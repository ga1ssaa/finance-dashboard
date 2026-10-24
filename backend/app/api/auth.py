"""Authentication endpoints with explicit commit-before-cookie/token behavior."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.auth import (
    AuthenticatedUser, COOKIE_NAME, PASSWORD_HASHER, clear_refresh_cookie,
    get_current_user, issue_access_token, set_refresh_cookie, valid_refresh_cookie,
)
from app.auth_schemas import AuthResult, Credentials, UserResponse
from app.db import get_session
from app.services import auth


router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])
SessionDependency = Annotated[Session, Depends(get_session)]


def documented_csrf_header(x_csrf_protection: Annotated[Literal["1"], Header(alias="X-CSRF-Protection", examples=["1"])]):
    """Expose the middleware-enforced auth POST header in Swagger/OpenAPI."""


auth_post_dependencies = [Depends(documented_csrf_header)]


def authenticated_result(request: Request, response: Response, outcome) -> AuthResult:
    user, family, raw_token, expiry = outcome
    access_token = issue_access_token(request.app.state.settings, user.id, family.id)
    set_refresh_cookie(response, raw_token, expiry, request.app.state.settings.app_env == "production")
    return AuthResult(access_token=access_token, user=UserResponse.model_validate(user))


@router.post("/register", response_model=AuthResult, status_code=201, dependencies=auth_post_dependencies)
def register(body: Credentials, request: Request, response: Response, session: SessionDependency):
    password_hash = PASSWORD_HASHER.hash(body.password.get_secret_value())
    with session.begin():
        outcome = auth.register(session, body.email, password_hash)
    return authenticated_result(request, response, outcome)


@router.post("/login", response_model=AuthResult, dependencies=auth_post_dependencies)
def login(body: Credentials, request: Request, response: Response, session: SessionDependency):
    with session.begin():
        outcome = auth.login(session, body.email, body.password.get_secret_value())
    if outcome is None:
        return JSONResponse(status_code=401, content={"detail": "Invalid email or password"}, headers={"WWW-Authenticate": "Bearer"})
    return authenticated_result(request, response, outcome)


@router.post("/refresh", response_model=AuthResult, dependencies=auth_post_dependencies)
def refresh(request: Request, response: Response, session: SessionDependency):
    raw_token = request.cookies.get(COOKIE_NAME)
    outcome = None
    if valid_refresh_cookie(raw_token):
        with session.begin():
            outcome = auth.rotate_refresh(session, raw_token)
    if outcome is None:
        failure = JSONResponse(status_code=401, content={"detail": "Authentication required"}, headers={"WWW-Authenticate": "Bearer"})
        clear_refresh_cookie(failure, request.app.state.settings.app_env == "production")
        return failure
    return authenticated_result(request, response, outcome)


@router.post("/logout", status_code=204, dependencies=auth_post_dependencies)
def logout(request: Request, session: SessionDependency):
    raw_token = request.cookies.get(COOKIE_NAME)
    if valid_refresh_cookie(raw_token):
        with session.begin():
            auth.logout(session, raw_token)
    response = Response(status_code=204)
    clear_refresh_cookie(response, request.app.state.settings.app_env == "production")
    return response


@router.get("/me", response_model=UserResponse)
def me(user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
    return UserResponse(id=user.id, email=user.email)
