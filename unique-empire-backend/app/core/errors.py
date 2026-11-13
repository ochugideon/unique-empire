from typing import Any


class AppError(Exception):
    """Business or protocol error rendered as {"error": {code, message, details}}."""

    def __init__(self, status_code: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def not_found(what: str = "Record") -> AppError:
    return AppError(404, "NOT_FOUND", f"{what} was not found.")


def forbidden(message: str = "You do not have permission to do this.") -> AppError:
    return AppError(403, "FORBIDDEN", message)
