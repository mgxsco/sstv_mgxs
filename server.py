#!/usr/bin/env python3
"""
SSTV Robot36 Web Server

Live TX (sender) and RX (receiver) web interface for SSTV Robot36.
"""

import base64
import io
import json
import numpy as np
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from PIL import Image

from sstv import Robot36Encoder, Robot36Decoder

app = Flask(__name__)
app.config['SECRET_KEY'] = 'sstv-robot36-secret'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Global encoder/decoder instances
encoder = Robot36Encoder()
decoder = Robot36Decoder()


@app.route('/')
def index():
    """Main page with links to sender and receiver"""
    return render_template('index.html')


@app.route('/sender')
def sender():
    """Sender/TX page"""
    return render_template('sender.html')


@app.route('/receiver')
def receiver():
    """Receiver/RX page"""
    return render_template('receiver.html')


@app.route('/api/encode', methods=['POST'])
def api_encode():
    """
    API endpoint to encode an image to SSTV audio.

    Accepts: JSON with base64 image data or multipart form with image file
    Returns: JSON with base64 encoded WAV audio
    """
    try:
        if request.is_json:
            data = request.get_json()
            image_data = base64.b64decode(data['image'])
            img = Image.open(io.BytesIO(image_data))
        else:
            file = request.files['image']
            img = Image.open(file.stream)

        # Encode to SSTV audio
        audio = encoder.encode(img)

        # Convert to WAV bytes
        wav_buffer = io.BytesIO()
        from scipy.io import wavfile
        audio_int16 = (audio * 32767).astype(np.int16)
        wavfile.write(wav_buffer, encoder.sample_rate, audio_int16)
        wav_bytes = wav_buffer.getvalue()

        # Return base64 encoded audio
        return jsonify({
            'success': True,
            'audio': base64.b64encode(wav_bytes).decode('utf-8'),
            'sample_rate': encoder.sample_rate,
            'duration': len(audio) / encoder.sample_rate
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400


@app.route('/api/decode', methods=['POST'])
def api_decode():
    """
    API endpoint to decode SSTV audio to an image.

    Accepts: JSON with base64 audio data (raw PCM float32 or WAV)
    Returns: JSON with base64 encoded PNG image
    """
    try:
        data = request.get_json()

        if 'audio' in data:
            # Base64 encoded audio samples (float32 array)
            audio_bytes = base64.b64decode(data['audio'])
            sample_rate = data.get('sample_rate', 44100)

            # Convert bytes to numpy array
            audio = np.frombuffer(audio_bytes, dtype=np.float32)

            # Set decoder sample rate
            decoder.sample_rate = sample_rate

            # Decode to image
            image = decoder.decode(audio)

            # Convert to PNG bytes
            img_buffer = io.BytesIO()
            image.save(img_buffer, format='PNG')
            img_bytes = img_buffer.getvalue()

            return jsonify({
                'success': True,
                'image': base64.b64encode(img_bytes).decode('utf-8')
            })

        elif 'wav' in data:
            # Base64 encoded WAV file
            wav_bytes = base64.b64decode(data['wav'])
            wav_buffer = io.BytesIO(wav_bytes)

            # Decode WAV
            from scipy.io import wavfile
            rate, audio = wavfile.read(wav_buffer)

            if audio.dtype == np.int16:
                audio = audio.astype(np.float64) / 32768

            if len(audio.shape) > 1:
                audio = np.mean(audio, axis=1)

            decoder.sample_rate = rate
            image = decoder.decode(audio)

            img_buffer = io.BytesIO()
            image.save(img_buffer, format='PNG')
            img_bytes = img_buffer.getvalue()

            return jsonify({
                'success': True,
                'image': base64.b64encode(img_bytes).decode('utf-8')
            })

        else:
            return jsonify({'success': False, 'error': 'No audio data provided'}), 400

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 400


# WebSocket events for real-time communication

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    print(f"Client connected: {request.sid}")
    emit('status', {'message': 'Connected to SSTV server'})


@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    print(f"Client disconnected: {request.sid}")


@socketio.on('encode_image')
def handle_encode_image(data):
    """
    WebSocket handler for real-time image encoding.

    Receives base64 image, encodes to SSTV, and sends back audio.
    """
    try:
        image_data = base64.b64decode(data['image'])
        img = Image.open(io.BytesIO(image_data))

        # Encode to SSTV audio
        audio = encoder.encode(img)

        # Send audio as float32 array
        audio_float32 = audio.astype(np.float32)
        audio_bytes = audio_float32.tobytes()

        emit('encoded_audio', {
            'audio': base64.b64encode(audio_bytes).decode('utf-8'),
            'sample_rate': encoder.sample_rate,
            'num_samples': len(audio)
        })

    except Exception as e:
        emit('error', {'message': str(e)})


@socketio.on('decode_audio')
def handle_decode_audio(data):
    """
    WebSocket handler for real-time audio decoding.

    Receives audio samples, decodes to image, and sends back.
    """
    try:
        audio_bytes = base64.b64decode(data['audio'])
        sample_rate = data.get('sample_rate', 44100)

        # Convert to numpy array
        audio = np.frombuffer(audio_bytes, dtype=np.float32)

        decoder.sample_rate = sample_rate
        image = decoder.decode(audio)

        # Convert to PNG
        img_buffer = io.BytesIO()
        image.save(img_buffer, format='PNG')
        img_bytes = img_buffer.getvalue()

        emit('decoded_image', {
            'image': base64.b64encode(img_bytes).decode('utf-8')
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        emit('error', {'message': str(e)})


@socketio.on('broadcast_audio')
def handle_broadcast_audio(data):
    """
    Broadcast SSTV audio to all connected receivers.
    """
    # Broadcast to all clients except sender
    emit('sstv_signal', data, broadcast=True, include_self=False)


if __name__ == '__main__':
    print("Starting SSTV Robot36 Web Server...")
    print("  Sender:   http://localhost:5000/sender")
    print("  Receiver: http://localhost:5000/receiver")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
