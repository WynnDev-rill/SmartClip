import json
import shutil
import subprocess
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(prefix="/videos", tags=["videos"])
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
CHUNK_SIZE = 1024 * 1024


class VideoMetadata(BaseModel):
    id: UUID
    filename: str
    duration: float
    width: int
    height: int
    resolution: str
    frame_rate: float
    video_codec: str
    audio_codec: str | None
    container: str
    file_size: int


def _paths(video_id: UUID, extension: str = "") -> tuple[Path, Path]:
    root = settings.upload_directory.resolve()
    media = (root / f"{video_id}{extension}").resolve()
    metadata = (root / f"{video_id}.json").resolve()
    if root not in media.parents or root not in metadata.parents:
        raise HTTPException(
            status_code=400, detail={"code": "invalid_path", "message": "Invalid video path."}
        )
    return media, metadata


def _rate(value: str | None) -> float:
    try:
        numerator, denominator = (value or "0/1").split("/", 1)
        return float(numerator) / float(denominator)
    except (ValueError, ZeroDivisionError):
        return 0.0


def _probe(path: Path, video_id: UUID, filename: str, file_size: int) -> VideoMetadata:
    try:
        result = subprocess.run(
            [
                settings.ffprobe_binary,
                "-v",
                "error",
                "-show_format",
                "-show_streams",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
        payload: dict[str, Any] = json.loads(result.stdout)
        streams = payload.get("streams", [])
        video = next(stream for stream in streams if stream.get("codec_type") == "video")
        audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
        width, height = int(video["width"]), int(video["height"])
        format_data = payload.get("format", {})
        return VideoMetadata(
            id=video_id,
            filename=filename,
            duration=float(format_data.get("duration") or video.get("duration") or 0),
            width=width,
            height=height,
            resolution=f"{width}x{height}",
            frame_rate=_rate(video.get("avg_frame_rate") or video.get("r_frame_rate")),
            video_codec=str(video.get("codec_name", "unknown")),
            audio_codec=str(audio.get("codec_name")) if audio else None,
            container=str(format_data.get("format_name", "unknown")),
            file_size=file_size,
        )
    except (
        subprocess.SubprocessError,
        OSError,
        ValueError,
        KeyError,
        StopIteration,
        json.JSONDecodeError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_video", "message": "The file could not be read as a video."},
        ) from exc


@router.post("", response_model=VideoMetadata, status_code=status.HTTP_201_CREATED)
async def upload_video(file: Annotated[UploadFile, File(...)]) -> VideoMetadata:
    filename = Path((file.filename or "video").replace("\\", "/")).name
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={"code": "unsupported_format", "message": "Use MP4, MOV, MKV, or WEBM."},
        )
    video_id = uuid4()
    media_path, metadata_path = _paths(video_id, extension)
    media_path.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with media_path.open("xb") as destination:
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > settings.max_upload_size:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail={
                            "code": "file_too_large",
                            "message": "The upload exceeds the configured size limit.",
                        },
                    )
                destination.write(chunk)
        metadata = _probe(media_path, video_id, filename, size)
        metadata_path.write_text(metadata.model_dump_json(), encoding="utf-8")
        return metadata
    except Exception:
        media_path.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@router.get("/{video_id}", response_model=VideoMetadata)
async def get_video(video_id: UUID) -> VideoMetadata:
    _, metadata_path = _paths(video_id)
    if not metadata_path.is_file():
        raise HTTPException(
            status_code=404, detail={"code": "video_not_found", "message": "Video not found."}
        )
    return VideoMetadata.model_validate_json(metadata_path.read_text(encoding="utf-8"))


@router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(video_id: UUID) -> None:
    _, metadata_path = _paths(video_id)
    if not metadata_path.is_file():
        raise HTTPException(
            status_code=404, detail={"code": "video_not_found", "message": "Video not found."}
        )
    metadata = VideoMetadata.model_validate_json(metadata_path.read_text(encoding="utf-8"))
    extension = Path(metadata.filename).suffix.lower()
    media_path, _ = _paths(video_id, extension)
    media_path.unlink(missing_ok=True)
    metadata_path.unlink(missing_ok=True)


def cleanup_uploads() -> None:
    shutil.rmtree(settings.upload_directory, ignore_errors=True)
