/**
 * SSTV Robot36 - Shared Constants and Utilities
 */

// Audio settings
const SAMPLE_RATE = 44100;

// Image dimensions
const WIDTH = 320;
const HEIGHT = 240;

// Frequencies (Hz)
const FREQ_BLACK = 1500;
const FREQ_WHITE = 2300;
const FREQ_SYNC = 1200;
const FREQ_VIS_1 = 1100;
const FREQ_VIS_0 = 1300;
const LEADER_FREQ = 1900;
const VIS_CODE = 8;  // Robot36

// Timing (seconds)
const LEADER_DURATION = 0.300;
const BREAK_DURATION = 0.010;
const VIS_BIT_DURATION = 0.030;
const SYNC_DURATION = 0.009;
const SYNC_PORCH_DURATION = 0.003;
const Y_SCAN_DURATION = 0.088;
const SEPARATOR_DURATION = 0.0045;
const COLOR_PORCH_DURATION = 0.0015;
const COLOR_SCAN_DURATION = 0.044;

// Derived timing constants
const LINE_DURATION = SYNC_DURATION + SYNC_PORCH_DURATION + Y_SCAN_DURATION +
                      SEPARATOR_DURATION + COLOR_PORCH_DURATION + COLOR_SCAN_DURATION;
const TOTAL_DURATION = LINE_DURATION * HEIGHT + 0.7;

/**
 * Color Conversion (ITU-R BT.601 full range)
 */
function rgbToYCrCb(r, g, b) {
    const y  = 0.299 * r + 0.587 * g + 0.114 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    return [
        Math.max(0, Math.min(255, Math.round(y))),
        Math.max(0, Math.min(255, Math.round(cr))),
        Math.max(0, Math.min(255, Math.round(cb)))
    ];
}

function yCrCbToRgb(y, cr, cb) {
    const r = y + 1.402 * (cr - 128);
    const g = y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128);
    const b = y + 1.772 * (cb - 128);
    return [
        Math.max(0, Math.min(255, Math.round(r))),
        Math.max(0, Math.min(255, Math.round(g))),
        Math.max(0, Math.min(255, Math.round(b)))
    ];
}

/**
 * Frequency/Value conversion
 */
function valueToFreq(value) {
    return FREQ_BLACK + (value / 255) * (FREQ_WHITE - FREQ_BLACK);
}

function freqToValue(freq) {
    const val = (freq - FREQ_BLACK) / (FREQ_WHITE - FREQ_BLACK) * 255;
    return Math.max(0, Math.min(255, Math.round(val)));
}

/**
 * WAV file creation
 */
function createWavFile(samples, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = samples.length * blockAlign;
    const fileSize = 44 + dataSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write samples as 16-bit PCM
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
    }

    return buffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

/**
 * SSTV Robot36 Encoder
 */
function encodeSSTV(imageData) {
    const samples = [];
    let phase = 0;

    function addTone(freq, duration) {
        const numSamples = Math.floor(duration * SAMPLE_RATE);
        for (let i = 0; i < numSamples; i++) {
            samples.push(Math.sin(phase));
            phase += 2 * Math.PI * freq / SAMPLE_RATE;
        }
    }

    function addFM(values, duration) {
        const numSamples = Math.floor(duration * SAMPLE_RATE);
        for (let i = 0; i < numSamples; i++) {
            const idx = Math.floor(i / numSamples * values.length);
            const val = values[Math.min(idx, values.length - 1)];
            const freq = valueToFreq(val);
            samples.push(Math.sin(phase));
            phase += 2 * Math.PI * freq / SAMPLE_RATE;
        }
    }

    // Convert image to YCrCb
    const ycrcb = [];
    for (let row = 0; row < HEIGHT; row++) {
        const yRow = [], crRow = [], cbRow = [];
        for (let col = 0; col < WIDTH; col++) {
            const idx = (row * WIDTH + col) * 4;
            const [y, cr, cb] = rgbToYCrCb(
                imageData.data[idx],
                imageData.data[idx + 1],
                imageData.data[idx + 2]
            );
            yRow.push(y);
            crRow.push(cr);
            cbRow.push(cb);
        }
        ycrcb.push({ y: yRow, cr: crRow, cb: cbRow });
    }

    // Leader tone
    addTone(LEADER_FREQ, LEADER_DURATION);
    addTone(FREQ_SYNC, BREAK_DURATION);

    // VIS code
    addTone(FREQ_VIS_1, VIS_BIT_DURATION);  // Start bit
    let parity = 0;
    for (let i = 0; i < 7; i++) {
        const bit = (VIS_CODE >> i) & 1;
        parity ^= bit;
        addTone(bit ? FREQ_VIS_1 : FREQ_VIS_0, VIS_BIT_DURATION);
    }
    addTone(parity ? FREQ_VIS_1 : FREQ_VIS_0, VIS_BIT_DURATION);  // Parity
    addTone(FREQ_VIS_0, VIS_BIT_DURATION);  // Stop bit
    addTone(FREQ_SYNC, BREAK_DURATION);

    // Image lines
    for (let line = 0; line < HEIGHT; line++) {
        const isEven = line % 2 === 0;
        addTone(FREQ_SYNC, SYNC_DURATION);
        addTone(FREQ_BLACK, SYNC_PORCH_DURATION);
        addFM(ycrcb[line].y, Y_SCAN_DURATION);
        addTone(isEven ? FREQ_BLACK : FREQ_WHITE, SEPARATOR_DURATION);
        addTone(FREQ_BLACK, COLOR_PORCH_DURATION);
        addFM(isEven ? ycrcb[line].cr : ycrcb[line].cb, COLOR_SCAN_DURATION);
    }

    // Convert to Float32Array with amplitude scaling
    const audio = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        audio[i] = samples[i] * 0.9;
    }
    return audio;
}

/**
 * DSP Functions for Decoder
 */
function simpleBandpass(signal, lowFreq, highFreq) {
    const n = 101;
    const h = new Float32Array(n);
    const fc1 = lowFreq / SAMPLE_RATE;
    const fc2 = highFreq / SAMPLE_RATE;

    for (let i = 0; i < n; i++) {
        const x = i - (n - 1) / 2;
        if (x === 0) {
            h[i] = 2 * (fc2 - fc1);
        } else {
            h[i] = (Math.sin(2 * Math.PI * fc2 * x) - Math.sin(2 * Math.PI * fc1 * x)) / (Math.PI * x);
        }
        h[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
    }

    const filtered = new Float32Array(signal.length);
    const halfN = Math.floor(n / 2);
    for (let i = 0; i < signal.length; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
            const idx = i - halfN + j;
            if (idx >= 0 && idx < signal.length) sum += signal[idx] * h[j];
        }
        filtered[i] = sum;
    }
    return filtered;
}

function lowpassFilter(signal, cutoff) {
    const n = 51;
    const h = new Float32Array(n);
    const fc = cutoff / SAMPLE_RATE;

    for (let i = 0; i < n; i++) {
        const x = i - (n - 1) / 2;
        if (x === 0) {
            h[i] = 2 * fc;
        } else {
            h[i] = Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
        }
        h[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
    }

    const filtered = new Float32Array(signal.length);
    const halfN = Math.floor(n / 2);
    for (let i = 0; i < signal.length; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
            const idx = i - halfN + j;
            if (idx >= 0 && idx < signal.length) sum += signal[idx] * h[j];
        }
        filtered[i] = sum;
    }
    return filtered;
}

function fft(real, imag) {
    const n = real.length;
    if (n <= 1) return;

    let j = 0;
    for (let i = 0; i < n - 1; i++) {
        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
        let k = n / 2;
        while (k <= j) { j -= k; k /= 2; }
        j += k;
    }

    for (let len = 2; len <= n; len *= 2) {
        const halfLen = len / 2;
        const angle = -2 * Math.PI / len;
        for (let i = 0; i < n; i += len) {
            for (let k = 0; k < halfLen; k++) {
                const cos = Math.cos(angle * k);
                const sin = Math.sin(angle * k);
                const tr = real[i + k + halfLen] * cos - imag[i + k + halfLen] * sin;
                const ti = real[i + k + halfLen] * sin + imag[i + k + halfLen] * cos;
                real[i + k + halfLen] = real[i + k] - tr;
                imag[i + k + halfLen] = imag[i + k] - ti;
                real[i + k] += tr;
                imag[i + k] += ti;
            }
        }
    }
}

function ifft(real, imag) {
    const n = real.length;
    for (let i = 0; i < n; i++) imag[i] = -imag[i];
    fft(real, imag);
    for (let i = 0; i < n; i++) {
        real[i] /= n;
        imag[i] = -imag[i] / n;
    }
}

function hilbert(signal) {
    const n = signal.length;
    let fftSize = 1;
    while (fftSize < n) fftSize *= 2;

    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    for (let i = 0; i < n; i++) real[i] = signal[i];

    fft(real, imag);

    for (let i = 1; i < fftSize / 2; i++) {
        real[i] *= 2;
        imag[i] *= 2;
    }
    for (let i = fftSize / 2 + 1; i < fftSize; i++) {
        real[i] = 0;
        imag[i] = 0;
    }

    ifft(real, imag);

    return { real: real.slice(0, n), imag: imag.slice(0, n) };
}

/**
 * FM Demodulation (high quality, for file decoding)
 */
function demodulateFFM(signal, onProgress) {
    onProgress?.('Filtering signal...');
    const filtered = simpleBandpass(signal, 900, 2500);

    onProgress?.('Computing FM demodulation...');
    const analytic = hilbert(filtered);

    onProgress?.('Extracting frequencies...');
    const freqs = new Float32Array(signal.length);
    let prevPhase = 0;

    for (let i = 0; i < signal.length; i++) {
        const phase = Math.atan2(analytic.imag[i], analytic.real[i]);
        let phaseDiff = phase - prevPhase;
        while (phaseDiff > Math.PI) phaseDiff -= 2 * Math.PI;
        while (phaseDiff < -Math.PI) phaseDiff += 2 * Math.PI;
        freqs[i] = Math.abs(phaseDiff * SAMPLE_RATE / (2 * Math.PI));
        prevPhase = phase;
    }

    onProgress?.('Smoothing...');
    const smoothed = lowpassFilter(freqs, 1200);
    for (let i = 0; i < smoothed.length; i++) {
        smoothed[i] = Math.max(1000, Math.min(2500, smoothed[i]));
    }

    return smoothed;
}

/**
 * Fast FM Demodulation (for real-time streaming)
 */
function demodulateRealtime(signal, startIdx, endIdx) {
    const freqs = new Float32Array(endIdx - startIdx);
    let prevSample = signal[startIdx];
    let lastZeroCross = startIdx;
    let currentFreq = 1900;

    for (let i = startIdx + 1; i < endIdx; i++) {
        const sample = signal[i];
        if (prevSample <= 0 && sample > 0) {
            const period = i - lastZeroCross;
            if (period > 0) {
                currentFreq = SAMPLE_RATE / period;
                currentFreq = Math.max(1000, Math.min(2500, currentFreq));
            }
            lastZeroCross = i;
        }
        freqs[i - startIdx] = currentFreq;
        prevSample = sample;
    }

    // Smoothing
    const smoothed = new Float32Array(freqs.length);
    const windowSize = 15;
    for (let i = 0; i < freqs.length; i++) {
        let sum = 0, count = 0;
        for (let j = Math.max(0, i - windowSize); j <= Math.min(freqs.length - 1, i + windowSize); j++) {
            sum += freqs[j];
            count++;
        }
        smoothed[i] = sum / count;
    }

    return smoothed;
}

/**
 * Decode a single line from frequency data
 */
function decodeSingleLine(freqs, lineOffset) {
    const syncSamples = Math.floor(SYNC_DURATION * SAMPLE_RATE);
    const porchSamples = Math.floor(SYNC_PORCH_DURATION * SAMPLE_RATE);
    const ySamples = Math.floor(Y_SCAN_DURATION * SAMPLE_RATE);
    const sepSamples = Math.floor(SEPARATOR_DURATION * SAMPLE_RATE);
    const colorPorchSamples = Math.floor(COLOR_PORCH_DURATION * SAMPLE_RATE);
    const colorSamples = Math.floor(COLOR_SCAN_DURATION * SAMPLE_RATE);

    const yData = new Uint8Array(WIDTH);
    const colorData = new Uint8Array(WIDTH);

    // Extract Y (luminance)
    const yStart = lineOffset + syncSamples + porchSamples;
    const yEnd = yStart + ySamples;

    for (let x = 0; x < WIDTH; x++) {
        const idx = yStart + Math.floor(x / WIDTH * (yEnd - yStart));
        yData[x] = (idx >= 0 && idx < freqs.length) ? freqToValue(freqs[idx]) : 128;
    }

    // Detect separator tone (determines Cr vs Cb)
    const sepStart = yEnd;
    let sepFreqSum = 0, sepCount = 0;
    for (let s = 0; s < sepSamples; s++) {
        const idx = sepStart + s;
        if (idx >= 0 && idx < freqs.length) {
            sepFreqSum += freqs[idx];
            sepCount++;
        }
    }
    const avgSepFreq = sepCount > 0 ? sepFreqSum / sepCount : 1900;
    const isCrLine = avgSepFreq < 1900;

    // Extract color
    const colorStart = sepStart + sepSamples + colorPorchSamples;
    const colorEnd = colorStart + colorSamples;

    for (let x = 0; x < WIDTH; x++) {
        const idx = colorStart + Math.floor(x / WIDTH * (colorEnd - colorStart));
        colorData[x] = (idx >= 0 && idx < freqs.length) ? freqToValue(freqs[idx]) : 128;
    }

    return { y: yData, color: colorData, isCrLine };
}

/**
 * Find sync pulses in frequency data
 */
function findSyncPulses(freqs) {
    const pulses = [];
    const minSamples = Math.floor(0.005 * SAMPLE_RATE);
    const maxSamples = Math.floor(0.020 * SAMPLE_RATE);
    let inSync = false, syncStart = 0;

    for (let i = 0; i < freqs.length; i++) {
        const isSync = freqs[i] < 1400 && freqs[i] > 1050;
        if (isSync && !inSync) {
            inSync = true;
            syncStart = i;
        } else if (!isSync && inSync) {
            inSync = false;
            const duration = i - syncStart;
            if (duration >= minSamples && duration <= maxSamples) {
                pulses.push(syncStart);
            }
        }
    }
    return pulses;
}

/**
 * Filter sync pulses to find regular intervals
 */
function findRegularSyncs(pulses) {
    if (pulses.length < 3) return pulses;

    const expectedInterval = Math.floor(LINE_DURATION * SAMPLE_RATE);
    const filtered = [pulses[0]];

    for (let i = 1; i < pulses.length; i++) {
        const dist = pulses[i] - filtered[filtered.length - 1];
        const ratio = dist / expectedInterval;
        if ((ratio > 0.7 && ratio < 1.3) || (ratio > 1.7 && ratio < 2.3)) {
            filtered.push(pulses[i]);
        }
    }
    return filtered;
}

/**
 * Detect signal start (after VIS code)
 */
function detectSignalStart(freqs) {
    const windowSamples = Math.floor(0.02 * SAMPLE_RATE);

    for (let i = 0; i < freqs.length - windowSamples; i += Math.floor(windowSamples / 4)) {
        let leaderCount = 0, sstvCount = 0;
        for (let j = 0; j < windowSamples; j++) {
            if (Math.abs(freqs[i + j] - LEADER_FREQ) < 200) leaderCount++;
            if (freqs[i + j] > 1100 && freqs[i + j] < 2400) sstvCount++;
        }

        if (leaderCount / windowSamples > 0.5) {
            for (let k = i + windowSamples; k < freqs.length; k++) {
                if (freqs[k] < 1400) {
                    const headerDuration = BREAK_DURATION + 10 * VIS_BIT_DURATION + BREAK_DURATION;
                    return Math.min(k + Math.floor(headerDuration * SAMPLE_RATE), freqs.length - 1);
                }
            }
        }

        if (freqs[i] < 1300 && freqs[i] > 1100 && sstvCount / windowSamples > 0.7) {
            return Math.max(0, i - Math.floor(0.01 * SAMPLE_RATE));
        }
    }

    return 0;
}

/**
 * Detect leader tone in FFT data
 */
function detectLeaderTone(freqData, sampleRate, fftSize) {
    const binWidth = sampleRate / fftSize;
    const leaderBin = Math.round(LEADER_FREQ / binWidth);
    const tolerance = Math.round(150 / binWidth);

    let maxVal = 0, maxBin = 0;
    for (let i = Math.max(0, leaderBin - tolerance); i < Math.min(freqData.length, leaderBin + tolerance); i++) {
        if (freqData[i] > maxVal) {
            maxVal = freqData[i];
            maxBin = i;
        }
    }

    const peakFreq = maxBin * binWidth;
    return {
        isLeader: Math.abs(peakFreq - LEADER_FREQ) < 150 && maxVal > 100,
        freq: peakFreq,
        strength: maxVal
    };
}
