"""Immutable operation receipts; reset never removes or changes these records."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CHAR, CheckConstraint, DateTime, ForeignKey, PrimaryKeyConstraint, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DataOperationReceipt(Base):
    __tablename__ = "data_operation_receipts"
    __table_args__ = (
        PrimaryKeyConstraint("owner_id", "idempotency_key", name="pk_data_operation_receipts"),
        UniqueConstraint("owner_id", "preview_id", name="uq_data_operation_receipts_owner_preview"),
        CheckConstraint("kind IN ('import_replace','reset')", name="ck_data_operation_receipts_kind"),
        CheckConstraint("request_sha256 ~ '^[0-9a-f]{64}$'", name="ck_data_operation_receipts_request_sha256"),
        CheckConstraint("jsonb_typeof(result_json) = 'object' AND octet_length(result_json::text) <= 8192", name="ck_data_operation_receipts_result"),
    )
    owner_id: Mapped[UUID] = mapped_column(PostgreSQLUUID(as_uuid=True), ForeignKey("owners.id", name="fk_data_operation_receipts_owner_id_owners", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[UUID] = mapped_column(PostgreSQLUUID(as_uuid=True), nullable=False)
    preview_id: Mapped[UUID] = mapped_column(PostgreSQLUUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    request_sha256: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    result_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
