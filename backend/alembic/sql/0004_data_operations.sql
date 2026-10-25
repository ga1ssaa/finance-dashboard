BEGIN;

-- Running upgrade 0003_auth -> 0004_data_operations

CREATE TABLE data_operation_receipts (
    owner_id UUID NOT NULL,
    idempotency_key UUID NOT NULL,
    preview_id UUID NOT NULL,
    kind VARCHAR(16) NOT NULL,
    request_sha256 CHAR(64) NOT NULL,
    result_json JSONB NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_data_operation_receipts PRIMARY KEY (owner_id, idempotency_key),
    CONSTRAINT fk_data_operation_receipts_owner_id_owners FOREIGN KEY(owner_id) REFERENCES owners (id) ON DELETE RESTRICT,
    CONSTRAINT uq_data_operation_receipts_owner_preview UNIQUE (owner_id, preview_id),
    CONSTRAINT ck_data_operation_receipts_kind CHECK (kind IN ('import_replace','reset')),
    CONSTRAINT ck_data_operation_receipts_request_sha256 CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_data_operation_receipts_result CHECK (jsonb_typeof(result_json) = 'object' AND octet_length(result_json::text) <= 8192)
);

UPDATE alembic_version SET version_num='0004_data_operations' WHERE alembic_version.version_num = '0003_auth';

COMMIT;
