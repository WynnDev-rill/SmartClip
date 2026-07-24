from typing import Literal

from pydantic import BaseModel


class VideoMetadata(BaseModel):
    video_id: str
    original_filename: str
    file_size_bytes: int
    duration_seconds: float
    width: int
    height: int
    resolution: str
    frame_rate: float
    video_codec: str
    audio_codec: str | None
    container: str
    status: Literal["uploaded"] = "uploaded"
