from sqlalchemy import Boolean, Column, ForeignKey, Integer, String
from app.db.base import Base


class ModuleSetting(Base):
    __tablename__ = "module_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    module_id = Column(String, ForeignKey("modules.id", ondelete="CASCADE"), nullable=False)
    key = Column(String, nullable=False)
    value = Column(String, nullable=False, default="")
    is_secret = Column(Boolean, default=False)
