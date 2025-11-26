/**
 * SSTV Robot36 - Core Library (Improved Decoder)
 */

// ============================================
// Constants
// ============================================
var SAMPLE_RATE = 44100;
var WIDTH = 320;
var HEIGHT = 240;

// Frequencies (Hz)
var FREQ_BLACK = 1500;
var FREQ_WHITE = 2300;
var FREQ_SYNC = 1200;
var FREQ_VIS_1 = 1100;
var FREQ_VIS_0 = 1300;
var LEADER_FREQ = 1900;
var VIS_CODE = 8;

// Timing (seconds)
var LEADER_DURATION = 0.300;
var BREAK_DURATION = 0.010;
var VIS_BIT_DURATION = 0.030;
var SYNC_DURATION = 0.009;
var SYNC_PORCH_DURATION = 0.003;
var Y_SCAN_DURATION = 0.088;
var SEPARATOR_DURATION = 0.0045;
var COLOR_PORCH_DURATION = 0.0015;
var COLOR_SCAN_DURATION = 0.044;

var LINE_DURATION = SYNC_DURATION + SYNC_PORCH_DURATION + Y_SCAN_DURATION +
                    SEPARATOR_DURATION + COLOR_PORCH_DURATION + COLOR_SCAN_DURATION;
var TOTAL_DURATION = LINE_DURATION * HEIGHT + 0.7;

// ============================================
// Color Conversion (ITU-R BT.601 Full Range)
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

    writeString(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

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
// Improved DSP Functions
// ============================================

// Blackman-Harris window for better sidelobe suppression
function blackmanHarrisWindow(n) {
    var w = new Float32Array(n);
    var a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
    for (var i = 0; i < n; i++) {
        var x = 2 * Math.PI * i / (n - 1);
        w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
    }
    return w;
}

// Improved bandpass filter with steeper rolloff
function bandpassFilter(signal, lowFreq, highFreq) {
    var n = 151;  // More taps for sharper cutoff
    var h = new Float32Array(n);
    var fc1 = lowFreq / SAMPLE_RATE;
    var fc2 = highFreq / SAMPLE_RATE;
    var window = blackmanHarrisWindow(n);

    var sum = 0;
    for (var i = 0; i < n; i++) {
        var x = i - (n - 1) / 2;
        if (x === 0) {
            h[i] = 2 * (fc2 - fc1);
        } else {
            h[i] = (Math.sin(2 * Math.PI * fc2 * x) - Math.sin(2 * Math.PI * fc1 * x)) / (Math.PI * x);
        }
        h[i] *= window[i];
        sum += h[i];
    }
    // Normalize
    for (var i = 0; i < n; i++) {
        h[i] /= sum;
    }

    return convolve(signal, h);
}

// Lowpass filter with configurable order
function lowpassFilter(signal, cutoff, order) {
    var n = order || 71;
    var h = new Float32Array(n);
    var fc = cutoff / SAMPLE_RATE;
    var window = blackmanHarrisWindow(n);

    var sum = 0;
    for (var i = 0; i < n; i++) {
        var x = i - (n - 1) / 2;
        if (x === 0) {
            h[i] = 2 * fc;
        } else {
            h[i] = Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
        }
        h[i] *= window[i];
        sum += h[i];
    }
    for (var i = 0; i < n; i++) {
        h[i] /= sum;
    }

    return convolve(signal, h);
}

// Optimized convolution
function convolve(signal, kernel) {
    var filtered = new Float32Array(signal.length);
    var halfN = Math.floor(kernel.length / 2);

    for (var i = 0; i < signal.length; i++) {
        var sum = 0;
        for (var j = 0; j < kernel.length; j++) {
            var idx = i - halfN + j;
            if (idx >= 0 && idx < signal.length) {
                sum += signal[idx] * kernel[j];
            }
        }
        filtered[i] = sum;
    }
    return filtered;
}

// Median filter for spike removal
function medianFilter(signal, windowSize) {
    var filtered = new Float32Array(signal.length);
    var half = Math.floor(windowSize / 2);
    var window = new Float32Array(windowSize);

    for (var i = 0; i < signal.length; i++) {
        var count = 0;
        for (var j = -half; j <= half; j++) {
            var idx = i + j;
            if (idx >= 0 && idx < signal.length) {
                window[count++] = signal[idx];
            }
        }
        // Sort window values
        var slice = window.subarray(0, count);
        slice.sort();
        filtered[i] = slice[Math.floor(count / 2)];
    }
    return filtered;
}

// FFT implementation
function fft(real, imag) {
    var n = real.length;
    if (n <= 1) return;

    var j = 0;
    for (var i = 0; i < n - 1; i++) {
        if (i < j) {
            var tempR = real[i], tempI = imag[i];
            real[i] = real[j]; imag[i] = imag[j];
            real[j] = tempR; imag[j] = tempI;
        }
        var k = n / 2;
        while (k <= j) { j -= k; k /= 2; }
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
    for (var i = 0; i < n; i++) imag[i] = -imag[i];
    fft(real, imag);
    for (var i = 0; i < n; i++) {
        real[i] /= n;
        imag[i] = -imag[i] / n;
    }
}

// Hilbert transform for analytic signal
function hilbert(signal) {
    var n = signal.length;
    var fftSize = 1;
    while (fftSize < n) fftSize *= 2;

    var real = new Float32Array(fftSize);
    var imag = new Float32Array(fftSize);
    for (var i = 0; i < n; i++) real[i] = signal[i];

    fft(real, imag);

    // Create analytic signal
    real[0] = real[0];
    imag[0] = imag[0];
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
// Improved FM Demodulation
// ============================================
function demodulateFFM(signal, onProgress) {
    if (onProgress) onProgress('Bandpass filtering...');

    // Tighter bandpass for SSTV frequencies
    var filtered = bandpassFilter(signal, 1000, 2500);

    if (onProgress) onProgress('Computing analytic signal...');
    var analytic = hilbert(filtered);

    if (onProgress) onProgress('Phase demodulation...');
    var freqs = new Float32Array(signal.length);
    var prevPhase = 0;

    for (var i = 0; i < signal.length; i++) {
        var phase = Math.atan2(analytic.imag[i], analytic.real[i]);
        var phaseDiff = phase - prevPhase;

        // Phase unwrapping
        while (phaseDiff > Math.PI) phaseDiff -= 2 * Math.PI;
        while (phaseDiff < -Math.PI) phaseDiff += 2 * Math.PI;

        // Convert phase difference to frequency
        freqs[i] = phaseDiff * SAMPLE_RATE / (2 * Math.PI);
        if (freqs[i] < 0) freqs[i] = -freqs[i];  // Handle negative frequencies
        prevPhase = phase;
    }

    if (onProgress) onProgress('Removing noise spikes...');
    // Median filter to remove impulse noise
    freqs = medianFilter(freqs, 5);

    if (onProgress) onProgress('Smoothing frequencies...');
    // Adaptive lowpass based on pixel rate
    var pixelRate = WIDTH / Y_SCAN_DURATION;  // ~3636 pixels/sec
    freqs = lowpassFilter(freqs, pixelRate * 1.5, 91);

    // Clamp to valid SSTV range
    for (var i = 0; i < freqs.length; i++) {
        freqs[i] = Math.max(1100, Math.min(2400, freqs[i]));
    }

    return freqs;
}

// Real-time demodulation with improved zero-crossing detection
function demodulateRealtime(signal, startIdx, endIdx) {
    var len = endIdx - startIdx;
    var freqs = new Float32Array(len);

    // Use both zero crossings for better accuracy
    var zeroCrossings = [];
    var prevSample = signal[startIdx];

    for (var i = startIdx + 1; i < endIdx; i++) {
        var sample = signal[i];
        // Detect both rising and falling edges
        if ((prevSample <= 0 && sample > 0) || (prevSample >= 0 && sample < 0)) {
            // Linear interpolation for sub-sample accuracy
            var frac = -prevSample / (sample - prevSample);
            zeroCrossings.push(i - 1 + frac);
        }
        prevSample = sample;
    }

    // Calculate frequency from half-periods
    var currentFreq = 1900;
    var crossIdx = 0;

    for (var i = 0; i < len; i++) {
        var samplePos = startIdx + i;

        // Find surrounding zero crossings
        while (crossIdx < zeroCrossings.length - 1 && zeroCrossings[crossIdx + 1] < samplePos) {
            crossIdx++;
        }

        if (crossIdx < zeroCrossings.length - 1) {
            var halfPeriod = zeroCrossings[crossIdx + 1] - zeroCrossings[crossIdx];
            if (halfPeriod > 0) {
                currentFreq = SAMPLE_RATE / (2 * halfPeriod);
                currentFreq = Math.max(1100, Math.min(2400, currentFreq));
            }
        }

        freqs[i] = currentFreq;
    }

    // Light smoothing
    var smoothed = new Float32Array(len);
    var windowSize = 11;
    for (var i = 0; i < len; i++) {
        var sum = 0, count = 0;
        for (var j = Math.max(0, i - windowSize); j <= Math.min(len - 1, i + windowSize); j++) {
            sum += freqs[j];
            count++;
        }
        smoothed[i] = sum / count;
    }

    return smoothed;
}

// ============================================
// Improved Line Decoder with Averaging
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

    // Calculate samples per pixel for averaging
    var ySamplesPerPixel = ySamples / WIDTH;
    var colorSamplesPerPixel = colorSamples / WIDTH;

    // Extract Y with sample averaging
    var yStart = lineOffset + syncSamples + porchSamples;

    for (var x = 0; x < WIDTH; x++) {
        var pixelStart = yStart + Math.floor(x * ySamplesPerPixel);
        var pixelEnd = yStart + Math.floor((x + 1) * ySamplesPerPixel);

        var sum = 0, count = 0;
        for (var s = pixelStart; s < pixelEnd && s < freqs.length; s++) {
            if (s >= 0) {
                sum += freqs[s];
                count++;
            }
        }

        if (count > 0) {
            yData[x] = freqToValue(sum / count);
        } else {
            yData[x] = 128;
        }
    }

    // Detect separator tone with averaging
    var sepStart = yStart + ySamples;
    var sepFreqSum = 0, sepCount = 0;

    // Sample middle portion of separator for more accuracy
    var sepMidStart = sepStart + Math.floor(sepSamples * 0.2);
    var sepMidEnd = sepStart + Math.floor(sepSamples * 0.8);

    for (var s = sepMidStart; s < sepMidEnd && s < freqs.length; s++) {
        if (s >= 0) {
            sepFreqSum += freqs[s];
            sepCount++;
        }
    }

    var avgSepFreq = sepCount > 0 ? sepFreqSum / sepCount : 1900;
    // Use threshold with hysteresis
    var isCrLine = avgSepFreq < 1850;  // Below 1850 = black separator = Cr line

    // Extract color channel with sample averaging
    var colorStart = sepStart + sepSamples + colorPorchSamples;

    for (var x = 0; x < WIDTH; x++) {
        var pixelStart = colorStart + Math.floor(x * colorSamplesPerPixel);
        var pixelEnd = colorStart + Math.floor((x + 1) * colorSamplesPerPixel);

        var sum = 0, count = 0;
        for (var s = pixelStart; s < pixelEnd && s < freqs.length; s++) {
            if (s >= 0) {
                sum += freqs[s];
                count++;
            }
        }

        if (count > 0) {
            colorData[x] = freqToValue(sum / count);
        } else {
            colorData[x] = 128;
        }
    }

    return { y: yData, color: colorData, isCrLine: isCrLine };
}

// ============================================
// Improved Signal Detection
// ============================================

// Correlation-based sync pulse detection
function findSyncPulses(freqs) {
    var pulses = [];
    var syncSamples = Math.floor(SYNC_DURATION * SAMPLE_RATE);
    var minSamples = Math.floor(0.006 * SAMPLE_RATE);
    var maxSamples = Math.floor(0.015 * SAMPLE_RATE);

    // Create sync pulse template
    var templateLen = syncSamples;
    var template = new Float32Array(templateLen);
    for (var i = 0; i < templateLen; i++) {
        template[i] = FREQ_SYNC;
    }

    var inSync = false;
    var syncStart = 0;
    var syncStrength = 0;

    // Adaptive threshold based on signal statistics
    var freqMean = 0, freqStd = 0;
    var sampleCount = Math.min(freqs.length, 50000);
    for (var i = 0; i < sampleCount; i++) {
        freqMean += freqs[i];
    }
    freqMean /= sampleCount;

    for (var i = 0; i < sampleCount; i++) {
        freqStd += (freqs[i] - freqMean) * (freqs[i] - freqMean);
    }
    freqStd = Math.sqrt(freqStd / sampleCount);

    // Sync threshold: below mean by some amount
    var syncThresholdHigh = Math.min(1450, freqMean - freqStd * 0.5);
    var syncThresholdLow = 1100;

    for (var i = 0; i < freqs.length; i++) {
        var isSync = freqs[i] < syncThresholdHigh && freqs[i] > syncThresholdLow;

        if (isSync && !inSync) {
            inSync = true;
            syncStart = i;
            syncStrength = 0;
        } else if (isSync && inSync) {
            syncStrength += (syncThresholdHigh - freqs[i]);
        } else if (!isSync && inSync) {
            inSync = false;
            var duration = i - syncStart;

            if (duration >= minSamples && duration <= maxSamples) {
                // Score based on duration match and strength
                var durationScore = 1 - Math.abs(duration - syncSamples) / syncSamples;
                if (durationScore > 0.5) {
                    pulses.push({
                        pos: syncStart,
                        duration: duration,
                        score: durationScore * syncStrength
                    });
                }
            }
        }
    }

    // Return positions sorted by score, then position
    pulses.sort(function(a, b) { return a.pos - b.pos; });

    return pulses.map(function(p) { return p.pos; });
}

// Filter sync pulses to find regular line intervals
function findRegularSyncs(pulses) {
    if (pulses.length < 3) return pulses;

    var expectedInterval = Math.floor(LINE_DURATION * SAMPLE_RATE);
    var tolerance = 0.15;  // 15% tolerance

    // Find the best starting pulse using voting
    var votes = new Array(pulses.length).fill(0);

    for (var i = 0; i < pulses.length; i++) {
        for (var j = i + 1; j < pulses.length; j++) {
            var dist = pulses[j] - pulses[i];
            var lines = Math.round(dist / expectedInterval);

            if (lines > 0 && lines <= HEIGHT) {
                var expectedDist = lines * expectedInterval;
                var error = Math.abs(dist - expectedDist) / expectedDist;

                if (error < tolerance) {
                    votes[i]++;
                    votes[j]++;
                }
            }
        }
    }

    // Find pulse with most votes
    var bestIdx = 0;
    for (var i = 1; i < votes.length; i++) {
        if (votes[i] > votes[bestIdx]) bestIdx = i;
    }

    // Build sequence from best starting point
    var filtered = [pulses[bestIdx]];
    var lastPos = pulses[bestIdx];

    for (var i = bestIdx + 1; i < pulses.length; i++) {
        var dist = pulses[i] - lastPos;
        var lines = Math.round(dist / expectedInterval);

        if (lines >= 1 && lines <= 3) {
            var expectedDist = lines * expectedInterval;
            var error = Math.abs(dist - expectedDist) / expectedDist;

            if (error < tolerance) {
                // Fill in missing lines if needed
                for (var l = 1; l < lines; l++) {
                    filtered.push(lastPos + l * expectedInterval);
                }
                filtered.push(pulses[i]);
                lastPos = pulses[i];
            }
        }
    }

    return filtered;
}

// Improved signal start detection with VIS code recognition
function detectSignalStart(freqs) {
    var windowSamples = Math.floor(0.05 * SAMPLE_RATE);  // 50ms window
    var stepSamples = Math.floor(0.01 * SAMPLE_RATE);    // 10ms step

    // Look for leader tone (1900 Hz)
    for (var i = 0; i < freqs.length - windowSamples; i += stepSamples) {
        var leaderCount = 0;

        for (var j = 0; j < windowSamples; j++) {
            if (Math.abs(freqs[i + j] - LEADER_FREQ) < 150) {
                leaderCount++;
            }
        }

        // Found leader tone (>60% of window)
        if (leaderCount / windowSamples > 0.6) {
            // Look for break + VIS code
            var breakStart = i + windowSamples;

            for (var k = breakStart; k < Math.min(breakStart + SAMPLE_RATE, freqs.length); k++) {
                // Found sync/break tone
                if (freqs[k] < 1300 && freqs[k] > 1100) {
                    // Skip VIS code duration
                    var visDuration = BREAK_DURATION + 10 * VIS_BIT_DURATION + BREAK_DURATION;
                    var imageStart = k + Math.floor(visDuration * SAMPLE_RATE);

                    // Verify we found actual image data
                    if (imageStart < freqs.length) {
                        var checkStart = imageStart;
                        var validCount = 0;
                        for (var c = 0; c < 1000 && checkStart + c < freqs.length; c++) {
                            if (freqs[checkStart + c] > 1100 && freqs[checkStart + c] < 2400) {
                                validCount++;
                            }
                        }
                        if (validCount > 800) {
                            return imageStart;
                        }
                    }
                }
            }
        }
    }

    // Fallback: look for first sync pulse
    var syncSamples = Math.floor(SYNC_DURATION * SAMPLE_RATE);
    for (var i = 0; i < freqs.length - syncSamples; i++) {
        var syncCount = 0;
        for (var j = 0; j < syncSamples; j++) {
            if (freqs[i + j] > 1150 && freqs[i + j] < 1350) {
                syncCount++;
            }
        }
        if (syncCount > syncSamples * 0.7) {
            return i;
        }
    }

    return 0;
}

// Leader tone detection for real-time monitoring
function detectLeaderTone(freqData, sampleRate, fftSize) {
    var binWidth = sampleRate / fftSize;
    var leaderBin = Math.round(LEADER_FREQ / binWidth);
    var tolerance = Math.round(200 / binWidth);

    var maxVal = 0;
    var maxBin = 0;
    var totalEnergy = 0;

    for (var i = Math.max(0, leaderBin - tolerance); i < Math.min(freqData.length, leaderBin + tolerance); i++) {
        if (freqData[i] > maxVal) {
            maxVal = freqData[i];
            maxBin = i;
        }
        totalEnergy += freqData[i];
    }

    var peakFreq = maxBin * binWidth;
    var isLeader = Math.abs(peakFreq - LEADER_FREQ) < 150 && maxVal > 80 && maxVal > totalEnergy * 0.3;

    return {
        isLeader: isLeader,
        freq: peakFreq,
        strength: maxVal
    };
}
