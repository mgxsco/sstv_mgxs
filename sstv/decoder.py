"""
Robot36 SSTV Decoder

Decodes Robot36 SSTV audio signals back into images.
"""

import numpy as np
from PIL import Image
from scipy.io import wavfile
from scipy.signal import hilbert, butter, filtfilt, medfilt

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
        b, a = butter(5, [low, high], btype='band')
        return filtfilt(b, a, signal)

    def _lowpass_filter(self, signal, cutoff=1000):
        """Apply lowpass filter to smooth frequency estimates"""
        nyquist = self.sample_rate / 2
        normalized_cutoff = cutoff / nyquist
        b, a = butter(3, normalized_cutoff, btype='low')
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
        # Apply bandpass filter to isolate SSTV frequencies
        filtered = self._bandpass_filter(signal)

        # Get analytic signal via Hilbert transform
        analytic = hilbert(filtered)

        # Compute instantaneous phase
        phase = np.unwrap(np.angle(analytic))

        # Compute instantaneous frequency (derivative of phase)
        freq = np.diff(phase) * self.sample_rate / (2 * np.pi)

        # Pad to maintain array length
        freq = np.concatenate([[freq[0]], freq])

        # Apply lowpass filter to smooth frequency estimates
        freq = self._lowpass_filter(freq, cutoff=800)

        # Clip to valid SSTV range
        freq = np.clip(freq, 1100, 2400)

        return freq

    def _freq_to_pixels(self, frequencies):
        """Convert frequency values to pixel values (0-255)"""
        pixels = (frequencies - Robot36.FREQ_BLACK) / (Robot36.FREQ_WHITE - Robot36.FREQ_BLACK) * 255
        return np.clip(pixels, 0, 255).astype(np.uint8)

    def _find_sync_pulses(self, frequencies):
        """
        Find sync pulse positions in the frequency data.

        Sync pulses are at 1200 Hz for 9ms.

        Args:
            frequencies: Demodulated frequency values

        Returns:
            List of sample indices where sync pulses start
        """
        sync_threshold = 1350  # Below this is considered sync region
        min_sync_samples = int(0.006 * self.sample_rate)  # At least 6ms
        max_sync_samples = int(0.015 * self.sample_rate)  # At most 15ms

        # Find where frequency is below threshold (sync region)
        is_sync = frequencies < sync_threshold

        # Find transitions from non-sync to sync
        sync_starts = np.where(np.diff(is_sync.astype(int)) == 1)[0] + 1

        valid_syncs = []

        for start in sync_starts:
            # Find end of sync pulse
            end = start
            while end < len(is_sync) and is_sync[end]:
                end += 1

            sync_duration = end - start

            # Valid sync pulse duration check
            if min_sync_samples <= sync_duration <= max_sync_samples:
                # Check average frequency is close to 1200 Hz
                avg_freq = np.mean(frequencies[start:end])
                if avg_freq < 1300:
                    valid_syncs.append(start)

        return valid_syncs

    def _filter_sync_pulses(self, sync_pulses):
        """
        Filter sync pulses to keep only line syncs at expected intervals.

        Args:
            sync_pulses: List of detected sync positions

        Returns:
            List of filtered sync positions
        """
        if len(sync_pulses) < 2:
            return sync_pulses

        # Expected line duration in samples
        expected_line_samples = int(Robot36.get_total_line_duration() * self.sample_rate)
        tolerance = int(0.005 * self.sample_rate)  # 5ms tolerance

        filtered = [sync_pulses[0]]

        for sync in sync_pulses[1:]:
            # Distance from last accepted sync
            dist = sync - filtered[-1]

            # Accept if close to expected line duration
            if abs(dist - expected_line_samples) < tolerance:
                filtered.append(sync)
            # Or if it's approximately a multiple (we might have missed some)
            elif dist > expected_line_samples * 0.8:
                # Check if this could be a valid next line
                filtered.append(sync)

        return filtered

    def _detect_header_end(self, frequencies):
        """
        Detect the end of the SSTV header (after VIS code).

        Returns:
            Sample index where image data begins
        """
        # Look for leader tone (1900 Hz)
        leader_freq = Robot36.LEADER_TONE_FREQ
        tolerance = 150

        # Search for sustained 1900 Hz tone
        window_samples = int(0.05 * self.sample_rate)  # 50ms window

        leader_start = None
        for i in range(0, len(frequencies) - window_samples, window_samples // 2):
            window = frequencies[i:i + window_samples]
            if np.mean(np.abs(window - leader_freq) < tolerance) > 0.6:
                leader_start = i
                break

        if leader_start is None:
            print("Warning: Could not detect leader tone")
            return 0

        # Find end of leader tone (drops to 1200 Hz)
        leader_end = leader_start
        for i in range(leader_start + window_samples, len(frequencies)):
            if frequencies[i] < 1400:
                leader_end = i
                break

        # Skip header components:
        # - Break: 10ms
        # - VIS: 10 bits * 30ms = 300ms
        # - Final break: 10ms
        header_duration = (
            Robot36.BREAK_DURATION +
            10 * Robot36.VIS_BIT_DURATION +
            Robot36.BREAK_DURATION
        )

        image_start = leader_end + int(header_duration * self.sample_rate)

        return min(image_start, len(frequencies) - 1)

    def _extract_line_data(self, frequencies, line_start):
        """
        Extract Y and color data from a scan line.

        Args:
            frequencies: Demodulated frequency values
            line_start: Sample index where line sync starts

        Returns:
            tuple: (y_data, color_data) as numpy arrays of pixel values
        """
        # Calculate sample positions
        sync_samples = int(Robot36.SYNC_PULSE_DURATION * self.sample_rate)
        porch_samples = int(Robot36.SYNC_PORCH_DURATION * self.sample_rate)
        y_samples = int(Robot36.Y_SCAN_DURATION * self.sample_rate)
        sep_samples = int(Robot36.SEPARATOR_DURATION * self.sample_rate)
        color_porch_samples = int(Robot36.COLOR_PORCH_DURATION * self.sample_rate)
        color_samples = int(Robot36.COLOR_SCAN_DURATION * self.sample_rate)

        # Skip sync pulse and porch
        y_start = line_start + sync_samples + porch_samples

        # Extract Y data
        y_end = y_start + y_samples
        if y_end > len(frequencies):
            y_end = len(frequencies)

        y_region = frequencies[y_start:y_end]

        if len(y_region) < 10:
            return np.full(Robot36.WIDTH, 128, dtype=np.uint8), np.full(Robot36.WIDTH, 128, dtype=np.uint8)

        # Resample Y data to WIDTH pixels
        y_indices = np.linspace(0, len(y_region) - 1, Robot36.WIDTH)
        y_data = np.interp(y_indices, np.arange(len(y_region)), y_region)
        y_data = self._freq_to_pixels(y_data)

        # Extract color data
        color_start = y_end + sep_samples + color_porch_samples
        color_end = color_start + color_samples

        if color_end > len(frequencies):
            color_end = len(frequencies)

        color_region = frequencies[color_start:color_end]

        if len(color_region) < 10:
            return y_data, np.full(Robot36.WIDTH, 128, dtype=np.uint8)

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
            print(f"Loaded audio: {len(audio)} samples at {rate} Hz")

            # Convert to float if integer
            if audio.dtype == np.int16:
                audio = audio.astype(np.float64) / 32768
            elif audio.dtype == np.int32:
                audio = audio.astype(np.float64) / 2147483648

            # Convert stereo to mono
            if len(audio.shape) > 1:
                audio = np.mean(audio, axis=1)

        print("Demodulating FM signal...")
        frequencies = self._demodulate_fm(audio)

        # Detect header end
        print("Detecting header...")
        image_start = self._detect_header_end(frequencies)
        print(f"Image data starts at sample {image_start}")

        # Find all sync pulses after header
        print("Finding sync pulses...")
        sync_pulses = self._find_sync_pulses(frequencies[image_start:])
        sync_pulses = [s + image_start for s in sync_pulses]
        print(f"Found {len(sync_pulses)} potential sync pulses")

        # Filter to keep valid line syncs
        sync_pulses = self._filter_sync_pulses(sync_pulses)
        print(f"Filtered to {len(sync_pulses)} line syncs")

        # Initialize image arrays
        # Important: Cr and Cb should be 128 for neutral gray, not 0!
        y_image = np.zeros((Robot36.HEIGHT, Robot36.WIDTH), dtype=np.uint8)
        cr_image = np.full((Robot36.HEIGHT, Robot36.WIDTH), 128, dtype=np.uint8)
        cb_image = np.full((Robot36.HEIGHT, Robot36.WIDTH), 128, dtype=np.uint8)

        # Estimate line duration in samples
        line_samples = int(Robot36.get_total_line_duration() * self.sample_rate)

        # Process each line
        print("Decoding scan lines...")
        lines_decoded = 0

        for i, sync_pos in enumerate(sync_pulses):
            if lines_decoded >= Robot36.HEIGHT:
                break

            # Ensure we have enough data for this line
            if sync_pos + line_samples > len(frequencies):
                break

            try:
                y_data, color_data = self._extract_line_data(frequencies, sync_pos)

                y_image[lines_decoded] = y_data

                # Robot36: even lines have R-Y (Cr), odd lines have B-Y (Cb)
                is_even = (lines_decoded % 2) == 0

                if is_even:
                    cr_image[lines_decoded] = color_data
                else:
                    cb_image[lines_decoded] = color_data

                lines_decoded += 1

            except Exception as e:
                print(f"Warning: Error processing line {lines_decoded}: {e}")
                continue

        print(f"Decoded {lines_decoded} lines")

        # Interpolate missing color values for alternating lines
        # Even lines have Cr, need to interpolate Cb
        # Odd lines have Cb, need to interpolate Cr
        for i in range(lines_decoded):
            is_even = (i % 2) == 0

            if is_even:
                # Even line - has Cr, need Cb
                # Use Cb from adjacent odd lines
                if i > 0:
                    cb_image[i] = cb_image[i - 1]
                elif i + 1 < lines_decoded:
                    cb_image[i] = cb_image[i + 1]
            else:
                # Odd line - has Cb, need Cr
                # Use Cr from adjacent even lines
                if i > 0:
                    cr_image[i] = cr_image[i - 1]
                elif i + 1 < lines_decoded:
                    cr_image[i] = cr_image[i + 1]

        # Second pass: average interpolation where possible
        for i in range(1, lines_decoded - 1):
            is_even = (i % 2) == 0

            if is_even:
                # Average Cb from lines above and below
                cb_image[i] = ((cb_image[i - 1].astype(np.int32) +
                                cb_image[i + 1].astype(np.int32)) // 2).astype(np.uint8)
            else:
                # Average Cr from lines above and below
                cr_image[i] = ((cr_image[i - 1].astype(np.int32) +
                                cr_image[i + 1].astype(np.int32)) // 2).astype(np.uint8)

        # Combine YCrCb channels
        ycrcb = np.stack([y_image, cr_image, cb_image], axis=-1)

        # Convert to RGB
        rgb = SSTVUtils.ycrcb_to_rgb(ycrcb)

        # Create PIL Image
        image = Image.fromarray(rgb, mode='RGB')

        # Save if path provided
        if output_path:
            image.save(output_path)
            print(f"Saved decoded image to {output_path}")

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
