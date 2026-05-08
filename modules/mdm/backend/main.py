from __future__ import annotations

import asyncio
import json
import logging
import os
import smtplib
import socket
import sqlite3
import time as _time
from contextlib import asynccontextmanager
from email.mime.text import MIMEText
from pathlib import Path
from time import perf_counter

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt

logger = logging.getLogger("mdm-module")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

APP_NAME = "mdm-module"
APP_VERSION = "1.0.0"
STARTED_AT = perf_counter()

JWT_SECRET = os.getenv("JWT_SECRET", "change-me")
JWT_ALGORITHM = "HS256"

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
SETTINGS_FILE = DATA_DIR / "mdm_settings.json"
DB_FILE = DATA_DIR / "mdm_history.db"
SHELL_ORIGIN = os.getenv("SHELL_ORIGIN", "http://localhost:3000")

SMTP_HOST = os.getenv("SMTP_HOST", "mail.coamo.com.br")
SMTP_PORT = int(os.getenv("SMTP_PORT", "25"))
SMTP_FROM = os.getenv("SMTP_FROM", "naoresponder@coamo.com.br")

MDM_HTTP_TIMEOUT = float(os.getenv("MDM_HTTP_TIMEOUT", "15"))
MDM_TOKEN_REFRESH_MINUTES = int(os.getenv("MDM_TOKEN_REFRESH_MINUTES", "30"))

_SENSITIVE_KEYS = {"password", "clientSecret"}
_MASK_PREFIX = "__MASKED__:"

_DEFAULT_SETTINGS: dict = {
    "baseUrl": os.getenv("MDM_BASE_URL", "https://coamo.mdmcloud.com.br"),
    "username": os.getenv("MDM_USERNAME", ""),
    "password": os.getenv("MDM_PASSWORD", ""),
    "clientId": os.getenv("MDM_CLIENT_ID", ""),
    "clientSecret": os.getenv("MDM_CLIENT_SECRET", ""),
    "licenseLimit": int(os.getenv("MDM_LICENSE_LIMIT", "15")),
    "alertRecipients": os.getenv("MDM_ALERT_RECIPIENTS", ""),
    "emailSubject": "",
    "alertEnabled": True,
    "alertCronHour": int(os.getenv("MDM_ALERT_CRON_HOUR", "11")),
    "alertCronMinute": int(os.getenv("MDM_ALERT_CRON_MINUTE", "0")),
    "alertTimezone": os.getenv("TZ", "America/Sao_Paulo"),
}


# ── Persistence helpers ──────────────────────────────────────────────────────

def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_settings() -> dict:
    try:
        if SETTINGS_FILE.exists():
            return {**_DEFAULT_SETTINGS, **json.loads(SETTINGS_FILE.read_text())}
    except Exception as exc:
        logger.warning("Failed to read settings file: %s", exc)
    return dict(_DEFAULT_SETTINGS)


def _save_settings(cfg: dict) -> None:
    _ensure_data_dir()
    SETTINGS_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))


def _mask_settings(cfg: dict) -> dict:
    out = dict(cfg)
    for k in _SENSITIVE_KEYS:
        v = out.get(k, "")
        if v:
            out[k] = f"{_MASK_PREFIX}{v[:4]}"
    return out


def _merge_settings(existing: dict, incoming: dict) -> dict:
    merged = dict(existing)
    for k, v in incoming.items():
        if k in _SENSITIVE_KEYS:
            if v and not str(v).startswith(_MASK_PREFIX):
                merged[k] = v
        else:
            if v is not None:
                merged[k] = v
    return merged


def _init_db() -> None:
    _ensure_data_dir()
    con = sqlite3.connect(str(DB_FILE))
    con.execute("""
        CREATE TABLE IF NOT EXISTS mdm_license_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            purchased INTEGER NOT NULL,
            used INTEGER NOT NULL,
            available INTEGER NOT NULL
        )
    """)
    con.commit()
    con.close()


def _save_history(purchased: int, used: int, available: int) -> None:
    try:
        con = sqlite3.connect(str(DB_FILE))
        con.execute(
            "INSERT INTO mdm_license_history (purchased, used, available) VALUES (?, ?, ?)",
            (purchased, used, available),
        )
        con.commit()
        con.close()
        logger.info("[history] Saved: purchased=%s used=%s available=%s", purchased, used, available)
    except Exception as exc:
        logger.error("[history] Failed to save: %s", exc)


def _load_history(start_date: str | None = None, end_date: str | None = None) -> list[dict]:
    try:
        con = sqlite3.connect(str(DB_FILE))
        con.row_factory = sqlite3.Row
        if start_date and end_date:
            rows = con.execute(
                "SELECT * FROM mdm_license_history WHERE DATE(collected_at) BETWEEN ? AND ? ORDER BY collected_at",
                (start_date, end_date),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM mdm_license_history ORDER BY collected_at"
            ).fetchall()
        con.close()
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.error("[history] Failed to load: %s", exc)
        return []


# ── JWT auth ─────────────────────────────────────────────────────────────────

def require_auth(authorization: str = Header(...)) -> None:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Unauthorized")
    token = authorization[7:]
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(401, f"Invalid token: {exc}") from exc


# ── MDM API helpers ───────────────────────────────────────────────────────────

_access_token: str | None = None
_token_lock = asyncio.Lock()


async def _fetch_token() -> str:
    cfg = _load_settings()
    base_url = str(cfg.get("baseUrl") or "").strip().rstrip("/")
    username = str(cfg.get("username") or "").strip()
    password = str(cfg.get("password") or "").strip()
    client_id = str(cfg.get("clientId") or "").strip()
    client_secret = str(cfg.get("clientSecret") or "").strip()

    if not (username and password and client_id and client_secret):
        raise HTTPException(503, "MDM credentials are not configured")

    token_url = f"{base_url}/MobiControl/api/token"
    payload = {
        "grant_type": "password",
        "username": username,
        "password": password,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    async with httpx.AsyncClient(timeout=MDM_HTTP_TIMEOUT) as client:
        try:
            resp = await client.post(token_url, data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"})
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"MDM token error: {exc}") from exc
    token = resp.json().get("access_token")
    if not token:
        raise HTTPException(502, "MDM token response missing access_token")
    return token


async def _ensure_token(force_refresh: bool = False) -> str:
    global _access_token
    async with _token_lock:
        if force_refresh or not _access_token:
            _access_token = await _fetch_token()
            logger.info("MDM access token refreshed")
        return _access_token


async def _fetch_license() -> dict:
    cfg = _load_settings()
    base_url = str(cfg.get("baseUrl") or "").strip().rstrip("/")
    token = await _ensure_token()
    headers = {"Authorization": f"Bearer {token}", "Accept": "text/json"}
    async with httpx.AsyncClient(timeout=MDM_HTTP_TIMEOUT) as client:
        resp = await client.get(f"{base_url}/MobiControl/api/license", headers=headers)
        if resp.status_code == 401:
            token = await _ensure_token(force_refresh=True)
            headers["Authorization"] = f"Bearer {token}"
            resp = await client.get(f"{base_url}/MobiControl/api/license", headers=headers)
        try:
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"MDM license error: {exc}") from exc
    return resp.json()


async def _fetch_device_groups() -> list:
    cfg = _load_settings()
    base_url = str(cfg.get("baseUrl") or "").strip().rstrip("/")
    token = await _ensure_token()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=MDM_HTTP_TIMEOUT) as client:
        resp = await client.get(
            f"{base_url}/MobiControl/api/devicegroups",
            headers=headers,
            params={"skip": 0, "take": 500},
        )
        if resp.status_code == 401:
            token = await _ensure_token(force_refresh=True)
            headers["Authorization"] = f"Bearer {token}"
            resp = await client.get(
                f"{base_url}/MobiControl/api/devicegroups",
                headers=headers,
                params={"skip": 0, "take": 500},
            )
        try:
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"MDM device groups error: {exc}") from exc
    raw = resp.json()
    if isinstance(raw, list):
        return raw
    return raw.get("Items") or raw.get("items") or []


_device_counts_cache: dict[str, int] = {}
_device_counts_ts: float = 0.0
_device_counts_lock = asyncio.Lock()
_DEVICE_COUNTS_TTL = 300


async def _build_group_device_counts() -> dict[str, int]:
    global _device_counts_cache, _device_counts_ts
    async with _device_counts_lock:
        now = _time.monotonic()
        if _device_counts_cache and (now - _device_counts_ts) < _DEVICE_COUNTS_TTL:
            return dict(_device_counts_cache)

        cfg = _load_settings()
        base_url = str(cfg.get("baseUrl") or "").strip().rstrip("/")
        token = await _ensure_token()
        headers = {"Authorization": f"Bearer {token}"}
        counts: dict[str, int] = {}
        skip = 0
        take = 2000
        devices: list = []

        async with httpx.AsyncClient(timeout=60) as client:
            while True:
                resp = await client.get(
                    f"{base_url}/MobiControl/api/devices",
                    headers=headers,
                    params={"skip": skip, "take": take},
                )
                if resp.status_code == 401:
                    token = await _ensure_token(force_refresh=True)
                    headers["Authorization"] = f"Bearer {token}"
                    resp = await client.get(
                        f"{base_url}/MobiControl/api/devices",
                        headers=headers,
                        params={"skip": skip, "take": take},
                    )
                try:
                    resp.raise_for_status()
                except httpx.HTTPError as exc:
                    logger.error("[groups] Failed to fetch devices: %s", exc)
                    break
                devices = resp.json()
                if not isinstance(devices, list) or not devices:
                    break
                for d in devices:
                    path = str(d.get("Path") or "")
                    if not path:
                        continue
                    parts = [p for p in path.split("\\") if p]
                    for depth in range(1, len(parts) + 1):
                        ancestor = "\\\\" + "\\".join(parts[:depth])
                        counts[ancestor] = counts.get(ancestor, 0) + 1
                if len(devices) < take:
                    break
                skip += take

        _device_counts_cache = counts
        _device_counts_ts = now
        return dict(counts)


# ── Alert / cron ─────────────────────────────────────────────────────────────

def _parse_recipients(raw: str) -> list[str]:
    return [a.strip() for a in (raw or "").split(",") if a.strip()]


def _send_email(recipients: list[str], subject: str, body: str) -> None:
    if not recipients:
        logger.warning("Email skipped: no recipients configured")
        return
    msg = MIMEText(body, "plain", "utf-8")
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.sendmail(SMTP_FROM, recipients, msg.as_string())
        logger.info("Email sent to %s", recipients)
    except Exception as exc:
        logger.error("Failed to send email: %s", exc)
        raise


async def _daily_license_check() -> None:
    try:
        logger.info("[cron] Starting daily MDM license collection…")
        cfg = _load_settings()
        limit = int(cfg.get("licenseLimit") or 15)
        recipients = _parse_recipients(str(cfg.get("alertRecipients") or ""))
        subject = str(cfg.get("emailSubject") or "ALERTA – Licenças MDM abaixo do limite").strip()
        data = await _fetch_license()
        total = int(data.get("PurchasedLicenses") or 0)
        used = int((data.get("UsedLicenses") or {}).get("Android") or 0)
        available = total - used
        logger.info("[cron] Licenses available: %s (limit=%s)", available, limit)
        _save_history(total, used, available)
        alert_active = str(cfg.get("alertEnabled", True)).lower() in ("1", "true", "yes", "on")
        if alert_active and available < limit:
            body = (
                "ATENÇÃO!\n\n"
                "A quantidade de licenças disponíveis do Mobicontrol está abaixo do limite configurado.\n\n"
                f"Licenças compradas : {total}\n"
                f"Licenças utilizadas: {used}\n"
                f"Licenças disponíveis: {available}\n\n"
                "Favor verificar a necessidade de aquisição de novas licenças.\n\n"
                "Mensagem automática do sistema.\n"
            )
            _send_email(recipients, subject, body)
    except Exception as exc:
        logger.error("[cron] Error in daily check: %s", exc)


async def _token_refresh_loop() -> None:
    while True:
        try:
            await asyncio.sleep(MDM_TOKEN_REFRESH_MINUTES * 60)
            await _ensure_token(force_refresh=True)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Token refresh loop error: %s", exc)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    cfg = _load_settings()
    cron_hour = int(cfg.get("alertCronHour") or 11)
    cron_minute = int(cfg.get("alertCronMinute") or 0)
    cron_tz = str(cfg.get("alertTimezone") or "America/Sao_Paulo")
    scheduler = AsyncIOScheduler(timezone=cron_tz)
    scheduler.add_job(
        _daily_license_check,
        CronTrigger(hour=cron_hour, minute=cron_minute, timezone=cron_tz),
        id="mdm-daily-check",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Daily MDM collection scheduled at %02d:%02d %s", cron_hour, cron_minute, cron_tz)
    refresh_task = asyncio.create_task(_token_refresh_loop())
    try:
        yield
    finally:
        refresh_task.cancel()
        if scheduler.running:
            scheduler.shutdown(wait=False)


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[SHELL_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    cfg = _load_settings()
    configured = bool(cfg.get("username") and cfg.get("clientId"))
    return {
        "status": "ok",
        "service": APP_NAME,
        "version": APP_VERSION,
        "hostname": socket.gethostname(),
        "uptime_seconds": round(perf_counter() - STARTED_AT, 2),
        "mdm_configured": configured,
    }


@app.get("/api/mdm/license", dependencies=[Depends(require_auth)])
async def get_license():
    cfg = _load_settings()
    limit = int(cfg.get("licenseLimit") or 15)
    data = await _fetch_license()
    total = int(data.get("PurchasedLicenses") or 0)
    used = int((data.get("UsedLicenses") or {}).get("Android") or 0)
    return {
        "raw": data,
        "summary": {
            "purchased": total,
            "used_android": used,
            "available": total - used,
            "limit": limit,
            "below_limit": (total - used) < limit,
        },
    }


@app.get("/api/mdm/license/history", dependencies=[Depends(require_auth)])
def get_history(start_date: str | None = None, end_date: str | None = None):
    return _load_history(start_date, end_date)


@app.post("/api/mdm/license/check-alert", dependencies=[Depends(require_auth)])
async def trigger_check():
    await _daily_license_check()
    return {"status": "ok", "message": "License check executed"}


@app.get("/api/mdm/devicegroups", dependencies=[Depends(require_auth)])
async def get_device_groups():
    groups = await _fetch_device_groups()
    return groups


@app.get("/api/mdm/groups/device-count", dependencies=[Depends(require_auth)])
async def get_group_device_count(group_path: str):
    counts = await _build_group_device_counts()
    return {"count": counts.get(group_path, 0)}


@app.post("/api/mdm/test-email", dependencies=[Depends(require_auth)])
async def test_email():
    cfg = _load_settings()
    recipients = _parse_recipients(str(cfg.get("alertRecipients") or ""))
    subject = str(cfg.get("emailSubject") or "ALERTA – Licenças MDM abaixo do limite").strip()
    if not recipients:
        raise HTTPException(400, "Nenhum destinatário configurado para o alerta")
    try:
        data = await _fetch_license()
        total = int(data.get("PurchasedLicenses") or 0)
        used = int((data.get("UsedLicenses") or {}).get("Android") or 0)
        available = total - used
    except Exception:
        total = used = available = 0
    body = (
        "E-MAIL DE TESTE — ALERTA MDM\n\n"
        "Esta é uma mensagem de teste enviada manualmente pelo painel administrativo.\n\n"
        f"Licenças disponíveis no momento: {available}\n"
        f"Licenças usadas: {used}\n"
        f"Licenças compradas: {total}\n\n"
        "Mensagem automática do sistema.\n"
    )
    try:
        _send_email(recipients, f"[TESTE] {subject}", body)
    except Exception as exc:
        raise HTTPException(502, f"Falha ao enviar e-mail de teste: {exc}") from exc
    return {"status": "ok", "message": f"E-mail de teste enviado para {', '.join(recipients)}"}


@app.get("/api/mdm/settings", dependencies=[Depends(require_auth)])
def get_settings():
    cfg = _load_settings()
    return _mask_settings(cfg)


@app.post("/api/mdm/settings", dependencies=[Depends(require_auth)])
async def save_settings(body: dict):
    existing = _load_settings()
    merged = _merge_settings(existing, body)
    _save_settings(merged)
    global _access_token
    _access_token = None
    return {"status": "ok"}


# ── Static files (must be last) ───────────────────────────────────────────────

_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")
