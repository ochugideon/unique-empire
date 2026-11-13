import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import OWNER_OR_MANAGER, Ctx, get_ctx
from app.core.errors import AppError, not_found
from app.database import get_db
from app.models import Category, Product, ProductVariant
from app.schemas.catalog import (
    CategoryIn, CategoryOut, CategoryUpdate, ProductIn, ProductOut, ProductUpdate, VariantIn, VariantOut, VariantUpdate,
)
from app.services.audit import write_audit

router = APIRouter(tags=["catalogue"])


def _dev(ctx: Ctx):
    return ctx.device.id if ctx.device else None


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(include_inactive: bool = Query(False), ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    query = select(Category).order_by(Category.name)
    if not (include_inactive and ctx.user.role in ("OWNER", "MANAGER")):
        query = query.where(Category.is_active.is_(True))
    return db.scalars(query).all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryIn, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    category = Category(name=body.name.strip())
    db.add(category)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "CATEGORY_EXISTS", "A category with that name already exists.")
    db.commit()
    return category


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: uuid.UUID, body: CategoryUpdate, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if category is None:
        raise not_found("Category")
    if body.name is not None:
        category.name = body.name.strip()
    if body.is_active is not None:
        category.is_active = body.is_active
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "CATEGORY_EXISTS", "A category with that name already exists.")
    return category


@router.get("/products", response_model=list[ProductOut])
def list_products(
    include_inactive: bool = Query(False),
    category_id: uuid.UUID | None = None,
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
):
    query = select(Product).order_by(Product.name)
    privileged = ctx.user.role in ("OWNER", "MANAGER")
    if not (include_inactive and privileged):
        query = query.where(Product.is_active.is_(True))
    if category_id:
        query = query.where(Product.category_id == category_id)
    products = [ProductOut.model_validate(p) for p in db.scalars(query).all()]
    if not (include_inactive and privileged):  # sales screens only see sellable variants
        for product in products:
            product.variants = [v for v in product.variants if v.is_active]
    return products


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(body: ProductIn, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    if db.get(Category, body.category_id) is None:
        raise not_found("Category")
    product = Product(name=body.name.strip(), category_id=body.category_id, description=body.description)
    product.variants = [ProductVariant(name=v.name.strip(), price=v.price) for v in body.variants]
    db.add(product)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "PRODUCT_EXISTS", "A product or variant with that name already exists.")
    write_audit(db, actor_id=ctx.user.id, device_id=_dev(ctx), action="PRODUCT_CREATED", entity_type="product",
                entity_id=product.id, after={"name": product.name, "variants": {v.name: v.price for v in product.variants}})
    db.commit()
    return product


@router.patch("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: uuid.UUID, body: ProductUpdate, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("Product")
    if body.category_id is not None:
        if db.get(Category, body.category_id) is None:
            raise not_found("Category")
        product.category_id = body.category_id
    if body.name is not None:
        product.name = body.name.strip()
    if body.description is not None:
        product.description = body.description
    if body.is_active is not None:  # products are deactivated, never deleted (FR-020/FR-023)
        product.is_active = body.is_active
    write_audit(db, actor_id=ctx.user.id, device_id=_dev(ctx), action="PRODUCT_UPDATED", entity_type="product",
                entity_id=product.id, after=body.model_dump(exclude_none=True, mode="json"))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "PRODUCT_EXISTS", "A product with that name already exists.")
    return product


@router.post("/products/{product_id}/variants", response_model=VariantOut, status_code=201)
def add_variant(product_id: uuid.UUID, body: VariantIn, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("Product")
    variant = ProductVariant(product_id=product.id, name=body.name.strip(), price=body.price)
    db.add(variant)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "VARIANT_EXISTS", "This product already has a variant with that name.")
    write_audit(db, actor_id=ctx.user.id, device_id=_dev(ctx), action="PRICE_SET", entity_type="variant",
                entity_id=variant.id, after={"product": product.name, "variant": variant.name, "price": variant.price})
    db.commit()
    return variant


@router.patch("/variants/{variant_id}", response_model=VariantOut)
def update_variant(variant_id: uuid.UUID, body: VariantUpdate, ctx: Ctx = Depends(OWNER_OR_MANAGER), db: Session = Depends(get_db)):
    variant = db.get(ProductVariant, variant_id)
    if variant is None:
        raise not_found("Variant")
    before = {"name": variant.name, "price": variant.price, "is_active": variant.is_active}
    if body.name is not None:
        variant.name = body.name.strip()
    if body.price is not None:  # historical sales keep their own price snapshot (FR-022)
        variant.price = body.price
    if body.is_active is not None:
        variant.is_active = body.is_active
    action = "PRICE_CHANGE" if body.price is not None and body.price != before["price"] else "VARIANT_UPDATED"
    write_audit(db, actor_id=ctx.user.id, device_id=_dev(ctx), action=action, entity_type="variant", entity_id=variant.id,
                before=before, after={"name": variant.name, "price": variant.price, "is_active": variant.is_active})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "VARIANT_EXISTS", "This product already has a variant with that name.")
    return variant
