from typing import Annotated

from fastapi import APIRouter, File, Response, UploadFile, status

from app.core.config import settings
from app.models.video import VideoMetadata
from app.services.storage import VideoStorage
from app.services.upload import upload_video

router = APIRouter(prefix="/videos", tags=["videos"])
storage = VideoStorage(settings.upload_directory, settings.upload_ttl_hours)


@router.post("/upload", response_model=VideoMetadata, status_code=status.HTTP_201_CREATED)
async def create_video(file: Annotated[UploadFile, File()]) -> VideoMetadata:
    storage.cleanup_expired()
    return await upload_video(file, storage, settings.max_upload_size_bytes)


@router.get("/{video_id}", response_model=VideoMetadata)
async def get_video(video_id: str) -> VideoMetadata:
    storage.cleanup_expired()
    return storage.get(video_id)


@router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(video_id: str) -> Response:
    storage.delete(video_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
