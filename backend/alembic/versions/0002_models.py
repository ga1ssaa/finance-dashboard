"""Create ownership, transactions, subscriptions, budgets, and preferences.

Revision ID: 0002_models
Revises: 0001_infrastructure
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0002_models"
down_revision: str | None = "0001_infrastructure"
branch_labels: str | None = None
depends_on: str | None = None


def _audit_columns() -> list[sa.Column]:
    # UUIDs are supplied by the ORM (uuid4) or explicitly by raw SQL callers.
    return [
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "owners",
        *_audit_columns(),
        sa.PrimaryKeyConstraint("id", name="pk_owners"),
    )
    op.create_table(
        "transactions",
        *_audit_columns(),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("amount_usd", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("type", sa.String(length=7), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.CheckConstraint(
            "title ~ '[^[:space:]]'", name="ck_transactions_title_nonblank"
        ),
        sa.CheckConstraint(
            "category ~ '[^[:space:]]'", name="ck_transactions_category_nonblank"
        ),
        sa.CheckConstraint(
            "amount_usd > 0 AND amount_usd < 'Infinity'::numeric",
            name="ck_transactions_amount_usd_positive_finite",
        ),
        sa.CheckConstraint("type IN ('income', 'expense')", name="ck_transactions_type"),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["owners.id"], name="fk_transactions_owner_id_owners", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_transactions"),
    )
    op.create_index(
        "ix_transactions_owner_date_id", "transactions", ["owner_id", "transaction_date", "id"]
    )
    op.create_table(
        "subscriptions",
        *_audit_columns(),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_name", sa.String(length=255), nullable=False),
        sa.Column("amount_usd", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("next_payment_date", sa.Date(), nullable=False),
        sa.Column(
            "icon", sa.String(length=64), server_default=sa.text("'credit-card'"), nullable=False
        ),
        sa.Column(
            "status", sa.String(length=6), server_default=sa.text("'active'"), nullable=False
        ),
        sa.CheckConstraint(
            "service_name ~ '[^[:space:]]'", name="ck_subscriptions_service_name_nonblank"
        ),
        sa.CheckConstraint("icon ~ '[^[:space:]]'", name="ck_subscriptions_icon_nonblank"),
        sa.CheckConstraint(
            "amount_usd >= 0 AND amount_usd < 'Infinity'::numeric",
            name="ck_subscriptions_amount_usd_nonnegative_finite",
        ),
        sa.CheckConstraint("status IN ('active', 'paused')", name="ck_subscriptions_status"),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["owners.id"], name="fk_subscriptions_owner_id_owners", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_subscriptions"),
    )
    op.create_index(
        "ix_subscriptions_owner_next_payment_date_id",
        "subscriptions",
        ["owner_id", "next_payment_date", "id"],
    )
    op.create_table(
        "budget_profiles",
        *_audit_columns(),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "monthly_income_usd", sa.Numeric(precision=20, scale=8), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "needs_spent_usd", sa.Numeric(precision=20, scale=8), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "wants_spent_usd", sa.Numeric(precision=20, scale=8), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "savings_usd", sa.Numeric(precision=20, scale=8), server_default=sa.text("0"), nullable=False
        ),
        sa.CheckConstraint(
            "monthly_income_usd >= 0 AND monthly_income_usd < 'Infinity'::numeric",
            name="ck_budget_profiles_monthly_income_usd_nonnegative_finite",
        ),
        sa.CheckConstraint(
            "needs_spent_usd >= 0 AND needs_spent_usd < 'Infinity'::numeric",
            name="ck_budget_profiles_needs_spent_usd_nonnegative_finite",
        ),
        sa.CheckConstraint(
            "wants_spent_usd >= 0 AND wants_spent_usd < 'Infinity'::numeric",
            name="ck_budget_profiles_wants_spent_usd_nonnegative_finite",
        ),
        sa.CheckConstraint(
            "savings_usd >= 0 AND savings_usd < 'Infinity'::numeric",
            name="ck_budget_profiles_savings_usd_nonnegative_finite",
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["owners.id"], name="fk_budget_profiles_owner_id_owners", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_budget_profiles"),
        sa.UniqueConstraint("owner_id", name="uq_budget_profiles_owner_id"),
    )
    op.create_table(
        "preferences",
        *_audit_columns(),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "display_currency", sa.String(length=3), server_default=sa.text("'USD'"), nullable=False
        ),
        sa.CheckConstraint(
            "display_currency IN ('USD', 'KZT', 'EUR', 'RUB')",
            name="ck_preferences_display_currency",
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["owners.id"], name="fk_preferences_owner_id_owners", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_preferences"),
        sa.UniqueConstraint("owner_id", name="uq_preferences_owner_id"),
    )


def downgrade() -> None:
    op.drop_table("preferences")
    op.drop_table("budget_profiles")
    op.drop_index("ix_subscriptions_owner_next_payment_date_id", table_name="subscriptions")
    op.drop_table("subscriptions")
    op.drop_index("ix_transactions_owner_date_id", table_name="transactions")
    op.drop_table("transactions")
    op.drop_table("owners")
