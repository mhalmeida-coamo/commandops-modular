"""
CommandOps Module Registry — Phase 1

Descoberta híbrida:
  1. Config-file (modules_config.yml) — módulos conhecidos, lookup por container_name.
     Não exige labels nos containers do projeto original.
  2. Labels Docker (commandops.module=true) — auto-registro para novos módulos.

Expõe GET /modules com health em tempo real via Docker socket.
Roda como stack independente sem tocar no projeto original.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Any

import docker  # type: ignore
import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("registry")

app = FastAPI(
    title="CommandOps Module Registry",
    version="0.2.0",
    description="Descobre e monitora módulos CommandOps via config-file + Docker labels",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)

LABEL_PREFIX   = "commandops.module"
POLL_INTERVAL  = int(os.getenv("POLL_INTERVAL", "30"))
CONFIG_PATH    = Path(os.getenv("MODULES_CONFIG", "/app/modules_config.yml"))

# Estado global
_modules_cache: list[dict[str, Any]] = []
_last_poll_at: float = 0.0
_poll_errors:  int   = 0
_config: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        logger.warning("modules_config.yml não encontrado em %s", CONFIG_PATH)
        return {"compose_project": "", "modules": []}
    with CONFIG_PATH.open() as f:
        return yaml.safe_load(f) or {}


# ---------------------------------------------------------------------------
# Health mapping
# ---------------------------------------------------------------------------

def _container_health(container: Any) -> str:
    try:
        status = (container.status or "").lower()
        if status != "running":
            return "danger"
        health_info = container.attrs.get("State", {}).get("Health", {})
        if not health_info:
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


# ---------------------------------------------------------------------------
# Descoberta por config-file (container_name)
# ---------------------------------------------------------------------------

def _discover_from_config(
    client: Any,
    known_ids: set[str],
) -> list[dict[str, Any]]:
    modules_def: list[dict] = _config.get("modules", [])
    result: list[dict[str, Any]] = []

    for m in modules_def:
        module_id = (m.get("id") or "").strip()
        if not module_id or module_id in known_ids:
            continue

        container_name = m.get("container_name", "")
        health = "danger"
        status = "stopped"
        actual_name = container_name

        if container_name:
            try:
                c = client.containers.get(container_name)
                c.reload()
                health = _container_health(c)
                status = c.status
                actual_name = c.name
            except docker.errors.NotFound:
                health = "danger"
                status = "not_found"
            except Exception as exc:
                logger.warning("Erro ao inspecionar %s: %s", container_name, exc)
                health = "warning"
                status = "unknown"

        entry: dict[str, Any] = {
            "id":           module_id,
            "name":         m.get("name", module_id),
            "version":      m.get("version", "1.0.0"),
            "section":      m.get("section", ""),
            "permission":   m.get("permission", module_id),
            "health_path":  m.get("health_path", "/health"),
            "health":       health,
            "container":    actual_name,
            "status":       status,
            "source":       "config",
        }
        if m.get("frontend_url"):
            entry["frontend_url"] = m["frontend_url"]
        result.append(entry)

    return result


# ---------------------------------------------------------------------------
# Descoberta por labels (auto-registro para módulos futuros)
# ---------------------------------------------------------------------------

def _discover_from_labels(
    client: Any,
    known_ids: set[str],
) -> list[dict[str, Any]]:
    compose_project: str = _config.get("compose_project", "")
    label_filters: list[str] = [f"{LABEL_PREFIX}=true"]
    if compose_project:
        label_filters.append(f"com.docker.compose.project={compose_project}")

    try:
        containers = client.containers.list(
            all=True,
            filters={"label": label_filters},
        )
    except Exception as exc:
        logger.warning("Erro ao listar containers por labels: %s", exc)
        return []

    result: list[dict[str, Any]] = []
    for c in containers:
        labels: dict[str, str] = c.labels or {}
        module_id = labels.get(f"{LABEL_PREFIX}.id", "").strip()
        if not module_id or module_id in known_ids:
            continue

        result.append({
            "id":          module_id,
            "name":        labels.get(f"{LABEL_PREFIX}.name", module_id),
            "version":     labels.get(f"{LABEL_PREFIX}.version", "1.0.0"),
            "section":     labels.get(f"{LABEL_PREFIX}.section", ""),
            "permission":  labels.get(f"{LABEL_PREFIX}.permission", module_id),
            "health_path": labels.get(f"{LABEL_PREFIX}.health_path", "/health"),
            "health":      _container_health(c),
            "container":   c.name,
            "status":      c.status,
            "source":      "label",
        })

    return result


# ---------------------------------------------------------------------------
# Descoberta principal (híbrida)
# ---------------------------------------------------------------------------

def _discover() -> list[dict[str, Any]]:
    global _poll_errors

    try:
        client = docker.from_env(timeout=5)
    except Exception as exc:
        _poll_errors += 1
        logger.warning("Docker socket indisponível (%d erros): %s", _poll_errors, exc)
        return _modules_cache

    known_ids: set[str] = set()
    discovered: list[dict[str, Any]] = []

    # 1. Config-file — módulos conhecidos sem labels
    config_modules = _discover_from_config(client, known_ids)
    for m in config_modules:
        known_ids.add(m["id"])
    discovered.extend(config_modules)

    # 2. Labels — auto-registro de módulos futuros (não duplica os do config)
    label_modules = _discover_from_labels(client, known_ids)
    discovered.extend(label_modules)

    discovered.sort(key=lambda m: (m["section"], m["name"]))
    _poll_errors = 0
    logger.info(
        "Descobertos %d módulo(s) [config=%d label=%d]",
        len(discovered), len(config_modules), len(label_modules),
    )
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
    global _modules_cache, _last_poll_at, _config
    _config = _load_config()
    _modules_cache = await asyncio.to_thread(_discover)
    _last_poll_at = time.time()
    asyncio.create_task(_poll_loop())
    logger.info(
        "Registry iniciado — %d módulo(s) descoberto(s) (config: %d definidos)",
        len(_modules_cache),
        len(_config.get("modules", [])),
    )


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
    cfg = _config.get("modules", [])
    return {
        "status": "ok",
        "modules_discovered": len(_modules_cache),
        "modules_in_config": len(cfg),
        "last_poll_at": _last_poll_at,
        "poll_errors": _poll_errors,
        "poll_interval_seconds": POLL_INTERVAL,
        "compose_project_filter": _config.get("compose_project") or None,
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
