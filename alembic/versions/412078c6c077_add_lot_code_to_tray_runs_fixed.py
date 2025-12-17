"""Add lot_code to tray_runs (fixed)

Revision ID: 412078c6c077
Revises: f4638c130d4f
Create Date: 2025-12-16 18:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '412078c6c077'
down_revision: Union[str, Sequence[str], None] = 'f4638c130d4f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add lot_code column to tray_runs table."""
    # Add lot_code column to tray_runs
    op.add_column('tray_runs', sa.Column('lot_code', sa.String(100), nullable=True))


def downgrade() -> None:
    """Remove lot_code column from tray_runs table."""
    # Remove lot_code column from tray_runs
    op.drop_column('tray_runs', 'lot_code')
