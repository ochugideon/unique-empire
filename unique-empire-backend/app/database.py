import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, Numeric, Uuid, create_engine, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings
from app.core.types import UTCDateTime

JSONType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    # Every money column is NUMERIC(12,2); every timestamp is timezone-aware UTC.
    type_annotation_map = {
        datetime: UTCDateTime(),
        uuid.UUID: Uuid(as_uuid=True),
        Decimal: Numeric(12, 2),
        dict: JSONType,
        list: JSONType,
    }


def make_engine(url: str):
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    else:
        kwargs.update(pool_size=settings.db_pool_size, max_overflow=settings.db_max_overflow)
    return create_engine(url, **kwargs)


# Synchronous sessions with connection pooling (Architecture section 3).
engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def lock_row(db: Session, model, pk):
    """SELECT ... FOR UPDATE that also refreshes any stale in-memory copy."""
    stmt = (
        select(model)
        .where(model.id == pk)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return db.execute(stmt).scalar_one_or_none()
