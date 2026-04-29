from sqlalchemy import Boolean, Column, Integer, String, JSON
from app.db.base import Base


class Module(Base):
    __tablename__ = "modules"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    version = Column(String, nullable=False, default="1.0.0")
    status = Column(String, nullable=False, default="enabled")
    nav_label = Column(String, nullable=False)
    nav_order = Column(Integer, nullable=False, default=99)
    icon = Column(String, default="📦")
    remote_url = Column(String, nullable=False)
    api_url = Column(String, nullable=False)
    required_roles = Column(JSON, nullable=False, default=list)
    enabled = Column(Boolean, default=True)
