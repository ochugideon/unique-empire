import hashlib
import secrets
from datetime import timedelta
from uuid import UUID

import bcrypt
import jwt

from app.config import settings
from app.core.errors import AppError
from app.core.timeutil import utcnow


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=settings.bcrypt_rounds)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


# Used to keep login timing similar when the username does not exist.
DUMMY_HASH = hash_password("not-a-real-password")


def create_access_token(user_id: UUID, session_id: UUID) -> str:
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "typ": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        data = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise AppError(401, "TOKEN_EXPIRED", "Your session has expired. Please sign in again.")
    except jwt.PyJWTError:
        raise AppError(401, "TOKEN_INVALID", "Invalid authentication token.")
    if data.get("typ") != "access":
        raise AppError(401, "TOKEN_INVALID", "Invalid authentication token.")
    return data


def new_refresh_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(48)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
