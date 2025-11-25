"""
Robot36 SSTV Encoder

Encodes images into Robot36 SSTV audio signals.
"""

import numpy as np
from PIL import Image
from scipy.io import wavfile

from .constants import Robot36, SSTVUtils


class Robot36Encoder:
    """
    Encoder for Robot36 SSTV mode.

    Converts images to audio signals that can be transmitted
    over radio or played through a speaker for SSTV reception.
    """

    def __init__(self, sample_rate=Robot36.SAMPLE_RATE):
        """
        Initialize the Robot36 encoder.

        Args:
            sample_rate: Audio sample rate in Hz (default: 44100)
        """
        self.sample_rate = sample_rate
        self.phase = 0

    def _add_tone(self, freq, duration):
        """Generate a tone and update phase for continuity"""
        samples, self.phase = SSTVUtils.generate_tone(
            freq, duration, self.sample_rate, self.phase
        )
        return samples

    def _add_fm_signal(self, values, duration):
        """Generate FM modulated signal and update phase"""
        samples, self.phase = SSTVUtils.generate_fm_signal(
            values, duration, self.sample_rate, self.phase
        )
        return samples

    def _generate_vis_code(self):
        """
        Generate VIS (Vertical Interval Signaling) code for Robot36.

        The VIS code identifies the SSTV mode to the receiver.
        Format: start bit + 7 data bits + parity bit (LSB first)
        """
        samples = []

        # Start bit (1)
        samples.append(self._add_tone(Robot36.FREQ_VIS_BIT_1, Robot36.VIS_BIT_DURATION))

        # VIS code bits (LSB first)
        vis_code = Robot36.VIS_CODE
        parity = 0

        for i in range(7):
            bit = (vis_code >> i) & 1
            parity ^= bit
            freq = Robot36.FREQ_VIS_BIT_1 if bit else Robot36.FREQ_VIS_BIT_0
            samples.append(self._add_tone(freq, Robot36.VIS_BIT_DURATION))

        # Parity bit (even parity)
        freq = Robot36.FREQ_VIS_BIT_1 if parity else Robot36.FREQ_VIS_BIT_0
        samples.append(self._add_tone(freq, Robot36.VIS_BIT_DURATION))

        # Stop bit (0)
        samples.append(self._add_tone(Robot36.FREQ_VIS_BIT_0, Robot36.VIS_BIT_DURATION))

        return np.concatenate(samples)

    def _generate_header(self):
        """Generate the SSTV header (leader + VIS code)"""
        samples = []

        # Leader tone (1900 Hz for 300ms)
        samples.append(self._add_tone(
            Robot36.LEADER_TONE_FREQ,
            Robot36.LEADER_TONE_DURATION
        ))

        # Break (1200 Hz for 10ms)
        samples.append(self._add_tone(
            Robot36.FREQ_SYNC,
            Robot36.BREAK_DURATION
        ))

        # VIS code
        samples.append(self._generate_vis_code())

        # Break after VIS (1200 Hz for 10ms)
        samples.append(self._add_tone(
            Robot36.FREQ_SYNC,
            Robot36.BREAK_DURATION
        ))

        return np.concatenate(samples)

    def _generate_scan_line(self, y_data, color_data, is_even):
        """
        Generate a single scan line.

        Robot36 alternates between R-Y (even lines) and B-Y (odd lines).

        Args:
            y_data: Luminance values for the line (320 pixels)
            color_data: Color difference values (R-Y or B-Y)
            is_even: True for even lines (R-Y), False for odd (B-Y)

        Returns:
            numpy array of audio samples for the line
        """
        samples = []

        # Sync pulse (1200 Hz for 9ms)
        samples.append(self._add_tone(
            Robot36.FREQ_SYNC,
            Robot36.SYNC_PULSE_DURATION
        ))

        # Sync porch (1500 Hz for 3ms)
        samples.append(self._add_tone(
            Robot36.FREQ_BLACK,
            Robot36.SYNC_PORCH_DURATION
        ))

        # Y (luminance) scan (88ms)
        samples.append(self._add_fm_signal(
            y_data,
            Robot36.Y_SCAN_DURATION
        ))

        # Separator pulse
        # Even lines: separator at 1500 Hz
        # Odd lines: separator at 2300 Hz
        sep_freq = Robot36.FREQ_BLACK if is_even else Robot36.FREQ_WHITE
        samples.append(self._add_tone(
            sep_freq,
            Robot36.SEPARATOR_DURATION
        ))

        # Porch before color (1500 Hz for 1.5ms)
        samples.append(self._add_tone(
            Robot36.FREQ_BLACK,
            Robot36.COLOR_PORCH_DURATION
        ))

        # Color difference scan (44ms)
        # Even lines: R-Y, Odd lines: B-Y
        samples.append(self._add_fm_signal(
            color_data,
            Robot36.COLOR_SCAN_DURATION
        ))

        return np.concatenate(samples)

    def encode(self, image, output_path=None):
        """
        Encode an image to Robot36 SSTV audio.

        Args:
            image: PIL Image, numpy array, or path to image file
            output_path: Optional path to save the WAV file

        Returns:
            numpy array of audio samples (float64, range -1 to 1)
        """
        # Load and prepare image
        if isinstance(image, str):
            img = Image.open(image)
        elif isinstance(image, np.ndarray):
            img = Image.fromarray(image)
        else:
            img = image

        # Convert to RGB if necessary
        if img.mode != 'RGB':
            img = img.convert('RGB')

        # Resize to Robot36 dimensions
        img = img.resize((Robot36.WIDTH, Robot36.HEIGHT), Image.Resampling.LANCZOS)

        # Convert to numpy array
        rgb_array = np.array(img, dtype=np.uint8)

        # Convert to YCrCb
        ycrcb = SSTVUtils.rgb_to_ycrcb(rgb_array)

        # Reset phase for new encoding
        self.phase = 0

        # Generate audio
        audio_samples = []

        # Add header
        audio_samples.append(self._generate_header())

        # Generate scan lines
        for line_num in range(Robot36.HEIGHT):
            y_data = ycrcb[line_num, :, 0]  # Luminance
            is_even = (line_num % 2) == 0

            if is_even:
                # Even line: use Cr (R-Y)
                color_data = ycrcb[line_num, :, 1]
            else:
                # Odd line: use Cb (B-Y)
                color_data = ycrcb[line_num, :, 2]

            audio_samples.append(self._generate_scan_line(y_data, color_data, is_even))

        # Concatenate all samples
        audio = np.concatenate(audio_samples)

        # Normalize to prevent clipping
        audio = audio * 0.9

        # Save to WAV if path provided
        if output_path:
            self.save_wav(audio, output_path)

        return audio

    def save_wav(self, audio, output_path):
        """
        Save audio samples to a WAV file.

        Args:
            audio: numpy array of audio samples (float64, range -1 to 1)
            output_path: Path to save the WAV file
        """
        # Convert to 16-bit PCM
        audio_int16 = (audio * 32767).astype(np.int16)
        wavfile.write(output_path, self.sample_rate, audio_int16)

    def encode_to_wav(self, image_path, output_path):
        """
        Convenience method to encode an image file directly to a WAV file.

        Args:
            image_path: Path to the input image
            output_path: Path to save the output WAV file
        """
        self.encode(image_path, output_path)
