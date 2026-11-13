from fastapi import APIRouter

from app.api.v1 import admin, auth, business_days, devices, expenses, products, reports, sales, sync, users

api_router = APIRouter(prefix="/api/v1")
for module in (auth, users, devices, products, business_days, sales, expenses, sync, reports, admin):
    api_router.include_router(module.router)
