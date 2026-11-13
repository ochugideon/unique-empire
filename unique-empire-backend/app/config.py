from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+psycopg2://ue:ue_password@db:5432/unique_empire"
    db_pool_size: int = 5
    db_max_overflow: int = 5

    secret_key: str = "change-me"
    jwt_algorithm: str = "HS256"
    bcrypt_rounds: int = 12

    access_token_minutes: int = 15
    refresh_token_days: int = 7
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    inactivity_minutes: int = 15
    offline_authorization_days: int = 7
    cookie_secure: bool = True

    device_stale_hours: int = 12
    business_timezone: str = "Africa/Lagos"
    currency_code: str = "NGN"
    initial_branch_name: str = "Uyo"

    cors_origins: list[str] = []
    login_rate_limit: str = "10/minute"
    default_rate_limit: str = "120/minute"

    restoration_log_path: str = "/backup/restoration_log.jsonl"
    sentry_dsn: str | None = None

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
