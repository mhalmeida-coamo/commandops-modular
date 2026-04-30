from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from app.auth import TokenUser, verify_token
from app.settings_client import get_cypress_settings
from app.smb import fetch_smb_file, SmbError
from app.xml_parser import parse_printers, parse_roles
from app.ldap_client import get_group_members, add_user_to_group

router = APIRouter(prefix="/api/cypress", tags=["cypress"])


def _require_cfg(cfg: dict, *keys: str) -> None:
    missing = [k for k in keys if not cfg.get(k, "").strip()]
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"Configurações ausentes: {', '.join(missing)}. Configure no painel admin.",
        )


class AddUserIn(BaseModel):
    group: str = Field(min_length=1, max_length=240)
    user: str = Field(min_length=1, max_length=240)


@router.get("/printer/search")
async def search_printer(
    q: str = Query(..., min_length=1, description="Nome da impressora"),
    _user: TokenUser = Depends(verify_token),
) -> dict:
    cfg = await get_cypress_settings()
    _require_cfg(cfg, "SMB_SERVER", "SMB_SHARE", "SMB_DEVICES_FILE", "SMB_DOMAIN", "SMB_USERNAME", "SMB_PASSWORD")

    try:
        devices_bytes = fetch_smb_file(
            server=cfg["SMB_SERVER"].strip(),
            share=cfg["SMB_SHARE"].strip(),
            remote_path=cfg["SMB_DEVICES_FILE"].strip(),
            domain=cfg["SMB_DOMAIN"].strip(),
            username=cfg["SMB_USERNAME"].strip(),
            password=cfg["SMB_PASSWORD"].strip(),
        )
    except SmbError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    printers = parse_printers(devices_bytes, q)

    if not printers:
        return {"query": q, "found": False, "count": 0, "printers": []}

    # Enrich roles with data from roles.xml
    all_role_names = {role["name"] for p in printers for role in p["roles"] if role["name"]}
    roles_data: dict = {}
    if all_role_names and cfg.get("SMB_ROLES_PATH", "").strip():
        try:
            roles_bytes = fetch_smb_file(
                server=cfg["SMB_SERVER"].strip(),
                share=cfg["SMB_SHARE"].strip(),
                remote_path=cfg["SMB_ROLES_PATH"].strip(),
                domain=cfg["SMB_DOMAIN"].strip(),
                username=cfg["SMB_USERNAME"].strip(),
                password=cfg["SMB_PASSWORD"].strip(),
            )
            roles_data = parse_roles(roles_bytes, list(all_role_names))
        except Exception:
            pass

    for printer in printers:
        for role in printer["roles"]:
            role_info = roles_data.get(role["name"])
            if role_info:
                role["description"] = role_info.get("description", "")
                role["role_type"] = role_info.get("role_type", "")
                role["members"] = role_info.get("members", [])
                role["admins"] = role_info.get("admins", [])

    return {"query": q, "found": True, "count": len(printers), "printers": printers}


@router.get("/group/members")
async def group_members(
    group: str = Query(..., min_length=1, description="Nome do grupo AD"),
    _user: TokenUser = Depends(verify_token),
) -> dict:
    cfg = await get_cypress_settings()
    _require_cfg(cfg, "AD_SERVER", "AD_BASE_DN", "AD_USER", "AD_PASSWORD")

    return get_group_members(
        server=cfg["AD_SERVER"].strip(),
        base_dn=cfg["AD_BASE_DN"].strip(),
        bind_user=cfg["AD_USER"].strip(),
        bind_password=cfg["AD_PASSWORD"].strip(),
        group_name=group,
    )


@router.post("/group/add-user")
async def group_add_user(
    payload: AddUserIn,
    _user: TokenUser = Depends(verify_token),
) -> dict:
    cfg = await get_cypress_settings()
    _require_cfg(cfg, "AD_SERVER", "AD_BASE_DN", "AD_USER", "AD_PASSWORD")

    return add_user_to_group(
        server=cfg["AD_SERVER"].strip(),
        base_dn=cfg["AD_BASE_DN"].strip(),
        bind_user=cfg["AD_USER"].strip(),
        bind_password=cfg["AD_PASSWORD"].strip(),
        group_name=payload.group,
        username=payload.user,
    )
