"""
Robot36 SSTV Mode Constants and Protocol Specification

Robot36 is a color SSTV mode that transmits 320x240 pixel images
in approximately 36 seconds using YCrCb color encoding.
"""

import numpy as np


class Robot36:
    """Robot36 SSTV Mode Protocol Constants"""

    # Image dimensions
    WIDTH = 320
    HEIGHT = 240

    # Audio parameters
    SAMPLE_RATE = 44100  # Hz

    # Frequency specifications (Hz)
    FREQ_BLACK = 1500  # Black level
    FREQ_WHITE = 2300  # White level
    FREQ_SYNC = 1200   # Sync pulse
    FREQ_VIS_BIT_1 = 1100  # VIS code bit 1
    FREQ_VIS_BIT_0 = 1300  # VIS code bit 0

    # VIS (Vertical Interval Signaling) code for Robot36
    VIS_CODE = 8

    # Timing specifications (in seconds)
    # Leader tone
    LEADER_TONE_DURATION = 0.300  # 300ms leader tone at 1900 Hz
    LEADER_TONE_FREQ = 1900

    # Break
    BREAK_DURATION = 0.010  # 10ms break at 1200 Hz

    # VIS code timing
    VIS_BIT_DURATION = 0.030  # 30ms per bit

    # Line sync pulse
    SYNC_PULSE_DURATION = 0.009  # 9ms sync pulse

    # Sync porch
    SYNC_PORCH_DURATION = 0.003  # 3ms sync porch at 1500 Hz

    # Scan line timing for Robot36
    # Y (luminance) scan duration
    Y_SCAN_DURATION = 0.088  # 88ms for luminance

    # Separator pulse between Y and color
    SEPARATOR_DURATION = 0.0045  # 4.5ms separator at 1500 Hz

    # Porch before color
    COLOR_PORCH_DURATION = 0.0015  # 1.5ms porch at 1500 Hz

    # Color difference (R-Y or B-Y) scan duration
    COLOR_SCAN_DURATION = 0.044  # 44ms for color

    # Total line time calculation
    # Even lines: sync + porch + Y + sep + porch + R-Y
    # Odd lines: sync + porch + Y + sep + porch + B-Y

    @classmethod
    def get_total_line_duration(cls):
        """Calculate total duration for one scan line"""
        return (
            cls.SYNC_PULSE_DURATION +
            cls.SYNC_PORCH_DURATION +
            cls.Y_SCAN_DURATION +
            cls.SEPARATOR_DURATION +
            cls.COLOR_PORCH_DURATION +
            cls.COLOR_SCAN_DURATION
        )

    @classmethod
    def get_total_image_duration(cls):
        """Calculate total duration for entire image transmission"""
        header_duration = (
            cls.LEADER_TONE_DURATION +
            cls.BREAK_DURATION +
            cls.VIS_BIT_DURATION * 10 +  # 8 bits + start + parity
            cls.BREAK_DURATION
        )
        image_duration = cls.get_total_line_duration() * cls.HEIGHT
        return header_duration + image_duration

    @classmethod
    def freq_to_value(cls, freq):
        """Convert frequency to pixel value (0-255)"""
        value = (freq - cls.FREQ_BLACK) / (cls.FREQ_WHITE - cls.FREQ_BLACK) * 255
        return np.clip(value, 0, 255)

    @classmethod
    def value_to_freq(cls, value):
        """Convert pixel value (0-255) to frequency"""
        freq = cls.FREQ_BLACK + (value / 255) * (cls.FREQ_WHITE - cls.FREQ_BLACK)
        return freq


class SSTVUtils:
    """Utility functions for SSTV signal processing"""

    @staticmethod
    def rgb_to_ycrcb(rgb):
        """
        Convert RGB to YCrCb color space used by Robot36

        Args:
            rgb: numpy array of shape (..., 3) with RGB values 0-255

        Returns:
            numpy array of shape (..., 3) with YCrCb values 0-255
        """
        rgb = np.asarray(rgb, dtype=np.float64)

        # Standard YCbCr conversion matrix
        y = 16 + 65.481 * rgb[..., 0] / 255 + 128.553 * rgb[..., 1] / 255 + 24.966 * rgb[..., 2] / 255
        cr = 128 + 112.0 * rgb[..., 0] / 255 - 93.786 * rgb[..., 1] / 255 - 18.214 * rgb[..., 2] / 255
        cb = 128 - 37.797 * rgb[..., 0] / 255 - 74.203 * rgb[..., 1] / 255 + 112.0 * rgb[..., 2] / 255

        ycrcb = np.stack([y, cr, cb], axis=-1)
        return np.clip(ycrcb, 0, 255).astype(np.uint8)

    @staticmethod
    def ycrcb_to_rgb(ycrcb):
        """
        Convert YCrCb to RGB color space

        Args:
            ycrcb: numpy array of shape (..., 3) with YCrCb values 0-255

        Returns:
            numpy array of shape (..., 3) with RGB values 0-255
        """
        ycrcb = np.asarray(ycrcb, dtype=np.float64)

        y = ycrcb[..., 0]
        cr = ycrcb[..., 1]
        cb = ycrcb[..., 2]

        # Inverse conversion
        r = 298.082 * (y - 16) / 256 + 408.583 * (cr - 128) / 256
        g = 298.082 * (y - 16) / 256 - 208.120 * (cr - 128) / 256 - 100.291 * (cb - 128) / 256
        b = 298.082 * (y - 16) / 256 + 516.411 * (cb - 128) / 256

        rgb = np.stack([r, g, b], axis=-1)
        return np.clip(rgb, 0, 255).astype(np.uint8)

    @staticmethod
    def generate_tone(freq, duration, sample_rate=Robot36.SAMPLE_RATE, phase=0):
        """
        Generate a pure sine tone

        Args:
            freq: Frequency in Hz
            duration: Duration in seconds
            sample_rate: Sample rate in Hz
            phase: Starting phase in radians

        Returns:
            tuple: (samples as numpy array, ending phase)
        """
        num_samples = int(duration * sample_rate)
        t = np.arange(num_samples) / sample_rate
        samples = np.sin(2 * np.pi * freq * t + phase)
        end_phase = (2 * np.pi * freq * duration + phase) % (2 * np.pi)
        return samples, end_phase

    @staticmethod
    def generate_fm_signal(values, duration, sample_rate=Robot36.SAMPLE_RATE, phase=0):
        """
        Generate FM modulated signal for scan line

        Args:
            values: Pixel values (0-255) to encode
            duration: Total duration in seconds
            sample_rate: Sample rate in Hz
            phase: Starting phase in radians

        Returns:
            tuple: (samples as numpy array, ending phase)
        """
        num_samples = int(duration * sample_rate)
        num_values = len(values)

        # Interpolate values to match sample count
        indices = np.linspace(0, num_values - 1, num_samples)
        interp_values = np.interp(indices, np.arange(num_values), values)

        # Convert to frequencies
        freqs = Robot36.value_to_freq(interp_values)

        # Generate phase-continuous FM signal
        t = np.arange(num_samples) / sample_rate
        phase_increment = 2 * np.pi * freqs / sample_rate
        phases = np.cumsum(phase_increment) + phase
        samples = np.sin(phases)

        end_phase = phases[-1] % (2 * np.pi)
        return samples, end_phase
