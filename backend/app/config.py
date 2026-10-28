"""Environment configuration without exposing database credentials."""

import os
import re
from pathlib import Path
from typing import Literal

from urllib.parse import urlsplit
from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def production_origin(value: str, site: str) -> str:
    """Only HTTPS origins on the explicitly owned two-label .me site are supported."""
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    if (not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.me", site)
        or parsed.scheme != "https" or parsed.netloc != host or parsed.path or parsed.query or parsed.fragment
        or not (host == site or host.endswith("." + site))
        or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part) for part in host.split("."))
        or value != "https://" + host):
        raise ValueError("Production origins must be exact HTTPS origins on PRODUCTION_SITE_DOMAIN (.me)")
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
        hide_input_in_errors=True,
    )

    database_url: SecretStr = Field(validation_alias="DATABASE_URL", repr=False)
    auth_jwt_secret: SecretStr = Field(validation_alias="AUTH_JWT_SECRET", repr=False)
    app_env: Literal["development", "test", "production"] = Field(default="development", validation_alias="APP_ENV")
    cors_allowed_origins: tuple[str, ...] = Field(
        default=("http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:8000"),
        validation_alias="CORS_ALLOWED_ORIGINS",
    )
    production_site_domain: str = Field(default="", validation_alias="PRODUCTION_SITE_DOMAIN")
    production_api_origin: str = Field(default="", validation_alias="PRODUCTION_API_ORIGIN")
    trusted_proxy: Literal["none", "heroku"] = Field(default="none", validation_alias="TRUSTED_PROXY")
    production_database_host: str = Field(default="", validation_alias="PRODUCTION_DATABASE_HOST")
    production_database_name: str = Field(default="", validation_alias="PRODUCTION_DATABASE_NAME")
    database_sslrootcert: str = Field(default="", validation_alias="DATABASE_SSLROOTCERT")

    def __init__(self, **values):
        # A deployed process must never inherit a developer's private .env file.
        if values.get("APP_ENV", os.environ.get("APP_ENV")) == "production":
            values["_env_file"] = None
        super().__init__(**values)

    @field_validator("auth_jwt_secret")
    @classmethod
    def validate_auth_jwt_secret(cls, secret: SecretStr) -> SecretStr:
        if len(secret.get_secret_value().encode("utf-8")) < 32:
            raise ValueError("AUTH_JWT_SECRET must contain at least 32 UTF-8 bytes")
        return secret

    @model_validator(mode="after")
    def validate_environment(self):
        """Development stays loopback-only; production requires the reviewed same-site contract."""
        if self.app_env == "production":
            production_origin(self.production_api_origin, self.production_site_domain)
            if self.trusted_proxy != "heroku" or not self.cors_allowed_origins:
                raise ValueError("Production requires the Heroku proxy contract and explicit HTTPS browser origins")
            for origin in self.cors_allowed_origins:
                production_origin(origin, self.production_site_domain)
            if not self.database_sslrootcert.startswith("/"):
                raise ValueError("Production requires an absolute DATABASE_SSLROOTCERT bundle path")
        for origin in self.cors_allowed_origins if self.app_env != "production" else ():
            matched = re.fullmatch(
                r"https?://(?:localhost|127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})", origin
            )
            if matched is None or int(matched.group(1)) > 65535:
                raise ValueError("CORS_ALLOWED_ORIGINS must contain explicit loopback HTTP(S) origins with valid ports")
        self.cors_allowed_origins = tuple(dict.fromkeys(self.cors_allowed_origins))
        url = make_url(self.database_url.get_secret_value())
        if self.app_env != "production" and url.drivername != "postgresql+psycopg":
            raise ValueError("Development DATABASE_URL must use the postgresql+psycopg driver")
        if self.app_env == "production":
            if (url.host != self.production_database_host or url.database != self.production_database_name
                or not re.fullmatch(r"[a-z0-9.-]+\.(?:amazonaws\.com|herokudns\.com)", url.host or "")
                or not re.fullmatch(r"[a-zA-Z0-9_]+", url.database or "")
                or url.database.startswith(("finance_dashboard", "avero_compose", "template"))
                or url.database == "postgres" or url.port not in (None, 5432)
                or not url.username or not url.password or set(url.query) - {"sslmode"}
                or url.query.get("sslmode", "require") not in ("require", "verify-full")):
                raise ValueError("Production DATABASE_URL must match the explicitly approved new Heroku database target")
            self.database_url = SecretStr(url.set(drivername="postgresql+psycopg", query={}).render_as_string(hide_password=False))
        return self

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr) -> SecretStr:
        try:
            url = make_url(value.get_secret_value())
        except (ArgumentError, ValueError, TypeError):
            raise ValueError("DATABASE_URL must be a valid PostgreSQL connection URL") from None
        if url.drivername not in {"postgresql+psycopg", "postgresql", "postgres"}:
            raise ValueError("DATABASE_URL must use PostgreSQL")
        if not url.host or not url.database:
            raise ValueError("DATABASE_URL must specify a host and database")
        return value
