from typing import Any

from fastapi import HTTPException, status


class ApiError(HTTPException):
    def __init__(self, status_code: int, detail: str, **extra: Any) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.extra = extra


class AuthenticationError(ApiError):
    def __init__(self, detail: str = "authentication required") -> None:
        super().__init__(status.HTTP_401_UNAUTHORIZED, detail)


class PermissionDeniedError(ApiError):
    def __init__(self, detail: str = "not permitted") -> None:
        super().__init__(status.HTTP_403_FORBIDDEN, detail)


class NotFoundError(ApiError):
    def __init__(self, detail: str = "not found") -> None:
        super().__init__(status.HTTP_404_NOT_FOUND, detail)


class ConflictError(ApiError):
    """CAS failure or a duplicate that the client has to reconcile."""

    def __init__(self, detail: str, **extra: Any) -> None:
        super().__init__(status.HTTP_409_CONFLICT, detail, **extra)


class UnprocessableError(ApiError):
    def __init__(self, detail: str) -> None:
        super().__init__(422, detail)


class RateLimitError(ApiError):
    def __init__(self, detail: str = "too many requests") -> None:
        super().__init__(status.HTTP_429_TOO_MANY_REQUESTS, detail)
