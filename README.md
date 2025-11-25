# SSTV Robot36 Encoder/Decoder

A Python application for encoding images to Robot36 SSTV (Slow Scan Television) audio signals and decoding them back to images.

## Overview

SSTV (Slow Scan Television) is a method used by amateur radio operators to transmit images over radio frequencies. Robot36 is one of the most popular SSTV modes, transmitting 320x240 pixel color images in approximately 36 seconds.

This application provides:
- **Encoder**: Convert images (JPEG, PNG, etc.) to Robot36 SSTV audio signals (WAV format)
- **Decoder**: Convert Robot36 SSTV audio signals back to images

## Robot36 Specifications

| Parameter | Value |
|-----------|-------|
| Image Size | 320 x 240 pixels |
| Color Format | YCrCb |
| Transmission Time | ~36 seconds |
| VIS Code | 8 |
| Black Frequency | 1500 Hz |
| White Frequency | 2300 Hz |
| Sync Frequency | 1200 Hz |

## Installation

### Requirements

- Python 3.8 or higher
- numpy
- scipy
- Pillow

### Install from source

```bash
# Clone the repository
git clone <repository-url>
cd sstv_mgxs

# Install dependencies
pip install -r requirements.txt

# Install the package
pip install -e .
```

## Usage

### Command Line Interface

#### Encode an image to SSTV audio

```bash
# Basic usage - outputs to <input>.wav
python cli.py encode photo.jpg

# Specify output file
python cli.py encode photo.jpg -o sstv_signal.wav

# Custom sample rate
python cli.py encode photo.jpg -o sstv_signal.wav -s 48000
```

#### Decode SSTV audio to an image

```bash
# Basic usage - outputs to <input>.png
python cli.py decode sstv_signal.wav

# Specify output file
python cli.py decode sstv_signal.wav -o decoded.png
```

#### Show Robot36 specifications

```bash
python cli.py info
```

### Python API

#### Encoding

```python
from sstv import Robot36Encoder

# Create encoder
encoder = Robot36Encoder()

# Encode image to WAV file
encoder.encode_to_wav("input_image.jpg", "output.wav")

# Or get raw audio samples
audio_samples = encoder.encode("input_image.jpg")
```

#### Decoding

```python
from sstv import Robot36Decoder

# Create decoder
decoder = Robot36Decoder()

# Decode WAV file to image
image = decoder.decode_wav("sstv_signal.wav", "decoded_image.png")

# Or decode from audio samples
image = decoder.decode(audio_samples, "decoded_image.png")
```

## How It Works

### Encoding Process

1. **Image Preparation**: The input image is resized to 320x240 pixels
2. **Color Conversion**: RGB is converted to YCrCb color space
3. **Header Generation**:
   - Leader tone (1900 Hz for 300ms)
   - Break (1200 Hz for 10ms)
   - VIS code (identifies Robot36 mode)
4. **Line Encoding**: For each of the 240 lines:
   - Sync pulse (1200 Hz for 9ms)
   - Sync porch (1500 Hz for 3ms)
   - Y (luminance) scan (88ms)
   - Separator pulse (4.5ms)
   - Color porch (1.5ms)
   - Color difference scan (44ms) - R-Y for even lines, B-Y for odd lines

### Decoding Process

1. **FM Demodulation**: Extract instantaneous frequency from audio using Hilbert transform
2. **Header Detection**: Find leader tone and decode VIS code
3. **Sync Detection**: Locate sync pulses to identify line boundaries
4. **Line Extraction**: For each line, extract Y and color data
5. **Color Reconstruction**: Interpolate missing color information (since R-Y and B-Y alternate)
6. **Color Conversion**: Convert YCrCb back to RGB

## Project Structure

```
sstv_mgxs/
├── cli.py              # Command line interface
├── requirements.txt    # Python dependencies
├── setup.py            # Package setup
├── README.md           # This file
└── sstv/
    ├── __init__.py     # Package initialization
    ├── constants.py    # Robot36 protocol constants
    ├── encoder.py      # Image to audio encoder
    └── decoder.py      # Audio to image decoder
```

## Technical Notes

- The encoder maintains phase continuity for clean audio output
- The decoder uses bandpass filtering to isolate SSTV frequencies
- Color information is interpolated since Robot36 sends R-Y and B-Y on alternating lines
- Sample rate can be adjusted but 44100 Hz is recommended for compatibility

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## References

- [SSTV Handbook](http://www.barberdsp.com/downloads/Dayton%20Paper.pdf)
- [Robot SSTV Modes](https://www.qsl.net/on6mu/robot.htm)
