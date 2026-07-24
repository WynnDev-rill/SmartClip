from dataclasses import dataclass
from pathlib import Path


def ytdlp_inspect_command(url: str) -> list[str]:
    return [
        "yt-dlp",
        "--ignore-config",
        "--no-playlist",
        "--no-warnings",
        "--dump-single-json",
        "--",
        url,
    ]


def ytdlp_download_command(url: str, directory: Path, height: int) -> list[str]:
    limit = f"bestvideo[height<={height}]+bestaudio/best[height<={height}]"
    return [
        "yt-dlp",
        "--ignore-config",
        "--no-playlist",
        "--restrict-filenames",
        "--no-part",
        "--newline",
        "--max-filesize",
        "1000M",
        "-f",
        limit,
        "--merge-output-format",
        "mp4",
        "-o",
        str(directory / "source.%(ext)s"),
        "--",
        url,
    ]


def render_command(
    source: Path, output: Path, start: float, duration: float, width: int, height: int, layout: str
) -> list[str]:
    if layout == "smart-crop":
        vf = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    else:
        vf = (
            f"split[bg][fg];[bg]scale={width}:{height}:"
            f"force_original_aspect_ratio=increase,crop={width}:{height},"
            f"boxblur=24[blur];[fg]scale={width}:{height}:"
            "force_original_aspect_ratio=decrease[fit];"
            "[blur][fit]overlay=(W-w)/2:(H-h)/2"
        )
    return [
        "ffmpeg",
        "-nostdin",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(output),
    ]


@dataclass(frozen=True)
class Signal:
    time: float
    audio: float
    motion: float
    scene: float = 0


def analyze(
    signals: list[Signal], mode: str, maximum: int, max_duration: float = 120
) -> list[dict]:
    """Deterministic peaks, low-energy boundaries, natural endings and overlap suppression."""
    threshold = {"conservative": 0.72, "balanced": 0.55, "aggressive": 0.4}[mode]
    peaks = sorted(
        signals, key=lambda s: (-(0.45 * s.audio + 0.4 * s.motion + 0.15 * s.scene), s.time)
    )
    results: list[dict] = []
    for peak in peaks:
        score = 0.45 * peak.audio + 0.4 * peak.motion + 0.15 * peak.scene
        if score < threshold:
            break
        before = [s for s in signals if peak.time - 45 <= s.time <= peak.time]
        after = [s for s in signals if peak.time <= s.time <= peak.time + 75]
        start = (
            min(before, key=lambda s: (s.audio + s.motion, -s.time)).time
            if before
            else max(0, peak.time - 15)
        )
        end_signal = min(after, key=lambda s: (s.audio + s.motion, s.time)) if after else peak
        end = max(peak.time + 3, end_signal.time)
        if end - start > max_duration:
            start = end - max_duration
        if any(max(start, r["start"]) < min(end, r["end"]) for r in results):
            continue
        results.append(
            {
                "start": max(0, start),
                "end": end,
                "score": round(score * 100),
                "reasons": ["audio energy", "visual motion"],
            }
        )
        if len(results) >= maximum:
            break
    return sorted(results, key=lambda r: r["start"])
