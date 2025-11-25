#!/usr/bin/env python3
"""
SSTV Robot36 Command Line Interface

Encode images to Robot36 SSTV audio or decode audio back to images.
"""

import argparse
import sys
from pathlib import Path


def encode_command(args):
    """Handle the encode subcommand"""
    from sstv import Robot36Encoder

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file '{input_path}' not found", file=sys.stderr)
        sys.exit(1)

    # Determine output path
    if args.output:
        output_path = args.output
    else:
        output_path = input_path.stem + ".wav"

    print(f"Encoding '{input_path}' to Robot36 SSTV...")

    encoder = Robot36Encoder(sample_rate=args.sample_rate)
    encoder.encode_to_wav(str(input_path), output_path)

    print(f"Successfully encoded to '{output_path}'")
    print(f"  Image size: 320x240")
    print(f"  Sample rate: {args.sample_rate} Hz")
    print(f"  Approximate duration: ~36 seconds")


def decode_command(args):
    """Handle the decode subcommand"""
    from sstv import Robot36Decoder

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file '{input_path}' not found", file=sys.stderr)
        sys.exit(1)

    # Determine output path
    if args.output:
        output_path = args.output
    else:
        output_path = input_path.stem + ".png"

    print(f"Decoding '{input_path}' from Robot36 SSTV...")

    decoder = Robot36Decoder()
    image = decoder.decode_wav(str(input_path), output_path)

    print(f"Successfully decoded to '{output_path}'")
    print(f"  Image size: {image.size[0]}x{image.size[1]}")


def info_command(args):
    """Handle the info subcommand"""
    from sstv.constants import Robot36

    print("Robot36 SSTV Mode Specifications")
    print("=" * 40)
    print(f"  Image dimensions: {Robot36.WIDTH}x{Robot36.HEIGHT} pixels")
    print(f"  Default sample rate: {Robot36.SAMPLE_RATE} Hz")
    print(f"  VIS code: {Robot36.VIS_CODE}")
    print()
    print("Frequency specifications:")
    print(f"  Black level: {Robot36.FREQ_BLACK} Hz")
    print(f"  White level: {Robot36.FREQ_WHITE} Hz")
    print(f"  Sync pulse: {Robot36.FREQ_SYNC} Hz")
    print()
    print("Timing specifications:")
    print(f"  Line duration: {Robot36.get_total_line_duration()*1000:.2f} ms")
    print(f"  Total image duration: {Robot36.get_total_image_duration():.2f} seconds")


def main():
    """Main entry point for the CLI"""
    parser = argparse.ArgumentParser(
        prog="sstv-robot36",
        description="SSTV Robot36 encoder and decoder",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Encode an image to SSTV audio:
    sstv-robot36 encode photo.jpg -o sstv_signal.wav

  Decode SSTV audio to an image:
    sstv-robot36 decode sstv_signal.wav -o decoded.png

  Show Robot36 mode information:
    sstv-robot36 info
"""
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Encode command
    encode_parser = subparsers.add_parser(
        "encode",
        help="Encode an image to Robot36 SSTV audio"
    )
    encode_parser.add_argument(
        "input",
        help="Input image file (JPEG, PNG, etc.)"
    )
    encode_parser.add_argument(
        "-o", "--output",
        help="Output WAV file (default: <input>.wav)"
    )
    encode_parser.add_argument(
        "-s", "--sample-rate",
        type=int,
        default=44100,
        help="Audio sample rate in Hz (default: 44100)"
    )
    encode_parser.set_defaults(func=encode_command)

    # Decode command
    decode_parser = subparsers.add_parser(
        "decode",
        help="Decode Robot36 SSTV audio to an image"
    )
    decode_parser.add_argument(
        "input",
        help="Input WAV file"
    )
    decode_parser.add_argument(
        "-o", "--output",
        help="Output image file (default: <input>.png)"
    )
    decode_parser.set_defaults(func=decode_command)

    # Info command
    info_parser = subparsers.add_parser(
        "info",
        help="Show Robot36 mode specifications"
    )
    info_parser.set_defaults(func=info_command)

    # Parse arguments
    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(0)

    # Execute the appropriate command
    args.func(args)


if __name__ == "__main__":
    main()
