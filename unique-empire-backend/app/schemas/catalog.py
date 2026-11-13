import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import NonNegMoney, Money, OrmModel


class CategoryIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    is_active: bool | None = None


class CategoryOut(OrmModel):
    id: uuid.UUID
    name: str
    is_active: bool


class VariantIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    price: NonNegMoney


class VariantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    price: NonNegMoney | None = None
    is_active: bool | None = None


class VariantOut(OrmModel):
    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    price: Money
    is_active: bool


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    category_id: uuid.UUID
    description: str | None = Field(default=None, max_length=2000)
    variants: list[VariantIn] = Field(min_length=1)


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    category_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None


class ProductOut(OrmModel):
    id: uuid.UUID
    category_id: uuid.UUID
    name: str
    description: str | None
    is_active: bool
    created_at: datetime
    variants: list[VariantOut]
