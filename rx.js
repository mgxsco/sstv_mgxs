/**
 * SSTV Robot36 - Receiver UI
 */

// Audio state
let audioCtx = null;
let rxStream = null;
let rxSource = null;
let rxProcessor = null;
let analyser = null;
let animFrame = null;

// Decoder state
let rxChunks = [];
let isListening = false;
let signalDetected = false;
let leaderDetectCount = 0;

// Image buffers
let liveYImage = null;
let liveCrImage = null;
let liveCbImage = null;
let liveCanvas = null;
let liveCtx = null;

// Streaming decoder state
let streamBuffer = new Float32Array(0);
let streamLineNum = 0;
let streamStarted = false;
let streamLeaderCount = 0;
let streamImageStartIdx = 0;

// Adjustment state
let decodedFreqs = null;
let decodedImageStart = 0;

// Constants
const STREAM_LINE_SAMPLES = Math.floor(LINE_DURATION * SAMPLE_RATE);
const STREAM_MIN_BUFFER = STREAM_LINE_SAMPLES * 3;
const LEADER_DETECT_THRESHOLD = 5;

// DOM elements
const elements = {
    canvas: null,
    placeholder: null,
    lineIndicator: null,
    audioFileInput: null,
    btnStart: null,
    btnSave: null,
    btnClear: null,
    progress: null,
    status: null,
    phaseSlider: null,
    skewSlider: null,
    phaseValue: null,
    skewValue: null
};

/**
 * Initialize the RX page
 */
function init() {
    elements.canvas = document.getElementById('rx-canvas');
    elements.placeholder = document.getElementById('rx-placeholder');
    elements.lineIndicator = document.getElementById('line-indicator');
    elements.audioFileInput = document.getElementById('audio-file');
    elements.btnStart = document.getElementById('btn-start');
    elements.btnSave = document.getElementById('btn-save');
    elements.btnClear = document.getElementById('btn-clear');
    elements.progress = document.getElementById('rx-progress');
    elements.status = document.getElementById('rx-status');
    elements.phaseSlider = document.getElementById('phase-slider');
    elements.skewSlider = document.getElementById('skew-slider');
    elements.phaseValue = document.getElementById('phase-value');
    elements.skewValue = document.getElementById('skew-value');

    // Event handlers
    elements.btnStart.addEventListener('click', toggleListening);
    elements.btnSave.addEventListener('click', saveImage);
    elements.btnClear.addEventListener('click', clearRx);
    elements.audioFileInput.addEventListener('change', handleAudioFile);
    elements.phaseSlider.addEventListener('input', adjustDecode);
    elements.skewSlider.addEventListener('input', adjustDecode);
}

/**
 * Initialize image buffers
 */
function initLiveBuffers() {
    liveYImage = new Array(HEIGHT).fill(null).map(() => new Uint8Array(WIDTH).fill(128));
    liveCrImage = new Array(HEIGHT).fill(null).map(() => new Uint8Array(WIDTH).fill(128));
    liveCbImage = new Array(HEIGHT).fill(null).map(() => new Uint8Array(WIDTH).fill(128));

    liveCanvas = elements.canvas;
    liveCtx = liveCanvas.getContext('2d');
    liveCtx.fillStyle = '#000';
    liveCtx.fillRect(0, 0, WIDTH, HEIGHT);

    liveCanvas.style.display = 'block';
    elements.placeholder.style.display = 'none';
    elements.lineIndicator.style.display = 'block';
    elements.lineIndicator.textContent = `0/${HEIGHT}`;
}

/**
 * Initialize streaming decoder
 */
function initStreamDecoder() {
    streamBuffer = new Float32Array(0);
    streamLineNum = 0;
    streamStarted = false;
    streamLeaderCount = 0;
    streamImageStartIdx = 0;
    initLiveBuffers();
}

/**
 * Render a single decoded line
 */
function renderLiveLine(lineNum) {
    if (lineNum <= 0 || lineNum > HEIGHT) return;

    const imgData = liveCtx.createImageData(WIDTH, 1);
    const y = lineNum - 1;

    for (let x = 0; x < WIDTH; x++) {
        const [r, g, b] = yCrCbToRgb(liveYImage[y][x], liveCrImage[y][x], liveCbImage[y][x]);
        imgData.data[x * 4] = r;
        imgData.data[x * 4 + 1] = g;
        imgData.data[x * 4 + 2] = b;
        imgData.data[x * 4 + 3] = 255;
    }

    liveCtx.putImageData(imgData, 0, y);
    elements.lineIndicator.textContent = `${lineNum}/${HEIGHT}`;
}

/**
 * Render full image from buffers
 */
function renderFullImage() {
    if (!liveCtx) {
        liveCanvas = elements.canvas;
        liveCtx = liveCanvas.getContext('2d');
    }

    const imgData = liveCtx.createImageData(WIDTH, HEIGHT);

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const [r, g, b] = yCrCbToRgb(liveYImage[y][x], liveCrImage[y][x], liveCbImage[y][x]);
            const idx = (y * WIDTH + x) * 4;
            imgData.data[idx] = r;
            imgData.data[idx + 1] = g;
            imgData.data[idx + 2] = b;
            imgData.data[idx + 3] = 255;
        }
    }

    liveCtx.putImageData(imgData, 0, 0);
}

/**
 * Apply decoded line data to buffers
 */
function applyLineToBuffers(lineNum, lineData) {
    liveYImage[lineNum] = lineData.y;
    if (lineData.isCrLine) {
        liveCrImage[lineNum] = lineData.color;
        if (lineNum > 0) liveCbImage[lineNum] = liveCbImage[lineNum - 1].slice();
    } else {
        liveCbImage[lineNum] = lineData.color;
        if (lineNum > 0) liveCrImage[lineNum] = liveCrImage[lineNum - 1].slice();
    }
}

/**
 * Process incoming audio chunk (streaming decode)
 */
function processStreamChunk(chunk) {
    // Append to buffer
    const newBuffer = new Float32Array(streamBuffer.length + chunk.length);
    newBuffer.set(streamBuffer);
    newBuffer.set(chunk, streamBuffer.length);
    streamBuffer = newBuffer;

    if (streamBuffer.length < STREAM_MIN_BUFFER) return;

    // Find signal start if not started
    if (!streamStarted) {
        const checkSamples = Math.min(chunk.length, 1000);
        let leaderCount = 0, prevSample = chunk[0], lastZero = 0;

        for (let i = 1; i < checkSamples; i++) {
            if (prevSample <= 0 && chunk[i] > 0) {
                const period = i - lastZero;
                const freq = SAMPLE_RATE / period;
                if (Math.abs(freq - LEADER_FREQ) < 200) leaderCount++;
                lastZero = i;
            }
            prevSample = chunk[i];
        }

        if (leaderCount > 5) {
            streamLeaderCount++;
            if (streamLeaderCount >= 3) {
                streamStarted = true;
                const headerDuration = LEADER_DURATION + BREAK_DURATION + 10 * VIS_BIT_DURATION + BREAK_DURATION;
                streamImageStartIdx = streamBuffer.length + Math.floor(headerDuration * SAMPLE_RATE);
                elements.status.textContent = 'Signal detected! Decoding in real-time...';
            }
        } else {
            streamLeaderCount = Math.max(0, streamLeaderCount - 1);
        }
        return;
    }

    // Process complete lines
    while (streamLineNum < HEIGHT) {
        const lineStart = streamImageStartIdx + streamLineNum * STREAM_LINE_SAMPLES;
        const lineEnd = lineStart + STREAM_LINE_SAMPLES;

        if (lineEnd + 500 > streamBuffer.length) break;

        const freqs = demodulateRealtime(streamBuffer, lineStart, lineEnd + 500);
        const lineData = decodeSingleLine(freqs, 0);
        applyLineToBuffers(streamLineNum, lineData);

        streamLineNum++;
        renderLiveLine(streamLineNum);

        elements.progress.style.width = (streamLineNum / HEIGHT * 100) + '%';
        elements.status.textContent = `Decoding line ${streamLineNum}/${HEIGHT}...`;
    }

    // Trim buffer to save memory
    if (streamLineNum > 2) {
        const keepFrom = streamImageStartIdx + (streamLineNum - 2) * STREAM_LINE_SAMPLES;
        if (keepFrom > 0 && keepFrom < streamBuffer.length) {
            const newBuf = new Float32Array(streamBuffer.length - keepFrom);
            newBuf.set(streamBuffer.subarray(keepFrom));
            streamBuffer = newBuf;
            streamImageStartIdx -= keepFrom;
        }
    }

    // Check if complete
    if (streamLineNum >= HEIGHT) {
        elements.status.textContent = `Complete! Decoded ${streamLineNum} lines`;
        elements.btnSave.disabled = false;
        setTimeout(() => { if (isListening) stopListening(); }, 500);
    }
}

/**
 * Toggle listening state
 */
async function toggleListening() {
    if (isListening) {
        stopAndDecode();
    } else {
        await startListening();
    }
}

/**
 * Start listening for SSTV signal
 */
async function startListening() {
    try {
        rxStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: SAMPLE_RATE
            }
        });

        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        rxSource = audioCtx.createMediaStreamSource(rxStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        rxProcessor = audioCtx.createScriptProcessor(4096, 1, 1);

        rxSource.connect(analyser);
        analyser.connect(rxProcessor);
        rxProcessor.connect(audioCtx.destination);

        rxChunks = [];
        isListening = true;
        signalDetected = false;
        leaderDetectCount = 0;

        initStreamDecoder();

        rxProcessor.onaudioprocess = e => {
            if (!isListening) return;

            const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
            rxChunks.push(chunk);
            processStreamChunk(chunk);

            // Auto-stop after max duration
            const totalSamples = rxChunks.reduce((s, c) => s + c.length, 0);
            const recordedTime = totalSamples / SAMPLE_RATE;
            if (recordedTime > TOTAL_DURATION + 5) {
                stopAndDecode();
            }
        };

        elements.btnStart.textContent = 'Stop';
        elements.btnStart.classList.add('recording');
        elements.status.textContent = 'Waiting for Robot36 signal...';

        updateRxDisplay();
    } catch (err) {
        elements.status.textContent = 'Mic error: ' + err.message;
    }
}

/**
 * Stop listening
 */
function stopListening() {
    isListening = false;
    signalDetected = false;

    if (rxStream) {
        rxStream.getTracks().forEach(t => t.stop());
        rxStream = null;
    }
    if (rxProcessor) {
        rxProcessor.disconnect();
        rxProcessor = null;
    }
    if (rxSource) {
        rxSource.disconnect();
        rxSource = null;
    }
    if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
    }

    elements.btnStart.textContent = 'Start';
    elements.btnStart.classList.remove('recording');
}

/**
 * Stop listening and prepare for adjustment
 */
async function stopAndDecode() {
    stopListening();

    if (streamLineNum > 0) {
        elements.status.textContent = `Decoded ${streamLineNum}/${HEIGHT} lines - preparing adjustments...`;
        elements.btnSave.disabled = false;

        if (rxChunks.length > 0) {
            const totalLen = rxChunks.reduce((s, c) => s + c.length, 0);
            const combined = new Float32Array(totalLen);
            let offset = 0;
            for (const chunk of rxChunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }

            await new Promise(r => setTimeout(r, 50));

            try {
                decodedFreqs = demodulateFFM(combined, null);
                decodedImageStart = detectSignalStart(decodedFreqs);
                elements.status.textContent = `Decoded ${streamLineNum}/${HEIGHT} lines - ready for adjustment`;
            } catch (e) {
                console.error('Adjustment prep failed:', e);
                elements.status.textContent = `Decoded ${streamLineNum}/${HEIGHT} lines`;
            }
        }
        return;
    }

    if (rxChunks.length > 0) {
        runDecode();
    }
}

/**
 * Update RX display (signal detection)
 */
function updateRxDisplay() {
    if (!isListening) return;

    if (analyser && audioCtx) {
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);

        if (!signalDetected) {
            const detection = detectLeaderTone(freqData, audioCtx.sampleRate, analyser.fftSize);
            if (detection.isLeader) {
                leaderDetectCount++;
                if (leaderDetectCount >= LEADER_DETECT_THRESHOLD) {
                    signalDetected = true;
                    elements.status.textContent = 'Signal detected! Recording...';
                    initLiveBuffers();
                }
            } else {
                leaderDetectCount = Math.max(0, leaderDetectCount - 1);
            }
        }

        if (!streamStarted || streamLineNum <= 0 || streamLineNum >= HEIGHT) {
            if (signalDetected) {
                const totalSamples = rxChunks.reduce((s, c) => s + c.length, 0);
                const secs = totalSamples / SAMPLE_RATE;
                const remaining = Math.max(0, TOTAL_DURATION - secs);
                elements.status.textContent = `Recording: ${secs.toFixed(1)}s (${remaining.toFixed(1)}s remaining)`;
                elements.progress.style.width = Math.min(100, secs / TOTAL_DURATION * 100) + '%';
            }
        }
    }

    animFrame = requestAnimationFrame(updateRxDisplay);
}

/**
 * Run full decode on recorded audio
 */
async function runDecode() {
    elements.status.textContent = 'Decoding...';
    elements.btnStart.disabled = true;

    await new Promise(r => setTimeout(r, 50));

    const totalLen = rxChunks.reduce((s, c) => s + c.length, 0);
    const combined = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of rxChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }

    const onProgress = (msg, pct) => {
        elements.status.textContent = msg;
        elements.progress.style.width = pct + '%';
    };

    try {
        const linesDecoded = decodeSSTV(combined, onProgress);
        if (linesDecoded && linesDecoded >= 3) {
            elements.btnSave.disabled = false;
            elements.status.textContent = `Decoded ${linesDecoded} lines - adjust alignment below`;
        } else {
            elements.status.textContent = 'Could not decode - try again';
        }
    } catch (err) {
        console.error(err);
        elements.status.textContent = 'Decode error: ' + err.message;
    }

    elements.btnStart.disabled = false;
}

/**
 * Full SSTV decode from audio
 */
function decodeSSTV(audio, onProgress) {
    onProgress?.('Starting decode...', 0);

    // Normalize audio
    let maxAmp = 0;
    for (let i = 0; i < audio.length; i++) {
        maxAmp = Math.max(maxAmp, Math.abs(audio[i]));
    }
    if (maxAmp > 0) {
        const normalized = new Float32Array(audio.length);
        for (let i = 0; i < audio.length; i++) {
            normalized[i] = audio[i] / maxAmp;
        }
        audio = normalized;
    }

    const freqs = demodulateFFM(audio, onProgress);
    decodedFreqs = freqs;

    onProgress?.('Finding signal start...', 10);
    const imageStart = detectSignalStart(freqs);
    decodedImageStart = imageStart;

    onProgress?.('Finding sync pulses...', 20);
    let syncPulses = findSyncPulses(freqs.slice(imageStart));
    syncPulses = syncPulses.map(s => s + imageStart);
    syncPulses = findRegularSyncs(syncPulses);

    if (syncPulses.length < 3) {
        const lineSamples = Math.floor(LINE_DURATION * SAMPLE_RATE);
        syncPulses = [];
        for (let i = imageStart; i < freqs.length - lineSamples; i += lineSamples) {
            syncPulses.push(i);
            if (syncPulses.length >= HEIGHT) break;
        }
    }

    initLiveBuffers();

    const lineSamples = Math.floor(LINE_DURATION * SAMPLE_RATE);
    let linesDecoded = 0;
    const lineHasCr = new Array(HEIGHT).fill(false);

    onProgress?.('Decoding lines...', 30);

    for (let i = 0; i < syncPulses.length && linesDecoded < HEIGHT; i++) {
        const syncPos = syncPulses[i];
        if (syncPos + lineSamples > freqs.length) break;

        const lineData = decodeSingleLine(freqs, syncPos);
        applyLineToBuffers(linesDecoded, lineData);
        lineHasCr[linesDecoded] = lineData.isCrLine;

        linesDecoded++;
        renderLiveLine(linesDecoded);

        const pct = 30 + (linesDecoded / HEIGHT) * 60;
        onProgress?.(`Decoded ${linesDecoded}/${HEIGHT} lines`, pct);
    }

    if (linesDecoded < 3) return null;

    onProgress?.('Interpolating colors...', 92);
    interpolateColors(lineHasCr, linesDecoded);

    onProgress?.('Rendering final image...', 98);
    renderFullImage();

    onProgress?.('Done!', 100);
    return linesDecoded;
}

/**
 * Interpolate missing color channels
 */
function interpolateColors(lineHasCr, linesDecoded) {
    for (let i = 1; i < linesDecoded - 1; i++) {
        if (lineHasCr[i]) {
            let prevCb = -1, nextCb = -1;
            for (let j = i - 1; j >= 0; j--) if (!lineHasCr[j]) { prevCb = j; break; }
            for (let j = i + 1; j < linesDecoded; j++) if (!lineHasCr[j]) { nextCb = j; break; }
            if (prevCb >= 0 && nextCb >= 0) {
                const t = (i - prevCb) / (nextCb - prevCb);
                for (let x = 0; x < WIDTH; x++) {
                    liveCbImage[i][x] = Math.floor(liveCbImage[prevCb][x] * (1 - t) + liveCbImage[nextCb][x] * t);
                }
            }
        } else {
            let prevCr = -1, nextCr = -1;
            for (let j = i - 1; j >= 0; j--) if (lineHasCr[j]) { prevCr = j; break; }
            for (let j = i + 1; j < linesDecoded; j++) if (lineHasCr[j]) { nextCr = j; break; }
            if (prevCr >= 0 && nextCr >= 0) {
                const t = (i - prevCr) / (nextCr - prevCr);
                for (let x = 0; x < WIDTH; x++) {
                    liveCrImage[i][x] = Math.floor(liveCrImage[prevCr][x] * (1 - t) + liveCrImage[nextCr][x] * t);
                }
            }
        }
    }
}

/**
 * Adjust decode with phase and skew
 */
function adjustDecode() {
    const phase = parseInt(elements.phaseSlider.value);
    const skew = parseFloat(elements.skewSlider.value);

    elements.phaseValue.textContent = phase;
    elements.skewValue.textContent = skew;

    if (!decodedFreqs) return;

    // Ensure canvas is ready
    if (!liveCtx) {
        liveCanvas = elements.canvas;
        liveCtx = liveCanvas.getContext('2d');
    }

    liveCanvas.style.display = 'block';
    elements.placeholder.style.display = 'none';

    const freqs = decodedFreqs;
    const baseLineSamples = Math.floor(LINE_DURATION * SAMPLE_RATE);
    const syncSamples = Math.floor(SYNC_DURATION * SAMPLE_RATE);
    const porchSamples = Math.floor(SYNC_PORCH_DURATION * SAMPLE_RATE);
    const ySamples = Math.floor(Y_SCAN_DURATION * SAMPLE_RATE);
    const sepSamples = Math.floor(SEPARATOR_DURATION * SAMPLE_RATE);
    const colorPorchSamples = Math.floor(COLOR_PORCH_DURATION * SAMPLE_RATE);
    const colorSamples = Math.floor(COLOR_SCAN_DURATION * SAMPLE_RATE);

    // Re-init buffers
    liveYImage = new Array(HEIGHT).fill(null).map(() => new Uint8Array(WIDTH).fill(128));
    liveCrImage = new Array(HEIGHT).fill(null).map(() => new Uint8Array(WIDTH).fill(128));
    liveCbImage = new Array(HEIGHT).fill(null).map(() => new Uint8Array(WIDTH).fill(128));

    const lineHasCr = [];

    for (let line = 0; line < HEIGHT; line++) {
        const lineSamples = baseLineSamples + skew;
        const lineStart = decodedImageStart + phase + Math.floor(line * lineSamples);

        if (lineStart < 0 || lineStart + baseLineSamples > freqs.length) {
            lineHasCr.push(line % 2 === 0);
            continue;
        }

        // Extract Y
        const yStart = lineStart + syncSamples + porchSamples;
        const yEnd = yStart + ySamples;

        for (let x = 0; x < WIDTH; x++) {
            const idx = yStart + Math.floor(x / WIDTH * (yEnd - yStart));
            if (idx >= 0 && idx < freqs.length) {
                liveYImage[line][x] = freqToValue(freqs[idx]);
            }
        }

        // Detect separator tone
        const sepStart = yEnd;
        let sepFreqSum = 0;
        for (let s = 0; s < sepSamples && sepStart + s < freqs.length; s++) {
            sepFreqSum += freqs[sepStart + s];
        }
        const avgSepFreq = sepFreqSum / sepSamples;
        const isCrLine = avgSepFreq < 1900;
        lineHasCr.push(isCrLine);

        // Extract color
        const colorStart = sepStart + sepSamples + colorPorchSamples;
        const colorEnd = colorStart + colorSamples;
        const colorImg = isCrLine ? liveCrImage : liveCbImage;

        for (let x = 0; x < WIDTH; x++) {
            const idx = colorStart + Math.floor(x / WIDTH * (colorEnd - colorStart));
            if (idx >= 0 && idx < freqs.length) {
                colorImg[line][x] = freqToValue(freqs[idx]);
            }
        }
    }

    // Interpolate missing channels
    interpolateColors(lineHasCr, HEIGHT);
    renderFullImage();
}

/**
 * Handle audio file selection
 */
async function handleAudioFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    elements.status.textContent = 'Loading audio file...';

    try {
        const arrayBuffer = await file.arrayBuffer();
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        let audioData;
        if (audioBuffer.numberOfChannels > 1) {
            audioData = new Float32Array(audioBuffer.length);
            const ch0 = audioBuffer.getChannelData(0);
            const ch1 = audioBuffer.getChannelData(1);
            for (let i = 0; i < audioBuffer.length; i++) {
                audioData[i] = (ch0[i] + ch1[i]) / 2;
            }
        } else {
            audioData = audioBuffer.getChannelData(0);
        }

        // Resample if needed
        if (audioBuffer.sampleRate !== SAMPLE_RATE) {
            elements.status.textContent = 'Resampling audio...';
            const ratio = SAMPLE_RATE / audioBuffer.sampleRate;
            const newLength = Math.floor(audioData.length * ratio);
            const resampled = new Float32Array(newLength);
            for (let i = 0; i < newLength; i++) {
                const srcIdx = i / ratio;
                const idx = Math.floor(srcIdx);
                const frac = srcIdx - idx;
                resampled[i] = idx + 1 < audioData.length
                    ? audioData[idx] * (1 - frac) + audioData[idx + 1] * frac
                    : audioData[idx];
            }
            audioData = resampled;
        }

        rxChunks = [audioData];
        elements.status.textContent = `Loaded ${(audioData.length / SAMPLE_RATE).toFixed(1)}s of audio`;

        await runDecode();
    } catch (err) {
        elements.status.textContent = 'Error loading audio: ' + err.message;
    }
}

/**
 * Clear RX state
 */
function clearRx() {
    rxChunks = [];
    decodedFreqs = null;
    decodedImageStart = 0;

    streamBuffer = new Float32Array(0);
    streamLineNum = 0;
    streamStarted = false;
    streamLeaderCount = 0;
    streamImageStartIdx = 0;

    elements.phaseSlider.value = 0;
    elements.skewSlider.value = 0;
    elements.phaseValue.textContent = '0';
    elements.skewValue.textContent = '0';

    const ctx = elements.canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    elements.canvas.style.display = 'none';

    elements.placeholder.style.display = 'block';
    elements.lineIndicator.style.display = 'none';
    elements.btnSave.disabled = true;
    elements.progress.style.width = '0%';
    elements.status.textContent = 'Click Start to listen';
}

/**
 * Save decoded image
 */
function saveImage() {
    const link = document.createElement('a');
    link.download = 'sstv_' + Date.now() + '.png';
    link.href = elements.canvas.toDataURL();
    link.click();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
