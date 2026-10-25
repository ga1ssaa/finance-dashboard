"""Destructive request confirmations and immutable reconciliation summaries."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BeforeValidator, Field, SecretStr, StrictStr, WithJsonSchema

from app.auth_schemas import validated_password
from app.import_preview_schemas import ImportPreviewRequest, ImportPreviewResponse, PreviewCounts, PreviewCurrent, PreviewModel, PreviewWarning, ReplacementImpact
from app.schemas import AuditTime

OperationPassword = Annotated[SecretStr, BeforeValidator(validated_password), WithJsonSchema({
    "type": "string", "format": "password", "writeOnly": True, "minLength": 8, "maxLength": 128,
    "description": "At most 512 UTF-8 bytes; whitespace is preserved",
})]


class ImportApplyRequest(ImportPreviewRequest):
    preview_token: SecretStr = Field(max_length=4096, repr=False)
    password: OperationPassword = Field(repr=False)
    confirmation: StrictStr = Field(max_length=64)


class ResetRequest(PreviewModel):
    preview_token: SecretStr = Field(max_length=4096, repr=False)
    password: OperationPassword = Field(repr=False)
    confirmation: StrictStr = Field(max_length=64)


class ResetPreviewRequest(PreviewModel):
    pass


class AuthorizedImportPreview(ImportPreviewResponse):
    preview_token: str = Field(repr=False)
    expires_at: AuditTime


class ResetPreviewResponse(PreviewModel):
    validation_status: Literal["valid"]
    current: PreviewCurrent
    replacement_impact: ReplacementImpact
    warnings: list[PreviewWarning]
    preview_token: str = Field(repr=False)
    expires_at: AuditTime


class DataOperationResult(PreviewModel):
    idempotency_key: UUID
    operation: Literal["import_replace", "reset"]
    status: Literal["completed"]
    completed_at: AuditTime
    document_sha256: str | None = Field(pattern=r"^[0-9a-f]{64}$")
    removed: PreviewCounts
    created: PreviewCounts
