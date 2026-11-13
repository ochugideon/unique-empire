"""Create the seeded branch and the first owner account (idempotent).

    python -m scripts.seed --username owner --full-name "Business Owner"
The password is read from UE_OWNER_PASSWORD or prompted for.
"""
import argparse
import getpass
import os
import sys

from sqlalchemy import select

from app.config import settings
from app.core.security import hash_password
from app.database import SessionLocal
from app.models import Branch, Category, User
from app.schemas.auth import _password_rules


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", default="owner")
    parser.add_argument("--full-name", default="Business Owner")
    parser.add_argument("--with-categories", action="store_true", help="also create starter product categories")
    args = parser.parse_args()

    with SessionLocal() as db:
        if db.scalar(select(Branch).where(Branch.name == settings.initial_branch_name)) is None:
            db.add(Branch(name=settings.initial_branch_name))
            print(f"Created branch {settings.initial_branch_name}")
        if db.scalar(select(User).where(User.role == "OWNER")) is None:
            password = os.environ.get("UE_OWNER_PASSWORD") or getpass.getpass("Owner password: ")
            try:
                _password_rules(password)
            except ValueError as exc:
                print(f"Invalid password: {exc}")
                return 1
            db.add(User(username=args.username.lower(), full_name=args.full_name, password_hash=hash_password(password), role="OWNER"))
            print(f"Created owner account '{args.username.lower()}'")
        if args.with_categories:
            for name in ("Shawarma", "Milkshakes", "Smoothies", "Parfait", "Popcorn"):
                if db.scalar(select(Category).where(Category.name == name)) is None:
                    db.add(Category(name=name))
        db.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
