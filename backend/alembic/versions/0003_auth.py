"""Add authentication identities and refresh-session families only.

Revision ID: 0003_auth
Revises: 0002_models
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0003_auth"
down_revision = "0002_models"
branch_labels = None
depends_on = None


def _audit_columns():
    return [
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade():
    # No legacy owner is assigned to an account, and no financial table changes.
    op.create_table(
        "users", *_audit_columns(),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.ForeignKeyConstraint(["owner_id"], ["owners.id"], name="fk_users_owner_id_owners", ondelete="RESTRICT"),
        sa.UniqueConstraint("owner_id", name="uq_users_owner_id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_table(
        "auth_sessions", *_audit_columns(),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_auth_sessions"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_auth_sessions_user_id_users", ondelete="RESTRICT"),
        sa.CheckConstraint("expires_at > created_at", name="ck_auth_sessions_expiry"),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_table(
        "auth_refresh_tokens", *_audit_columns(),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.CHAR(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_auth_refresh_tokens"),
        sa.ForeignKeyConstraint(["session_id"], ["auth_sessions.id"], name="fk_auth_refresh_tokens_session_id_auth_sessions", ondelete="RESTRICT"),
        sa.UniqueConstraint("token_hash", name="uq_auth_refresh_tokens_token_hash"),
        sa.CheckConstraint("expires_at > created_at", name="ck_auth_refresh_tokens_expiry"),
    )
    op.create_index("ix_auth_refresh_tokens_session_id", "auth_refresh_tokens", ["session_id"])


def downgrade():
    # Downgrade is a separate destructive operation requiring explicit approval.
    op.drop_index("ix_auth_refresh_tokens_session_id", table_name="auth_refresh_tokens")
    op.drop_table("auth_refresh_tokens")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("users")
