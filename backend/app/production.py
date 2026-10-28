"""Explicit Heroku-only web entry point. Never migrates or trusts arbitrary proxies."""
import os
import re
from pathlib import Path
import uvicorn
from app.config import Settings


def require_heroku(environ, *, web=True):
    pattern = r"web\.[1-9][0-9]*" if web else r"run\.[1-9][0-9]*"
    if not re.fullmatch(pattern, environ.get("DYNO", "")):
        raise RuntimeError("Production requires the approved Heroku dyno network boundary")
    port = environ.get("PORT", "")
    if web and (not port.isdecimal() or not 1 <= int(port) <= 65535):
        raise RuntimeError("Heroku PORT must be an integer from 1 through 65535")


def main():
    settings = Settings(_env_file=None)
    if settings.app_env != "production":
        raise RuntimeError("The Heroku entry point requires APP_ENV=production")
    require_heroku(os.environ)
    if not Path(settings.database_sslrootcert).is_file():
        raise RuntimeError("The approved PostgreSQL CA bundle is unavailable")
    uvicorn.run("app.main:create_app", factory=True, host="0.0.0.0", port=int(os.environ["PORT"]),
                workers=1, proxy_headers=False, access_log=False, limit_concurrency=16,
                timeout_keep_alive=5, backlog=64)


if __name__ == "__main__":
    main()
