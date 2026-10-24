"""Authentication persistence. Callers own commits and HTTP responses."""

from datetime import timedelta
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import DUMMY_PASSWORD_HASH, PASSWORD_HASHER, password_matches, token_hash, utcnow
from app.models import AuthRefreshToken, AuthSession, Owner, User


def new_refresh_token(session: Session, family: AuthSession):
    raw_token = secrets.token_urlsafe(32)
    expiry = min(utcnow() + timedelta(days=7), family.expires_at)
    session.add(AuthRefreshToken(session_id=family.id, token_hash=token_hash(raw_token), expires_at=expiry))
    session.flush()
    return raw_token, expiry


def new_session(session: Session, user: User):
    family = AuthSession(user_id=user.id, expires_at=utcnow() + timedelta(days=30))
    session.add(family)
    session.flush()
    raw_token, expiry = new_refresh_token(session, family)
    return user, family, raw_token, expiry


def register(session: Session, email: str, password_hash: str):
    # Fresh namespace only. Legacy owners and their financial records are never
    # queried or assigned by registration, even when the old env variable exists.
    owner = Owner()
    session.add(owner)
    session.flush()
    user = User(owner_id=owner.id, email=email, password_hash=password_hash)
    session.add(user)
    session.flush()
    return new_session(session, user)


def login(session: Session, email: str, password: str):
    user = session.scalar(select(User).where(User.email == email))
    verified = password_matches(user.password_hash if user is not None else DUMMY_PASSWORD_HASH, password)
    if user is None or not verified:
        return None
    if PASSWORD_HASHER.check_needs_rehash(user.password_hash):
        user.password_hash = PASSWORD_HASHER.hash(password)
    return new_session(session, user)


def lock_family_for_token(session: Session, raw_token: str):
    hashed = token_hash(raw_token)
    family_id = session.scalar(select(AuthRefreshToken.session_id).where(AuthRefreshToken.token_hash == hashed))
    if family_id is None:
        return None, hashed
    family = session.scalar(select(AuthSession).where(AuthSession.id == family_id).with_for_update())
    return family, hashed


def rotate_refresh(session: Session, raw_token: str):
    family, hashed = lock_family_for_token(session, raw_token)
    now = utcnow()
    if family is None or family.revoked_at is not None or family.expires_at <= now:
        return None
    token = session.scalar(select(AuthRefreshToken).where(
        AuthRefreshToken.token_hash == hashed, AuthRefreshToken.session_id == family.id,
    ).with_for_update().execution_options(populate_existing=True))
    if token is None:
        return None
    if token.used_at is not None:
        family.revoked_at = now
        session.flush()
        return None  # Route commits replay revocation before returning 401.
    if token.expires_at <= now:
        return None
    token.used_at = now
    user = session.get(User, family.user_id)
    raw_token, expiry = new_refresh_token(session, family)
    return user, family, raw_token, expiry


def logout(session: Session, raw_token: str) -> None:
    family, _ = lock_family_for_token(session, raw_token)
    if family is not None and family.revoked_at is None:
        family.revoked_at = utcnow()
        session.flush()
