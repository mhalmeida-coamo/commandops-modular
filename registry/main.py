"""
CommandOps Module Registry — Phase 1

Descobre containers Docker com label commandops.module=true
e expõe GET /modules com health em tempo real.
Roda como serviço independente sem tocar no projeto original.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

import docker  # type: ignore
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("registry")

app = FastAPI(
    title="CommandOps Module Registry",
    version="0.1.0",
    description="Descobre e monitora módulos CommandOps via Docker labels",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)

LABEL_PREFIX   = "commandops.module"
POLL_INTERVAL  = int(os.getenv("POLL_INTERVAL", "30"))

# Estado global
_modules_cache: list[dict[str, Any]] = []
_last_poll_at: float = 0.0
_poll_errors:  int   = 0


# ---------------------------------------------------------------------------
# Helpers de descoberta
# ---------------------------------------------------------------------------

def _container_health(container: Any) -> str:
    try:
        status = (container.status or "").lower()
        if status != "running":
            return "danger"
        health_info = container.attrs.get("State", {}).get("Health", {})
        if not health_info:
            # Container sem healthcheck configurado — considera saudável se running
            return "healthy"
        docker_health = (health_info.get("Status") or "").lower()
        mapping = {
            "healthy":   "healthy",
            "unhealthy": "danger",
            "starting":  "warning",
            "none":      "healthy",
        }
        return mapping.get(docker_health, "warning")
    except Exception:
        return "warning"


def _discover() -> list[dict[str, Any]]:
    global _poll_errors

    try:
        client = docker.from_env(timeout=5)
    except Exception as exc:
        _poll_errors += 1
        logger.warning("Docker socket indisponível (%d erros): %s", _poll_errors, exc)
        return _modules_cache  # mantém cache anterior

    discovered: list[dict[str, Any]] = []
    try:
        containers = client.containers.list(
            all=True,  # inclui stopped para reportar health=danger
            filters={"label": f"{LABEL_PREFIX}=true"},
        )
    except Exception as exc:
        _poll_errors += 1
        logger.warning("Erro ao listar containers: %s", exc)
        return _modules_cache

    for c in containers:
        labels: dict[str, str] = c.labels or {}
        module_id = labels.get(f"{LABEL_PREFIX}.id", "").strip()
        if not module_id:
            continue

        health = _container_health(c)
        discovered.append({
            "id":          module_id,
            "name":        labels.get(f"{LABEL_PREFIX}.name", module_id),
            "version":     labels.get(f"{LABEL_PREFIX}.version", "1.0.0"),
            "section":     labels.get(f"{LABEL_PREFIX}.section", ""),
            "permission":  labels.get(f"{LABEL_PREFIX}.permission", module_id),
            "health_path": labels.get(f"{LABEL_PREFIX}.health_path", "/health"),
            "health":      health,
            "container":   c.name,
            "status":      c.status,
        })

    # Ordena por seção → nome
    discovered.sort(key=lambda m: (m["section"], m["name"]))
    _poll_errors = 0
    logger.info("Descobertos %d módulo(s)", len(discovered))
    return discovered


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------

async def _poll_loop() -> None:
    global _modules_cache, _last_poll_at
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        try:
            result = await asyncio.to_thread(_discover)
            _modules_cache = result
            _last_poll_at = time.time()
        except Exception as exc:
            logger.error("Poll loop error: %s", exc)


@app.on_event("startup")
async def startup() -> None:
    global _modules_cache, _last_poll_at
    _modules_cache = await asyncio.to_thread(_discover)
    _last_poll_at = time.time()
    asyncio.create_task(_poll_loop())
    logger.info("Registry iniciado — %d módulo(s) descoberto(s)", len(_modules_cache))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/modules", summary="Lista todos os módulos descobertos")
def list_modules() -> list[dict[str, Any]]:
    return _modules_cache


@app.get("/modules/{module_id}", summary="Detalhe de um módulo")
def get_module(module_id: str) -> dict[str, Any]:
    for m in _modules_cache:
        if m["id"] == module_id:
            return m
    raise HTTPException(status_code=404, detail=f"Módulo '{module_id}' não encontrado")


@app.get("/health", summary="Health do registry")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "modules_discovered": len(_modules_cache),
        "last_poll_at": _last_poll_at,
        "poll_errors": _poll_errors,
        "poll_interval_seconds": POLL_INTERVAL,
    }


@app.get("/status", summary="Status detalhado por módulo")
def status() -> dict[str, Any]:
    by_health: dict[str, list[str]] = {"healthy": [], "warning": [], "danger": []}
    for m in _modules_cache:
        bucket = by_health.get(m["health"], by_health["warning"])
        bucket.append(m["id"])
    return {
        "total": len(_modules_cache),
        "by_health": by_health,
        "last_poll_at": _last_poll_at,
        "poll_errors": _poll_errors,
    }
