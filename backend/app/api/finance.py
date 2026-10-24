"""Thin HTTP handlers: validate, invoke services, commit, then respond."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.auth import AuthenticatedUser, get_current_user
from app.models import BudgetProfile, Preferences, Subscription, Transaction
from app.schemas import (
    BudgetPatch, BudgetResponse, DashboardResponse, DateRange, PreferencesPatch,
    PreferencesResponse, SubscriptionCreate, SubscriptionPage, SubscriptionPatch,
    SubscriptionQuery, SubscriptionResponse, SubscriptionSummary, TransactionCreate,
    TransactionPage, TransactionPatch, TransactionQuery, TransactionResponse,
)
from app.services import finance


router = APIRouter(prefix="/api/v1")
SessionDependency = Annotated[Session, Depends(get_session)]


def get_owner_id(request: Request, user: Annotated[AuthenticatedUser, Depends(get_current_user)]) -> UUID:
    if "owner_id" in request.query_params:
        raise HTTPException(status_code=422, detail="owner_id is not a client parameter")
    return user.owner_id


OwnerDependency = Annotated[UUID, Depends(get_owner_id)]


@router.post("/transactions", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED, tags=["transactions"])
def create_transaction(body: TransactionCreate, session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        record = finance.create_record(session, Transaction, owner_id, body.model_dump())
        result = TransactionResponse.model_validate(record)
    return result


@router.get("/transactions", response_model=TransactionPage, tags=["transactions"])
def list_transactions(query: Annotated[TransactionQuery, Query()], session: SessionDependency, owner_id: OwnerDependency):
    return TransactionPage.model_validate(finance.list_records(session, Transaction, owner_id, query))


@router.get("/transactions/{record_id}", response_model=TransactionResponse, tags=["transactions"])
def get_transaction(record_id: UUID, session: SessionDependency, owner_id: OwnerDependency):
    return TransactionResponse.model_validate(finance.get_record(session, Transaction, owner_id, record_id))


@router.patch("/transactions/{record_id}", response_model=TransactionResponse, tags=["transactions"])
def patch_transaction(record_id: UUID, body: TransactionPatch, session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        record = finance.get_record(session, Transaction, owner_id, record_id)
        finance.update_record(session, record, body.model_dump(exclude_unset=True))
        result = TransactionResponse.model_validate(record)
    return result


@router.delete("/transactions/{record_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["transactions"])
def delete_transaction(record_id: UUID, session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        finance.delete_record(session, finance.get_record(session, Transaction, owner_id, record_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/subscriptions", response_model=SubscriptionResponse, status_code=status.HTTP_201_CREATED, tags=["subscriptions"])
def create_subscription(body: SubscriptionCreate, session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        record = finance.create_record(session, Subscription, owner_id, body.model_dump())
        result = SubscriptionResponse.model_validate(record)
    return result


@router.get("/subscriptions", response_model=SubscriptionPage, tags=["subscriptions"])
def list_subscriptions(query: Annotated[SubscriptionQuery, Query()], session: SessionDependency, owner_id: OwnerDependency):
    return SubscriptionPage.model_validate(finance.list_records(session, Subscription, owner_id, query))


@router.get("/subscriptions/summary", response_model=SubscriptionSummary, tags=["subscriptions"])
def subscription_summary(session: SessionDependency, owner_id: OwnerDependency):
    return SubscriptionSummary.model_validate(finance.subscription_summary(session, owner_id))


@router.get("/subscriptions/{record_id}", response_model=SubscriptionResponse, tags=["subscriptions"])
def get_subscription(record_id: UUID, session: SessionDependency, owner_id: OwnerDependency):
    return SubscriptionResponse.model_validate(finance.get_record(session, Subscription, owner_id, record_id))


@router.patch("/subscriptions/{record_id}", response_model=SubscriptionResponse, tags=["subscriptions"])
def patch_subscription(record_id: UUID, body: SubscriptionPatch, session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        record = finance.get_record(session, Subscription, owner_id, record_id)
        finance.update_record(session, record, body.model_dump(exclude_unset=True))
        result = SubscriptionResponse.model_validate(record)
    return result


@router.delete("/subscriptions/{record_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["subscriptions"])
def delete_subscription(record_id: UUID, session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        finance.delete_record(session, finance.get_record(session, Subscription, owner_id, record_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/budget", response_model=BudgetResponse, tags=["budget"])
def get_budget(session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        result = BudgetResponse.model_validate(finance.get_singleton(session, BudgetProfile, owner_id))
    return result


@router.patch("/budget", response_model=BudgetResponse, tags=["budget"])
def patch_budget(body: BudgetPatch, session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        record = finance.get_singleton(session, BudgetProfile, owner_id)
        finance.update_record(session, record, body.model_dump(exclude_unset=True))
        result = BudgetResponse.model_validate(record)
    return result


@router.get("/preferences", response_model=PreferencesResponse, tags=["preferences"])
def get_preferences(session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        result = PreferencesResponse.model_validate(finance.get_singleton(session, Preferences, owner_id))
    return result


@router.patch("/preferences", response_model=PreferencesResponse, tags=["preferences"])
def patch_preferences(body: PreferencesPatch, session: SessionDependency, owner_id: OwnerDependency):
    with session.begin():
        record = finance.get_singleton(session, Preferences, owner_id)
        finance.update_record(session, record, body.model_dump(exclude_unset=True))
        result = PreferencesResponse.model_validate(record)
    return result


@router.get("/dashboard", response_model=DashboardResponse, tags=["dashboard"])
def get_dashboard(query: Annotated[DateRange, Query()], session: SessionDependency, owner_id: OwnerDependency):
    return DashboardResponse.model_validate(finance.dashboard(session, owner_id, query))
