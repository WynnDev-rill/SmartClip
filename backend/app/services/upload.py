import re
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.errors import VideoError
from app.models.video import VideoMetadata
from app.services.metadata import probe_video
from app.services.storage import VideoStorage

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
CHUNK_SIZE = 1024 * 1024


def sanitize_filename(filename: str | None) -> str:
    name = Path((filename or "video").replace("\\", "/")).name
    cleaned = re.sub(r"[^\w.() -]", "_", name, flags=re.UNICODE).strip(" .")
    return cleaned[:255] or "video"


async def upload_video(file: UploadFile, storage: VideoStorage, limit: int) -> VideoMetadata:
    filename = sanitize_filename(file.filename)
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise VideoError(
            415, "unsupported_format", "Supported formats are MP4, MOV, MKV, and WEBM."
        )
    video_id = uuid4().hex
    destination = storage.video_path(video_id, extension)
    size = 0
    try:
        with destination.open("xb") as output:
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > limit:
                    raise VideoError(
                        413, "file_too_large", f"The file exceeds the {limit}-byte upload limit."
                    )
                output.write(chunk)
        if size == 0:
            raise VideoError(422, "empty_file", "The uploaded file is empty.")
        details = probe_video(destination)
        metadata = VideoMetadata(
            video_id=video_id, original_filename=filename, file_size_bytes=size, **details
        )
        storage.save_metadata(metadata)
        return metadata
    except Exception:
        destination.unlink(missing_ok=True)
        storage.metadata_path(video_id).unlink(missing_ok=True)
        raise
    finally:
        await file.close()
