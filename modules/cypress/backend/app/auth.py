import os
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-prod")
JWT_ALGORITHM = "HS256"

security = HTTPBearer()


class TokenUser(BaseModel):
    username: str
    role: str
    is_platform_admin: bool = False


def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> TokenUser:
    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )
        return TokenUser(
            username=payload["sub"],
            role=payload.get("role", "viewer"),
            is_platform_admin=payload.get("is_platform_admin", False),
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
