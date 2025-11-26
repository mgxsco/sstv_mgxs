/**
 * SSTV Robot36 - Transmitter with Crop Selection
 */

var audioCtx = null;
var txSource = null;
var animFrame = null;

// Crop state
var cropImage = null;
var cropScale = 1;
var cropRect = { x: 0, y: 0, w: 0, h: 0 };
var cropDragging = false;
var cropResizing = false;
var cropResizeHandle = null;
var cropStartX = 0;
var cropStartY = 0;
var cropStartRect = null;

var ASPECT_RATIO = WIDTH / HEIGHT; // 4:3 = 1.333...

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
    // File input handler - opens crop modal
    document.getElementById('file-input').addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;

        var img = new Image();
        img.onload = function() {
            cropImage = img;
            openCropModal();
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
    document.getElementById('btn-tx-stop').addEventListener('click', function() {
        stopTransmit();
    });

    // Save button
    document.getElementById('btn-tx-save').addEventListener('click', function() {
        saveAudio();
    });

    // Crop modal buttons
    document.getElementById('btn-crop-confirm').addEventListener('click', function() {
        applyCrop();
    });

    document.getElementById('btn-crop-cancel').addEventListener('click', function() {
        closeCropModal();
    });

    // Crop interaction events
    var cropSelection = document.getElementById('crop-selection');
    var cropWorkspace = document.querySelector('.crop-workspace');

    cropSelection.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var handle = e.target.getAttribute('data-handle');
        if (handle) {
            startResize(e, handle);
        } else {
            startDrag(e);
        }
    });

    cropSelection.addEventListener('touchstart', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var touch = e.touches[0];
        var handle = e.target.getAttribute('data-handle');
        if (handle) {
            startResize(touch, handle);
        } else {
            startDrag(touch);
        }
    }, { passive: false });

    cropWorkspace.addEventListener('mousedown', function(e) {
        if (e.target === cropWorkspace || e.target.tagName === 'CANVAS') {
            startNewSelection(e);
        }
    });

    cropWorkspace.addEventListener('touchstart', function(e) {
        if (e.target === cropWorkspace || e.target.tagName === 'CANVAS') {
            e.preventDefault();
            startNewSelection(e.touches[0]);
        }
    }, { passive: false });

    document.addEventListener('mousemove', function(e) {
        if (cropDragging) {
            dragSelection(e);
        } else if (cropResizing) {
            resizeSelection(e);
        }
    });

    document.addEventListener('touchmove', function(e) {
        if (cropDragging || cropResizing) {
            e.preventDefault();
            var touch = e.touches[0];
            if (cropDragging) {
                dragSelection(touch);
            } else if (cropResizing) {
                resizeSelection(touch);
            }
        }
    }, { passive: false });

    document.addEventListener('mouseup', function() {
        cropDragging = false;
        cropResizing = false;
    });

    document.addEventListener('touchend', function() {
        cropDragging = false;
        cropResizing = false;
    });

    // Keyboard: Escape to close modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && document.getElementById('crop-modal').classList.contains('active')) {
            closeCropModal();
        }
    });

    // iOS audio unlock - touch anywhere to init audio context
    document.body.addEventListener('touchstart', function() {
        initAudioContext();
    }, { once: true });

    document.body.addEventListener('click', function() {
        initAudioContext();
    }, { once: true });
});

function openCropModal() {
    var modal = document.getElementById('crop-modal');
    var canvas = document.getElementById('crop-canvas');
    var ctx = canvas.getContext('2d');
    var selection = document.getElementById('crop-selection');

    // Calculate display size (max 800x600 or viewport constrained)
    var maxW = Math.min(800, window.innerWidth - 100);
    var maxH = Math.min(600, window.innerHeight - 250);

    var imgW = cropImage.width;
    var imgH = cropImage.height;

    // Scale to fit
    cropScale = Math.min(maxW / imgW, maxH / imgH, 1);
    var displayW = Math.floor(imgW * cropScale);
    var displayH = Math.floor(imgH * cropScale);

    canvas.width = displayW;
    canvas.height = displayH;
    ctx.drawImage(cropImage, 0, 0, displayW, displayH);

    // Initialize crop rectangle - fit largest 4:3 area centered
    var cropW, cropH;
    if (imgW / imgH > ASPECT_RATIO) {
        // Image is wider - constrain by height
        cropH = displayH;
        cropW = Math.floor(cropH * ASPECT_RATIO);
    } else {
        // Image is taller - constrain by width
        cropW = displayW;
        cropH = Math.floor(cropW / ASPECT_RATIO);
    }

    cropRect = {
        x: Math.floor((displayW - cropW) / 2),
        y: Math.floor((displayH - cropH) / 2),
        w: cropW,
        h: cropH
    };

    updateCropSelection();

    // Add resize handles to selection
    selection.innerHTML = '';
    var handles = ['nw', 'ne', 'sw', 'se'];
    for (var i = 0; i < handles.length; i++) {
        var handle = document.createElement('div');
        handle.className = 'crop-handle ' + handles[i];
        handle.setAttribute('data-handle', handles[i]);
        selection.appendChild(handle);
    }

    modal.classList.add('active');
}

function closeCropModal() {
    document.getElementById('crop-modal').classList.remove('active');
    if (cropImage) {
        URL.revokeObjectURL(cropImage.src);
        cropImage = null;
    }
    // Reset file input so same file can be selected again
    document.getElementById('file-input').value = '';
}

function updateCropSelection() {
    var selection = document.getElementById('crop-selection');
    selection.style.left = cropRect.x + 'px';
    selection.style.top = cropRect.y + 'px';
    selection.style.width = cropRect.w + 'px';
    selection.style.height = cropRect.h + 'px';
}

function getWorkspaceCoords(e) {
    var workspace = document.querySelector('.crop-workspace');
    var rect = workspace.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function startDrag(e) {
    cropDragging = true;
    cropResizing = false;
    var coords = getWorkspaceCoords(e);
    cropStartX = coords.x;
    cropStartY = coords.y;
    cropStartRect = { x: cropRect.x, y: cropRect.y, w: cropRect.w, h: cropRect.h };
}

function dragSelection(e) {
    var coords = getWorkspaceCoords(e);
    var dx = coords.x - cropStartX;
    var dy = coords.y - cropStartY;

    var canvas = document.getElementById('crop-canvas');
    var maxX = canvas.width - cropRect.w;
    var maxY = canvas.height - cropRect.h;

    cropRect.x = Math.max(0, Math.min(maxX, cropStartRect.x + dx));
    cropRect.y = Math.max(0, Math.min(maxY, cropStartRect.y + dy));

    updateCropSelection();
}

function startResize(e, handle) {
    cropResizing = true;
    cropDragging = false;
    cropResizeHandle = handle;
    var coords = getWorkspaceCoords(e);
    cropStartX = coords.x;
    cropStartY = coords.y;
    cropStartRect = { x: cropRect.x, y: cropRect.y, w: cropRect.w, h: cropRect.h };
}

function resizeSelection(e) {
    var coords = getWorkspaceCoords(e);
    var dx = coords.x - cropStartX;
    var dy = coords.y - cropStartY;
    var canvas = document.getElementById('crop-canvas');

    var newRect = { x: cropStartRect.x, y: cropStartRect.y, w: cropStartRect.w, h: cropStartRect.h };
    var minSize = 40;

    // Determine which dimension to use based on handle and movement
    if (cropResizeHandle === 'se') {
        // Resize from bottom-right
        newRect.w = Math.max(minSize, cropStartRect.w + dx);
        newRect.h = Math.floor(newRect.w / ASPECT_RATIO);
    } else if (cropResizeHandle === 'sw') {
        // Resize from bottom-left
        newRect.w = Math.max(minSize, cropStartRect.w - dx);
        newRect.h = Math.floor(newRect.w / ASPECT_RATIO);
        newRect.x = cropStartRect.x + cropStartRect.w - newRect.w;
    } else if (cropResizeHandle === 'ne') {
        // Resize from top-right
        newRect.w = Math.max(minSize, cropStartRect.w + dx);
        newRect.h = Math.floor(newRect.w / ASPECT_RATIO);
        newRect.y = cropStartRect.y + cropStartRect.h - newRect.h;
    } else if (cropResizeHandle === 'nw') {
        // Resize from top-left
        newRect.w = Math.max(minSize, cropStartRect.w - dx);
        newRect.h = Math.floor(newRect.w / ASPECT_RATIO);
        newRect.x = cropStartRect.x + cropStartRect.w - newRect.w;
        newRect.y = cropStartRect.y + cropStartRect.h - newRect.h;
    }

    // Constrain to canvas bounds
    if (newRect.x < 0) {
        newRect.x = 0;
        newRect.w = Math.min(newRect.w, canvas.width);
        newRect.h = Math.floor(newRect.w / ASPECT_RATIO);
    }
    if (newRect.y < 0) {
        newRect.y = 0;
        newRect.h = Math.min(newRect.h, canvas.height);
        newRect.w = Math.floor(newRect.h * ASPECT_RATIO);
    }
    if (newRect.x + newRect.w > canvas.width) {
        newRect.w = canvas.width - newRect.x;
        newRect.h = Math.floor(newRect.w / ASPECT_RATIO);
    }
    if (newRect.y + newRect.h > canvas.height) {
        newRect.h = canvas.height - newRect.y;
        newRect.w = Math.floor(newRect.h * ASPECT_RATIO);
    }

    // Minimum size check
    if (newRect.w >= minSize && newRect.h >= minSize / ASPECT_RATIO) {
        cropRect = newRect;
        updateCropSelection();
    }
}

function startNewSelection(e) {
    var coords = getWorkspaceCoords(e);
    var canvas = document.getElementById('crop-canvas');

    // Start a new selection from click point
    var startW = Math.min(160, canvas.width / 2);
    var startH = Math.floor(startW / ASPECT_RATIO);

    cropRect = {
        x: Math.max(0, Math.min(canvas.width - startW, coords.x - startW / 2)),
        y: Math.max(0, Math.min(canvas.height - startH, coords.y - startH / 2)),
        w: startW,
        h: startH
    };

    updateCropSelection();

    // Immediately start resizing from SE corner
    cropResizing = true;
    cropResizeHandle = 'se';
    cropStartX = coords.x;
    cropStartY = coords.y;
    cropStartRect = { x: cropRect.x, y: cropRect.y, w: cropRect.w, h: cropRect.h };
}

function applyCrop() {
    if (!cropImage) return;

    // Calculate source rectangle in original image coordinates
    var srcX = Math.floor(cropRect.x / cropScale);
    var srcY = Math.floor(cropRect.y / cropScale);
    var srcW = Math.floor(cropRect.w / cropScale);
    var srcH = Math.floor(cropRect.h / cropScale);

    // Draw cropped area to TX canvas at 320x240
    var txCanvas = document.getElementById('tx-canvas');
    var ctx = txCanvas.getContext('2d');
    ctx.drawImage(cropImage, srcX, srcY, srcW, srcH, 0, 0, WIDTH, HEIGHT);

    txCanvas.style.display = 'block';
    document.getElementById('tx-placeholder').style.display = 'none';
    document.getElementById('btn-transmit').disabled = false;
    document.getElementById('btn-tx-save').disabled = false;
    document.getElementById('tx-status').textContent = 'Ready to transmit or save';

    closeCropModal();
}

function transmit() {
    document.getElementById('tx-status').textContent = 'Encoding...';
    document.getElementById('btn-transmit').disabled = true;
    document.getElementById('btn-tx-save').disabled = true;

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

        document.getElementById('btn-tx-stop').disabled = false;
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
            document.getElementById('btn-tx-save').disabled = false;
            document.getElementById('btn-tx-stop').disabled = true;
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
    document.getElementById('btn-tx-save').disabled = false;
    document.getElementById('btn-tx-stop').disabled = true;
    document.getElementById('tx-status').textContent = 'Stopped';
}

function saveAudio() {
    document.getElementById('tx-status').textContent = 'Encoding audio...';
    document.getElementById('btn-tx-save').disabled = true;
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

        document.getElementById('btn-tx-save').disabled = false;
        document.getElementById('btn-transmit').disabled = false;
        document.getElementById('tx-status').textContent = 'Audio saved!';
    }, 50);
}
