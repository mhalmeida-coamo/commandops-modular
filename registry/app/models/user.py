from sqlalchemy import Boolean, Column, String
from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    username = Column(String, primary_key=True)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False, default="viewer")
    is_platform_admin = Column(Boolean, default=False)
    allowed_modules = Column(String, default="*")
