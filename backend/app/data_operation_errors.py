"""Static public errors; never include documents, tokens or driver messages."""


class DataOperationError(RuntimeError):
    def __init__(self, status_code: int, code: str, detail: str, headers=None):
        self.status_code, self.code, self.detail = status_code, code, detail
        self.headers = headers or {}
        super().__init__(code)


def unavailable():
    return DataOperationError(503, "DATA_OPERATIONS_UNAVAILABLE", "Data operations are unavailable")


def invalid_preview():
    return DataOperationError(403, "PREVIEW_INVALID", "Preview authorization is invalid")


def session_invalid():
    return DataOperationError(401, "AUTHENTICATION_REQUIRED", "Authentication required")
