import logging

# import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import api_router
from app.config import settings
from app.core.errors import AppError
from app.core.ratelimit import limiter
from app.services.technical import record_technical_event

logging.basicConfig(level=logging.INFO, format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}')
logger = logging.getLogger("unique_empire")


def _scrub_sentry(event, hint):
    request = event.get("request", {})
    request.pop("data", None)
    request.pop("cookies", None)
    request["headers"] = {k: v for k, v in (request.get("headers") or {}).items() if k.lower() not in ("authorization", "cookie")}
    return event


def create_app() -> FastAPI:
    if settings.is_production and (settings.secret_key == "change-me" or len(settings.secret_key) < 32):
        raise RuntimeError("SECRET_KEY must be a random string of at least 32 characters in production.")
    # if settings.sentry_dsn:
    #     sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.environment, send_default_pii=False,
    #                     traces_sample_rate=0.0, before_send=_scrub_sentry)

    docs = not settings.is_production  # Swagger/ReDoc: development and staging only
    app = FastAPI(
        title="Unique Empire API", version="1.1.0",
        docs_url="/api/docs" if docs else None, redoc_url="/api/redoc" if docs else None,
        openapi_url="/api/openapi.json" if docs else None,
    )
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-Device-Id", "X-Requested-With"],
        )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/docs"):
            response.headers.setdefault("Cache-Control", "no-store")  # private data must not be cached
        return response

    def error_body(code: str, message: str, details=None) -> dict:
        return {"error": {"code": code, "message": message, "details": details}}

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, content=error_body(exc.code, exc.message, exc.details))

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        details = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content=error_body("VALIDATION_ERROR", "Some details are missing or invalid.", details))

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code, content=error_body("HTTP_ERROR", str(exc.detail)))

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
        return JSONResponse(status_code=429, content=error_body("RATE_LIMITED", "Too many requests. Please wait a moment and try again."))

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception):
        logger.exception("unhandled error on %s", request.url.path)
        record_technical_event("ERROR", "APPLICATION", "Unexpected application error",
                               {"path": request.url.path, "method": request.method, "error": type(exc).__name__})
        # Staff see a plain message, never diagnostics (FR-148).
        return JSONResponse(status_code=500, content=error_body("INTERNAL_ERROR", "Something went wrong. Please try again."))

    @app.get("/api/health", tags=["health"])
    def health():
        from app import database
        try:
            with database.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            record_technical_event("CRITICAL", "DATABASE", "Health check could not reach the database")
            return JSONResponse(status_code=503, content={"status": "database_unavailable"})
        return {"status": "ok"}

    app.include_router(api_router)
    return app


app = create_app()
