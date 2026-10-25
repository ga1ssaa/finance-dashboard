"""Owner-scoped financial operations. Transaction boundaries belong to callers."""

from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import BudgetProfile, Owner, Preferences, Subscription, Transaction
from app.schemas import DateRange, SubscriptionQuery, TransactionQuery


def lock_owner(session: Session, owner_id: UUID) -> None:
    """All financial writers acquire this existing namespace row first."""
    record = session.scalar(select(Owner.id).where(Owner.id == owner_id).with_for_update())
    if record is None:
        raise HTTPException(status_code=401, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"})


def get_record(session: Session, model, owner_id: UUID, record_id: UUID):
    record = session.scalar(select(model).where(model.id == record_id, model.owner_id == owner_id))
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return record


def create_record(session: Session, model, owner_id: UUID, values: dict):
    lock_owner(session, owner_id)
    record = model(owner_id=owner_id, **values)
    session.add(record)
    session.flush()
    return record


def update_record(session: Session, record, values: dict):
    for name, value in values.items():
        setattr(record, name, value)
    session.flush()
    # onupdate timestamps are server expressions; load them before serialization.
    session.refresh(record)
    return record


def delete_record(session: Session, record) -> None:
    session.delete(record)
    session.flush()


def scoped_conditions(model, owner_id: UUID, query: DateRange):
    conditions = [model.owner_id == owner_id]
    date_column = model.transaction_date if model is Transaction else model.next_payment_date
    if query.date_from is not None:
        conditions.append(date_column >= query.date_from)
    if query.date_to is not None:
        conditions.append(date_column <= query.date_to)
    return conditions


def literal_pattern(value: str) -> str:
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def list_records(session: Session, model, owner_id: UUID, query: TransactionQuery | SubscriptionQuery):
    conditions = scoped_conditions(model, owner_id, query)
    if model is Transaction:
        if query.type is not None:
            conditions.append(model.type == query.type)
        if query.category is not None:
            conditions.append(model.category == query.category)
        if query.q is not None:
            pattern = literal_pattern(query.q)
            conditions.append(or_(model.title.ilike(pattern, escape="\\"), model.category.ilike(pattern, escape="\\")))
        sort_columns = {"transaction_date": model.transaction_date, "amount_usd": model.amount_usd,
                        "title": model.title, "created_at": model.created_at}
    else:
        if query.status is not None:
            conditions.append(model.status == query.status)
        sort_columns = {"next_payment_date": model.next_payment_date, "amount_usd": model.amount_usd,
                        "service_name": model.service_name, "created_at": model.created_at}
    total = session.scalar(select(func.count()).select_from(model).where(*conditions))
    column = sort_columns[query.sort_by]
    sort = column.asc() if query.sort_direction == "asc" else column.desc()
    records = session.scalars(select(model).where(*conditions).order_by(sort, model.id.asc())
                              .limit(query.limit).offset(query.offset)).all()
    return {"items": records, "total": total, "limit": query.limit, "offset": query.offset}


def get_singleton(session: Session, model, owner_id: UUID):
    lock_owner(session, owner_id)
    record = session.scalar(select(model).where(model.owner_id == owner_id))
    if record is not None:
        return record
    session.execute(insert(model).values(owner_id=owner_id)
                    .on_conflict_do_nothing(index_elements=[model.owner_id]))
    return session.scalar(select(model).where(model.owner_id == owner_id))


def subscription_summary(session: Session, owner_id: UUID) -> dict:
    active = Subscription.status == "active"
    paused = Subscription.status == "paused"
    result = session.execute(select(
        func.count().filter(active).label("active_count"),
        func.count().filter(paused).label("paused_count"),
        func.coalesce(func.sum(Subscription.amount_usd).filter(active), Decimal("0")).label("monthly_cost_usd"),
    ).where(Subscription.owner_id == owner_id)).one()
    return dict(result._mapping)


def dashboard(session: Session, owner_id: UUID, query: DateRange) -> dict:
    conditions = scoped_conditions(Transaction, owner_id, query)
    income = func.coalesce(func.sum(case((Transaction.type == "income", Transaction.amount_usd), else_=Decimal("0"))), Decimal("0"))
    expenses = func.coalesce(func.sum(case((Transaction.type == "expense", Transaction.amount_usd), else_=Decimal("0"))), Decimal("0"))
    result = session.execute(select(
        income.label("income_usd"), expenses.label("expenses_usd"),
        (income - expenses).label("balance_usd"), func.count().label("transaction_count"),
    ).where(*conditions)).one()
    amount = func.sum(Transaction.amount_usd)
    categories = session.execute(select(Transaction.category, amount.label("amount_usd"))
                                 .where(*conditions, Transaction.type == "expense")
                                 .group_by(Transaction.category)
                                 .order_by(amount.desc(), Transaction.category.asc())).all()
    return {**dict(result._mapping), "expense_by_category": [dict(row._mapping) for row in categories]}
