"""Logging configuration helpers."""
from __future__ import annotations

import logging
import os
from typing import Optional

_LOG_LEVELS = {
    "critical": logging.CRITICAL,
    "error": logging.ERROR,
    "warning": logging.WARNING,
    "info": logging.INFO,
    "debug": logging.DEBUG,
}


def configure_logging(level: Optional[str] = None) -> None:
    """Configure global logging for the backend.

    Parameters
    ----------
    level:
        Optional string override. When not provided the ``LOG_LEVEL``
        environment variable is consulted, defaulting to ``INFO``.
    """

    env_level = level or os.getenv("LOG_LEVEL", "INFO").lower()
    numeric_level = _LOG_LEVELS.get(env_level, logging.INFO)

    logging.basicConfig(
        level=numeric_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


__all__ = ["configure_logging"]
