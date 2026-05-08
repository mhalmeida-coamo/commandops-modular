from __future__ import annotations

import json
import logging
import os
import socket
from pathlib import Path
from time import perf_counter

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt

logger = logging.getLogger("userlock-module")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

APP_NAME = "userlock-module"
APP_VERSION = "1.0.0"
STARTED_AT = perf_counter()

JWT_SECRET = os.getenv("JWT_SECRET", "change-me")
JWT_ALGORITHM = "HS256"
SHELL_ORIGIN = os.getenv("SHELL_ORIGIN", "http://localhost:3000")

USERLOCK_MS_URL = os.getenv("USERLOCK_MS_URL", "http://commandops-userlock-ms:8120")
PROXY_TIMEOUT = float(os.getenv("USERLOCK_HTTP_TIMEOUT", "30"))

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
SETTINGS_FILE = DATA_DIR / "userlock_settings.json"

_SENSITIVE_KEYS = {"bindPassword", "winrmPassword", "clientSecret"}
_MASK_PREFIX = "__MASKED__:"

_DEFAULT_SETTINGS: dict = {
    "retentionDays": 90,
    "pollIntervalSec": 60,
    "lookbackWindowSec": 3600,
    "alertThreshold": 5,
    "ad": {
        "enabled": False,
        "host": "",
        "port": 389,
        "baseDn": "",
        "bindDn": "",
        "bindPassword": "",
        "useTls": False,
        "timeoutSec": 10,
    },
    "radius": {
        "enabled": False,
        "host": "",
        "winrmPort": 5985,
        "winrmUser": "",
        "winrmPassword": "",
        "winrmUseTls": False,
        "logName": "Microsoft-Windows-NetworkPolicyServer/Operational",
    },
    "kerberos": {
        "enabled": False,
        "host": "",
        "winrmPort": 5985,
        "winrmUser": "",
        "winrmPassword": "",
        "winrmUseTls": False,
        "logName": "Security",
    },
    "entra": {
        "enabled": False,
        "tenantId": "",
        "clientId": "",
        "clientSecret": "",
        "scopes": "https://graph.microsoft.com/.default",
    },
}


# ── Settings ──────────────────────────────────────────────────────────────────

def _load_settings() -> dict:
    try:
        if SETTINGS_FILE.exists():
            return json.loads(SETTINGS_FILE.read_text())
    except Exception as exc:
        logger.warning("Failed to read settings: %s", exc)
    return dict(_DEFAULT_SETTINGS)


def _save_settings(cfg: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))


def _mask_settings(cfg: dict) -> dict:
    def _mask(obj: dict) -> dict:
        out = {}
        for k, v in obj.items():
            if isinstance(v, dict):
                out[k] = _mask(v)
            elif k in _SENSITIVE_KEYS and v:
                out[k] = f"{_MASK_PREFIX}{str(v)[:4]}"
            else:
                out[k] = v
        return out
    return _mask(cfg)


def _merge_settings(existing: dict, incoming: dict) -> dict:
    def _merge(base: dict, new: dict) -> dict:
        merged = dict(base)
        for k, v in new.items():
            if isinstance(v, dict) and isinstance(merged.get(k), dict):
                merged[k] = _merge(merged[k], v)
            elif k in _SENSITIVE_KEYS:
                if v and not str(v).startswith(_MASK_PREFIX):
                    merged[k] = v
            elif v is not None:
                merged[k] = v
        return merged
    return _merge(existing, incoming)


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
    target = f"{USERLOCK_MS_URL}/{path}"
    if qs:
        target = f"{target}?{qs}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "authorization")}
    body = await request.body() if method in ("POST", "PUT", "PATCH") else None
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        try:
            resp = await client.request(method, target, headers=headers, content=body)
        except httpx.ConnectError:
            raise HTTPException(503, "userlock-ms indisponível")
        except httpx.TimeoutException:
            raise HTTPException(504, "userlock-ms timeout")
    ct = resp.headers.get("content-type", "application/json")
    return Response(content=resp.content, status_code=resp.status_code, media_type=ct)


async def _push_config_to_ms(cfg: dict) -> None:
    ad = cfg.get("ad", {})
    rad = cfg.get("radius", {})
    krb = cfg.get("kerberos", {})
    ent = cfg.get("entra", {})
    payload = {
        "retention_days": cfg.get("retentionDays", 90),
        "poll_interval_sec": cfg.get("pollIntervalSec", 60),
        "lookback_window_sec": cfg.get("lookbackWindowSec", 3600),
        "alert_threshold": cfg.get("alertThreshold", 5),
        "ad": {
            "enabled": ad.get("enabled", False),
            "host": ad.get("host", ""),
            "port": ad.get("port", 389),
            "base_dn": ad.get("baseDn", ""),
            "bind_dn": ad.get("bindDn", ""),
            "bind_password": ad.get("bindPassword", ""),
            "use_tls": ad.get("useTls", False),
            "timeout_sec": ad.get("timeoutSec", 10),
        },
        "radius": {
            "enabled": rad.get("enabled", False),
            "host": rad.get("host", ""),
            "winrm_port": rad.get("winrmPort", 5985),
            "winrm_user": rad.get("winrmUser", ""),
            "winrm_password": rad.get("winrmPassword", ""),
            "winrm_tls": rad.get("winrmUseTls", False),
            "log_name": rad.get("logName", "Microsoft-Windows-NetworkPolicyServer/Operational"),
        },
        "kerberos": {
            "enabled": krb.get("enabled", False),
            "host": krb.get("host", ""),
            "winrm_port": krb.get("winrmPort", 5985),
            "winrm_user": krb.get("winrmUser", ""),
            "winrm_password": krb.get("winrmPassword", ""),
            "winrm_tls": krb.get("winrmUseTls", False),
            "log_name": krb.get("logName", "Security"),
        },
        "entra": {
            "enabled": False,
            "tenant_id": ent.get("tenantId", ""),
            "client_id": ent.get("clientId", ""),
            "client_secret": ent.get("clientSecret", ""),
            "scopes": ent.get("scopes", "https://graph.microsoft.com/.default"),
        },
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            await client.post(f"{USERLOCK_MS_URL}/v1/config/reload", json=payload)
            logger.info("Config pushed to userlock-ms")
        except Exception as exc:
            logger.warning("Config push failed: %s", exc)


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
        "userlock_ms_url": USERLOCK_MS_URL,
    }


# ── Settings endpoints ────────────────────────────────────────────────────────

@app.get("/api/userlock/settings", dependencies=[Depends(require_auth)])
def get_settings():
    return _mask_settings(_load_settings())


@app.post("/api/userlock/settings", dependencies=[Depends(require_auth)])
async def save_settings(body: dict):
    existing = _load_settings()
    merged = _merge_settings(existing, body)
    _save_settings(merged)
    await _push_config_to_ms(merged)
    return {"status": "ok"}


# ── Proxy — forward all /api/userlock/v1/* to the C microservice ──────────────

@app.api_route(
    "/api/userlock/v1/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    dependencies=[Depends(require_auth)],
)
async def proxy_userlock(path: str, request: Request):
    return await _proxy_to_ms(request.method, f"v1/{path}", request)


# ── Static files (must be last) ───────────────────────────────────────────────

_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")
