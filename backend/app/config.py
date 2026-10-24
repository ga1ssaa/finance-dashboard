"""Environment configuration without exposing database credentials."""

import re
from pathlib import Path
from uuid import UUID

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
        hide_input_in_errors=True,
    )

    database_url: SecretStr = Field(validation_alias="DATABASE_URL", repr=False)
    single_owner_id: UUID = Field(validation_alias="SINGLE_OWNER_ID", repr=False)
    cors_allowed_origins: tuple[str, ...] = Field(
        default=("http://localhost:5173", "http://127.0.0.1:5173"),
        validation_alias="CORS_ALLOWED_ORIGINS",
    )

    @field_validator("cors_allowed_origins")
    @classmethod
    def validate_cors_allowed_origins(cls, origins: tuple[str, ...]) -> tuple[str, ...]:
        """Allow only serialized local browser origins, never URLs or wildcards."""
        for origin in origins:
            matched = re.fullmatch(
                r"https?://(?:localhost|127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})", origin
            )
            if matched is None or int(matched.group(1)) > 65535:
                raise ValueError("CORS_ALLOWED_ORIGINS must contain explicit loopback HTTP(S) origins with valid ports")
        return tuple(dict.fromkeys(origins))

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr) -> SecretStr:
        try:
            url = make_url(value.get_secret_value())
        except (ArgumentError, ValueError, TypeError):
            raise ValueError("DATABASE_URL must be a valid PostgreSQL connection URL") from None
        if url.drivername != "postgresql+psycopg":
            raise ValueError("DATABASE_URL must use the postgresql+psycopg driver")
        if not url.host or not url.database:
            raise ValueError("DATABASE_URL must specify a host and database")
        return value
