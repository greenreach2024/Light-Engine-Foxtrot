"""
Base SQLAlchemy configuration and database connection.
"""

import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager
from typing import Generator

# Determine project root directory
PROJECT_ROOT = Path(__file__).parent.parent.parent

# Database configuration
# Use SQLite for development if PostgreSQL URL not provided
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{PROJECT_ROOT}/lightengine.db"  # Absolute path for SQLite
)

# For SQLite, we need to handle UUID differently
if DATABASE_URL.startswith("sqlite"):
    print(f"📂 Database URL: {DATABASE_URL}")
    print(f"📂 Project Root: {PROJECT_ROOT}")

# Create engine with connection pooling
if DATABASE_URL.startswith("sqlite"):
    # SQLite uses different connection arguments
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=False,  # Set to True for SQL query logging
    )
else:
    # PostgreSQL with connection pooling
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,  # Verify connections before using
        echo=False,  # Set to True for SQL query logging
    )

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for all models
Base = declarative_base()


@contextmanager
def get_db_session() -> Generator[Session, None, None]:
    """
    Database session context manager.
    
    Usage:
        with get_db_session() as session:
            user = session.query(User).filter_by(email=email).first()
            session.commit()
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency for database sessions.
    
    Usage:
        @app.get("/users")
        async def list_users(db: Session = Depends(get_db)):
            return db.query(User).all()
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
