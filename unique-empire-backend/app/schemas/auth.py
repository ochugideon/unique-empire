import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field

from app.schemas.common import OrmModel

Role = Literal["OWNER", "MANAGER", "ATTENDANT"]


def _password_rules(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if len(value.encode("utf-8")) > 72:  # bcrypt input limit
        raise ValueError("Password is too long (72 bytes maximum).")
    return value


Password = Annotated[str, AfterValidator(_password_rules)]
Username = Annotated[
    str,
    BeforeValidator(lambda v: v.strip().lower() if isinstance(v, str) else v),
    Field(pattern=r"^[a-z0-9._-]{3,50}$"),
]


class LoginIn(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=200)


class UserOut(OrmModel):
    id: uuid.UUID
    username: str
    full_name: str
    role: Role
    is_active: bool
    created_at: datetime


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut
    device_id: uuid.UUID | None = None
    # Client must stop offline use after this moment (NFR-025).
    offline_authorization_expires_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    offline_authorization_expires_at: datetime


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: Password


class UserCreate(BaseModel):
    username: Username
    full_name: str = Field(min_length=2, max_length=120)
    password: Password
    role: Role


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    role: Role | None = None
    is_active: bool | None = None


class ResetPasswordIn(BaseModel):
    new_password: Password
