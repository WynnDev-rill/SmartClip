import json
from datetime import UTC, datetime, timedelta
from importlib.metadata import version
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app import inspection
from app.api.routes import url_jobs
from app.core.config import settings
from app.inspection import InspectionFailure, inspect_metadata
from app.jobs import Job, manager
from app.main import app
from app.media import (
    Signal,
    analyze,
    normalize_video_url,
    render_command,
    ytdlp_download_command,
    ytdlp_inspect_command,
)
from app.security import token_matches, validate_url

TOKEN = "test-secret"


def test_pinned_ytdlp_dependency_is_installed():
    assert version("yt-dlp") == "2026.7.4"


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
        inspection.subprocess,
        "run",
        lambda *a, **k: Mock(stdout=json.dumps(payload), stderr="", returncode=0),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/url/inspect", headers=auth(), json={"url": "https://example.com/v"}
        )
    assert response.status_code == 200 and response.json()["qualityOptions"] == ["720p"]
    assert "formats" not in response.json()


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=3iPA35AKI0E",
        "https://youtu.be/3iPA35AKI0E?si=BJrRfwEn1aa4SeQS",
        "https://youtube.com/shorts/3iPA35AKI0E?si=tracking",
    ],
)
def test_youtube_urls_are_normalized_without_tracking(url):
    assert normalize_video_url(url) == "https://www.youtube.com/watch?v=3iPA35AKI0E"


@pytest.mark.parametrize(
    ("stderr", "code"),
    [
        (
            "ERROR: Sign in to confirm you're not a bot. This helps protect our community",
            "youtube_bot_challenge",
        ),
        ("ERROR: player-client challenge", "youtube_client_blocked"),
        ("ERROR: PO Token required", "po_token_required"),
        ("ERROR: Private video", "private_video"),
        ("ERROR: Video unavailable", "video_unavailable"),
        ("ERROR: Unsupported URL", "unsupported_url"),
        ("ERROR: Sign in to confirm your age", "age_restricted"),
        ("ERROR: login required", "login_required"),
        ("ERROR: not available in your country", "geo_restricted"),
        ("ERROR: signature extraction failed", "extractor_outdated"),
        ("ERROR: Unable to download webpage", "network_failure"),
        ("ERROR: extractor crashed", "extractor_failure"),
    ],
)
def test_inspection_failure_codes(monkeypatch, stderr, code):
    monkeypatch.setattr(url_jobs, "validate_url", lambda u: u)

    def fail(*args, **kwargs):
        return Mock(returncode=1, stdout="", stderr=stderr)

    monkeypatch.setattr(inspection.subprocess, "run", fail)
    with TestClient(app) as client:
        response = client.post(
            "/api/url/inspect", headers=auth(), json={"url": "https://example.com/v"}
        )
    assert response.json()["detail"]["code"] == code


def test_inspection_timeout_has_distinct_code(monkeypatch):
    monkeypatch.setattr(url_jobs, "validate_url", lambda u: u)
    monkeypatch.setattr(
        inspection.subprocess,
        "run",
        lambda *a, **k: (_ for _ in ()).throw(inspection.subprocess.TimeoutExpired(a[0], 60)),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/url/inspect", headers=auth(), json={"url": "https://example.com/v"}
        )
    assert response.status_code == 504
    assert response.json()["detail"]["code"] == "inspection_timeout"


def test_malformed_inspection_json_has_distinct_code(monkeypatch):
    monkeypatch.setattr(url_jobs, "validate_url", lambda u: u)
    monkeypatch.setattr(
        inspection.subprocess,
        "run",
        lambda *a, **k: Mock(stdout="not-json", stderr="", returncode=0),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/url/inspect", headers=auth(), json={"url": "https://example.com/v"}
        )
    assert response.status_code == 502
    assert response.json()["detail"] == {
        "code": "malformed_metadata",
        "message": "The extractor returned malformed metadata.",
    }


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


@pytest.mark.parametrize(
    "private_detail",
    [
        "signed-secret-url",
        "https://cdn.example/video?token=secret",
        "Authorization: Bearer private-api-token",
        "Cookie: session=private-cookie",
        "ordinary runtime failure",
    ],
)
def test_error_is_sanitized(monkeypatch, private_detail):
    monkeypatch.setattr(url_jobs, "validate_url", lambda u: u)

    def fail(*a, **k):
        raise RuntimeError(private_detail)

    monkeypatch.setattr(inspection.subprocess, "run", fail)
    with TestClient(app) as client:
        response = client.post(
            "/api/url/inspect", headers=auth(), json={"url": "https://example.com/v"}
        )
    assert response.status_code == 502
    assert response.json()["detail"] == {
        "code": "extractor_failure",
        "message": "The extractor could not inspect this video.",
    }
    assert private_detail not in response.text


def test_all_safe_clients_fail_without_leaking_stderr(monkeypatch, caplog):
    secret = "Cookie: private-cookie https://signed.example/media?token=secret"
    monkeypatch.setattr(
        inspection.subprocess,
        "run",
        lambda *a, **k: Mock(returncode=1, stdout="", stderr=f"extractor crashed {secret}"),
    )
    with pytest.raises(InspectionFailure) as failure:
        inspect_metadata("https://www.youtube.com/watch?v=abc", "safe-request", youtube=True)
    assert failure.value.code == "extractor_failure"
    assert secret not in caplog.text


def test_safe_client_fallback_stops_after_success(monkeypatch):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if len(calls) == 1:
            return Mock(returncode=1, stdout="", stderr="player client blocked")
        return Mock(
            returncode=0,
            stderr="",
            stdout=json.dumps({"title": "Public", "formats": [], "extractor_key": "Youtube"}),
        )

    monkeypatch.setattr(inspection.subprocess, "run", run)
    result = inspect_metadata("https://www.youtube.com/watch?v=abc", "safe-request", youtube=True)
    assert result.client == "web" and len(calls) == 2
    assert "youtube:player_client=web" in calls[1]


def test_diagnostic_endpoint_is_sanitized(monkeypatch):
    monkeypatch.setattr(url_jobs, "validate_url", lambda u: u)
    monkeypatch.setattr(
        url_jobs,
        "inspect_metadata",
        lambda *a, **k: (_ for _ in ()).throw(
            InspectionFailure("youtube_bot_challenge", 1, "default")
        ),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/url/diagnose",
            headers=auth(),
            json={"url": "https://youtu.be/HhubZkgtkHM?si=tracking"},
        )
    assert response.json()["normalizedUrl"] == "https://www.youtube.com/watch?v=HhubZkgtkHM"
    assert response.json()["publicReachability"] == "blocked_by_antibot"
    assert "stderr" not in response.text.lower() and "tracking" not in response.text


def test_progress_normalization_is_monotonic_and_tracks_terminal_states(tmp_path):
    job = Job("progress", {}, tmp_path)
    job.update_progress("inspecting", 10, "Inspecting")
    assert (job.phase, job.progress_percent, job.current_step) == ("inspecting", 10, "Inspecting")
    job.update_progress("completed", 100, "Completed", 1, 1)
    job.update_progress("failed", -50, "Failed", 9, -1)
    assert job.progress_percent == 100
    assert job.completed_items == 0 and job.total_items == 0
    job.update_progress("cancelled", 101, "Cancelled")
    assert job.phase == "cancelled" and job.progress_percent == 100
