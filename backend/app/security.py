import hmac
import ipaddress
import socket
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable
from urllib.parse import urlparse

from fastapi import Depends, Header, HTTPException, Request

from app.core.config import settings


def token_matches(candidate: str, expected: str) -> bool:
    return hmac.compare_digest(candidate.encode(), expected.encode())


def authenticate(authorization: str | None = Header(default=None)) -> None:
    candidate = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    if not candidate or not token_matches(candidate, settings.api_token):
        raise HTTPException(
            401,
            detail={"code": "unauthorized", "message": "Invalid token."},
            headers={"WWW-Authenticate": "Bearer"},
        )


Auth = Depends(authenticate)


class RateLimiter:
    """Small per-client, in-memory sliding-window limiter."""

    def __init__(self, limit: int = 60, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window = window_seconds
        self.requests: dict[str, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, request: Request) -> None:
        now = time.monotonic()
        key = request.client.host if request.client else "unknown"
        with self.lock:
            bucket = self.requests[key]
            while bucket and bucket[0] <= now - self.window:
                bucket.popleft()
            if len(bucket) >= self.limit:
                raise HTTPException(
                    429,
                    detail={"code": "rate_limited", "message": "Too many requests."},
                )
            bucket.append(now)


rate_limiter = RateLimiter()
RateLimit = Depends(rate_limiter.check)


def validate_url(url: str, resolver: Callable[..., list] = socket.getaddrinfo) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        raise ValueError("Only public HTTP(S) video URLs are supported.")
    try:
        addresses = {
            item[4][0].split("%", 1)[0]
            for item in resolver(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        }
    except (OSError, UnicodeError) as exc:
        raise ValueError("The video host could not be resolved.") from exc
    if not addresses:
        raise ValueError("The video host could not be resolved.")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError("Private or reserved network destinations are not allowed.")
    return url


def safe_error(_: Exception) -> str:
    return "Video processing failed. Check that the public URL is available and supported."
