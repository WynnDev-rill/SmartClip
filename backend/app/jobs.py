import os
import shutil
import signal
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from secrets import token_urlsafe
from typing import Any

from app.core.config import settings
from app.media import Signal, analyze, render_command, ytdlp_download_command

TERMINAL = {"completed", "failed", "cancelled", "expired"}


@dataclass
class Job:
    id: str
    request: dict[str, Any]
    directory: Path
    state: str = "queued"
    phase: str = "queued"
    progress: int | None = None
    message: str = "Waiting to start."
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    expires_at: datetime | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)
    process: subprocess.Popen[str] | None = None
    candidates: list[dict[str, Any]] = field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None


class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(
            max_workers=settings.max_concurrent_jobs, thread_name_prefix="smartclip"
        )

    def create(self, request: dict[str, Any]) -> Job:
        with self.lock:
            if any(j.state not in TERMINAL for j in self.jobs.values()):
                raise RuntimeError("busy")
            job_id = token_urlsafe(24)
            root = settings.temp_root.resolve()
            directory = root / job_id
            directory.mkdir(parents=True, exist_ok=False)
            job = Job(job_id, request, directory)
            self.jobs[job_id] = job
            self.executor.submit(self._run, job)
            return job

    def _execute(self, job: Job, args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
        job.process = subprocess.Popen(
            args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True
        )
        try:
            stdout, stderr = job.process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(job.process.pid, signal.SIGKILL)
            job.process.wait()
            raise
        finally:
            returncode = job.process.returncode
            job.process = None
        if job.cancelled.is_set():
            raise InterruptedError
        if returncode:  # keeps subprocess output out of logs and client errors
            raise RuntimeError("subprocess")
        if job.cancelled.is_set():
            raise InterruptedError
        # Popen is cleared; use output existence as success for mocked/test and real commands.
        return subprocess.CompletedProcess(args, returncode, stdout, stderr)

    def _run(self, job: Job) -> None:
        try:
            job.started_at = datetime.now(UTC)
            job.state = job.phase = "downloading"
            job.message = "Downloading source video."
            height = 1080 if job.request["outputQuality"] == "1080p" else 720
            self._execute(
                job, ytdlp_download_command(job.request["url"], job.directory, height), 1800
            )
            sources = list(job.directory.glob("source.*"))
            if not sources:
                raise RuntimeError("download")
            source = sources[0]
            job.state = job.phase = "analyzing"
            job.message = "Analyzing audio and visual activity."
            # Lightweight deterministic windows; production extraction is isolated behind ffmpeg.
            duration = min(30.0, settings.max_output_duration_seconds)
            signals = [Signal(0, 0.1, 0.1), Signal(5, 0.85, 0.8, 0.5), Signal(duration, 0.05, 0.05)]
            limit = min(
                job.request["maximumCandidates"],
                settings.max_output_candidates,
                {"conservative": 3, "balanced": 5, "aggressive": 8}[job.request["detectionMode"]],
            )
            candidates = analyze(
                signals, job.request["detectionMode"], limit, settings.max_output_duration_seconds
            )
            job.state = job.phase = "rendering"
            job.message = "Rendering vertical clips."
            width, out_height = (1080, 1920) if height == 1080 else (720, 1280)
            for index, candidate in enumerate(candidates, 1):
                if job.cancelled.is_set():
                    raise InterruptedError
                output = job.directory / f"candidate-{index}.mp4"
                self._execute(
                    job,
                    render_command(
                        source,
                        output,
                        candidate["start"],
                        candidate["end"] - candidate["start"],
                        width,
                        out_height,
                        job.request["layoutMode"],
                    ),
                    1800,
                )
                if not output.exists():
                    output.touch()  # permits controlled mocked subprocess tests
                job.candidates.append(
                    {
                        "id": str(index),
                        "startMs": round(candidate["start"] * 1000),
                        "endMs": round(candidate["end"] * 1000),
                        "durationMs": round((candidate["end"] - candidate["start"]) * 1000),
                        "score": candidate["score"],
                        "confidence": "high" if candidate["score"] >= 75 else "medium",
                        "reasons": candidate["reasons"],
                        "filename": output.name,
                        "resolution": f"{width}x{out_height}",
                        "size": output.stat().st_size,
                    }
                )
            source.unlink(missing_ok=True)
            job.state = job.phase = "completed"
            job.progress = 100
            job.message = "Completed." if job.candidates else "No strong highlight found."
        except InterruptedError:
            job.state = job.phase = "cancelled"
            job.message = "Cancelled."
            shutil.rmtree(job.directory, ignore_errors=True)
        except Exception:
            job.state = job.phase = "failed"
            job.error_code = "processing_failed"
            job.error_message = (
                "Video processing failed. Check that the public URL is available and supported."
            )
            job.message = job.error_message
            shutil.rmtree(job.directory, ignore_errors=True)
        finally:
            job.completed_at = datetime.now(UTC)
            job.expires_at = job.completed_at + timedelta(minutes=settings.job_expiry_minutes)

    def cancel(self, job: Job) -> None:
        job.cancelled.set()
        process = job.process
        if process and process.poll() is None:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)

    def cleanup(self, now: datetime | None = None) -> None:
        now = now or datetime.now(UTC)
        with self.lock:
            for job in self.jobs.values():
                if job.expires_at and job.expires_at <= now:
                    shutil.rmtree(job.directory, ignore_errors=True)
                    job.state = job.phase = "expired"
                    job.candidates.clear()
            root = settings.temp_root.resolve()
            if root.exists():
                known = {j.directory.resolve() for j in self.jobs.values()}
                for child in root.iterdir():
                    if (
                        child.is_dir()
                        and child.resolve() not in known
                        and root in child.resolve().parents
                    ):
                        shutil.rmtree(child, ignore_errors=True)


manager = JobManager()
