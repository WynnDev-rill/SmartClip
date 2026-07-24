import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.api.routes import url_jobs
from app.core.config import settings
from app.jobs import Job, manager
from app.main import app
from app.media import Signal, analyze, render_command, ytdlp_download_command, ytdlp_inspect_command
from app.security import token_matches, validate_url

TOKEN = "test-secret"


@pytest.fixture(autouse=True)
def clean(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "api_token", TOKEN)
    monkeypatch.setattr(settings, "temp_root", tmp_path)
    manager.jobs.clear()
    yield
    manager.jobs.clear()


def auth():
    return {"Authorization": f"Bearer {TOKEN}"}


def public_resolver(*args, **kwargs):
    return [(2, 1, 6, "", ("93.184.216.34", 443))]


def test_health_and_authentication():
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert (
            client.post("/api/jobs", json={"url": "https://example.com/video"}).status_code == 401
        )
        assert (
            client.post(
                "/api/jobs",
                headers={"Authorization": "Bearer wrong"},
                json={"url": "https://example.com/video"},
            ).status_code
            == 401
        )
    assert token_matches("same", "same") and not token_matches("no", "same")


@pytest.mark.parametrize(
    "url", ["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)"]
)
def test_invalid_schemes(url):
    with pytest.raises(ValueError):
        validate_url(url, public_resolver)


def test_ssrf_and_redirect_destination_validation():
    for address in ("127.0.0.1", "10.0.0.1", "169.254.1.1", "::1", "fc00::1"):
        with pytest.raises(ValueError):
            validate_url(
                "https://host.test/v",
                lambda *a, address=address, **k: [(2, 1, 6, "", (address, 443))],
            )
    assert validate_url("https://example.com/v", public_resolver)


def test_inspect_safe_metadata(monkeypatch):
    monkeypatch.setattr(url_jobs, "validate_url", lambda u: u)
    payload = {
        "title": "Mine",
        "duration": 10,
        "extractor_key": "Youtube",
        "formats": [{"height": 720, "acodec": "none"}, {"vcodec": "none"}],
    }
    monkeypatch.setattr(
        url_jobs.subprocess, "run", lambda *a, **k: Mock(stdout=json.dumps(payload))
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/url/inspect", headers=auth(), json={"url": "https://example.com/v"}
        )
    assert response.status_code == 200 and response.json()["qualityOptions"] == ["720p"]
    assert "formats" not in response.json()


def test_option_validation():
    with TestClient(app) as client:
        response = client.post(
            "/api/jobs", headers=auth(), json={"url": "https://example.com", "layoutMode": "evil"}
        )
    assert response.status_code == 422


def test_commands_are_argument_lists_without_shell_paths(tmp_path):
    url = "https://example.com/v;touch /tmp/pwn"
    inspect = ytdlp_inspect_command(url)
    download = ytdlp_download_command(url, tmp_path, 720)
    render = render_command(tmp_path / "s.mp4", tmp_path / "o.mp4", 1, 5, 720, 1280, "smart-crop")
    assert inspect[-1] == url and download[-1] == url and "--no-playlist" in download
    assert render[0] == "ffmpeg" and "shell=True" not in repr((inspect, download, render))


def test_candidate_scoring_natural_end_and_overlap():
    signals = [
        Signal(0, 0.1, 0.1),
        Signal(5, 0.9, 0.9, 0.8),
        Signal(8, 0.05, 0.05),
        Signal(6, 0.8, 0.8),
    ]
    found = analyze(signals, "balanced", 5)
    assert len(found) == 1 and found[0]["end"] == 8 and found[0]["score"] > 80
    assert analyze([Signal(0, 0.1, 0.1)], "conservative", 3) == []


def test_cleanup_expiry_and_safe_file_serving(tmp_path):
    directory = tmp_path / "abc"
    directory.mkdir()
    output = directory / "candidate-1.mp4"
    output.write_bytes(b"mp4")
    job = Job(
        "abc",
        {},
        directory,
        state="completed",
        phase="completed",
        candidates=[{"filename": output.name}],
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    manager.jobs[job.id] = job
    with TestClient(app) as client:
        assert client.get("/api/files/abc/candidate-1.mp4", headers=auth()).status_code == 200
        assert client.get("/api/files/abc/not-owned.mp4", headers=auth()).status_code == 404
        assert client.get("/api/files/abc/%2e%2e%2fsecret.mp4", headers=auth()).status_code in {
            404,
            422,
        }
    manager.cleanup(datetime.now(UTC) + timedelta(minutes=2))
    assert job.state == "expired" and not directory.exists()


def test_one_active_job_and_cancellation(monkeypatch, tmp_path):
    monkeypatch.setattr(url_jobs, "validate_url", lambda u: u)
    active = Job("active", {}, tmp_path / "active")
    manager.jobs[active.id] = active
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/jobs", headers=auth(), json={"url": "https://example.com/v"}
            ).status_code
            == 409
        )
        response = client.post("/api/jobs/active/cancel", headers=auth())
    assert response.status_code == 200 and active.cancelled.is_set()


def test_error_is_sanitized(monkeypatch):
    monkeypatch.setattr(url_jobs, "validate_url", lambda u: u)

    def fail(*a, **k):
        raise RuntimeError("signed-secret-url")

    monkeypatch.setattr(url_jobs.subprocess, "run", fail)
    with TestClient(app) as client:
        body = client.post(
            "/api/url/inspect", headers=auth(), json={"url": "https://example.com/v"}
        ).json()
    assert "signed-secret-url" not in str(body)
