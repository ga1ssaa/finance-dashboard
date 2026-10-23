"""USD-base income and expense records with free-text categories."""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Numeric, PrimaryKeyConstraint, String
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.audit import AuditMixin

if TYPE_CHECKING:
    from app.models.owner import Owner


class Transaction(AuditMixin, Base):
    __tablename__ = "transactions"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_transactions"),
        CheckConstraint("title ~ '[^[:space:]]'", name="ck_transactions_title_nonblank"),
        CheckConstraint("category ~ '[^[:space:]]'", name="ck_transactions_category_nonblank"),
        CheckConstraint(
            "amount_usd > 0 AND amount_usd < 'Infinity'::numeric",
            name="ck_transactions_amount_usd_positive_finite",
        ),
        CheckConstraint("type IN ('income', 'expense')", name="ck_transactions_type"),
        Index("ix_transactions_owner_date_id", "owner_id", "transaction_date", "id"),
    )

    owner_id: Mapped[UUID] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        ForeignKey("owners.id", name="fk_transactions_owner_id_owners", ondelete="RESTRICT"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    type: Mapped[str] = mapped_column(String(7), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)

    owner: Mapped["Owner"] = relationship(back_populates="transactions")
