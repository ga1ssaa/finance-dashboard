"""Create dedicated local Compose secrets without printing or replacing them."""

import os
from pathlib import Path
import secrets


target = Path(__file__).resolve().parents[1] / ".env.compose.local"
content = (
    f"AVERO_DB_PASSWORD={secrets.token_hex(32)}\n"
    f"AVERO_AUTH_JWT_SECRET={secrets.token_urlsafe(48)}\n"
    "AVERO_HTTP_PORT=8080\n"
)
try:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    raise SystemExit(".env.compose.local already exists; preserved without changes") from None
with os.fdopen(descriptor, "w") as file:
    file.write(content)
print("Created private .env.compose.local (mode 0600); no secrets printed")
