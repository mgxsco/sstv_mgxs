/**
 * SSTV Robot36 - Receiver
 */

var audioCtx = null;
var rxStream = null;
var rxSource = null;
var rxProcessor = null;
var analyser = null;
var animFrame = null;

var rxChunks = [];
var isListening = false;
var signalDetected = false;
var leaderDetectCount = 0;

var liveYImage = null;
var liveCrImage = null;
var liveCbImage = null;
var liveCtx = null;

var streamBuffer = [];
var streamLineNum = 0;
var streamStarted = false;
var streamLeaderCount = 0;
var streamImageStartIdx = 0;

var decodedFreqs = null;
var decodedImageStart = 0;
var originalImageStart = 0;  // Store the original start position from streaming decode

var LINE_SAMPLES = Math.floor(LINE_DURATION * SAMPLE_RATE);

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('btn-start').addEventListener('click', function() {
        if (isListening) {
            stopAndDecode();
        } else {
            startListening();
        }
    });

    document.getElementById('btn-rx-save').addEventListener('click', function() {
        saveImage();
    });

    document.getElementById('btn-clear').addEventListener('click', function() {
        clearRx();
    });

    document.getElementById('audio-file').addEventListener('change', function(e) {
        handleAudioFile(e);
    });

    document.getElementById('phase-slider').addEventListener('input', function() {
        adjustDecode();
    });

    document.getElementById('skew-slider').addEventListener('input', function() {
        adjustDecode();
    });
});

function initBuffers() {
    liveYImage = [];
    liveCrImage = [];
    liveCbImage = [];
    for (var y = 0; y < HEIGHT; y++) {
        liveYImage[y] = new Uint8Array(WIDTH);
        liveCrImage[y] = new Uint8Array(WIDTH);
        liveCbImage[y] = new Uint8Array(WIDTH);
        for (var x = 0; x < WIDTH; x++) {
            liveYImage[y][x] = 128;
            liveCrImage[y][x] = 128;
            liveCbImage[y][x] = 128;
        }
    }

    var canvas = document.getElementById('rx-canvas');
    liveCtx = canvas.getContext('2d');
    liveCtx.fillStyle = '#000';
    liveCtx.fillRect(0, 0, WIDTH, HEIGHT);

    canvas.style.display = 'block';
    document.getElementById('rx-placeholder').style.display = 'none';
    document.getElementById('line-indicator').style.display = 'block';
    document.getElementById('line-indicator').textContent = '0/' + HEIGHT;
}

function initStreamDecoder() {
    streamBuffer = [];
    streamLineNum = 0;
    streamStarted = false;
    streamLeaderCount = 0;
    streamImageStartIdx = 0;

    // Clear previous session's decoded data so phase/skew uses new audio
    decodedFreqs = null;
    decodedImageStart = 0;
    originalImageStart = 0;

    initBuffers();
}

function renderLine(lineNum) {
    if (lineNum < 0 || lineNum >= HEIGHT) return;

    var imgData = liveCtx.createImageData(WIDTH, 1);

    for (var x = 0; x < WIDTH; x++) {
        var rgb = yCrCbToRgb(liveYImage[lineNum][x], liveCrImage[lineNum][x], liveCbImage[lineNum][x]);
        imgData.data[x * 4] = rgb[0];
        imgData.data[x * 4 + 1] = rgb[1];
        imgData.data[x * 4 + 2] = rgb[2];
        imgData.data[x * 4 + 3] = 255;
    }

    liveCtx.putImageData(imgData, 0, lineNum);
    document.getElementById('line-indicator').textContent = (lineNum + 1) + '/' + HEIGHT;
}

function renderFullImage() {
    if (!liveCtx) {
        var canvas = document.getElementById('rx-canvas');
        liveCtx = canvas.getContext('2d');
    }

    var imgData = liveCtx.createImageData(WIDTH, HEIGHT);

    for (var y = 0; y < HEIGHT; y++) {
        for (var x = 0; x < WIDTH; x++) {
            var rgb = yCrCbToRgb(liveYImage[y][x], liveCrImage[y][x], liveCbImage[y][x]);
            var idx = (y * WIDTH + x) * 4;
            imgData.data[idx] = rgb[0];
            imgData.data[idx + 1] = rgb[1];
            imgData.data[idx + 2] = rgb[2];
            imgData.data[idx + 3] = 255;
        }
    }

    liveCtx.putImageData(imgData, 0, 0);
}

function applyLineData(lineNum, lineData) {
    for (var x = 0; x < WIDTH; x++) {
        liveYImage[lineNum][x] = lineData.y[x];
    }

    if (lineData.isCrLine) {
        for (var x = 0; x < WIDTH; x++) {
            liveCrImage[lineNum][x] = lineData.color[x];
        }
        if (lineNum > 0) {
            for (var x = 0; x < WIDTH; x++) {
                liveCbImage[lineNum][x] = liveCbImage[lineNum - 1][x];
            }
        }
    } else {
        for (var x = 0; x < WIDTH; x++) {
            liveCbImage[lineNum][x] = lineData.color[x];
        }
        if (lineNum > 0) {
            for (var x = 0; x < WIDTH; x++) {
                liveCrImage[lineNum][x] = liveCrImage[lineNum - 1][x];
            }
        }
    }
}

function getStreamBufferFloat32() {
    var totalLen = 0;
    for (var i = 0; i < streamBuffer.length; i++) {
        totalLen += streamBuffer[i].length;
    }
    var result = new Float32Array(totalLen);
    var offset = 0;
    for (var i = 0; i < streamBuffer.length; i++) {
        result.set(streamBuffer[i], offset);
        offset += streamBuffer[i].length;
    }
    return result;
}

function processStreamChunk(chunk) {
    streamBuffer.push(chunk);

    var totalSamples = 0;
    for (var i = 0; i < streamBuffer.length; i++) {
        totalSamples += streamBuffer[i].length;
    }

    if (totalSamples < LINE_SAMPLES * 3) return;

    if (!streamStarted) {
        var leaderCount = 0;
        var prevSample = chunk[0];
        var lastZero = 0;

        for (var i = 1; i < Math.min(chunk.length, 1000); i++) {
            if (prevSample <= 0 && chunk[i] > 0) {
                var period = i - lastZero;
                if (period > 0) {
                    var freq = SAMPLE_RATE / period;
                    if (Math.abs(freq - LEADER_FREQ) < 200) {
                        leaderCount++;
                    }
                }
                lastZero = i;
            }
            prevSample = chunk[i];
        }

        if (leaderCount > 5) {
            streamLeaderCount++;
            if (streamLeaderCount >= 3) {
                streamStarted = true;
                var headerDuration = LEADER_DURATION + BREAK_DURATION + 10 * VIS_BIT_DURATION + BREAK_DURATION;
                streamImageStartIdx = totalSamples + Math.floor(headerDuration * SAMPLE_RATE);
                document.getElementById('rx-status').textContent = 'Signal detected! Decoding...';
            }
        } else {
            streamLeaderCount = Math.max(0, streamLeaderCount - 1);
        }
        return;
    }

    var combined = getStreamBufferFloat32();

    while (streamLineNum < HEIGHT) {
        var lineStart = streamImageStartIdx + streamLineNum * LINE_SAMPLES;
        var lineEnd = lineStart + LINE_SAMPLES;

        if (lineEnd + 500 > combined.length) break;

        var freqs = demodulateRealtime(combined, lineStart, lineEnd + 500);
        var lineData = decodeSingleLine(freqs, 0);
        applyLineData(streamLineNum, lineData);
        renderLine(streamLineNum);

        streamLineNum++;

        document.getElementById('rx-progress').style.width = (streamLineNum / HEIGHT * 100) + '%';
        document.getElementById('rx-status').textContent = 'Decoding line ' + streamLineNum + '/' + HEIGHT;
    }

    if (streamLineNum >= HEIGHT) {
        document.getElementById('rx-status').textContent = 'Complete! Decoded ' + streamLineNum + ' lines';
        document.getElementById('btn-rx-save').disabled = false;
        setTimeout(function() {
            if (isListening) stopListening();
        }, 500);
    }
}

function startListening() {
    navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        }
    }).then(function(stream) {
        rxStream = stream;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        rxSource = audioCtx.createMediaStreamSource(stream);
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

        rxProcessor.onaudioprocess = function(e) {
            if (!isListening) return;

            var chunk = new Float32Array(e.inputBuffer.getChannelData(0));
            rxChunks.push(chunk);
            processStreamChunk(chunk);

            var totalSamples = 0;
            for (var i = 0; i < rxChunks.length; i++) {
                totalSamples += rxChunks[i].length;
            }
            var recordedTime = totalSamples / SAMPLE_RATE;
            if (recordedTime > TOTAL_DURATION + 5) {
                stopAndDecode();
            }
        };

        document.getElementById('btn-start').textContent = 'Stop';
        document.getElementById('btn-start').classList.add('recording');
        document.getElementById('rx-status').textContent = 'Listening for Robot36 signal...';

        updateDisplay();
    }).catch(function(err) {
        document.getElementById('rx-status').textContent = 'Microphone error: ' + err.message;
    });
}

function stopListening() {
    isListening = false;
    signalDetected = false;

    if (rxStream) {
        var tracks = rxStream.getTracks();
        for (var i = 0; i < tracks.length; i++) {
            tracks[i].stop();
        }
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

    document.getElementById('btn-start').textContent = 'Start';
    document.getElementById('btn-start').classList.remove('recording');
}

function stopAndDecode() {
    stopListening();

    if (streamLineNum > 0) {
        document.getElementById('rx-status').textContent = 'Decoded ' + streamLineNum + '/' + HEIGHT + ' lines - preparing adjustments...';
        document.getElementById('btn-rx-save').disabled = false;

        if (rxChunks.length > 0) {
            var totalLen = 0;
            for (var i = 0; i < rxChunks.length; i++) {
                totalLen += rxChunks[i].length;
            }
            var combined = new Float32Array(totalLen);
            var offset = 0;
            for (var i = 0; i < rxChunks.length; i++) {
                combined.set(rxChunks[i], offset);
                offset += rxChunks[i].length;
            }

            // Save the original start position used by streaming decoder
            // Need to account for buffer that wasn't trimmed
            originalImageStart = streamImageStartIdx;

            setTimeout(function() {
                try {
                    decodedFreqs = demodulateFFM(combined, null);
                    // Use the streaming decoder's start position as base, not detectSignalStart
                    // which might return a different position
                    decodedImageStart = originalImageStart;
                    document.getElementById('rx-status').textContent = 'Decoded ' + streamLineNum + '/' + HEIGHT + ' lines - ready for adjustment';
                } catch (e) {
                    console.error('Adjustment prep failed:', e);
                    document.getElementById('rx-status').textContent = 'Decoded ' + streamLineNum + '/' + HEIGHT + ' lines';
                }
            }, 50);
        }
        return;
    }

    if (rxChunks.length > 0) {
        runFullDecode();
    }
}

function updateDisplay() {
    if (!isListening) return;

    if (analyser && audioCtx) {
        var freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);

        if (!signalDetected) {
            var detection = detectLeaderTone(freqData, audioCtx.sampleRate, analyser.fftSize);
            if (detection.isLeader) {
                leaderDetectCount++;
                if (leaderDetectCount >= 5) {
                    signalDetected = true;
                    document.getElementById('rx-status').textContent = 'Signal detected! Recording...';
                    initBuffers();
                }
            } else {
                leaderDetectCount = Math.max(0, leaderDetectCount - 1);
            }
        }

        if (!streamStarted || streamLineNum <= 0 || streamLineNum >= HEIGHT) {
            if (signalDetected) {
                var totalSamples = 0;
                for (var i = 0; i < rxChunks.length; i++) {
                    totalSamples += rxChunks[i].length;
                }
                var secs = totalSamples / SAMPLE_RATE;
                var remaining = Math.max(0, TOTAL_DURATION - secs);
                document.getElementById('rx-status').textContent = 'Recording: ' + secs.toFixed(1) + 's (' + remaining.toFixed(1) + 's remaining)';
                document.getElementById('rx-progress').style.width = Math.min(100, secs / TOTAL_DURATION * 100) + '%';
            }
        }
    }

    animFrame = requestAnimationFrame(updateDisplay);
}

function runFullDecode() {
    document.getElementById('rx-status').textContent = 'Decoding...';
    document.getElementById('btn-start').disabled = true;

    setTimeout(function() {
        var totalLen = 0;
        for (var i = 0; i < rxChunks.length; i++) {
            totalLen += rxChunks[i].length;
        }
        var combined = new Float32Array(totalLen);
        var offset = 0;
        for (var i = 0; i < rxChunks.length; i++) {
            combined.set(rxChunks[i], offset);
            offset += rxChunks[i].length;
        }

        try {
            var linesDecoded = decodeSSTV(combined);
            if (linesDecoded && linesDecoded >= 3) {
                document.getElementById('btn-rx-save').disabled = false;
                document.getElementById('rx-status').textContent = 'Decoded ' + linesDecoded + ' lines - adjust alignment below';
            } else {
                document.getElementById('rx-status').textContent = 'Could not decode - try again';
            }
        } catch (err) {
            console.error(err);
            document.getElementById('rx-status').textContent = 'Decode error: ' + err.message;
        }

        document.getElementById('btn-start').disabled = false;
    }, 50);
}

function decodeSSTV(audio) {
    document.getElementById('rx-status').textContent = 'Starting decode...';
    document.getElementById('rx-progress').style.width = '0%';

    // Normalize audio
    var maxAmp = 0;
    for (var i = 0; i < audio.length; i++) {
        maxAmp = Math.max(maxAmp, Math.abs(audio[i]));
    }
    if (maxAmp > 0) {
        var normalized = new Float32Array(audio.length);
        for (var i = 0; i < audio.length; i++) {
            normalized[i] = audio[i] / maxAmp;
        }
        audio = normalized;
    }

    document.getElementById('rx-status').textContent = 'Demodulating...';
    document.getElementById('rx-progress').style.width = '10%';

    var freqs = demodulateFFM(audio, null);
    decodedFreqs = freqs;

    document.getElementById('rx-status').textContent = 'Finding signal start...';
    document.getElementById('rx-progress').style.width = '20%';

    var imageStart = detectSignalStart(freqs);
    decodedImageStart = imageStart;

    document.getElementById('rx-status').textContent = 'Finding sync pulses...';
    document.getElementById('rx-progress').style.width = '30%';

    var syncPulses = findSyncPulses(freqs.subarray(imageStart));
    for (var i = 0; i < syncPulses.length; i++) {
        syncPulses[i] += imageStart;
    }
    syncPulses = findRegularSyncs(syncPulses);

    if (syncPulses.length < 3) {
        syncPulses = [];
        for (var i = imageStart; i < freqs.length - LINE_SAMPLES; i += LINE_SAMPLES) {
            syncPulses.push(i);
            if (syncPulses.length >= HEIGHT) break;
        }
    }

    initBuffers();

    var linesDecoded = 0;
    var lineHasCr = [];

    document.getElementById('rx-status').textContent = 'Decoding lines...';

    for (var i = 0; i < syncPulses.length && linesDecoded < HEIGHT; i++) {
        var syncPos = syncPulses[i];
        if (syncPos + LINE_SAMPLES > freqs.length) break;

        var lineData = decodeSingleLine(freqs, syncPos);
        applyLineData(linesDecoded, lineData);
        lineHasCr[linesDecoded] = lineData.isCrLine;

        renderLine(linesDecoded);
        linesDecoded++;

        var pct = 30 + (linesDecoded / HEIGHT) * 60;
        document.getElementById('rx-progress').style.width = pct + '%';
    }

    if (linesDecoded < 3) return null;

    document.getElementById('rx-status').textContent = 'Interpolating colors...';
    document.getElementById('rx-progress').style.width = '92%';

    interpolateColors(lineHasCr, linesDecoded);

    document.getElementById('rx-status').textContent = 'Rendering final image...';
    document.getElementById('rx-progress').style.width = '98%';

    renderFullImage();

    document.getElementById('rx-progress').style.width = '100%';
    return linesDecoded;
}

function interpolateColors(lineHasCr, linesDecoded) {
    for (var i = 1; i < linesDecoded - 1; i++) {
        if (lineHasCr[i]) {
            var prevCb = -1, nextCb = -1;
            for (var j = i - 1; j >= 0; j--) {
                if (!lineHasCr[j]) { prevCb = j; break; }
            }
            for (var j = i + 1; j < linesDecoded; j++) {
                if (!lineHasCr[j]) { nextCb = j; break; }
            }
            if (prevCb >= 0 && nextCb >= 0) {
                var t = (i - prevCb) / (nextCb - prevCb);
                for (var x = 0; x < WIDTH; x++) {
                    liveCbImage[i][x] = Math.floor(liveCbImage[prevCb][x] * (1 - t) + liveCbImage[nextCb][x] * t);
                }
            }
        } else {
            var prevCr = -1, nextCr = -1;
            for (var j = i - 1; j >= 0; j--) {
                if (lineHasCr[j]) { prevCr = j; break; }
            }
            for (var j = i + 1; j < linesDecoded; j++) {
                if (lineHasCr[j]) { nextCr = j; break; }
            }
            if (prevCr >= 0 && nextCr >= 0) {
                var t = (i - prevCr) / (nextCr - prevCr);
                for (var x = 0; x < WIDTH; x++) {
                    liveCrImage[i][x] = Math.floor(liveCrImage[prevCr][x] * (1 - t) + liveCrImage[nextCr][x] * t);
                }
            }
        }
    }
}

function adjustDecode() {
    var phase = parseInt(document.getElementById('phase-slider').value);
    var skew = parseFloat(document.getElementById('skew-slider').value);

    document.getElementById('phase-value').textContent = phase;
    document.getElementById('skew-value').textContent = skew;

    if (!decodedFreqs) {
        // If we have recorded audio but haven't demodulated yet, do it now
        if (rxChunks.length > 0 && !isListening) {
            document.getElementById('rx-status').textContent = 'Processing audio for adjustment...';
            var totalLen = 0;
            for (var i = 0; i < rxChunks.length; i++) {
                totalLen += rxChunks[i].length;
            }
            var combined = new Float32Array(totalLen);
            var offset = 0;
            for (var i = 0; i < rxChunks.length; i++) {
                combined.set(rxChunks[i], offset);
                offset += rxChunks[i].length;
            }
            try {
                decodedFreqs = demodulateFFM(combined, null);
                // Use streaming decoder's start position if available, otherwise detect
                if (originalImageStart > 0) {
                    decodedImageStart = originalImageStart;
                } else {
                    decodedImageStart = detectSignalStart(decodedFreqs);
                }
            } catch (e) {
                document.getElementById('rx-status').textContent = 'Error processing audio';
                return;
            }
        } else {
            return;
        }
    }

    var canvas = document.getElementById('rx-canvas');
    if (!liveCtx) {
        liveCtx = canvas.getContext('2d');
    }

    canvas.style.display = 'block';
    document.getElementById('rx-placeholder').style.display = 'none';

    var freqs = decodedFreqs;
    var baseLineSamples = Math.floor(LINE_DURATION * SAMPLE_RATE);
    var syncSamples = Math.floor(SYNC_DURATION * SAMPLE_RATE);
    var porchSamples = Math.floor(SYNC_PORCH_DURATION * SAMPLE_RATE);
    var ySamples = Math.floor(Y_SCAN_DURATION * SAMPLE_RATE);
    var sepSamples = Math.floor(SEPARATOR_DURATION * SAMPLE_RATE);
    var colorPorchSamples = Math.floor(COLOR_PORCH_DURATION * SAMPLE_RATE);
    var colorSamples = Math.floor(COLOR_SCAN_DURATION * SAMPLE_RATE);

    // Work on temporary buffers to avoid erasing current image if something goes wrong
    var tempY = [];
    var tempCr = [];
    var tempCb = [];
    for (var y = 0; y < HEIGHT; y++) {
        tempY[y] = new Uint8Array(WIDTH);
        tempCr[y] = new Uint8Array(WIDTH);
        tempCb[y] = new Uint8Array(WIDTH);
        for (var x = 0; x < WIDTH; x++) {
            tempY[y][x] = 128;
            tempCr[y][x] = 128;
            tempCb[y][x] = 128;
        }
    }

    var lineHasCr = [];
    var validLines = 0;

    for (var line = 0; line < HEIGHT; line++) {
        var lineSamples = baseLineSamples + skew;
        var lineStart = decodedImageStart + phase + Math.floor(line * lineSamples);

        if (lineStart < 0 || lineStart + baseLineSamples > freqs.length) {
            lineHasCr.push(line % 2 === 0);
            continue;
        }

        validLines++;

        // Extract Y
        var yStart = lineStart + syncSamples + porchSamples;
        var yEnd = yStart + ySamples;

        for (var x = 0; x < WIDTH; x++) {
            var idx = yStart + Math.floor(x / WIDTH * (yEnd - yStart));
            if (idx >= 0 && idx < freqs.length) {
                tempY[line][x] = freqToValue(freqs[idx]);
            }
        }

        // Detect separator tone
        var sepStart = yEnd;
        var sepFreqSum = 0;
        var sepCount = 0;
        for (var s = 0; s < sepSamples; s++) {
            if (sepStart + s < freqs.length) {
                sepFreqSum += freqs[sepStart + s];
                sepCount++;
            }
        }
        var avgSepFreq = sepCount > 0 ? sepFreqSum / sepCount : 1900;
        var isCrLine = avgSepFreq < 1900;
        lineHasCr.push(isCrLine);

        // Extract color
        var colorStart = sepStart + sepSamples + colorPorchSamples;
        var colorEnd = colorStart + colorSamples;

        for (var x = 0; x < WIDTH; x++) {
            var idx = colorStart + Math.floor(x / WIDTH * (colorEnd - colorStart));
            if (idx >= 0 && idx < freqs.length) {
                var val = freqToValue(freqs[idx]);
                if (isCrLine) {
                    tempCr[line][x] = val;
                } else {
                    tempCb[line][x] = val;
                }
            }
        }
    }

    // Only update live buffers if we successfully decoded some lines
    if (validLines < 10) {
        document.getElementById('rx-status').textContent = 'Adjustment out of range - try different values';
        return;
    }

    // Copy temp buffers to live buffers
    liveYImage = tempY;
    liveCrImage = tempCr;
    liveCbImage = tempCb;

    interpolateColors(lineHasCr, HEIGHT);
    renderFullImage();

    document.getElementById('rx-status').textContent = 'Adjusted - Phase: ' + phase + ', Skew: ' + skew;
}

function handleAudioFile(e) {
    var file = e.target.files[0];
    if (!file) return;

    document.getElementById('rx-status').textContent = 'Loading audio file...';

    var reader = new FileReader();
    reader.onload = function(ev) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        audioCtx.decodeAudioData(ev.target.result, function(audioBuffer) {
            var audioData;
            if (audioBuffer.numberOfChannels > 1) {
                audioData = new Float32Array(audioBuffer.length);
                var ch0 = audioBuffer.getChannelData(0);
                var ch1 = audioBuffer.getChannelData(1);
                for (var i = 0; i < audioBuffer.length; i++) {
                    audioData[i] = (ch0[i] + ch1[i]) / 2;
                }
            } else {
                audioData = new Float32Array(audioBuffer.getChannelData(0));
            }

            if (audioBuffer.sampleRate !== SAMPLE_RATE) {
                document.getElementById('rx-status').textContent = 'Resampling audio...';
                var ratio = SAMPLE_RATE / audioBuffer.sampleRate;
                var newLength = Math.floor(audioData.length * ratio);
                var resampled = new Float32Array(newLength);
                for (var i = 0; i < newLength; i++) {
                    var srcIdx = i / ratio;
                    var idx = Math.floor(srcIdx);
                    var frac = srcIdx - idx;
                    if (idx + 1 < audioData.length) {
                        resampled[i] = audioData[idx] * (1 - frac) + audioData[idx + 1] * frac;
                    } else {
                        resampled[i] = audioData[idx];
                    }
                }
                audioData = resampled;
            }

            rxChunks = [audioData];
            document.getElementById('rx-status').textContent = 'Loaded ' + (audioData.length / SAMPLE_RATE).toFixed(1) + 's of audio';

            runFullDecode();
        }, function(err) {
            document.getElementById('rx-status').textContent = 'Error decoding audio: ' + err;
        });
    };
    reader.readAsArrayBuffer(file);
}

function clearRx() {
    rxChunks = [];
    decodedFreqs = null;
    decodedImageStart = 0;
    originalImageStart = 0;

    streamBuffer = [];
    streamLineNum = 0;
    streamStarted = false;
    streamLeaderCount = 0;
    streamImageStartIdx = 0;

    document.getElementById('phase-slider').value = 0;
    document.getElementById('skew-slider').value = 0;
    document.getElementById('phase-value').textContent = '0';
    document.getElementById('skew-value').textContent = '0';

    var canvas = document.getElementById('rx-canvas');
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    canvas.style.display = 'none';

    document.getElementById('rx-placeholder').style.display = 'block';
    document.getElementById('line-indicator').style.display = 'none';
    document.getElementById('btn-rx-save').disabled = true;
    document.getElementById('rx-progress').style.width = '0%';
    document.getElementById('rx-status').textContent = 'Click Start to listen for signal';
}

function saveImage() {
    var canvas = document.getElementById('rx-canvas');
    var link = document.createElement('a');
    link.download = 'sstv_' + Date.now() + '.png';
    link.href = canvas.toDataURL();
    link.click();
}
