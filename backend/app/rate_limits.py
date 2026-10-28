"""Shared bounded sliding-window auth quotas, serialized atomically in PostgreSQL.

Keys are HMACs, never stored IPs/emails. No local fallback is permitted on failure.
The independent security table is excluded from financial import/export/reset.
"""
import hashlib
import hmac
import math
from sqlalchemy import BigInteger, CHAR, Column, Integer, MetaData, Table, delete, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import SQLAlchemyError

PRODUCTION_REVISION = "0005_auth_rate_limits"
LOCK_ID = 470983416125  # One short transaction serializes quotas across all web dynos.
rate_table = Table("auth_rate_limits", MetaData(),
    Column("key_hash", CHAR(64), primary_key=True),
    Column("attempts", JSONB, nullable=False),
    Column("expires_at", BigInteger, nullable=False, index=True),
    Column("window_seconds", Integer, nullable=False))


class RateLimitUnavailable(Exception):
    pass


class PostgresAuthRateLimiter:
    def __init__(self, engine, secret, max_keys=10000):
        self.engine, self.secret, self.max_keys = engine, secret.encode(), max_keys

    def check(self, rules):
        if not rules:
            return None
        try:
            with self.engine.begin() as connection:
                connection.execute(text("SET LOCAL lock_timeout = '1000ms'"))
                connection.execute(text("SET LOCAL statement_timeout = '2000ms'"))
                connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_ID})
                now = int(connection.scalar(text("SELECT extract(epoch FROM clock_timestamp())")))
                connection.execute(delete(rate_table).where(rate_table.c.expires_at <= now))
                count = connection.scalar(select(func.count()).select_from(rate_table))
                retry = 0
                for key, limit, window in rules:
                    hashed = hmac.new(self.secret, key.encode(), hashlib.sha256).hexdigest()
                    row = connection.execute(select(rate_table).where(rate_table.c.key_hash == hashed)).mappings().one_or_none()
                    if row is None and count >= self.max_keys:
                        retry = max(retry, 60)
                        continue
                    values = [stamp for stamp in row["attempts"] if stamp > now - window] if row else []
                    if len(values) >= limit:
                        retry = max(retry, max(1, math.ceil(values[0] + window - now)))
                    else:
                        values.append(now)
                    record = {"attempts": values, "expires_at": values[-1] + window, "window_seconds": window}
                    if row is None:
                        connection.execute(insert(rate_table).values(key_hash=hashed, **record))
                        count += 1
                    else:
                        connection.execute(update(rate_table).where(rate_table.c.key_hash == hashed).values(**record))
                return retry or None
        except SQLAlchemyError:
            raise RateLimitUnavailable("Authentication protection unavailable") from None


def production_schema_ready(connection):
    revisions = connection.execute(text("SELECT version_num FROM public.alembic_version")).scalars().all()
    if revisions != [PRODUCTION_REVISION]:
        return False
    connection.execute(select(rate_table).limit(0)).close()
    return True
