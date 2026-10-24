"""Additive authentication records; legacy financial ownership remains unchanged."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CHAR, CheckConstraint, DateTime, ForeignKey, Index, PrimaryKeyConstraint, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.audit import AuditMixin


class User(AuditMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_users"),
        UniqueConstraint("owner_id", name="uq_users_owner_id"),
        UniqueConstraint("email", name="uq_users_email"),
    )
    owner_id: Mapped[UUID] = mapped_column(PostgreSQLUUID(as_uuid=True), ForeignKey("owners.id", name="fk_users_owner_id_owners", ondelete="RESTRICT"), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)


class AuthSession(AuditMixin, Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_auth_sessions"),
        CheckConstraint("expires_at > created_at", name="ck_auth_sessions_expiry"),
        Index("ix_auth_sessions_user_id", "user_id"),
    )
    user_id: Mapped[UUID] = mapped_column(PostgreSQLUUID(as_uuid=True), ForeignKey("users.id", name="fk_auth_sessions_user_id_users", ondelete="RESTRICT"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthRefreshToken(AuditMixin, Base):
    __tablename__ = "auth_refresh_tokens"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_auth_refresh_tokens"),
        UniqueConstraint("token_hash", name="uq_auth_refresh_tokens_token_hash"),
        CheckConstraint("expires_at > created_at", name="ck_auth_refresh_tokens_expiry"),
        Index("ix_auth_refresh_tokens_session_id", "session_id"),
    )
    session_id: Mapped[UUID] = mapped_column(PostgreSQLUUID(as_uuid=True), ForeignKey("auth_sessions.id", name="fk_auth_refresh_tokens_session_id_auth_sessions", ondelete="RESTRICT"), nullable=False)
    token_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
