"""Model contract checks that need no database connection."""

import pytest
from sqlalchemy import Date, DateTime, Numeric, UniqueConstraint, inspect

from app.db import Base
from app.models import BudgetProfile, Owner, Preferences, Subscription, Transaction


CHILDREN = [Transaction, Subscription, BudgetProfile, Preferences]


def test_business_metadata_has_exactly_expected_tables():
    assert set(Base.metadata.tables) == {
        "owners", "transactions", "subscriptions", "budget_profiles", "preferences",
        "users", "auth_sessions", "auth_refresh_tokens"
    }


@pytest.mark.parametrize("model", [Owner, *CHILDREN])
def test_identity_and_audit_contract(model):
    columns = model.__table__.c
    assert columns.id.primary_key and columns.id.type.as_uuid
    assert columns.id.default is not None
    for name in ("created_at", "updated_at"):
        assert isinstance(columns[name].type, DateTime)
        assert columns[name].type.timezone
        assert not columns[name].nullable
        assert columns[name].server_default is not None
    assert columns.updated_at.onupdate is not None


def test_relationships_preserve_restrictive_ownership():
    mapper = inspect(Owner)
    assert set(mapper.relationships.keys()) == {
        "transactions", "subscriptions", "budget_profile", "preferences"
    }
    for relationship in mapper.relationships:
        assert relationship.passive_deletes == "all"
        assert "delete" not in relationship.cascade
        assert "delete-orphan" not in relationship.cascade
        assert relationship.back_populates == "owner"
    assert not mapper.relationships.budget_profile.uselist
    assert not mapper.relationships.preferences.uselist
    for model in CHILDREN:
        column = model.__table__.c.owner_id
        assert not column.nullable
        fk, = column.foreign_keys
        assert fk.target_fullname == "owners.id"
        assert fk.ondelete == "RESTRICT"


@pytest.mark.parametrize("model", [BudgetProfile, Preferences])
def test_profiles_have_named_unique_owner(model):
    assert any(
        isinstance(constraint, UniqueConstraint)
        and constraint.name
        and [column.name for column in constraint.columns] == ["owner_id"]
        for constraint in model.__table__.constraints
    )


def test_money_and_calendar_types():
    for model, names in (
        (Transaction, ["amount_usd"]),
        (Subscription, ["amount_usd"]),
        (BudgetProfile, ["monthly_income_usd", "needs_spent_usd", "wants_spent_usd", "savings_usd"]),
    ):
        for name in names:
            column = model.__table__.c[name]
            assert isinstance(column.type, Numeric)
            assert (column.type.precision, column.type.scale) == (20, 8)
            assert not column.nullable
    assert type(Transaction.__table__.c.transaction_date.type) is Date
    assert type(Subscription.__table__.c.next_payment_date.type) is Date


def test_owner_date_indexes_support_stable_listing():
    for model, date_column in ((Transaction, "transaction_date"), (Subscription, "next_payment_date")):
        assert any(
            [column.name for column in index.columns] == ["owner_id", date_column, "id"]
            for index in model.__table__.indexes
        )
