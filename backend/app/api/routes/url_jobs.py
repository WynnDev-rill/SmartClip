import logging
from pathlib import Path
from secrets import token_hex
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import AnyHttpUrl, BaseModel, Field

from app.core.config import settings
from app.inspection import (
    InspectionFailure,
    extractor_version,
    inspect_metadata,
    inspection_message,
)
from app.jobs import Job, manager
from app.media import normalize_video_url
from app.security import Auth, RateLimit, validate_url

router = APIRouter(prefix="/api", dependencies=[Auth, RateLimit])
logger = logging.getLogger(__name__)

INSPECTION_STATUS = {
    "unsupported_url": 422,
    "video_unavailable": 422,
    "private_video": 422,
    "login_required": 422,
    "age_restricted": 422,
    "geo_restricted": 422,
    "inspection_timeout": 504,
}
DEFAULT_INSPECTION_STATUS = 502


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
        return normalize_video_url(validate_url(str(url)))
    except ValueError as exc:
        raise HTTPException(422, detail={"code": "unsafe_url", "message": str(exc)}) from exc


@router.post("/url/inspect", summary="Inspect a public video URL without downloading it")
def inspect_url(body: URLRequest) -> dict:
    url = checked(body.url)
    request_id = token_hex(8)
    try:
        outcome = inspect_metadata(url, request_id, youtube="youtube.com" in url)
        data = outcome.metadata
    except InspectionFailure as exc:
        status = INSPECTION_STATUS.get(exc.code, DEFAULT_INSPECTION_STATUS)
        raise HTTPException(
            status, detail={"code": exc.code, "message": inspection_message(exc.code)}
        ) from exc
    except Exception as exc:
        # Never interpolate the exception: it may contain signed URLs, headers, or cookies.
        logger.warning(
            "Unexpected inspection failure exception_type=%s code=extractor_failure",
            type(exc).__name__,
        )
        raise HTTPException(
            502,
            detail={
                "code": "extractor_failure",
                "message": inspection_message("extractor_failure"),
            },
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


@router.post("/url/diagnose", summary="Return sanitized public URL extraction diagnostics")
def diagnose_url(body: URLRequest) -> dict:
    url = checked(body.url)
    provider = "youtube" if "youtube.com" in url else "other"
    request_id = token_hex(8)
    try:
        result = inspect_metadata(url, request_id, youtube=provider == "youtube")
        return {
            "normalizedUrl": url,
            "provider": provider,
            "publicReachability": "reachable",
            "extractorVersion": result.extractor_version,
            "errorCode": None,
            "elapsedMs": result.elapsed_ms,
        }
    except InspectionFailure as exc:
        reachability = (
            "blocked_by_antibot" if exc.code == "youtube_bot_challenge" else "unreachable"
        )
        # The response intentionally excludes stderr, command arguments, paths, and request headers.
        return {
            "normalizedUrl": url,
            "provider": provider,
            "publicReachability": reachability,
            "extractorVersion": extractor_version(),
            "errorCode": exc.code,
            "elapsedMs": exc.elapsed_ms,
        }


def view(job: Job) -> dict:
    return {
        "jobId": job.id,
        "state": job.state,
        "phase": job.phase,
        "progress": job.progress,
        "progressPercent": job.progress_percent,
        "currentStep": job.current_step,
        "completedItems": job.completed_items,
        "totalItems": job.total_items,
        "message": job.message,
        "createdAt": job.created_at,
        "startedAt": job.started_at,
        "updatedAt": job.updated_at,
        "elapsedSeconds": job.elapsed_seconds,
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
