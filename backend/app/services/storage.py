import time
from pathlib import Path

from app.core.errors import VideoError
from app.models.video import VideoMetadata


class VideoStorage:
    def __init__(self, directory: Path, ttl_hours: float) -> None:
        self.directory = directory.resolve()
        self.ttl_seconds = ttl_hours * 3600
        self.directory.mkdir(parents=True, exist_ok=True)

    def video_path(self, video_id: str, extension: str) -> Path:
        return self.directory / f"{video_id}{extension}"

    def metadata_path(self, video_id: str) -> Path:
        return self.directory / f"{video_id}.json"

    def save_metadata(self, metadata: VideoMetadata) -> None:
        self.metadata_path(metadata.video_id).write_text(
            metadata.model_dump_json(), encoding="utf-8"
        )

    def get(self, video_id: str) -> VideoMetadata:
        if not video_id.isalnum():
            raise VideoError(404, "video_not_found", "Video not found.")
        path = self.metadata_path(video_id)
        try:
            return VideoMetadata.model_validate_json(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError) as error:
            raise VideoError(404, "video_not_found", "Video not found.") from error

    def delete(self, video_id: str) -> None:
        metadata = self.get(video_id)
        for path in self.directory.glob(f"{metadata.video_id}.*"):
            if path.is_file():
                path.unlink(missing_ok=True)

    def cleanup_expired(self, now: float | None = None) -> int:
        cutoff = (now or time.time()) - self.ttl_seconds
        removed = 0
        for metadata_path in self.directory.glob("*.json"):
            if metadata_path.stat().st_mtime < cutoff:
                video_id = metadata_path.stem
                for path in self.directory.glob(f"{video_id}.*"):
                    path.unlink(missing_ok=True)
                removed += 1
        return removed
