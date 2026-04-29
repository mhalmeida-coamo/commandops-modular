from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.config import settings
from app.db.base import get_db
from app.models.module import Module
from app.models.module_setting import ModuleSetting
from app.models.user import User
from app.routers.auth import verify_token

router = APIRouter(prefix="/modules", tags=["settings"])


class SettingOut(BaseModel):
    key: str
    value: str
    is_secret: bool


class SettingIn(BaseModel):
    key: str
    value: str
    is_secret: bool = False


def _require_module(module_id: str, db: Session) -> Module:
    mod = db.query(Module).filter(Module.id == module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Módulo não encontrado")
    return mod


@router.get("/{module_id}/settings", response_model=list[SettingOut])
def get_settings(
    module_id: str,
    current_user: User = Depends(verify_token),
    db: Session = Depends(get_db),
) -> list[SettingOut]:
    if not current_user.is_platform_admin:
        raise HTTPException(status_code=403, detail="Requer permissão de administrador")
    _require_module(module_id, db)
    rows = db.query(ModuleSetting).filter(ModuleSetting.module_id == module_id).all()
    return [
        SettingOut(key=r.key, value="***" if r.is_secret else r.value, is_secret=r.is_secret)
        for r in rows
    ]


@router.put("/{module_id}/settings", response_model=list[SettingOut])
def put_settings(
    module_id: str,
    body: list[SettingIn],
    current_user: User = Depends(verify_token),
    db: Session = Depends(get_db),
) -> list[SettingOut]:
    if not current_user.is_platform_admin:
        raise HTTPException(status_code=403, detail="Requer permissão de administrador")
    _require_module(module_id, db)

    existing = {
        r.key: r
        for r in db.query(ModuleSetting).filter(ModuleSetting.module_id == module_id).all()
    }

    incoming_keys = set()
    for item in body:
        incoming_keys.add(item.key)
        if item.key in existing:
            row = existing[item.key]
            row.is_secret = item.is_secret
            if not (item.is_secret and item.value == "***"):
                row.value = item.value
        else:
            db.add(ModuleSetting(
                module_id=module_id,
                key=item.key,
                value=item.value,
                is_secret=item.is_secret,
            ))

    for key, row in existing.items():
        if key not in incoming_keys:
            db.delete(row)

    db.commit()

    rows = db.query(ModuleSetting).filter(ModuleSetting.module_id == module_id).all()
    return [
        SettingOut(key=r.key, value="***" if r.is_secret else r.value, is_secret=r.is_secret)
        for r in rows
    ]


@router.get("/{module_id}/settings/service", response_model=list[SettingOut])
def get_settings_service(
    module_id: str,
    x_service_secret: str = Header(...),
    db: Session = Depends(get_db),
) -> list[SettingOut]:
    if x_service_secret != settings.service_secret:
        raise HTTPException(status_code=403, detail="Acesso negado")
    _require_module(module_id, db)
    rows = db.query(ModuleSetting).filter(ModuleSetting.module_id == module_id).all()
    return [SettingOut(key=r.key, value=r.value, is_secret=r.is_secret) for r in rows]
