"""Seed inicial: cria usuário admin e registra o módulo VPN."""
import os
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from app.db.base import Base, engine, SessionLocal
from app.models.module import Module
from app.models.user import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

VPN_MODULE_URL = os.environ.get("VPN_MODULE_URL", "http://localhost:5101")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")


def seed(db: Session) -> None:
    # Admin user
    if not db.query(User).filter(User.username == "admin").first():
        db.add(
            User(
                username="admin",
                hashed_password=pwd_context.hash(ADMIN_PASSWORD),
                role="admin",
                is_platform_admin=True,
                allowed_modules="*",
            )
        )

    # VPN module
    if not db.query(Module).filter(Module.id == "vpn").first():
        db.add(
            Module(
                id="vpn",
                name="VPN",
                description="Gerenciamento de túneis VPN",
                version="1.0.0",
                status="enabled",
                nav_label="VPN",
                nav_order=1,
                icon="🔐",
                remote_url=f"{VPN_MODULE_URL}/assets/remoteEntry.js",
                api_url=f"{VPN_MODULE_URL}",
                required_roles=["admin", "operador"],
                enabled=True,
            )
        )

    db.commit()


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed(db)


if __name__ == "__main__":
    init_db()
    print("Database initialized.")
