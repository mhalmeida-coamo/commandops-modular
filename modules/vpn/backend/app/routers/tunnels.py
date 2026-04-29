from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.auth import TokenUser, verify_token

router = APIRouter(prefix="/tunnels", tags=["tunnels"])


class VpnTunnel(BaseModel):
    id: str
    name: str
    status: str
    ip: str
    user: str
    connected_since: str | None


# Dados de demonstração — substituir pela integração real com o servidor VPN
_MOCK_TUNNELS: list[VpnTunnel] = [
    VpnTunnel(
        id="tun-001",
        name="HQ-São Paulo",
        status="active",
        ip="10.8.0.2",
        user="jsilva",
        connected_since=datetime(2026, 4, 29, 8, 0, tzinfo=timezone.utc).isoformat(),
    ),
    VpnTunnel(
        id="tun-002",
        name="Filial Londrina",
        status="active",
        ip="10.8.0.5",
        user="mpereira",
        connected_since=datetime(2026, 4, 29, 9, 30, tzinfo=timezone.utc).isoformat(),
    ),
    VpnTunnel(
        id="tun-003",
        name="Filial Maringá",
        status="inactive",
        ip="10.8.0.8",
        user="—",
        connected_since=None,
    ),
]


@router.get("", response_model=list[VpnTunnel])
def list_tunnels(_user: TokenUser = Depends(verify_token)) -> list[VpnTunnel]:
    return _MOCK_TUNNELS


@router.get("/{tunnel_id}", response_model=VpnTunnel)
def get_tunnel(tunnel_id: str, _user: TokenUser = Depends(verify_token)) -> VpnTunnel:
    for t in _MOCK_TUNNELS:
        if t.id == tunnel_id:
            return t
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Túnel não encontrado")
