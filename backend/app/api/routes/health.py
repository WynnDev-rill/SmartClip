import shutil

from fastapi import APIRouter

from app.jobs import TERMINAL, manager

router = APIRouter(tags=["system"])


@router.get("/health", summary="Public container health check")
def health_check() -> dict:
    return {
        "status": "ok",
        "service": "smartclip-url-service",
        "version": "1.0.0",
        "ffmpegAvailable": shutil.which("ffmpeg") is not None,
        "ffprobeAvailable": shutil.which("ffprobe") is not None,
        "ytDlpAvailable": shutil.which("yt-dlp") is not None,
        "jobActive": any(j.state not in TERMINAL for j in manager.jobs.values()),
    }
