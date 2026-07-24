import json
import subprocess
from pathlib import Path

from app.core.errors import VideoError


def _rate(value: str) -> float:
    try:
        numerator, denominator = value.split("/")
        return round(float(numerator) / float(denominator), 3) if float(denominator) else 0
    except (ValueError, ZeroDivisionError):
        return 0


def _resolution(height: int) -> str:
    common = (4320, 2160, 1440, 1080, 720, 480, 360)
    closest = min(common, key=lambda value: abs(value - height))
    return f"{closest}p"


def probe_video(path: Path) -> dict[str, object]:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=True)
        payload = json.loads(result.stdout)
    except (FileNotFoundError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise VideoError(
            422, "unreadable_video", "The video is corrupted or unreadable."
        ) from error

    video = next(
        (stream for stream in payload.get("streams", []) if stream.get("codec_type") == "video"),
        None,
    )
    audio = next(
        (stream for stream in payload.get("streams", []) if stream.get("codec_type") == "audio"),
        None,
    )
    if not video:
        raise VideoError(
            422, "unreadable_video", "The file does not contain a readable video stream."
        )
    width, height = int(video.get("width", 0)), int(video.get("height", 0))
    duration = float(payload.get("format", {}).get("duration") or video.get("duration") or 0)
    format_name = str(payload.get("format", {}).get("format_name", "")).split(",")[0]
    return {
        "duration_seconds": round(duration, 3),
        "width": width,
        "height": height,
        "resolution": _resolution(height),
        "frame_rate": _rate(str(video.get("avg_frame_rate", "0/1"))),
        "video_codec": str(video.get("codec_name", "unknown")),
        "audio_codec": str(audio.get("codec_name")) if audio else None,
        "container": format_name,
    }
