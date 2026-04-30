"""Fetches module settings from the Registry with a short TTL cache."""
import os
import time
import httpx

REGISTRY_URL = os.environ.get("REGISTRY_URL", "").strip().rstrip("/")
SERVICE_SECRET = os.environ.get("SERVICE_SECRET", "").strip()
_CACHE_TTL = 60.0

_cache: dict[str, str] = {}
_cache_ts: float = 0.0


async def get_cypress_settings() -> dict[str, str]:
    global _cache, _cache_ts
    now = time.monotonic()

    if _cache and (now - _cache_ts) < _CACHE_TTL:
        return _cache

    if not REGISTRY_URL or not SERVICE_SECRET:
        return _cache

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(
                f"{REGISTRY_URL}/modules/cypress/settings/service",
                headers={"X-Service-Secret": SERVICE_SECRET},
            )
            if res.is_success:
                _cache = {item["key"]: item["value"] for item in res.json()}
                _cache_ts = now
    except Exception:
        pass

    return _cache
