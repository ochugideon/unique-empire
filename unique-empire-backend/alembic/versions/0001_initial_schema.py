"""Initial schema: the 16 tables of Architecture v1.1 + audit-log immutability trigger.

Revision ID: 0001
Revises:
"""
from alembic import op

from app import models  # noqa: F401
from app.database import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

AUDIT_GUARD = """
CREATE OR REPLACE FUNCTION ue_block_audit_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_delete
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION ue_block_audit_mutation();
"""


def upgrade() -> None:
    bind = op.get_bind()
    # Baseline: created from the models. For later changes use `alembic revision --autogenerate`
    # so each migration is a frozen, reviewable diff.
    Base.metadata.create_all(bind=bind)
    if bind.dialect.name == "postgresql":
        op.execute(AUDIT_GUARD)  # NFR-009: audit records cannot be modified or deleted, even by the app


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS audit_logs_no_update_delete ON audit_logs")
        op.execute("DROP FUNCTION IF EXISTS ue_block_audit_mutation()")
    Base.metadata.drop_all(bind=bind)
