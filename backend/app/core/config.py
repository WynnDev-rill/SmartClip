from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SmartClip API"
    environment: str = "development"
    frontend_origins: str = "http://localhost:5173"
    max_upload_size_bytes: int = Field(default=2 * 1024**3, gt=0)
    upload_ttl_hours: float = Field(default=24, gt=0)
    upload_directory: Path = Path("/tmp/smartclip-uploads")

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origins.split(",") if origin.strip()]


settings = Settings()
