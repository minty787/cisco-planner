"""Database initialization."""
import os
from sqlmodel import SQLModel, Session, create_engine

DATA_DIR = os.environ.get("DATA_DIR", "/app/data")
os.makedirs(DATA_DIR, exist_ok=True)
DATABASE_URL = f"sqlite:///{DATA_DIR}/planner.db"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    """Create tables if they don't exist."""
    from . import models  # noqa: F401 - ensures models register
    SQLModel.metadata.create_all(engine)


def get_session():
    """FastAPI dependency for a DB session."""
    with Session(engine) as session:
        yield session
