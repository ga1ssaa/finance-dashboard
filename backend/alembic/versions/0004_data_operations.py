"""Add immutable owner-scoped operation receipts only.

Revision ID: 0004_data_operations
Revises: 0003_auth
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_data_operations"
down_revision = "0003_auth"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "data_operation_receipts",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("idempotency_key", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("preview_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("request_sha256", sa.CHAR(64), nullable=False),
        sa.Column("result_json", postgresql.JSONB(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("owner_id", "idempotency_key", name="pk_data_operation_receipts"),
        sa.ForeignKeyConstraint(["owner_id"], ["owners.id"], name="fk_data_operation_receipts_owner_id_owners", ondelete="RESTRICT"),
        sa.UniqueConstraint("owner_id", "preview_id", name="uq_data_operation_receipts_owner_preview"),
        sa.CheckConstraint("kind IN ('import_replace','reset')", name="ck_data_operation_receipts_kind"),
        sa.CheckConstraint("request_sha256 ~ '^[0-9a-f]{64}$'", name="ck_data_operation_receipts_request_sha256"),
        sa.CheckConstraint("jsonb_typeof(result_json) = 'object' AND octet_length(result_json::text) <= 8192", name="ck_data_operation_receipts_result"),
    )


def downgrade():
    # Destructive rollback is never invoked by the application or test suite.
    op.drop_table("data_operation_receipts")
