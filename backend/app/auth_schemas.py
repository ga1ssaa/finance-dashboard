"""Authentication payloads deliberately omit owner IDs and credential hashes."""

import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, SecretStr, WithJsonSchema


def normalized_email(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Email must be a string")
    value = value.strip().lower()
    if (len(value) > 254 or not value.isascii()
            or not re.fullmatch(r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", value)
            or len(value.split("@", 1)[0]) > 64):
        raise ValueError("Email must be a valid ASCII address of at most 254 characters")
    return value


def validated_password(value: object) -> str:
    if not isinstance(value, str) or not 15 <= len(value) <= 128:
        raise ValueError("Password must contain 15 through 128 characters")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("Password must contain valid Unicode characters") from None
    if len(encoded) > 512:
        raise ValueError("Password must use at most 512 UTF-8 bytes")
    return value


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    email: Annotated[str, BeforeValidator(normalized_email), Field(max_length=254)]
    password: Annotated[SecretStr, BeforeValidator(validated_password), WithJsonSchema({
        "type": "string", "format": "password", "writeOnly": True,
        "minLength": 15, "maxLength": 128, "description": "At most 512 UTF-8 bytes; whitespace is preserved",
    })]


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str


class AuthResult(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: Literal[300] = 300
    user: UserResponse
