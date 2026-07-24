import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.routes import videos
from app.main import app
from app.services.storage import VideoStorage


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    storage = VideoStorage(tmp_path, 24)
    monkeypatch.setattr(videos, "storage", storage)
    monkeypatch.setattr(
        "app.services.upload.probe_video",
        lambda _path: {
            "duration_seconds": 12.5,
            "width": 1920,
            "height": 1080,
            "resolution": "1080p",
            "frame_rate": 60.0,
            "video_codec": "h264",
            "audio_codec": "aac",
            "container": "mp4",
        },
    )
    return TestClient(app)


def upload(client: TestClient, name: str = "clip.mp4", content: bytes = b"video"):
    return client.post("/api/videos/upload", files={"file": (name, content, "video/mp4")})


def test_successful_mp4_upload_and_metadata(client: TestClient) -> None:
    response = upload(client)
    assert response.status_code == 201
    data = response.json()
    assert data["original_filename"] == "clip.mp4"
    assert data["resolution"] == "1080p"
    assert data["frame_rate"] == 60
    assert client.get(f"/api/videos/{data['video_id']}").json() == data


def test_unsupported_extension(client: TestClient) -> None:
    response = upload(client, "clip.avi")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_format"


def test_empty_file(client: TestClient) -> None:
    assert upload(client, content=b"").status_code == 422


def test_oversized_file(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(videos.settings, "max_upload_size_bytes", 2)
    assert upload(client, content=b"too large").status_code == 413


def test_delete_uploaded_video(client: TestClient) -> None:
    video_id = upload(client).json()["video_id"]
    assert client.delete(f"/api/videos/{video_id}").status_code == 204
    assert client.get(f"/api/videos/{video_id}").status_code == 404


def test_unknown_video_id(client: TestClient) -> None:
    assert client.get("/api/videos/doesnotexist").status_code == 404


def test_unsafe_filename_is_sanitized(client: TestClient) -> None:
    data = upload(client, "../../my<script>.mp4").json()
    assert data["original_filename"] == "my_script_.mp4"
    assert ".." not in data["original_filename"]


def test_cleanup_expired_files(tmp_path: Path) -> None:
    storage = VideoStorage(tmp_path, 1)
    metadata = tmp_path / "abc.json"
    video = tmp_path / "abc.mp4"
    metadata.write_text(json.dumps({}), encoding="utf-8")
    video.write_bytes(b"video")
    old = time.time() - 7200
    os.utime(metadata, (old, old))
    assert storage.cleanup_expired() == 1
    assert not metadata.exists() and not video.exists()
