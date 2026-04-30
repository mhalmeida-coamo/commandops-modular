import httpx
import asyncio
import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.base import get_db
from app.models.module import Module
from app.models.module_setting import ModuleSetting
from app.models.user import User
from app.routers.auth import verify_token
from time import perf_counter

router = APIRouter(prefix="/modules", tags=["modules"])
HEALTH_FAILURE_KEY = "__meta_health_failures"
HEALTH_FAILURES_DISABLE_THRESHOLD = int(os.environ.get("HEALTH_FAILURES_DISABLE_THRESHOLD", "3"))


class ModuleOut(BaseModel):
    id: str
    name: str
    version: str
    status: str
    nav_label: str
    nav_order: int
    icon: str
    remote_url: str
    api_url: str
    required_roles: list[str]
    health: str
    latency_ms: int | None = None


class ModuleGovernanceOut(BaseModel):
    id: str
    name: str
    version: str
    status: str
    enabled: bool
    nav_label: str
    nav_order: int
    icon: str
    dependencies: list[str]
    configured: bool
    health: str
    latency_ms: int | None = None


class ModuleEnabledIn(BaseModel):
    enabled: bool


class ModuleCreate(BaseModel):
    id: str
    name: str
    description: str = ""
    version: str = "1.0.0"
    nav_label: str
    nav_order: int = 99
    icon: str = "📦"
    remote_url: str
    api_url: str
    health_url: str | None = None
    required_roles: list[str] = ["admin"]


async def check_module_health(client: httpx.AsyncClient, mod: Module) -> tuple[str, int | None]:
    url = (mod.health_url or mod.api_url).rstrip("/") + "/health"
    started = perf_counter()
    try:
        res = await client.get(url)
        latency_ms = max(int((perf_counter() - started) * 1000), 1)
        return ("healthy" if res.status_code == 200 else "degraded", latency_ms)
    except Exception:
        return "unreachable", None


def _public_settings(settings: list[ModuleSetting]) -> list[ModuleSetting]:
    return [s for s in settings if not s.key.startswith("__meta_")]


def _get_failures_row(module_id: str, db: Session) -> ModuleSetting | None:
    return (
        db.query(ModuleSetting)
        .filter(ModuleSetting.module_id == module_id, ModuleSetting.key == HEALTH_FAILURE_KEY)
        .first()
    )


def _apply_health_policy(mod: Module, health: str, db: Session) -> bool:
    row = _get_failures_row(mod.id, db)
    failures = int(row.value) if row and row.value.isdigit() else 0
    changed = False

    if health == "unreachable":
        failures += 1
    else:
        failures = 0

    next_failures = str(failures)
    if row:
        if row.value != next_failures:
            row.value = next_failures
            changed = True
    else:
        db.add(
            ModuleSetting(
                module_id=mod.id,
                key=HEALTH_FAILURE_KEY,
                value=next_failures,
                is_secret=False,
            )
        )
        changed = True

    if (
        HEALTH_FAILURES_DISABLE_THRESHOLD > 0
        and failures >= HEALTH_FAILURES_DISABLE_THRESHOLD
        and mod.enabled
    ):
        mod.enabled = False
        mod.status = "disabled"
        changed = True

    return changed


@router.get("", response_model=list[ModuleOut])
async def list_modules(
    include_disabled: bool = False,
    current_user: User = Depends(verify_token),
    db: Session = Depends(get_db),
) -> list[ModuleOut]:
    query = db.query(Module).order_by(Module.nav_order)
    if not include_disabled or not current_user.is_platform_admin:
        query = query.filter(Module.enabled.is_(True))
    modules = query.all()

    allowed = current_user.allowed_modules
    if allowed != "*":
        allowed_ids = set(allowed.split(","))
        modules = [m for m in modules if m.id in allowed_ids or current_user.is_platform_admin]

    async with httpx.AsyncClient(timeout=3.0) as client:
        health_results = await asyncio.gather(*(check_module_health(client, mod) for mod in modules))
    result = []
    has_changes = False
    for mod, (health, latency_ms) in zip(modules, health_results):
        has_changes = _apply_health_policy(mod, health, db) or has_changes
        result.append(
            ModuleOut(
                id=mod.id,
                name=mod.name,
                version=mod.version,
                status=mod.status,
                nav_label=mod.nav_label,
                nav_order=mod.nav_order,
                icon=mod.icon,
                remote_url=mod.remote_url,
                api_url=mod.api_url,
                required_roles=mod.required_roles or [],
                health=health,
                latency_ms=latency_ms,
            )
        )
    if has_changes:
        db.commit()
    return result


@router.post("", response_model=ModuleOut, status_code=201)
async def register_module(
    body: ModuleCreate,
    current_user: User = Depends(verify_token),
    db: Session = Depends(get_db),
) -> ModuleOut:
    if not current_user.is_platform_admin:
        raise HTTPException(status_code=403, detail="Requer permissão de administrador da plataforma")

    existing = db.query(Module).filter(Module.id == body.id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Módulo '{body.id}' já registrado")

    mod = Module(
        id=body.id,
        name=body.name,
        description=body.description,
        version=body.version,
        status="enabled",
        nav_label=body.nav_label,
        nav_order=body.nav_order,
        icon=body.icon,
        remote_url=body.remote_url,
        api_url=body.api_url,
        health_url=body.health_url,
        required_roles=body.required_roles,
        enabled=True,
    )
    db.add(mod)
    db.commit()
    db.refresh(mod)

    async with httpx.AsyncClient(timeout=3.0) as client:
        health, latency_ms = await check_module_health(client, mod)
    return ModuleOut(
        id=mod.id, name=mod.name, version=mod.version, status=mod.status,
        nav_label=mod.nav_label, nav_order=mod.nav_order, icon=mod.icon,
        remote_url=mod.remote_url, api_url=mod.api_url,
        required_roles=mod.required_roles or [], health=health, latency_ms=latency_ms,
    )


@router.get("/governance", response_model=list[ModuleGovernanceOut])
async def list_governance_modules(
    current_user: User = Depends(verify_token),
    db: Session = Depends(get_db),
) -> list[ModuleGovernanceOut]:
    if not current_user.is_platform_admin:
        raise HTTPException(status_code=403, detail="Requer permissão de administrador da plataforma")

    modules = db.query(Module).order_by(Module.nav_order).all()
    settings_rows = db.query(ModuleSetting).all()

    by_module: dict[str, list[ModuleSetting]] = {}
    for row in settings_rows:
        by_module.setdefault(row.module_id, []).append(row)

    async with httpx.AsyncClient(timeout=3.0) as client:
        health_results = await asyncio.gather(*(check_module_health(client, mod) for mod in modules))
    result: list[ModuleGovernanceOut] = []
    has_changes = False
    for mod, (health, latency_ms) in zip(modules, health_results):
        has_changes = _apply_health_policy(mod, health, db) or has_changes
        settings = _public_settings(by_module.get(mod.id, []))
        dependencies = [s.key for s in settings]
        configured = True if not settings else all(bool(s.value.strip()) for s in settings)
        result.append(
            ModuleGovernanceOut(
                id=mod.id,
                name=mod.name,
                version=mod.version,
                status=mod.status,
                enabled=bool(mod.enabled),
                nav_label=mod.nav_label,
                nav_order=mod.nav_order,
                icon=mod.icon,
                dependencies=dependencies,
                configured=configured,
                health=health,
                latency_ms=latency_ms,
            )
        )
    if has_changes:
        db.commit()
    return result


@router.patch("/{module_id}/enabled", response_model=ModuleGovernanceOut)
async def set_module_enabled(
    module_id: str,
    body: ModuleEnabledIn,
    current_user: User = Depends(verify_token),
    db: Session = Depends(get_db),
) -> ModuleGovernanceOut:
    if not current_user.is_platform_admin:
        raise HTTPException(status_code=403, detail="Requer permissão de administrador da plataforma")

    mod = db.query(Module).filter(Module.id == module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Módulo não encontrado")

    mod.enabled = body.enabled
    mod.status = "enabled" if body.enabled else "disabled"
    db.commit()
    db.refresh(mod)

    settings = db.query(ModuleSetting).filter(ModuleSetting.module_id == module_id).all()
    public_settings = _public_settings(settings)
    dependencies = [s.key for s in public_settings]
    configured = True if not public_settings else all(bool(s.value.strip()) for s in public_settings)
    async with httpx.AsyncClient(timeout=3.0) as client:
        health, latency_ms = await check_module_health(client, mod)

    return ModuleGovernanceOut(
        id=mod.id,
        name=mod.name,
        version=mod.version,
        status=mod.status,
        enabled=bool(mod.enabled),
        nav_label=mod.nav_label,
        nav_order=mod.nav_order,
        icon=mod.icon,
        dependencies=dependencies,
        configured=configured,
        health=health,
        latency_ms=latency_ms,
    )


@router.delete("/{module_id}", status_code=204)
def unregister_module(
    module_id: str,
    current_user: User = Depends(verify_token),
    db: Session = Depends(get_db),
) -> None:
    if not current_user.is_platform_admin:
        raise HTTPException(status_code=403, detail="Requer permissão de administrador da plataforma")

    mod = db.query(Module).filter(Module.id == module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Módulo não encontrado")

    db.delete(mod)
    db.commit()
