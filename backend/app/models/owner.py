"""Ownership namespace without authentication or account fields."""

from typing import TYPE_CHECKING

from sqlalchemy import PrimaryKeyConstraint
from sqlalchemy.orm import Mapped, relationship

from app.db import Base
from app.models.audit import AuditMixin

if TYPE_CHECKING:
    from app.models.budget_profile import BudgetProfile
    from app.models.preferences import Preferences
    from app.models.subscription import Subscription
    from app.models.transaction import Transaction


class Owner(AuditMixin, Base):
    __tablename__ = "owners"
    __table_args__ = (PrimaryKeyConstraint("id", name="pk_owners"),)

    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="owner", passive_deletes="all"
    )
    subscriptions: Mapped[list["Subscription"]] = relationship(
        back_populates="owner", passive_deletes="all"
    )
    budget_profile: Mapped["BudgetProfile | None"] = relationship(
        back_populates="owner", passive_deletes="all", uselist=False
    )
    preferences: Mapped["Preferences | None"] = relationship(
        back_populates="owner", passive_deletes="all", uselist=False
    )
