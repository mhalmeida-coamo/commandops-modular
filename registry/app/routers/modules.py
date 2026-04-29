import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.base import get_db
from app.models.module import Module
from app.models.user import User
from app.routers.auth import verify_token

router = APIRouter(prefix="/modules", tags=["modules"])


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


async def check_module_health(mod: Module) -> str:
    url = (mod.health_url or mod.api_url).rstrip("/") + "/health"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(url)
            return "healthy" if res.status_code == 200 else "degraded"
    except Exception:
        return "unreachable"


@router.get("", response_model=list[ModuleOut])
async def list_modules(
    current_user: User = Depends(verify_token),
    db: Session = Depends(get_db),
) -> list[ModuleOut]:
    modules = db.query(Module).filter(Module.enabled.is_(True)).order_by(Module.nav_order).all()

    allowed = current_user.allowed_modules
    if allowed != "*":
        allowed_ids = set(allowed.split(","))
        modules = [m for m in modules if m.id in allowed_ids or current_user.is_platform_admin]

    result = []
    for mod in modules:
        health = await check_module_health(mod)
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
            )
        )
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

    health = await check_module_health(mod)
    return ModuleOut(
        id=mod.id, name=mod.name, version=mod.version, status=mod.status,
        nav_label=mod.nav_label, nav_order=mod.nav_order, icon=mod.icon,
        remote_url=mod.remote_url, api_url=mod.api_url,
        required_roles=mod.required_roles or [], health=health,
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
