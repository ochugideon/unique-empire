import os
import uuid

os.environ.update(
    DATABASE_URL="sqlite+pysqlite:///:memory:",
    SECRET_KEY="test-secret-key-that-is-long-enough-123456",
    BCRYPT_ROUNDS="4",
    COOKIE_SECURE="false",
    ENVIRONMENT="development",
    RESTORATION_LOG_PATH="/tmp/ue_test_restoration_log.jsonl",
)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import database, models
from app.core.ratelimit import limiter
from app.core.security import hash_password
from app.database import Base, get_db
from app.main import app

limiter.enabled = False


@pytest.fixture()
def db_engine():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    # Standard recipe so SAVEPOINT (begin_nested) behaves correctly with pysqlite.
    @event.listens_for(engine, "connect")
    def _connect(dbapi_connection, _):
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def session_factory(db_engine):
    factory = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)
    database.SessionLocal = factory  # technical-event writer uses this at call time
    return factory


@pytest.fixture()
def client(session_factory):
    def override():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def seed(session_factory):
    """One branch, an owner, a manager, an attendant and one registered device."""
    with session_factory() as db:
        branch = models.Branch(name="Uyo")
        db.add(branch)
        db.flush()
        users = {}
        for role in ("OWNER", "MANAGER", "ATTENDANT"):
            u = models.User(username=role.lower(), full_name=role.title(), password_hash=hash_password("Passw0rd!"), role=role)
            db.add(u)
            users[role] = u
        db.flush()
        device = models.Device(
            branch_id=branch.id, device_identifier="device-identifier-1", device_code="A1", name="Counter phone",
            registered_by=users["OWNER"].id,
        )
        db.add(device)
        db.commit()
        return {"branch": branch.id, "device": device.id, "users": {k: v.id for k, v in users.items()}}


def login(client, role):
    r = client.post("/api/v1/auth/login", json={"username": role.lower(), "password": "Passw0rd!"},
                    headers={"X-Device-Id": "device-identifier-1"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "X-Device-Id": "device-identifier-1"}


@pytest.fixture()
def owner(client, seed):
    return login(client, "OWNER")


@pytest.fixture()
def attendant(client, seed):
    return login(client, "ATTENDANT")


@pytest.fixture()
def catalogue(client, owner):
    cat = client.post("/api/v1/categories", json={"name": "Shawarma"}, headers=owner).json()
    product = client.post("/api/v1/products", headers=owner, json={
        "name": "Chicken Shawarma", "category_id": cat["id"],
        "variants": [{"name": "Regular", "price": "3000.00"}, {"name": "Large", "price": "4500.00"}],
    })
    assert product.status_code == 201, product.text
    return product.json()
