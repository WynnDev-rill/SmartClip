from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    api_token: str = Field(default="development-only-token", alias="SMARTCLIP_API_TOKEN")
    max_video_duration_minutes: int = Field(60, alias="MAX_VIDEO_DURATION_MINUTES")
    max_concurrent_jobs: int = Field(1, alias="MAX_CONCURRENT_JOBS")
    max_output_candidates: int = Field(5, alias="MAX_OUTPUT_CANDIDATES")
    job_expiry_minutes: int = Field(30, alias="JOB_EXPIRY_MINUTES")
    max_source_size_mb: int = Field(1000, alias="MAX_SOURCE_SIZE_MB")
    max_output_duration_seconds: int = Field(120, alias="MAX_OUTPUT_DURATION_SECONDS")
    temp_root: Path = Field(Path("/tmp/smartclip"), alias="TEMP_ROOT")
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    allowed_origins: str = Field("", alias="ALLOWED_ORIGINS")
    port: int = Field(8000, alias="PORT")
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    @property
    def cors_origins(self) -> list[str]:
        return [x.strip() for x in self.allowed_origins.split(",") if x.strip() and x != "*"]


settings = Settings()
