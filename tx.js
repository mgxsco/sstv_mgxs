/**
 * SSTV Robot36 - Transmitter
 */

var audioCtx = null;
var txSource = null;
var animFrame = null;

// Initialize AudioContext on first user interaction (required for iOS)
function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    }
    // Resume if suspended (iOS requirement)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', function() {
    // File input handler
    document.getElementById('file-input').addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;

        var img = new Image();
        img.onload = function() {
            var canvas = document.getElementById('tx-canvas');
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
            canvas.style.display = 'block';
            document.getElementById('tx-placeholder').style.display = 'none';
            document.getElementById('btn-transmit').disabled = false;
            document.getElementById('btn-save').disabled = false;
            document.getElementById('tx-status').textContent = 'Ready to transmit or save';
            URL.revokeObjectURL(img.src);
        };
        img.onerror = function() {
            document.getElementById('tx-status').textContent = 'Error loading image';
            URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(file);
    });

    // Transmit button
    document.getElementById('btn-transmit').addEventListener('click', function() {
        transmit();
    });

    // Stop button
    document.getElementById('btn-stop').addEventListener('click', function() {
        stopTransmit();
    });

    // Save button
    document.getElementById('btn-save').addEventListener('click', function() {
        saveAudio();
    });

    // iOS audio unlock - touch anywhere to init audio context
    document.body.addEventListener('touchstart', function() {
        initAudioContext();
    }, { once: true });

    document.body.addEventListener('click', function() {
        initAudioContext();
    }, { once: true });
});

function transmit() {
    document.getElementById('tx-status').textContent = 'Encoding...';
    document.getElementById('btn-transmit').disabled = true;
    document.getElementById('btn-save').disabled = true;

    // Initialize/resume audio context first
    var ctx = initAudioContext();

    setTimeout(function() {
        var canvas = document.getElementById('tx-canvas');
        var canvasCtx = canvas.getContext('2d');
        var imageData = canvasCtx.getImageData(0, 0, WIDTH, HEIGHT);
        var audio = encodeSSTV(imageData);

        var buffer = ctx.createBuffer(1, audio.length, SAMPLE_RATE);
        buffer.getChannelData(0).set(audio);

        txSource = ctx.createBufferSource();
        txSource.buffer = buffer;
        txSource.connect(ctx.destination);

        document.getElementById('btn-stop').disabled = false;
        document.getElementById('tx-status').textContent = 'Transmitting...';

        var startTime = ctx.currentTime;
        var duration = buffer.duration;

        function updateProgress() {
            if (!txSource) return;
            var elapsed = ctx.currentTime - startTime;
            var pct = Math.min(100, elapsed / duration * 100);
            document.getElementById('tx-progress').style.width = pct + '%';
            if (elapsed < duration) {
                animFrame = requestAnimationFrame(updateProgress);
            }
        }

        txSource.onended = function() {
            document.getElementById('tx-status').textContent = 'Done!';
            document.getElementById('btn-transmit').disabled = false;
            document.getElementById('btn-save').disabled = false;
            document.getElementById('btn-stop').disabled = true;
            document.getElementById('tx-progress').style.width = '100%';
            txSource = null;
        };

        txSource.start();
        updateProgress();
    }, 50);
}

function stopTransmit() {
    if (txSource) {
        txSource.stop();
        txSource = null;
    }
    if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
    }
    document.getElementById('btn-transmit').disabled = false;
    document.getElementById('btn-save').disabled = false;
    document.getElementById('btn-stop').disabled = true;
    document.getElementById('tx-status').textContent = 'Stopped';
}

function saveAudio() {
    document.getElementById('tx-status').textContent = 'Encoding audio...';
    document.getElementById('btn-save').disabled = true;
    document.getElementById('btn-transmit').disabled = true;

    setTimeout(function() {
        var canvas = document.getElementById('tx-canvas');
        var ctx = canvas.getContext('2d');
        var imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
        var audio = encodeSSTV(imageData);
        var wavBuffer = createWavFile(audio, SAMPLE_RATE);

        var blob = new Blob([wavBuffer], { type: 'audio/wav' });
        var link = document.createElement('a');
        link.download = 'sstv_robot36_' + Date.now() + '.wav';
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);

        document.getElementById('btn-save').disabled = false;
        document.getElementById('btn-transmit').disabled = false;
        document.getElementById('tx-status').textContent = 'Audio saved!';
    }, 50);
}
