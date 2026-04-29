import pytest
from fastapi.testclient import TestClient
from jose import jwt
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


def test_list_tunnels_authenticated(client: TestClient) -> None:
    res = client.get(
        "/api/vpn/tunnels",
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "id" in data[0]
    assert "status" in data[0]


def test_list_tunnels_unauthenticated(client: TestClient) -> None:
    res = client.get("/api/vpn/tunnels")
    assert res.status_code == 403


def test_get_tunnel_not_found(client: TestClient) -> None:
    res = client.get(
        "/api/vpn/tunnels/inexistente",
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert res.status_code == 404
