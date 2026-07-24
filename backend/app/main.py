import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.url_jobs import router as jobs_router
from app.core.config import settings
from app.jobs import manager


async def cleanup_loop() -> None:
    while True:
        await asyncio.sleep(60)
        manager.cleanup()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.temp_root.mkdir(parents=True, exist_ok=True)
    manager.cleanup()
    task = asyncio.create_task(cleanup_loop())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    for job in manager.jobs.values():
        if job.state not in {"completed", "failed", "cancelled", "expired"}:
            manager.cancel(job)


def create_app() -> FastAPI:
    application = FastAPI(
        title="SmartClip URL Service",
        description=(
            "Private, deterministic URL-video highlight processing. No AI or speech-to-text."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )
    if settings.cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type"],
        )
    application.include_router(health_router)
    application.include_router(jobs_router)
    return application


app = create_app()
