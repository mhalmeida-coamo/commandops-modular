"""Seed inicial: cria usuário admin e registra módulos."""
import os
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from app.db.base import Base, engine, SessionLocal
from app.models.module import Module
from app.models.module_setting import ModuleSetting
from app.models.user import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# URLs públicas (browser) — configurar via env em cada ambiente
VPN_PUBLIC_URL     = os.environ.get("VPN_PUBLIC_URL",     "http://localhost:5101")
# URLs internas Docker — usadas apenas para health check do registry
VPN_INTERNAL_URL   = os.environ.get("VPN_INTERNAL_URL",   "http://vpn:8080")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")

SETTINGS_SEED: dict[str, list[dict]] = {
    "vpn": [
        {"key": "AD_WORKER_URL",   "value": "", "is_secret": False},
        {"key": "AD_WORKER_TOKEN", "value": "", "is_secret": True},
    ],
}

MODULES_SEED = [
    {
        "id": "vpn",
        "name": "VPN",
        "description": "Gerenciamento de túneis VPN e conectividade remota",
        "version": "1.0.0",
        "nav_label": "VPN",
        "nav_order": 1,
        "icon": "🔐",
        "remote_url":  f"{VPN_PUBLIC_URL}/assets/remoteEntry.js",
        "api_url":     VPN_PUBLIC_URL,
        "health_url":  VPN_INTERNAL_URL,
        "required_roles": ["admin", "operador"],
    },
]


def seed(db: Session) -> None:
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

    for data in MODULES_SEED:
        if not db.query(Module).filter(Module.id == data["id"]).first():
            db.add(Module(
                id=data["id"],
                name=data["name"],
                description=data["description"],
                version=data["version"],
                status="enabled",
                nav_label=data["nav_label"],
                nav_order=data["nav_order"],
                icon=data["icon"],
                remote_url=data["remote_url"],
                api_url=data["api_url"],
                health_url=data.get("health_url"),
                required_roles=data["required_roles"],
                enabled=True,
            ))

    for module_id, setting_list in SETTINGS_SEED.items():
        existing_keys = {
            r.key
            for r in db.query(ModuleSetting).filter(ModuleSetting.module_id == module_id).all()
        }
        for s in setting_list:
            if s["key"] not in existing_keys:
                db.add(ModuleSetting(
                    module_id=module_id,
                    key=s["key"],
                    value=s["value"],
                    is_secret=s["is_secret"],
                ))

    db.commit()


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed(db)


if __name__ == "__main__":
    init_db()
    print("Database initialized.")
