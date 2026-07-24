import json
from pathlib import Path
from unittest.mock import Mock
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.routes import videos
from app.core.config import settings
from app.main import app

PROBE = {
    "streams": [
        {
            "codec_type": "video",
            "codec_name": "h264",
            "width": 1920,
            "height": 1080,
            "avg_frame_rate": "30000/1001",
        },
        {"codec_type": "audio", "codec_name": "aac"},
    ],
    "format": {"duration": "12.5", "format_name": "mov,mp4"},
}


def probe_result():
    return Mock(stdout=json.dumps(PROBE))


def test_upload_get_and_delete_video(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "upload_directory", tmp_path)
    monkeypatch.setattr(videos.subprocess, "run", lambda *args, **kwargs: probe_result())
    with TestClient(app) as client:
        response = client.post(
            "/api/videos", files={"file": ("../unsafe.mp4", b"video-data", "video/mp4")}
        )
        assert response.status_code == 201
        body = response.json()
        UUID(body["id"])
        assert body["filename"] == "unsafe.mp4"
        assert body["resolution"] == "1920x1080"
        assert body["audio_codec"] == "aac"
        assert client.get(f"/api/videos/{body['id']}").json() == body
        assert client.delete(f"/api/videos/{body['id']}").status_code == 204
        assert client.get(f"/api/videos/{body['id']}").status_code == 404


def test_rejects_unsupported_format(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "upload_directory", tmp_path)
    with TestClient(app) as client:
        response = client.post("/api/videos", files={"file": ("bad.exe", b"bad")})
    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "unsupported_format"


def test_enforces_streamed_size_limit(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "upload_directory", tmp_path)
    monkeypatch.setattr(settings, "max_upload_size", 4)
    with TestClient(app) as client:
        response = client.post("/api/videos", files={"file": ("large.webm", b"12345")})
    assert response.status_code == 413
    assert not tmp_path.exists() or not list(tmp_path.iterdir())
