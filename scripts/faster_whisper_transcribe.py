#!/usr/bin/env python3
"""
Faster-Whisper Transcription Script
Standalone script for transcribing audio files using faster-whisper
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, Any, List

try:
    from faster_whisper import WhisperModel, BatchedInferencePipeline
except ImportError:
    print("Error: faster-whisper not installed. Run: pip install faster-whisper", file=sys.stderr)
    sys.exit(1)


def transcribe_audio(
    input_file: str,
    output_file: str,
    model_size: str = "large-v3",
    device: str = "cpu",
    compute_type: str = "float16",
    language: str = None,
    task: str = "transcribe",
    batch_size: int = None,
    beam_size: int = 5,
    vad_filter: bool = False,
    word_timestamps: bool = False,
) -> Dict[str, Any]:
    """
    Transcribe audio file using faster-whisper
    """
    print(f"Loading model: {model_size} on {device} with {compute_type}", file=sys.stderr)
    
    # Load model
    model = WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type
    )
    
    # Use batched inference if batch_size is specified
    if batch_size and batch_size > 1:
        print(f"Using batched inference with batch_size={batch_size}", file=sys.stderr)
        batched_model = BatchedInferencePipeline(model=model)
        segments, info = batched_model.transcribe(
            input_file,
            batch_size=batch_size,
            beam_size=beam_size,
            language=language,
            task=task,
            vad_filter=vad_filter,
            word_timestamps=word_timestamps,
        )
    else:
        print("Using standard inference", file=sys.stderr)
        segments, info = model.transcribe(
            input_file,
            beam_size=beam_size,
            language=language,
            task=task,
            vad_filter=vad_filter,
            word_timestamps=word_timestamps,
        )
    
    # Convert segments to list and extract data
    segments_list = []
    full_text = ""
    
    print("Processing segments...", file=sys.stderr)
    segment_count = 0
    for i, segment in enumerate(segments):
        segment_data = {
            "id": i,
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
        }

        # Progress reporting every 10 segments
        if i % 10 == 0 and i > 0:
            print(f"Processed {i} segments...", file=sys.stderr)

        segment_count = i + 1
        
        # Add word-level timestamps if requested
        if word_timestamps and hasattr(segment, 'words') and segment.words:
            segment_data["words"] = [
                {
                    "start": word.start,
                    "end": word.end,
                    "word": word.word,
                    "probability": word.probability,
                }
                for word in segment.words
            ]
        
        segments_list.append(segment_data)
        full_text += segment.text.strip() + " "

    print(f"Completed processing {segment_count} segments", file=sys.stderr)

    # Prepare result
    result = {
        "text": full_text.strip(),
        "segments": segments_list,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "duration_after_vad": getattr(info, 'duration_after_vad', None),
    }
    
    return result


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio using faster-whisper")
    parser.add_argument("--input", required=True, help="Input audio file path")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument("--model", default="large-v3", help="Model size (default: large-v3)")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="Device (default: cpu)")
    parser.add_argument("--compute_type", default="float16", help="Compute type (default: float16)")
    parser.add_argument("--language", help="Language code (auto-detect if not specified)")
    parser.add_argument("--task", default="transcribe", choices=["transcribe", "translate"], help="Task (default: transcribe)")
    parser.add_argument("--batch_size", type=int, help="Batch size for batched inference")
    parser.add_argument("--beam_size", type=int, default=5, help="Beam size (default: 5)")
    parser.add_argument("--vad_filter", action="store_true", help="Enable VAD filtering")
    parser.add_argument("--word_timestamps", action="store_true", help="Enable word-level timestamps")
    
    args = parser.parse_args()
    
    # Validate input file
    if not Path(args.input).exists():
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)
    
    # Create output directory if needed
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    
    try:
        start_time = time.time()
        
        # Transcribe
        result = transcribe_audio(
            input_file=args.input,
            output_file=args.output,
            model_size=args.model,
            device=args.device,
            compute_type=args.compute_type,
            language=args.language,
            task=args.task,
            batch_size=args.batch_size,
            beam_size=args.beam_size,
            vad_filter=args.vad_filter,
            word_timestamps=args.word_timestamps,
        )
        
        # Save result
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        
        elapsed_time = time.time() - start_time
        print(f"Transcription completed in {elapsed_time:.2f}s", file=sys.stderr)
        print(f"Output saved to: {args.output}", file=sys.stderr)
        
    except Exception as e:
        print(f"Error during transcription: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
