from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings

# Behind Caddy, run uvicorn with --proxy-headers so the client IP is the real one.
limiter = Limiter(key_func=get_remote_address, default_limits=[settings.default_rate_limit])
