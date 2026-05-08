from __future__ import annotations

import logging
import os
import socket
from pathlib import Path
from time import perf_counter

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt

logger = logging.getLogger("cypress-module")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

APP_NAME = "cypress-module"
APP_VERSION = "1.0.0"
STARTED_AT = perf_counter()

JWT_SECRET = os.getenv("JWT_SECRET", "change-me")
JWT_ALGORITHM = "HS256"
SHELL_ORIGIN = os.getenv("SHELL_ORIGIN", "http://localhost:3000")

CYPRESS_MS_URL = os.getenv("CYPRESS_MS_URL", "http://commandops-cypress-ms:8080")
PROXY_TIMEOUT = float(os.getenv("CYPRESS_HTTP_TIMEOUT", "30"))

_STATIC_DIR = Path(__file__).parent / "static"


# ── JWT auth ──────────────────────────────────────────────────────────────────

def require_auth(authorization: str = Header(...)) -> None:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Unauthorized")
    token = authorization[7:]
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(401, f"Invalid token: {exc}") from exc


# ── Proxy helpers ─────────────────────────────────────────────────────────────

async def _proxy_to_ms(method: str, path: str, request: Request) -> Response:
    qs = request.url.query
    target = f"{CYPRESS_MS_URL}/{path}"
    if qs:
        target = f"{target}?{qs}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "authorization")}
    body = await request.body() if method in ("POST", "PUT", "PATCH") else None
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        try:
            resp = await client.request(method, target, headers=headers, content=body)
        except httpx.ConnectError:
            raise HTTPException(503, "cypress-ms indisponível")
        except httpx.TimeoutException:
            raise HTTPException(504, "cypress-ms timeout")
    ct = resp.headers.get("content-type", "application/json")
    return Response(content=resp.content, status_code=resp.status_code, media_type=ct)


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title=APP_NAME, version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[SHELL_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": APP_NAME,
        "version": APP_VERSION,
        "hostname": socket.gethostname(),
        "uptime_seconds": round(perf_counter() - STARTED_AT, 2),
        "cypress_ms_url": CYPRESS_MS_URL,
    }


# ── Proxy — forward all /api/cypress/v1/* to the cypress microservice ─────────

@app.api_route(
    "/api/cypress/v1/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    dependencies=[Depends(require_auth)],
)
async def proxy_cypress_v1(path: str, request: Request):
    return await _proxy_to_ms(request.method, f"v1/{path}", request)


# ── Static files (must be last) ───────────────────────────────────────────────

if _STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")
