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
from typing import Any

import docker  # type: ignore
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("registry")

app = FastAPI(title="CommandOps Module Registry", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

LABEL_PREFIX = "commandops.module"
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))

# Cache em memória — atualizado pelo background loop
_modules_cache: list[dict[str, Any]] = []


def _container_health(container: Any) -> str:
    try:
        status = (container.status or "").lower()
        if status != "running":
            return "danger"
        health_info = container.attrs.get("State", {}).get("Health", {})
        if not health_info:
            return "healthy"
        docker_health = (health_info.get("Status") or "").lower()
        if docker_health == "healthy":
            return "healthy"
        if docker_health in ("unhealthy",):
            return "danger"
        if docker_health == "starting":
            return "warning"
        return "healthy"
    except Exception:
        return "warning"


def _discover() -> list[dict[str, Any]]:
    try:
        client = docker.from_env(timeout=5)
    except Exception as exc:
        logger.warning("Docker socket indisponível: %s", exc)
        return []

    discovered: list[dict[str, Any]] = []
    try:
        containers = client.containers.list(
            all=False,
            filters={"label": f"{LABEL_PREFIX}=true"},
        )
    except Exception as exc:
        logger.warning("Erro ao listar containers: %s", exc)
        return []

    for c in containers:
        labels: dict[str, str] = c.labels or {}
        module_id = labels.get(f"{LABEL_PREFIX}.id", "").strip()
        if not module_id:
            continue
        discovered.append({
            "id": module_id,
            "name": labels.get(f"{LABEL_PREFIX}.name", module_id),
            "version": labels.get(f"{LABEL_PREFIX}.version", "1.0.0"),
            "section": labels.get(f"{LABEL_PREFIX}.section", ""),
            "permission": labels.get(f"{LABEL_PREFIX}.permission", module_id),
            "health_path": labels.get(f"{LABEL_PREFIX}.health_path", "/health"),
            "health": _container_health(c),
            "container": c.name,
            "status": "running" if c.status == "running" else c.status,
        })

    logger.info("Descobertos %d módulo(s)", len(discovered))
    return discovered


async def _poll_loop() -> None:
    global _modules_cache
    while True:
        try:
            _modules_cache = await asyncio.to_thread(_discover)
        except Exception as exc:
            logger.error("Poll error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL)


@app.on_event("startup")
async def startup() -> None:
    global _modules_cache
    _modules_cache = await asyncio.to_thread(_discover)
    asyncio.create_task(_poll_loop())


@app.get("/modules")
def list_modules() -> list[dict[str, Any]]:
    return _modules_cache


@app.get("/modules/{module_id}")
def get_module(module_id: str) -> dict[str, Any]:
    for m in _modules_cache:
        if m["id"] == module_id:
            return m
    return {"error": "not found"}, 404  # type: ignore


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
