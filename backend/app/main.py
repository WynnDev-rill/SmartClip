import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.videos import router as videos_router
from app.api.routes.videos import storage
from app.core.config import settings
from app.core.errors import VideoError, video_error_handler


@asynccontextmanager
async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
    async def cleanup() -> None:
        while True:
            storage.cleanup_expired()
            await asyncio.sleep(min(settings.upload_ttl_hours * 1800, 3600))

    task = asyncio.create_task(cleanup())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


def create_app() -> FastAPI:
    application = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_exception_handler(VideoError, video_error_handler)  # type: ignore[arg-type]
    application.include_router(health_router, prefix="/api")
    application.include_router(videos_router, prefix="/api")
    application.include_router(health_router)
    return application


app = create_app()
