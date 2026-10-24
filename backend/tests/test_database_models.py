"""Opt-in checks on the separately approved disposable Phase 5 database.

RUN_DATABASE_TESTS=1 enables these checks. All test rows remain in an outer
transaction that is rolled back; the suite does not migrate or clear a database.
"""

from datetime import date
from decimal import Decimal
import os
from uuid import UUID, uuid4

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
import pytest
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import Base, create_database_engine
from app.models import BudgetProfile, Owner, Preferences, Subscription, Transaction


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DATABASE_TESTS") != "1",
    reason="requires explicit RUN_DATABASE_TESTS=1 for approved local database",
)
BUSINESS_TABLES = {"owners", "transactions", "subscriptions", "budget_profiles", "preferences"}


@pytest.fixture(scope="module")
def engine(phase5_engine):
    yield phase5_engine


@pytest.fixture
def session(engine):
    with engine.connect() as connection:
        outer = connection.begin()
        with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as database_session:
            try:
                yield database_session
            finally:
                database_session.close()
                outer.rollback()


@pytest.fixture
def owner(session):
    value = Owner()
    session.add(value)
    session.flush()
    return value


def transaction(owner_id, **changes):
    values = dict(owner_id=owner_id, title="Lunch", amount_usd=Decimal("12.12345678"),
                  type="expense", category="Custom category 🚲", transaction_date=date(2026, 10, 24))
    return Transaction(**(values | changes))


def subscription(owner_id, **changes):
    values = dict(owner_id=owner_id, service_name="Service", amount_usd=Decimal("0"),
                  next_payment_date=date(2026, 11, 1))
    return Subscription(**(values | changes))


def rejects(session, instance):
    with pytest.raises((IntegrityError, DataError)):
        with session.begin_nested():
            session.add(instance)
            session.flush()


def test_migration_matches_model_metadata(engine):
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True, "compare_server_default": True})
        assert compare_metadata(context, Base.metadata) == []


def test_precision_dates_audit_and_relationship_roundtrip(session, owner):
    tx = transaction(owner.id)
    sub = subscription(owner.id)
    budget = BudgetProfile(owner_id=owner.id)
    preferences = Preferences(owner_id=owner.id)
    session.add_all([tx, sub, budget, preferences])
    session.flush()
    identity = owner.id
    assert isinstance(identity, UUID)
    session.expire_all()
    reloaded = session.get(Owner, identity)
    assert reloaded.transactions[0].amount_usd == Decimal("12.12345678")
    assert reloaded.transactions[0].transaction_date == date(2026, 10, 24)
    assert reloaded.subscriptions[0].next_payment_date == date(2026, 11, 1)
    assert reloaded.subscriptions[0].amount_usd == Decimal("0")
    assert reloaded.subscriptions[0].icon == "credit-card"
    assert reloaded.subscriptions[0].status == "active"
    assert reloaded.budget_profile.monthly_income_usd == Decimal("0")
    assert reloaded.preferences.display_currency == "USD"
    assert reloaded.created_at.utcoffset() is not None
    assert reloaded.updated_at.utcoffset() is not None
    assert reloaded.transactions[0].owner is reloaded
    previous_timestamp = tx.updated_at
    tx.title = "Updated lunch"
    session.flush()
    session.refresh(tx)
    assert tx.title == "Updated lunch"
    # PostgreSQL now() is stable within this rollback-only transaction.
    assert tx.updated_at >= previous_timestamp


@pytest.mark.parametrize("amount", ["0", "-1", "NaN", "Infinity"])
def test_transaction_requires_positive_finite_amount(session, owner, amount):
    rejects(session, transaction(owner.id, amount_usd=Decimal(amount)))


@pytest.mark.parametrize("model", [Subscription, BudgetProfile])
@pytest.mark.parametrize("amount", ["-1", "NaN"])
def test_other_money_is_nonnegative_and_finite(session, owner, model, amount):
    value = subscription(owner.id, amount_usd=Decimal(amount)) if model is Subscription else BudgetProfile(owner_id=owner.id, savings_usd=Decimal(amount))
    rejects(session, value)


@pytest.mark.parametrize("field,value", [("title", " \t\n"), ("category", "\t\n"), ("type", "refund")])
def test_transaction_rejects_blank_text_and_invalid_type(session, owner, field, value):
    rejects(session, transaction(owner.id, **{field: value}))


@pytest.mark.parametrize("field,value", [("service_name", "\n\t"), ("icon", "\t"), ("status", "ended")])
def test_subscription_rejects_blank_text_and_invalid_status(session, owner, field, value):
    rejects(session, subscription(owner.id, **{field: value}))


def test_preferences_reject_unsupported_currency(session, owner):
    rejects(session, Preferences(owner_id=owner.id, display_currency="GBP"))


@pytest.mark.parametrize("model", [BudgetProfile, Preferences])
def test_one_to_one_owner_uniqueness(session, owner, model):
    session.add(model(owner_id=owner.id))
    session.flush()
    rejects(session, model(owner_id=owner.id))


def test_foreign_key_rejects_nonexistent_owner(session):
    rejects(session, transaction(uuid4()))


@pytest.mark.parametrize("loaded", [False, True])
def test_owner_delete_restricted_with_loaded_or_unloaded_children(session, owner, loaded):
    session.add(transaction(owner.id))
    session.flush()
    session.expire(owner, ["transactions"])
    if loaded:
        assert len(owner.transactions) == 1
    with pytest.raises(IntegrityError):
        with session.begin_nested():
            session.delete(owner)
            session.flush()


def test_numeric_precision_overflow_rejected(session, owner):
    # NUMERIC(20,8) allows at most twelve integral digits.
    with pytest.raises(DataError):
        with session.begin_nested():
            session.add(transaction(owner.id, amount_usd=Decimal("1000000000000")))
            session.flush()
