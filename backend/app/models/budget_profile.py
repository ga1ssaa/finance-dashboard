"""Independent 50/30/20 budget inputs; these are not transaction aggregates."""

from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Numeric, PrimaryKeyConstraint, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.audit import AuditMixin

if TYPE_CHECKING:
    from app.models.owner import Owner


class BudgetProfile(AuditMixin, Base):
    __tablename__ = "budget_profiles"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_budget_profiles"),
        UniqueConstraint("owner_id", name="uq_budget_profiles_owner_id"),
        CheckConstraint(
            "monthly_income_usd >= 0 AND monthly_income_usd < 'Infinity'::numeric",
            name="ck_budget_profiles_monthly_income_usd_nonnegative_finite",
        ),
        CheckConstraint(
            "needs_spent_usd >= 0 AND needs_spent_usd < 'Infinity'::numeric",
            name="ck_budget_profiles_needs_spent_usd_nonnegative_finite",
        ),
        CheckConstraint(
            "wants_spent_usd >= 0 AND wants_spent_usd < 'Infinity'::numeric",
            name="ck_budget_profiles_wants_spent_usd_nonnegative_finite",
        ),
        CheckConstraint(
            "savings_usd >= 0 AND savings_usd < 'Infinity'::numeric",
            name="ck_budget_profiles_savings_usd_nonnegative_finite",
        ),
    )

    owner_id: Mapped[UUID] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        ForeignKey("owners.id", name="fk_budget_profiles_owner_id_owners", ondelete="RESTRICT"),
        nullable=False,
    )
    monthly_income_usd: Mapped[Decimal] = mapped_column(
        Numeric(20, 8), nullable=False, default=Decimal("0"), server_default=text("0")
    )
    needs_spent_usd: Mapped[Decimal] = mapped_column(
        Numeric(20, 8), nullable=False, default=Decimal("0"), server_default=text("0")
    )
    wants_spent_usd: Mapped[Decimal] = mapped_column(
        Numeric(20, 8), nullable=False, default=Decimal("0"), server_default=text("0")
    )
    savings_usd: Mapped[Decimal] = mapped_column(
        Numeric(20, 8), nullable=False, default=Decimal("0"), server_default=text("0")
    )

    owner: Mapped["Owner"] = relationship(back_populates="budget_profile")
