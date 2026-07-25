import json
import logging
import subprocess
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from time import monotonic
from typing import Any

from app.media import ytdlp_inspect_command

logger = logging.getLogger(__name__)
TOTAL_TIMEOUT_SECONDS = 60
YOUTUBE_CLIENTS: tuple[str | None, ...] = (None, "web")


@dataclass(frozen=True)
class InspectionFailure(Exception):
    code: str
    exit_code: int | None = None
    client: str = "default"
    elapsed_ms: int = 0


@dataclass(frozen=True)
class InspectionResult:
    metadata: dict[str, Any]
    client: str
    elapsed_ms: int
    extractor_version: str


def extractor_version() -> str:
    try:
        return version("yt-dlp")
    except PackageNotFoundError:
        return "unknown"


def classify_extractor_failure(stderr: str) -> str:
    """Classify known extractor text. Order prevents anti-bot text becoming login_required."""
    text = stderr.lower()
    if any(
        marker in text
        for marker in (
            "sign in to confirm you’re not a bot",
            "sign in to confirm you're not a bot",
            "confirm you are not a bot",
            "this helps protect our community",
            "bot verification",
            "anti-bot",
            "cloud-ip challenge",
        )
    ):
        return "youtube_bot_challenge"
    if "po token" in text or "po-token" in text or "pot required" in text:
        return "po_token_required"
    if any(
        marker in text
        for marker in (
            "player client",
            "player-client",
            "client is not available",
            "client blocked",
        )
    ):
        return "youtube_client_blocked"
    if "private video" in text or "this video is private" in text:
        return "private_video"
    if any(marker in text for marker in ("confirm your age", "age-restricted", "age restricted")):
        return "age_restricted"
    if any(
        marker in text
        for marker in (
            "not available in your country",
            "not available in your region",
            "geo restricted",
        )
    ):
        return "geo_restricted"
    if any(marker in text for marker in ("login required", "login to view", "members-only")):
        return "login_required"
    if any(
        marker in text
        for marker in ("video unavailable", "has been removed", "no longer available")
    ):
        return "video_unavailable"
    if any(marker in text for marker in ("unsupported url", "no suitable extractor")):
        return "unsupported_url"
    if any(
        marker in text
        for marker in (
            "update to a newer version",
            "yt-dlp is out of date",
            "signature extraction failed",
        )
    ):
        return "extractor_outdated"
    if any(
        marker in text
        for marker in (
            "unable to download",
            "network is unreachable",
            "timed out",
            "temporary failure",
            "connection reset",
            "name or service not known",
        )
    ):
        return "network_failure"
    return "extractor_failure"


def inspection_message(code: str) -> str:
    messages = {
        "youtube_bot_challenge": (
            "YouTube rejected the server request because of an anti-bot check."
        ),
        "youtube_client_blocked": "YouTube rejected the extractor player client.",
        "po_token_required": (
            "YouTube requires a proof-of-origin token that this server does not use."
        ),
        "private_video": "The video is private.",
        "login_required": "The video explicitly requires login.",
        "age_restricted": "The video is age restricted.",
        "video_unavailable": "The video is unavailable.",
        "geo_restricted": "The video is not available in the server region.",
        "extractor_outdated": "The installed extractor must be updated.",
        "network_failure": "The extractor could not reach the video host.",
        "unsupported_url": "No extractor supports this URL.",
        "malformed_metadata": "The extractor returned malformed metadata.",
        "inspection_timeout": "Video inspection timed out.",
        "extractor_failure": "The extractor could not inspect this video.",
    }
    return messages.get(code, messages["extractor_failure"])


def inspect_metadata(url: str, request_id: str, *, youtube: bool) -> InspectionResult:
    started = monotonic()
    clients = YOUTUBE_CLIENTS if youtube else (None,)
    last_failure = InspectionFailure("extractor_failure")
    for client in clients:
        elapsed = monotonic() - started
        remaining = TOTAL_TIMEOUT_SECONDS - elapsed
        if remaining <= 0:
            last_failure = InspectionFailure("inspection_timeout", client=client or "default")
            break
        try:
            process = subprocess.run(
                ytdlp_inspect_command(url, client),
                capture_output=True,
                text=True,
                timeout=max(1, remaining),
                check=False,
            )
        except subprocess.TimeoutExpired:
            last_failure = InspectionFailure("inspection_timeout", client=client or "default")
            break
        except (OSError, subprocess.SubprocessError):
            last_failure = InspectionFailure("extractor_failure", client=client or "default")
            break
        if process.returncode:
            last_failure = InspectionFailure(
                classify_extractor_failure(process.stderr or ""),
                process.returncode,
                client or "default",
            )
            # A different safe YouTube player can fix only generic/client/PO failures. Definitive
            # availability, policy, network, and anti-bot results should not be obscured or retried.
            if last_failure.code not in {
                "youtube_client_blocked",
                "po_token_required",
                "extractor_failure",
            }:
                break
            continue
        try:
            data = json.loads(process.stdout)
        except (json.JSONDecodeError, TypeError):
            last_failure = InspectionFailure(
                "malformed_metadata", process.returncode, client or "default"
            )
            continue
        if (
            not isinstance(data, dict)
            or not data.get("title")
            or not isinstance(data.get("formats"), list)
        ):
            last_failure = InspectionFailure(
                "malformed_metadata", process.returncode, client or "default"
            )
            continue
        elapsed_ms = round((monotonic() - started) * 1000)
        logger.info(
            "url_inspection request_id=%s category=success version=%s exit_code=%s "
            "extractor=%s client=%s elapsed_ms=%s",
            request_id,
            extractor_version(),
            process.returncode,
            data.get("extractor_key") or data.get("extractor") or "unknown",
            client or "default",
            elapsed_ms,
        )
        return InspectionResult(data, client or "default", elapsed_ms, extractor_version())
    elapsed_ms = round((monotonic() - started) * 1000)
    logger.warning(
        "url_inspection request_id=%s category=%s version=%s exit_code=%s "
        "extractor=youtube client=%s elapsed_ms=%s",
        request_id,
        last_failure.code,
        extractor_version(),
        last_failure.exit_code,
        last_failure.client,
        elapsed_ms,
    )
    raise InspectionFailure(
        last_failure.code, last_failure.exit_code, last_failure.client, elapsed_ms
    )
