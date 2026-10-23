"""Server-side display-currency preference; theme remains browser-local."""

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, PrimaryKeyConstraint, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.audit import AuditMixin

if TYPE_CHECKING:
    from app.models.owner import Owner


class Preferences(AuditMixin, Base):
    __tablename__ = "preferences"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_preferences"),
        UniqueConstraint("owner_id", name="uq_preferences_owner_id"),
        CheckConstraint(
            "display_currency IN ('USD', 'KZT', 'EUR', 'RUB')",
            name="ck_preferences_display_currency",
        ),
    )

    owner_id: Mapped[UUID] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        ForeignKey("owners.id", name="fk_preferences_owner_id_owners", ondelete="RESTRICT"),
        nullable=False,
    )
    display_currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="USD", server_default=text("'USD'")
    )

    owner: Mapped["Owner"] = relationship(back_populates="preferences")
