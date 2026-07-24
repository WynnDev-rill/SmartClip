import json
import subprocess
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import AnyHttpUrl, BaseModel, Field

from app.core.config import settings
from app.jobs import Job, manager
from app.media import ytdlp_inspect_command
from app.security import Auth, RateLimit, safe_error, validate_url

router = APIRouter(prefix="/api", dependencies=[Auth, RateLimit])


class URLRequest(BaseModel):
    url: AnyHttpUrl


class JobRequest(URLRequest):
    durationMode: Literal["30-plus", "60-plus", "auto"] = "auto"
    detectionMode: Literal["conservative", "balanced", "aggressive"] = "balanced"
    outputQuality: Literal["720p", "1080p", "auto"] = "auto"
    layoutMode: Literal["smart-crop", "fit-background"] = "smart-crop"
    maximumCandidates: int = Field(5, ge=1, le=100)


def checked(url: AnyHttpUrl) -> str:
    try:
        return validate_url(str(url))
    except ValueError as exc:
        raise HTTPException(422, detail={"code": "unsafe_url", "message": str(exc)}) from exc


@router.post("/url/inspect", summary="Inspect a public video URL without downloading it")
def inspect_url(body: URLRequest) -> dict:
    url = checked(body.url)
    try:
        result = subprocess.run(
            ytdlp_inspect_command(url), capture_output=True, text=True, timeout=60, check=True
        )
        data = json.loads(result.stdout)
    except Exception as exc:
        raise HTTPException(
            422, detail={"code": "inspection_failed", "message": safe_error(exc)}
        ) from exc
    duration = data.get("duration")
    if duration and duration > settings.max_video_duration_minutes * 60:
        raise HTTPException(
            422,
            detail={
                "code": "duration_too_long",
                "message": "Video exceeds the configured duration limit.",
            },
        )
    formats = data.get("formats") or []
    heights = sorted({f.get("height") for f in formats if f.get("height") in {360, 480, 720, 1080}})
    return {
        "title": data.get("title") or "Untitled",
        "uploader": data.get("uploader"),
        "duration": duration,
        "thumbnailUrl": data.get("thumbnail"),
        "sourceWidth": data.get("width"),
        "sourceHeight": data.get("height"),
        "qualityOptions": [f"{h}p" for h in heights],
        "estimatedFilesize": data.get("filesize_approx") or data.get("filesize"),
        "extractor": data.get("extractor_key") or data.get("extractor"),
        "separateAudioVideo": any(f.get("acodec") == "none" for f in formats)
        and any(f.get("vcodec") == "none" for f in formats),
        "warnings": ["Only process videos you own or have permission to use."],
    }


def view(job: Job) -> dict:
    return {
        "jobId": job.id,
        "state": job.state,
        "phase": job.phase,
        "progress": job.progress,
        "message": job.message,
        "createdAt": job.created_at,
        "startedAt": job.started_at,
        "completedAt": job.completed_at,
        "expiresAt": job.expires_at,
        "candidateCount": len(job.candidates),
        "errorCode": job.error_code,
        "errorMessage": job.error_message,
    }


def get_job(job_id: str) -> Job:
    job = manager.jobs.get(job_id)
    if not job:
        raise HTTPException(404, detail={"code": "job_not_found", "message": "Job not found."})
    return job


@router.post("/jobs", status_code=202, summary="Start a URL processing job")
def create_job(body: JobRequest, request: Request) -> dict:
    data = body.model_dump(mode="json")
    data["url"] = checked(body.url)
    data["maximumCandidates"] = min(data["maximumCandidates"], settings.max_output_candidates)
    try:
        job = manager.create(data)
    except RuntimeError:
        raise HTTPException(
            409, detail={"code": "job_active", "message": "Another job is active."}
        ) from None
    return {
        "jobId": job.id,
        "state": job.state,
        "createdAt": job.created_at,
        "statusUrl": str(request.url_for("job_status", job_id=job.id)),
    }


@router.get("/jobs/{job_id}", name="job_status", summary="Poll job status")
def job_status(job_id: str) -> dict:
    return view(get_job(job_id))


@router.post("/jobs/{job_id}/cancel", summary="Cancel a running job")
def cancel_job(job_id: str) -> dict:
    job = get_job(job_id)
    if job.state not in {"completed", "failed", "cancelled", "expired"}:
        manager.cancel(job)
    return view(job)


@router.get("/jobs/{job_id}/results", summary="List completed clips")
def results(job_id: str, request: Request) -> dict:
    job = get_job(job_id)
    if job.state != "completed":
        raise HTTPException(
            409 if job.state not in {"expired"} else 410,
            detail={"code": job.state, "message": job.message},
        )
    return {
        "jobId": job.id,
        "candidates": [
            {
                **c,
                "downloadUrl": str(
                    request.url_for("download_file", job_id=job.id, filename=c["filename"])
                ),
                "expiresAt": job.expires_at,
            }
            for c in job.candidates
        ],
    }


@router.get("/files/{job_id}/{filename}", name="download_file", summary="Download a temporary MP4")
def download_file(job_id: str, filename: str):
    job = get_job(job_id)
    if job.state != "completed" or Path(filename).name != filename or not filename.endswith(".mp4"):
        raise HTTPException(404, detail={"code": "file_not_found", "message": "File not found."})
    path = (job.directory / filename).resolve()
    if (
        job.directory.resolve() not in path.parents
        or not path.is_file()
        or filename not in {c["filename"] for c in job.candidates}
    ):
        raise HTTPException(404, detail={"code": "file_not_found", "message": "File not found."})
    return FileResponse(path, media_type="video/mp4", filename=filename)
