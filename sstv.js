/**
 * SSTV Robot36 - Core Library
 */

// ============================================
// Constants
// ============================================
const SAMPLE_RATE = 44100;
const WIDTH = 320;
const HEIGHT = 240;

// Frequencies (Hz)
const FREQ_BLACK = 1500;
const FREQ_WHITE = 2300;
const FREQ_SYNC = 1200;
const FREQ_VIS_1 = 1100;
const FREQ_VIS_0 = 1300;
const LEADER_FREQ = 1900;
const VIS_CODE = 8;

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

const LINE_DURATION = SYNC_DURATION + SYNC_PORCH_DURATION + Y_SCAN_DURATION +
                      SEPARATOR_DURATION + COLOR_PORCH_DURATION + COLOR_SCAN_DURATION;
const TOTAL_DURATION = LINE_DURATION * HEIGHT + 0.7;

// ============================================
// Color Conversion
// ============================================
function rgbToYCrCb(r, g, b) {
    var y  = 0.299 * r + 0.587 * g + 0.114 * b;
    var cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    return [
        Math.max(0, Math.min(255, Math.round(y))),
        Math.max(0, Math.min(255, Math.round(cr))),
        Math.max(0, Math.min(255, Math.round(cb)))
    ];
}

function yCrCbToRgb(y, cr, cb) {
    var r = y + 1.402 * (cr - 128);
    var g = y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128);
    var b = y + 1.772 * (cb - 128);
    return [
        Math.max(0, Math.min(255, Math.round(r))),
        Math.max(0, Math.min(255, Math.round(g))),
        Math.max(0, Math.min(255, Math.round(b)))
    ];
}

function valueToFreq(value) {
    return FREQ_BLACK + (value / 255) * (FREQ_WHITE - FREQ_BLACK);
}

function freqToValue(freq) {
    var val = (freq - FREQ_BLACK) / (FREQ_WHITE - FREQ_BLACK) * 255;
    return Math.max(0, Math.min(255, Math.round(val)));
}

// ============================================
// Encoder
// ============================================
function encodeSSTV(imageData) {
    var samples = [];
    var phase = 0;

    function addTone(freq, duration) {
        var numSamples = Math.floor(duration * SAMPLE_RATE);
        for (var i = 0; i < numSamples; i++) {
            samples.push(Math.sin(phase));
            phase += 2 * Math.PI * freq / SAMPLE_RATE;
        }
    }

    function addFM(values, duration) {
        var numSamples = Math.floor(duration * SAMPLE_RATE);
        for (var i = 0; i < numSamples; i++) {
            var idx = Math.floor(i / numSamples * values.length);
            var val = values[Math.min(idx, values.length - 1)];
            var freq = valueToFreq(val);
            samples.push(Math.sin(phase));
            phase += 2 * Math.PI * freq / SAMPLE_RATE;
        }
    }

    // Convert image to YCrCb
    var ycrcb = [];
    for (var row = 0; row < HEIGHT; row++) {
        var yRow = [], crRow = [], cbRow = [];
        for (var col = 0; col < WIDTH; col++) {
            var idx = (row * WIDTH + col) * 4;
            var converted = rgbToYCrCb(
                imageData.data[idx],
                imageData.data[idx + 1],
                imageData.data[idx + 2]
            );
            yRow.push(converted[0]);
            crRow.push(converted[1]);
            cbRow.push(converted[2]);
        }
        ycrcb.push({ y: yRow, cr: crRow, cb: cbRow });
    }

    // Leader tone
    addTone(LEADER_FREQ, LEADER_DURATION);
    addTone(FREQ_SYNC, BREAK_DURATION);

    // VIS code
    addTone(FREQ_VIS_1, VIS_BIT_DURATION);
    var parity = 0;
    for (var i = 0; i < 7; i++) {
        var bit = (VIS_CODE >> i) & 1;
        parity ^= bit;
        addTone(bit ? FREQ_VIS_1 : FREQ_VIS_0, VIS_BIT_DURATION);
    }
    addTone(parity ? FREQ_VIS_1 : FREQ_VIS_0, VIS_BIT_DURATION);
    addTone(FREQ_VIS_0, VIS_BIT_DURATION);
    addTone(FREQ_SYNC, BREAK_DURATION);

    // Image lines
    for (var line = 0; line < HEIGHT; line++) {
        var isEven = line % 2 === 0;
        addTone(FREQ_SYNC, SYNC_DURATION);
        addTone(FREQ_BLACK, SYNC_PORCH_DURATION);
        addFM(ycrcb[line].y, Y_SCAN_DURATION);
        addTone(isEven ? FREQ_BLACK : FREQ_WHITE, SEPARATOR_DURATION);
        addTone(FREQ_BLACK, COLOR_PORCH_DURATION);
        addFM(isEven ? ycrcb[line].cr : ycrcb[line].cb, COLOR_SCAN_DURATION);
    }

    // Convert to Float32Array
    var audio = new Float32Array(samples.length);
    for (var i = 0; i < samples.length; i++) {
        audio[i] = samples[i] * 0.9;
    }
    return audio;
}

// ============================================
// WAV File Creation
// ============================================
function createWavFile(samples, sampleRate) {
    var numChannels = 1;
    var bitsPerSample = 16;
    var byteRate = sampleRate * numChannels * bitsPerSample / 8;
    var blockAlign = numChannels * bitsPerSample / 8;
    var dataSize = samples.length * blockAlign;
    var fileSize = 44 + dataSize;

    var buffer = new ArrayBuffer(fileSize);
    var view = new DataView(buffer);

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

    // Write samples
    var offset = 44;
    for (var i = 0; i < samples.length; i++) {
        var sample = Math.max(-1, Math.min(1, samples[i]));
        var int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
    }

    return buffer;
}

function writeString(view, offset, string) {
    for (var i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// ============================================
// DSP Functions
// ============================================
function simpleBandpass(signal, lowFreq, highFreq) {
    var n = 101;
    var h = new Float32Array(n);
    var fc1 = lowFreq / SAMPLE_RATE;
    var fc2 = highFreq / SAMPLE_RATE;

    for (var i = 0; i < n; i++) {
        var x = i - (n - 1) / 2;
        if (x === 0) {
            h[i] = 2 * (fc2 - fc1);
        } else {
            h[i] = (Math.sin(2 * Math.PI * fc2 * x) - Math.sin(2 * Math.PI * fc1 * x)) / (Math.PI * x);
        }
        h[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
    }

    var filtered = new Float32Array(signal.length);
    var halfN = Math.floor(n / 2);
    for (var i = 0; i < signal.length; i++) {
        var sum = 0;
        for (var j = 0; j < n; j++) {
            var idx = i - halfN + j;
            if (idx >= 0 && idx < signal.length) {
                sum += signal[idx] * h[j];
            }
        }
        filtered[i] = sum;
    }
    return filtered;
}

function lowpassFilter(signal, cutoff) {
    var n = 51;
    var h = new Float32Array(n);
    var fc = cutoff / SAMPLE_RATE;

    for (var i = 0; i < n; i++) {
        var x = i - (n - 1) / 2;
        if (x === 0) {
            h[i] = 2 * fc;
        } else {
            h[i] = Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
        }
        h[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
    }

    var filtered = new Float32Array(signal.length);
    var halfN = Math.floor(n / 2);
    for (var i = 0; i < signal.length; i++) {
        var sum = 0;
        for (var j = 0; j < n; j++) {
            var idx = i - halfN + j;
            if (idx >= 0 && idx < signal.length) {
                sum += signal[idx] * h[j];
            }
        }
        filtered[i] = sum;
    }
    return filtered;
}

function fft(real, imag) {
    var n = real.length;
    if (n <= 1) return;

    var j = 0;
    for (var i = 0; i < n - 1; i++) {
        if (i < j) {
            var tempR = real[i];
            var tempI = imag[i];
            real[i] = real[j];
            imag[i] = imag[j];
            real[j] = tempR;
            imag[j] = tempI;
        }
        var k = n / 2;
        while (k <= j) {
            j -= k;
            k /= 2;
        }
        j += k;
    }

    for (var len = 2; len <= n; len *= 2) {
        var halfLen = len / 2;
        var angle = -2 * Math.PI / len;
        for (var i = 0; i < n; i += len) {
            for (var k = 0; k < halfLen; k++) {
                var cos = Math.cos(angle * k);
                var sin = Math.sin(angle * k);
                var tr = real[i + k + halfLen] * cos - imag[i + k + halfLen] * sin;
                var ti = real[i + k + halfLen] * sin + imag[i + k + halfLen] * cos;
                real[i + k + halfLen] = real[i + k] - tr;
                imag[i + k + halfLen] = imag[i + k] - ti;
                real[i + k] += tr;
                imag[i + k] += ti;
            }
        }
    }
}

function ifft(real, imag) {
    var n = real.length;
    for (var i = 0; i < n; i++) {
        imag[i] = -imag[i];
    }
    fft(real, imag);
    for (var i = 0; i < n; i++) {
        real[i] /= n;
        imag[i] = -imag[i] / n;
    }
}

function hilbert(signal) {
    var n = signal.length;
    var fftSize = 1;
    while (fftSize < n) fftSize *= 2;

    var real = new Float32Array(fftSize);
    var imag = new Float32Array(fftSize);
    for (var i = 0; i < n; i++) {
        real[i] = signal[i];
    }

    fft(real, imag);

    for (var i = 1; i < fftSize / 2; i++) {
        real[i] *= 2;
        imag[i] *= 2;
    }
    for (var i = fftSize / 2 + 1; i < fftSize; i++) {
        real[i] = 0;
        imag[i] = 0;
    }

    ifft(real, imag);

    return {
        real: real.subarray(0, n),
        imag: imag.subarray(0, n)
    };
}

// ============================================
// FM Demodulation
// ============================================
function demodulateFFM(signal, onProgress) {
    if (onProgress) onProgress('Filtering signal...');
    var filtered = simpleBandpass(signal, 900, 2500);

    if (onProgress) onProgress('Computing FM demodulation...');
    var analytic = hilbert(filtered);

    if (onProgress) onProgress('Extracting frequencies...');
    var freqs = new Float32Array(signal.length);
    var prevPhase = 0;

    for (var i = 0; i < signal.length; i++) {
        var phase = Math.atan2(analytic.imag[i], analytic.real[i]);
        var phaseDiff = phase - prevPhase;

        while (phaseDiff > Math.PI) phaseDiff -= 2 * Math.PI;
        while (phaseDiff < -Math.PI) phaseDiff += 2 * Math.PI;

        freqs[i] = Math.abs(phaseDiff * SAMPLE_RATE / (2 * Math.PI));
        prevPhase = phase;
    }

    if (onProgress) onProgress('Smoothing...');
    var smoothed = lowpassFilter(freqs, 1200);

    for (var i = 0; i < smoothed.length; i++) {
        smoothed[i] = Math.max(1000, Math.min(2500, smoothed[i]));
    }

    return smoothed;
}

function demodulateRealtime(signal, startIdx, endIdx) {
    var freqs = new Float32Array(endIdx - startIdx);
    var prevSample = signal[startIdx];
    var lastZeroCross = startIdx;
    var currentFreq = 1900;

    for (var i = startIdx + 1; i < endIdx; i++) {
        var sample = signal[i];
        if (prevSample <= 0 && sample > 0) {
            var period = i - lastZeroCross;
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
    var smoothed = new Float32Array(freqs.length);
    var windowSize = 15;
    for (var i = 0; i < freqs.length; i++) {
        var sum = 0;
        var count = 0;
        for (var j = Math.max(0, i - windowSize); j <= Math.min(freqs.length - 1, i + windowSize); j++) {
            sum += freqs[j];
            count++;
        }
        smoothed[i] = sum / count;
    }

    return smoothed;
}

// ============================================
// Line Decoder
// ============================================
function decodeSingleLine(freqs, lineOffset) {
    var syncSamples = Math.floor(SYNC_DURATION * SAMPLE_RATE);
    var porchSamples = Math.floor(SYNC_PORCH_DURATION * SAMPLE_RATE);
    var ySamples = Math.floor(Y_SCAN_DURATION * SAMPLE_RATE);
    var sepSamples = Math.floor(SEPARATOR_DURATION * SAMPLE_RATE);
    var colorPorchSamples = Math.floor(COLOR_PORCH_DURATION * SAMPLE_RATE);
    var colorSamples = Math.floor(COLOR_SCAN_DURATION * SAMPLE_RATE);

    var yData = new Uint8Array(WIDTH);
    var colorData = new Uint8Array(WIDTH);

    // Extract Y
    var yStart = lineOffset + syncSamples + porchSamples;
    var yEnd = yStart + ySamples;

    for (var x = 0; x < WIDTH; x++) {
        var idx = yStart + Math.floor(x / WIDTH * (yEnd - yStart));
        if (idx >= 0 && idx < freqs.length) {
            yData[x] = freqToValue(freqs[idx]);
        } else {
            yData[x] = 128;
        }
    }

    // Detect separator
    var sepStart = yEnd;
    var sepFreqSum = 0;
    var sepCount = 0;
    for (var s = 0; s < sepSamples; s++) {
        var idx = sepStart + s;
        if (idx >= 0 && idx < freqs.length) {
            sepFreqSum += freqs[idx];
            sepCount++;
        }
    }
    var avgSepFreq = sepCount > 0 ? sepFreqSum / sepCount : 1900;
    var isCrLine = avgSepFreq < 1900;

    // Extract color
    var colorStart = sepStart + sepSamples + colorPorchSamples;
    var colorEnd = colorStart + colorSamples;

    for (var x = 0; x < WIDTH; x++) {
        var idx = colorStart + Math.floor(x / WIDTH * (colorEnd - colorStart));
        if (idx >= 0 && idx < freqs.length) {
            colorData[x] = freqToValue(freqs[idx]);
        } else {
            colorData[x] = 128;
        }
    }

    return { y: yData, color: colorData, isCrLine: isCrLine };
}

// ============================================
// Signal Detection
// ============================================
function findSyncPulses(freqs) {
    var pulses = [];
    var minSamples = Math.floor(0.005 * SAMPLE_RATE);
    var maxSamples = Math.floor(0.020 * SAMPLE_RATE);
    var inSync = false;
    var syncStart = 0;

    for (var i = 0; i < freqs.length; i++) {
        var isSync = freqs[i] < 1400 && freqs[i] > 1050;
        if (isSync && !inSync) {
            inSync = true;
            syncStart = i;
        } else if (!isSync && inSync) {
            inSync = false;
            var duration = i - syncStart;
            if (duration >= minSamples && duration <= maxSamples) {
                pulses.push(syncStart);
            }
        }
    }
    return pulses;
}

function findRegularSyncs(pulses) {
    if (pulses.length < 3) return pulses;

    var expectedInterval = Math.floor(LINE_DURATION * SAMPLE_RATE);
    var filtered = [pulses[0]];

    for (var i = 1; i < pulses.length; i++) {
        var dist = pulses[i] - filtered[filtered.length - 1];
        var ratio = dist / expectedInterval;
        if ((ratio > 0.7 && ratio < 1.3) || (ratio > 1.7 && ratio < 2.3)) {
            filtered.push(pulses[i]);
        }
    }
    return filtered;
}

function detectSignalStart(freqs) {
    var windowSamples = Math.floor(0.02 * SAMPLE_RATE);

    for (var i = 0; i < freqs.length - windowSamples; i += Math.floor(windowSamples / 4)) {
        var leaderCount = 0;
        var sstvCount = 0;

        for (var j = 0; j < windowSamples; j++) {
            if (Math.abs(freqs[i + j] - LEADER_FREQ) < 200) leaderCount++;
            if (freqs[i + j] > 1100 && freqs[i + j] < 2400) sstvCount++;
        }

        if (leaderCount / windowSamples > 0.5) {
            for (var k = i + windowSamples; k < freqs.length; k++) {
                if (freqs[k] < 1400) {
                    var headerDuration = BREAK_DURATION + 10 * VIS_BIT_DURATION + BREAK_DURATION;
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

function detectLeaderTone(freqData, sampleRate, fftSize) {
    var binWidth = sampleRate / fftSize;
    var leaderBin = Math.round(LEADER_FREQ / binWidth);
    var tolerance = Math.round(150 / binWidth);

    var maxVal = 0;
    var maxBin = 0;

    for (var i = Math.max(0, leaderBin - tolerance); i < Math.min(freqData.length, leaderBin + tolerance); i++) {
        if (freqData[i] > maxVal) {
            maxVal = freqData[i];
            maxBin = i;
        }
    }

    var peakFreq = maxBin * binWidth;
    return {
        isLeader: Math.abs(peakFreq - LEADER_FREQ) < 150 && maxVal > 100,
        freq: peakFreq,
        strength: maxVal
    };
}
