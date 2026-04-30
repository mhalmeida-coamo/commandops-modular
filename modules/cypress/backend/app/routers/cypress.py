from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from app.auth import TokenUser, verify_token
from app.settings_client import get_cypress_settings
from app.smb import fetch_smb_file, SmbError
from app.xml_parser import parse_printers, parse_roles, search_printers
from app.ldap_client import get_group_members, add_user_to_group, LdapError

router = APIRouter(prefix="/api/cypress", tags=["cypress"])


def _require_cfg(cfg: dict, *keys: str) -> None:
    missing = [k for k in keys if not cfg.get(k, "").strip()]
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"Configurações ausentes: {', '.join(missing)}. Configure no painel admin.",
        )


class PrinterOut(BaseModel):
    id: str
    name: str
    queue: str
    location: str
    description: str


class GroupMemberOut(BaseModel):
    dn: str
    sAMAccountName: str
    displayName: str
    mail: str


class GroupMembersOut(BaseModel):
    status: str
    group_dn: str
    members: list[GroupMemberOut]


class AddUserIn(BaseModel):
    group_dn: str = Field(min_length=3, max_length=512)
    username: str = Field(min_length=2, max_length=240)


class AddUserOut(BaseModel):
    status: str
    user_dn: str | None
    message: str


@router.get("/printers", response_model=list[PrinterOut])
async def list_printers(
    search: str = Query(default="", max_length=200),
    _user: TokenUser = Depends(verify_token),
) -> list[PrinterOut]:
    cfg = await get_cypress_settings()
    _require_cfg(cfg, "SMB_SERVER", "SMB_SHARE", "SMB_DEVICES_FILE", "SMB_DOMAIN", "SMB_USERNAME", "SMB_PASSWORD")

    remote_path = cfg.get("SMB_DEVICES_FILE", "").strip()

    try:
        xml_bytes = fetch_smb_file(
            server=cfg["SMB_SERVER"].strip(),
            share=cfg["SMB_SHARE"].strip(),
            remote_path=remote_path,
            domain=cfg["SMB_DOMAIN"].strip(),
            username=cfg["SMB_USERNAME"].strip(),
            password=cfg["SMB_PASSWORD"].strip(),
        )
    except SmbError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    printers = parse_printers(xml_bytes)
    matched = search_printers(printers, search)
    return [
        PrinterOut(
            id=p.id,
            name=p.name,
            queue=p.queue,
            location=p.location,
            description=p.description,
        )
        for p in matched
    ]


@router.get("/groups", response_model=list[dict])
async def list_groups(
    _user: TokenUser = Depends(verify_token),
) -> list[dict]:
    cfg = await get_cypress_settings()
    _require_cfg(cfg, "SMB_SERVER", "SMB_SHARE", "SMB_ROLES_PATH", "SMB_DOMAIN", "SMB_USERNAME", "SMB_PASSWORD")

    remote_path = cfg.get("SMB_ROLES_PATH", "").strip()

    try:
        xml_bytes = fetch_smb_file(
            server=cfg["SMB_SERVER"].strip(),
            share=cfg["SMB_SHARE"].strip(),
            remote_path=remote_path,
            domain=cfg["SMB_DOMAIN"].strip(),
            username=cfg["SMB_USERNAME"].strip(),
            password=cfg["SMB_PASSWORD"].strip(),
        )
    except SmbError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    roles = parse_roles(xml_bytes)
    return [{"id": r.id, "name": r.name, "group_dn": r.group_dn} for r in roles]


@router.get("/groups/{group_dn:path}/members", response_model=GroupMembersOut)
async def group_members(
    group_dn: str,
    _user: TokenUser = Depends(verify_token),
) -> GroupMembersOut:
    cfg = await get_cypress_settings()
    _require_cfg(cfg, "AD_SERVER", "AD_BASE_DN", "AD_USER", "AD_PASSWORD")

    try:
        members = get_group_members(
            server=cfg["AD_SERVER"].strip(),
            base_dn=cfg["AD_BASE_DN"].strip(),
            bind_user_dn=cfg["AD_USER"].strip(),
            bind_password=cfg["AD_PASSWORD"].strip(),
            group_dn=group_dn,
        )
    except LdapError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return GroupMembersOut(
        status="ok",
        group_dn=group_dn,
        members=[GroupMemberOut(**m) for m in members],
    )


@router.post("/groups/add-user", response_model=AddUserOut)
async def group_add_user(
    payload: AddUserIn,
    _user: TokenUser = Depends(verify_token),
) -> AddUserOut:
    cfg = await get_cypress_settings()
    _require_cfg(cfg, "AD_SERVER", "AD_BASE_DN", "AD_USER", "AD_PASSWORD")

    try:
        result = add_user_to_group(
            server=cfg["AD_SERVER"].strip(),
            base_dn=cfg["AD_BASE_DN"].strip(),
            bind_user_dn=cfg["AD_USER"].strip(),
            bind_password=cfg["AD_PASSWORD"].strip(),
            group_dn=payload.group_dn,
            username=payload.username,
        )
    except LdapError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return AddUserOut(**result)
