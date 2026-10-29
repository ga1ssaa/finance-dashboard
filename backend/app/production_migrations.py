"""Manual, new-target-only production migration. No connection before authorization checks."""
import argparse
import os
from ipaddress import ip_address, ip_network
from pathlib import Path
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from app.config import Settings
from app.db import create_database_engine
from app.initial_database import require_initial_database
from app.production import require_heroku
from app.rate_limits import PRODUCTION_REVISION

AUTHORIZATION = object()  # In-process approval, never an environment-wide migration switch.
PHRASE = "MIGRATE NEW AVERO PRODUCTION DATABASE"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres"}
PRIVATE_NETWORKS = tuple(ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"))
IDENTITY_FAILURE_CODES = frozenset({
    "ENGINE_TARGET_MISMATCH", "DRIVER_TARGET_MISMATCH", "TLS_POLICY_MISMATCH",
    "SERVER_IDENTITY_QUERY_INVALID", "SERVER_DATABASE_MISMATCH",
    "SERVER_CURRENT_USER_MISMATCH", "SERVER_SESSION_USER_MISMATCH",
    "SERVER_PORT_INVALID", "SERVER_ADDRESS_INVALID", "UNSUPPORTED_CONNECTION_METADATA",
    "SERVER_IDENTITY_QUERY_FAILED", "IDENTITY_TIMEOUT", "IDENTITY_CHECK_ERROR",
})


class IdentityVerificationError(RuntimeError):
    """Only an allowlisted category may cross the identity-verification boundary."""

    def __init__(self, code):
        super().__init__(code if type(code) is str and code in IDENTITY_FAILURE_CODES else "IDENTITY_CHECK_ERROR")

    @property
    def code(self):
        # Revalidate at output too; never interpolate arbitrary exception text.
        code = self.args[0] if len(self.args) == 1 else None
        return code if type(code) is str and code in IDENTITY_FAILURE_CODES else "IDENTITY_CHECK_ERROR"

    def __str__(self):
        return self.code


def checked_target(value):
    """Parse intent without permitting libpq routing overrides or leaking credentials."""
    try:
        if not isinstance(value, (str, URL)) or isinstance(value, str) and (value.strip() != value or "#" in value):
            raise ValueError()
        url = make_url(value)
        port = 5432 if url.port is None else url.port
        if (url.drivername != "postgresql+psycopg" or not url.host or not url.database or not url.username
            or type(port) is not int or not 1 <= port <= 65535
            or set(url.query) - {"sslmode", "sslrootcert", "ssl_min_protocol_version", "connect_timeout", "application_name"}):
            raise ValueError()
        return url.set(port=port)
    except Exception:
        raise RuntimeError("Migration database target is missing, malformed or unverifiable") from None


def verify_connection_target(settings, connection, target):
    """Check effective psycopg routing and server identity, not just caller metadata.

    Raw read-only SQL follows the existing verification guards: no recursive
    SQLAlchemy events, commits, rollbacks, new connections or transaction changes.
    """
    try:
        try:
            actual = checked_target(connection.engine.url)
        except RuntimeError:
            raise IdentityVerificationError("ENGINE_TARGET_MISMATCH") from None
        if actual != target:
            raise IdentityVerificationError("ENGINE_TARGET_MISMATCH")
        driver = connection.connection.driver_connection
        info = driver.info
        if (info.host != target.host or type(info.port) is not int or info.port != target.port
            or info.dbname != target.database or info.user != target.username):
            raise IdentityVerificationError("DRIVER_TARGET_MISMATCH")
        try:
            address = ip_address(info.hostaddr)
        except ValueError:
            raise IdentityVerificationError("DRIVER_TARGET_MISMATCH") from None
        if target.host in LOCAL_HOSTS:
            if target.host == "postgres":
                if not (address.is_loopback or any(address in network for network in PRIVATE_NETWORKS)):
                    raise IdentityVerificationError("DRIVER_TARGET_MISMATCH")
            elif not address.is_loopback:
                raise IdentityVerificationError("DRIVER_TARGET_MISMATCH")
        if settings.app_env == "production":
            parameters = info.get_parameters()
            if (driver.pgconn.ssl_in_use is not True or parameters.get("sslmode") != "verify-full"
                or parameters.get("sslrootcert") != settings.database_sslrootcert):
                raise IdentityVerificationError("TLS_POLICY_MISMATCH")
        try:
            with driver.cursor() as cursor:
                # inet::text includes a netmask; host() returns an address for ip_address().
                cursor.execute("SELECT current_database(), current_user, session_user, pg_catalog.host(inet_server_addr()), inet_server_port()")
                row = cursor.fetchone()
        except TimeoutError:
            raise
        except Exception:
            raise IdentityVerificationError("SERVER_IDENTITY_QUERY_FAILED") from None
        try:
            if not row or len(row) != 5:
                raise IdentityVerificationError("SERVER_IDENTITY_QUERY_INVALID")
            identity = tuple(row[:3])
            server_value, server_port = row[3], row[4]
            if len(identity) != 3:
                raise IdentityVerificationError("SERVER_IDENTITY_QUERY_INVALID")
        except (TypeError, IndexError, KeyError):
            raise IdentityVerificationError("SERVER_IDENTITY_QUERY_INVALID") from None
        if identity[0] != target.database:
            raise IdentityVerificationError("SERVER_DATABASE_MISMATCH")
        if identity[1] != target.username:
            raise IdentityVerificationError("SERVER_CURRENT_USER_MISMATCH")
        if identity[2] != target.username:
            raise IdentityVerificationError("SERVER_SESSION_USER_MISMATCH")
        if type(server_port) is not int or not 1 <= server_port <= 65535:
            raise IdentityVerificationError("SERVER_PORT_INVALID")
        try:
            server = ip_address(server_value)
        except (ValueError, TypeError):
            raise IdentityVerificationError("SERVER_ADDRESS_INVALID") from None
        # Local Docker may publish 5434 while PostgreSQL reports its private IP/5432.
        if target.host in LOCAL_HOSTS and not (server.is_loopback or any(server in network for network in PRIVATE_NETWORKS)):
            raise IdentityVerificationError("SERVER_ADDRESS_INVALID")
    except IdentityVerificationError:
        raise
    except TimeoutError:
        raise IdentityVerificationError("IDENTITY_TIMEOUT") from None
    except (AttributeError, TypeError, NotImplementedError):
        raise IdentityVerificationError("UNSUPPORTED_CONNECTION_METADATA") from None
    except Exception:
        raise IdentityVerificationError("IDENTITY_CHECK_ERROR") from None


def require_authorization(settings, config, *, connection=None):
    configured = checked_target(settings.database_url.get_secret_value())
    # Local preservation proofs explicitly declare their separately guarded target.
    # This metadata declares intent only; it never authorizes a remote connection.
    target = checked_target(config.attributes.get("migration_target_url", configured))
    if settings.app_env != "production" and (configured.host not in LOCAL_HOSTS or target.host not in LOCAL_HOSTS):
        raise RuntimeError("Remote migrations require explicit production configuration and authorization")
    supplied = config.attributes.get("connection")
    actual = connection if connection is not None else supplied
    if settings.app_env == "production":
        if (config.attributes.get("production_authorization") is not AUTHORIZATION or supplied is None
            or actual is not supplied or target != configured):
            raise RuntimeError("Production migrations require the explicit new-database authorization command")
    if actual is not None:
        verify_connection_target(settings, actual, target)
    elif target != configured:
        raise RuntimeError("An explicit local migration target requires a verifiable supplied connection")


def migrate_new_database(settings, host, database, confirmation, *, environ=None, config_path=None):
    if settings.app_env != "production" or confirmation != PHRASE:
        raise RuntimeError("Explicit production migration authorization is required")
    require_heroku(os.environ if environ is None else environ, web=False)
    if host != settings.production_database_host or database != settings.production_database_name:
        raise RuntimeError("Migration target does not match the explicitly approved new database")
    engine = create_database_engine(settings)
    try:
        with engine.begin() as connection:
            verify_connection_target(settings, connection, checked_target(settings.database_url.get_secret_value()))
            connection.execute(text("SET LOCAL lock_timeout = '3000ms'"))
            connection.execute(text("SET LOCAL statement_timeout = '60000ms'"))
            connection.execute(text("SELECT pg_advisory_xact_lock(470983416126)"))
            identity = connection.execute(text("SELECT current_database(), current_user")).one()
            url = make_url(settings.database_url.get_secret_value())
            if tuple(identity) != (database, url.username):
                raise RuntimeError("Production database identity mismatch")
            require_initial_database(connection)
            config = Config(str(config_path or Path.cwd() / "backend/alembic.ini"))
            config.attributes.update(connection=connection, production_authorization=AUTHORIZATION)
            command.upgrade(config, PRODUCTION_REVISION)
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description="Only after separate target/migration approval; never run on startup")
    parser.add_argument("--host", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    migrate_new_database(Settings(_env_file=None), args.host, args.database, args.confirm)


if __name__ == "__main__":
    # Alembic imports this package module too. Use the canonical instance so its
    # in-process authorization sentinel has the same identity under `python -m`.
    from app.production_migrations import main as guarded_main
    guarded_main()
