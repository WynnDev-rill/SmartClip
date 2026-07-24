from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.videos import cleanup_uploads
from app.api.routes.videos import router as videos_router
from app.core.config import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.upload_directory.mkdir(parents=True, exist_ok=True)
    yield
    cleanup_uploads()


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        description="Algorithm-driven video highlight generation API.",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(health_router, prefix="/api")
    application.include_router(videos_router, prefix="/api")
    application.include_router(health_router)
    return application


app = create_app()
