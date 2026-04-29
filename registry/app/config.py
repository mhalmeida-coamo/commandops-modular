from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_url: str = "postgresql://commandops:commandops@localhost:5432/commandops_registry"
    jwt_secret: str = "dev-secret-change-in-prod"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    class Config:
        env_file = ".env"


settings = Settings()
