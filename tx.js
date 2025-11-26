/**
 * SSTV Robot36 - Transmitter UI
 */

let audioCtx = null;
let txSource = null;
let analyser = null;
let animFrame = null;

// DOM elements
const elements = {
    canvas: null,
    placeholder: null,
    fileInput: null,
    btnTransmit: null,
    btnStop: null,
    btnSave: null,
    progress: null,
    status: null
};

/**
 * Initialize the TX page
 */
function init() {
    elements.canvas = document.getElementById('tx-canvas');
    elements.placeholder = document.getElementById('tx-placeholder');
    elements.fileInput = document.getElementById('file-input');
    elements.btnTransmit = document.getElementById('btn-transmit');
    elements.btnStop = document.getElementById('btn-stop');
    elements.btnSave = document.getElementById('btn-save');
    elements.progress = document.getElementById('tx-progress');
    elements.status = document.getElementById('tx-status');

    // File input handler
    elements.fileInput.addEventListener('change', handleFileSelect);

    // Button handlers
    elements.btnTransmit.addEventListener('click', transmit);
    elements.btnStop.addEventListener('click', stopTransmit);
    elements.btnSave.addEventListener('click', saveAudio);
}

/**
 * Handle image file selection
 */
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = () => {
        const ctx = elements.canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
        elements.canvas.style.display = 'block';
        elements.placeholder.style.display = 'none';
        elements.btnTransmit.disabled = false;
        elements.btnSave.disabled = false;
        elements.status.textContent = 'Ready to transmit or save';
        URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
        elements.status.textContent = 'Error loading image';
        URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
}

/**
 * Transmit SSTV audio
 */
async function transmit() {
    elements.status.textContent = 'Encoding...';
    elements.btnTransmit.disabled = true;
    elements.btnSave.disabled = true;

    await new Promise(r => setTimeout(r, 50));

    const ctx = elements.canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const audio = encodeSSTV(imageData);

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    const buffer = audioCtx.createBuffer(1, audio.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(audio);

    txSource = audioCtx.createBufferSource();
    txSource.buffer = buffer;
    analyser = audioCtx.createAnalyser();
    txSource.connect(analyser);
    analyser.connect(audioCtx.destination);

    elements.btnStop.disabled = false;
    elements.status.textContent = 'Transmitting...';

    const startTime = audioCtx.currentTime;
    const duration = buffer.duration;

    function updateProgress() {
        if (!txSource) return;
        const elapsed = audioCtx.currentTime - startTime;
        const pct = Math.min(100, elapsed / duration * 100);
        elements.progress.style.width = pct + '%';
        if (elapsed < duration) {
            animFrame = requestAnimationFrame(updateProgress);
        }
    }

    txSource.onended = () => {
        elements.status.textContent = 'Done!';
        elements.btnTransmit.disabled = false;
        elements.btnSave.disabled = false;
        elements.btnStop.disabled = true;
        elements.progress.style.width = '100%';
        txSource = null;
    };

    txSource.start();
    updateProgress();
}

/**
 * Stop transmission
 */
function stopTransmit() {
    if (txSource) {
        txSource.stop();
        txSource = null;
    }
    if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
    }
    elements.btnTransmit.disabled = false;
    elements.btnSave.disabled = false;
    elements.btnStop.disabled = true;
    elements.status.textContent = 'Stopped';
}

/**
 * Save encoded audio as WAV file
 */
async function saveAudio() {
    elements.status.textContent = 'Encoding audio...';
    elements.btnSave.disabled = true;
    elements.btnTransmit.disabled = true;

    await new Promise(r => setTimeout(r, 50));

    const ctx = elements.canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const audio = encodeSSTV(imageData);
    const wavBuffer = createWavFile(audio, SAMPLE_RATE);

    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    const link = document.createElement('a');
    link.download = 'sstv_robot36_' + Date.now() + '.wav';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);

    elements.btnSave.disabled = false;
    elements.btnTransmit.disabled = false;
    elements.status.textContent = 'Audio saved!';
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
