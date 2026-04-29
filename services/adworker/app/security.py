from fastapi import Header, HTTPException, status

from .config import settings


def require_api_token(x_worker_token: str | None = Header(default=None)) -> None:
    expected = settings.api_token.strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AD worker token nao configurado",
        )
    if not x_worker_token or x_worker_token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token do worker invalido",
        )
