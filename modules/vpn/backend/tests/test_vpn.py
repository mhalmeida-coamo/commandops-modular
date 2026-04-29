import pytest
from fastapi.testclient import TestClient
from jose import jwt
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app

JWT_SECRET = "dev-secret-change-in-prod"


def make_token(role: str = "operador") -> str:
    return jwt.encode(
        {"sub": "testuser", "role": role, "is_platform_admin": False},
        JWT_SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["module"] == "vpn"


def test_process_unauthenticated(client: TestClient) -> None:
    res = client.post("/api/vpn/process", json={"username": "mhalmeida", "enabled": True})
    assert res.status_code == 403


def test_process_missing_ad_worker(client: TestClient) -> None:
    # Sem AD_WORKER_URL configurado deve retornar 503
    res = client.post(
        "/api/vpn/process",
        json={"username": "mhalmeida", "enabled": True},
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert res.status_code == 503
    assert "AD Worker" in res.json()["detail"]


def test_process_success(client: TestClient) -> None:
    mock_response_data = {
        "login": "mhalmeida",
        "vpn_value": "TRUE",
        "group_action": "removed",
        "group_name": "GRP-BLOQUEIO-ENVIO-EXTERNO",
        "warnings": [],
    }

    mock_httpx_response = MagicMock()
    mock_httpx_response.is_success = True
    mock_httpx_response.json.return_value = mock_response_data

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_httpx_response)

    with patch("app.routers.vpn.AD_WORKER_URL", "http://adworker:8010"), \
         patch("app.routers.vpn.AD_WORKER_TOKEN", "test-token"), \
         patch("app.routers.vpn.httpx.AsyncClient", return_value=mock_client):
        res = client.post(
                "/api/vpn/process",
                json={"username": "mhalmeida", "enabled": True},
                headers={"Authorization": f"Bearer {make_token()}"},
            )

    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["result"]["login"] == "mhalmeida"
    assert data["result"]["vpn_value"] == "TRUE"
    assert data["result"]["group_action"] == "removed"
