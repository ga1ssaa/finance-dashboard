"""Add independent shared authentication quotas; never touches financial rows."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005_auth_rate_limits"
down_revision = "0004_data_operations"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("auth_rate_limits",
        sa.Column("key_hash", sa.CHAR(64), primary_key=True),
        sa.Column("attempts", postgresql.JSONB(), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
        sa.Column("window_seconds", sa.Integer(), nullable=False),
        sa.CheckConstraint("jsonb_typeof(attempts) = 'array' AND jsonb_array_length(attempts) BETWEEN 1 AND 30", name="ck_auth_rate_limits_attempts"),
        sa.CheckConstraint("window_seconds BETWEEN 1 AND 3600", name="ck_auth_rate_limits_window"))
    op.create_index("ix_auth_rate_limits_expires_at", "auth_rate_limits", ["expires_at"])


def downgrade():
    op.drop_table("auth_rate_limits")
