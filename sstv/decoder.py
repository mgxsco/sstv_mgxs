"""
Robot36 SSTV Decoder

Decodes Robot36 SSTV audio signals back into images.
"""

import numpy as np
from PIL import Image
from scipy.io import wavfile
from scipy.signal import hilbert, butter, filtfilt

from .constants import Robot36, SSTVUtils


class Robot36Decoder:
    """
    Decoder for Robot36 SSTV mode.

    Converts audio signals back into images.
    """

    def __init__(self, sample_rate=Robot36.SAMPLE_RATE):
        """
        Initialize the Robot36 decoder.

        Args:
            sample_rate: Expected audio sample rate in Hz
        """
        self.sample_rate = sample_rate

    def _bandpass_filter(self, signal, low_freq=1000, high_freq=2500):
        """Apply bandpass filter to isolate SSTV frequencies"""
        nyquist = self.sample_rate / 2
        low = low_freq / nyquist
        high = high_freq / nyquist
        b, a = butter(4, [low, high], btype='band')
        return filtfilt(b, a, signal)

    def _demodulate_fm(self, signal):
        """
        Demodulate FM signal to extract instantaneous frequency.

        Uses the Hilbert transform to get the analytic signal,
        then computes instantaneous frequency from phase derivative.

        Args:
            signal: Audio samples

        Returns:
            Array of instantaneous frequencies in Hz
        """
        # Apply bandpass filter
        filtered = self._bandpass_filter(signal)

        # Get analytic signal via Hilbert transform
        analytic = hilbert(filtered)

        # Compute instantaneous phase
        phase = np.unwrap(np.angle(analytic))

        # Compute instantaneous frequency (derivative of phase)
        freq = np.diff(phase) * self.sample_rate / (2 * np.pi)

        # Pad to maintain array length
        freq = np.concatenate([[freq[0]], freq])

        return freq

    def _freq_to_pixels(self, frequencies):
        """Convert frequency values to pixel values (0-255)"""
        pixels = (frequencies - Robot36.FREQ_BLACK) / (Robot36.FREQ_WHITE - Robot36.FREQ_BLACK) * 255
        return np.clip(pixels, 0, 255).astype(np.uint8)

    def _find_sync_pulses(self, frequencies, threshold=1250):
        """
        Find sync pulse positions in the frequency data.

        Sync pulses are at 1200 Hz for 9ms.

        Args:
            frequencies: Demodulated frequency values
            threshold: Frequency threshold for sync detection

        Returns:
            List of sample indices where sync pulses start
        """
        # Find where frequency is below threshold (sync region)
        is_sync = frequencies < threshold

        # Find transitions from non-sync to sync
        sync_starts = np.where(np.diff(is_sync.astype(int)) == 1)[0]

        # Filter by minimum sync duration (at least 7ms)
        min_sync_samples = int(0.007 * self.sample_rate)
        valid_syncs = []

        for start in sync_starts:
            # Check if sync pulse is long enough
            end = start
            while end < len(is_sync) and is_sync[end]:
                end += 1

            sync_duration = end - start
            if sync_duration >= min_sync_samples:
                valid_syncs.append(start)

        return valid_syncs

    def _detect_vis_code(self, frequencies):
        """
        Detect and decode the VIS code from the header.

        Returns:
            tuple: (VIS code value, sample index after VIS)
        """
        # Find leader tone (1900 Hz)
        leader_freq = Robot36.LEADER_TONE_FREQ
        tolerance = 100

        # Look for sustained 1900 Hz tone
        is_leader = np.abs(frequencies - leader_freq) < tolerance

        # Find where leader starts
        leader_start = None
        for i in range(len(is_leader) - int(0.1 * self.sample_rate)):
            if np.mean(is_leader[i:i + int(0.1 * self.sample_rate)]) > 0.7:
                leader_start = i
                break

        if leader_start is None:
            return None, 0

        # Find end of leader (transition to 1200 Hz break)
        leader_end = leader_start
        for i in range(leader_start, len(frequencies)):
            if frequencies[i] < 1300:
                leader_end = i
                break

        # Skip break (10ms)
        break_end = leader_end + int(Robot36.BREAK_DURATION * self.sample_rate)

        # Decode VIS bits
        vis_code = 0
        bit_samples = int(Robot36.VIS_BIT_DURATION * self.sample_rate)

        # Skip start bit
        pos = break_end + bit_samples

        # Read 7 data bits (LSB first)
        for i in range(7):
            bit_region = frequencies[pos:pos + bit_samples]
            avg_freq = np.mean(bit_region)

            # 1100 Hz = 1, 1300 Hz = 0
            if avg_freq < 1200:
                vis_code |= (1 << i)

            pos += bit_samples

        # Skip parity bit
        pos += bit_samples

        # Skip stop bit
        pos += bit_samples

        # Skip final break
        pos += int(Robot36.BREAK_DURATION * self.sample_rate)

        return vis_code, pos

    def _extract_line_data(self, frequencies, line_start, is_even):
        """
        Extract Y and color data from a scan line.

        Args:
            frequencies: Demodulated frequency values
            line_start: Sample index where line sync starts
            is_even: True for even lines (R-Y), False for odd (B-Y)

        Returns:
            tuple: (y_data, color_data) as numpy arrays of pixel values
        """
        # Skip sync pulse (9ms)
        pos = line_start + int(Robot36.SYNC_PULSE_DURATION * self.sample_rate)

        # Skip sync porch (3ms)
        pos += int(Robot36.SYNC_PORCH_DURATION * self.sample_rate)

        # Extract Y data (88ms)
        y_samples = int(Robot36.Y_SCAN_DURATION * self.sample_rate)
        y_region = frequencies[pos:pos + y_samples]

        # Resample Y data to WIDTH pixels
        y_indices = np.linspace(0, len(y_region) - 1, Robot36.WIDTH)
        y_data = np.interp(y_indices, np.arange(len(y_region)), y_region)
        y_data = self._freq_to_pixels(y_data)

        pos += y_samples

        # Skip separator (4.5ms)
        pos += int(Robot36.SEPARATOR_DURATION * self.sample_rate)

        # Skip color porch (1.5ms)
        pos += int(Robot36.COLOR_PORCH_DURATION * self.sample_rate)

        # Extract color data (44ms)
        color_samples = int(Robot36.COLOR_SCAN_DURATION * self.sample_rate)
        color_region = frequencies[pos:pos + color_samples]

        # Resample color data to WIDTH pixels
        color_indices = np.linspace(0, len(color_region) - 1, Robot36.WIDTH)
        color_data = np.interp(color_indices, np.arange(len(color_region)), color_region)
        color_data = self._freq_to_pixels(color_data)

        return y_data, color_data

    def decode(self, audio, output_path=None):
        """
        Decode Robot36 SSTV audio to an image.

        Args:
            audio: numpy array of audio samples, or path to WAV file
            output_path: Optional path to save the decoded image

        Returns:
            PIL Image of the decoded picture
        """
        # Load audio if path provided
        if isinstance(audio, str):
            rate, audio = wavfile.read(audio)
            self.sample_rate = rate

            # Convert to float if integer
            if audio.dtype == np.int16:
                audio = audio.astype(np.float64) / 32768
            elif audio.dtype == np.int32:
                audio = audio.astype(np.float64) / 2147483648

            # Convert stereo to mono
            if len(audio.shape) > 1:
                audio = np.mean(audio, axis=1)

        # Demodulate FM signal
        frequencies = self._demodulate_fm(audio)

        # Detect VIS code and find image start
        vis_code, image_start = self._detect_vis_code(frequencies)

        if vis_code is not None:
            print(f"Detected VIS code: {vis_code} (expected {Robot36.VIS_CODE} for Robot36)")
        else:
            print("Warning: Could not detect VIS code, attempting to find sync pulses directly")
            image_start = 0

        # Find all sync pulses after header
        sync_pulses = self._find_sync_pulses(frequencies[image_start:])
        sync_pulses = [s + image_start for s in sync_pulses]

        # Initialize image arrays
        y_image = np.zeros((Robot36.HEIGHT, Robot36.WIDTH), dtype=np.uint8)
        cr_image = np.zeros((Robot36.HEIGHT, Robot36.WIDTH), dtype=np.uint8)
        cb_image = np.zeros((Robot36.HEIGHT, Robot36.WIDTH), dtype=np.uint8)

        # Estimate line duration in samples
        line_samples = int(Robot36.get_total_line_duration() * self.sample_rate)

        # Process each line
        lines_decoded = 0
        for i, sync_pos in enumerate(sync_pulses):
            if lines_decoded >= Robot36.HEIGHT:
                break

            # Ensure we have enough data for this line
            if sync_pos + line_samples > len(frequencies):
                break

            is_even = (lines_decoded % 2) == 0

            try:
                y_data, color_data = self._extract_line_data(frequencies, sync_pos, is_even)

                y_image[lines_decoded] = y_data

                if is_even:
                    cr_image[lines_decoded] = color_data
                    # Interpolate Cb from adjacent lines
                    if lines_decoded > 0:
                        cb_image[lines_decoded] = cb_image[lines_decoded - 1]
                else:
                    cb_image[lines_decoded] = color_data
                    # Interpolate Cr from previous line
                    if lines_decoded > 0:
                        cr_image[lines_decoded] = cr_image[lines_decoded - 1]

                lines_decoded += 1

            except Exception as e:
                print(f"Warning: Error processing line {lines_decoded}: {e}")
                continue

        print(f"Decoded {lines_decoded} lines")

        # Interpolate missing color values for alternating lines
        for i in range(1, lines_decoded):
            if i % 2 == 0:
                # Even line - interpolate Cb
                if i + 1 < lines_decoded:
                    cb_image[i] = ((cb_image[i - 1].astype(int) + cb_image[i + 1].astype(int)) // 2).astype(np.uint8)
            else:
                # Odd line - interpolate Cr
                if i + 1 < lines_decoded:
                    cr_image[i] = ((cr_image[i - 1].astype(int) + cr_image[i + 1].astype(int)) // 2).astype(np.uint8)

        # Combine YCrCb channels
        ycrcb = np.stack([y_image, cr_image, cb_image], axis=-1)

        # Convert to RGB
        rgb = SSTVUtils.ycrcb_to_rgb(ycrcb)

        # Create PIL Image
        image = Image.fromarray(rgb, mode='RGB')

        # Save if path provided
        if output_path:
            image.save(output_path)

        return image

    def decode_wav(self, wav_path, output_path=None):
        """
        Convenience method to decode a WAV file directly.

        Args:
            wav_path: Path to the input WAV file
            output_path: Optional path to save the decoded image

        Returns:
            PIL Image of the decoded picture
        """
        return self.decode(wav_path, output_path)
