"""Manually maintained subscription dates and USD monthly costs."""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Numeric, PrimaryKeyConstraint, String, text
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.audit import AuditMixin

if TYPE_CHECKING:
    from app.models.owner import Owner


class Subscription(AuditMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_subscriptions"),
        CheckConstraint(
            "service_name ~ '[^[:space:]]'", name="ck_subscriptions_service_name_nonblank"
        ),
        CheckConstraint("icon ~ '[^[:space:]]'", name="ck_subscriptions_icon_nonblank"),
        CheckConstraint(
            "amount_usd >= 0 AND amount_usd < 'Infinity'::numeric",
            name="ck_subscriptions_amount_usd_nonnegative_finite",
        ),
        CheckConstraint("status IN ('active', 'paused')", name="ck_subscriptions_status"),
        Index(
            "ix_subscriptions_owner_next_payment_date_id",
            "owner_id",
            "next_payment_date",
            "id",
        ),
    )

    owner_id: Mapped[UUID] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        ForeignKey("owners.id", name="fk_subscriptions_owner_id_owners", ondelete="RESTRICT"),
        nullable=False,
    )
    service_name: Mapped[str] = mapped_column(String(255), nullable=False)
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    next_payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    icon: Mapped[str] = mapped_column(
        String(64), nullable=False, default="credit-card", server_default=text("'credit-card'")
    )
    status: Mapped[str] = mapped_column(
        String(6), nullable=False, default="active", server_default=text("'active'")
    )

    owner: Mapped["Owner"] = relationship(back_populates="subscriptions")
