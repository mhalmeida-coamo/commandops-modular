import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base, get_db
from app.main import app

TEST_DB_URL = "sqlite:///./test_registry.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_login_admin(client: TestClient) -> None:
    # seed cria o admin no startup
    from app.db.seed import seed
    with TestingSessionLocal() as db:
        seed(db)

    res = client.post("/auth/token", json={"username": "admin", "password": "admin"})
    assert res.status_code == 200
    data = res.json()
    assert "token" in data
    assert data["user"]["username"] == "admin"


def test_login_wrong_password(client: TestClient) -> None:
    res = client.post("/auth/token", json={"username": "admin", "password": "wrong"})
    assert res.status_code == 401


def test_list_modules_requires_auth(client: TestClient) -> None:
    res = client.get("/modules")
    assert res.status_code == 403
