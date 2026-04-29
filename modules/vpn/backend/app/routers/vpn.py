import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import httpx
from app.auth import TokenUser, verify_token
from app.settings_client import get_vpn_settings

router = APIRouter(prefix="/api/vpn", tags=["vpn"])

AD_WORKER_TIMEOUT = int(os.environ.get("AD_WORKER_TIMEOUT_SECONDS", "30"))

GroupAction = str  # removed | added | already_absent | already_present | not_found | failed


class VpnProcessIn(BaseModel):
    username: str = Field(min_length=3, max_length=240)
    enabled: bool
    requested_by: str | None = Field(default=None, max_length=240)


class VpnResult(BaseModel):
    login: str
    previous_vpn_value: str           # "TRUE" | "NOT_SET" — msNPAllowDialin antes da operação
    vpn_value: str                    # "TRUE" | "NOT_SET" — após a operação
    bloqueio_ext_action: GroupAction
    internet_mail_action: GroupAction
    internet_mail_group: str
    warnings: list[str] = []


class VpnProcessOut(BaseModel):
    status: str
    result: VpnResult


@router.post("/process", response_model=VpnProcessOut)
async def process(
    payload: VpnProcessIn,
    user: TokenUser = Depends(verify_token),
) -> VpnProcessOut:
    cfg = await get_vpn_settings()
    ad_worker_url = cfg.get("AD_WORKER_URL", "").strip().rstrip("/")
    ad_worker_token = cfg.get("AD_WORKER_TOKEN", "").strip()

    if not ad_worker_url or not ad_worker_token:
        raise HTTPException(
            status_code=503,
            detail="AD Worker não configurado. Defina AD_WORKER_URL e AD_WORKER_TOKEN no painel admin.",
        )

    body = {
        "username": payload.username,
        "enabled": payload.enabled,
        "requested_by": payload.requested_by or user.username,
    }

    try:
        async with httpx.AsyncClient(timeout=AD_WORKER_TIMEOUT) as client:
            res = await client.post(
                f"{ad_worker_url}/operations/vpn-user/execute",
                json=body,
                headers={"X-Worker-Token": ad_worker_token},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="AD Worker timeout") from exc
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=503, detail=f"AD Worker indisponível: {exc}") from exc

    if not res.is_success:
        detail = res.text
        try:
            detail = res.json().get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=f"AD Worker error: {detail}")

    data = res.json()
    return VpnProcessOut(status="ok", result=VpnResult(**data))
