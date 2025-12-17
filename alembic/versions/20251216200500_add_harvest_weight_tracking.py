"""Add harvest weight tracking

Revision ID: add_harvest_weights
Revises: expand_tray_format_v1
Create Date: 2025-12-16 20:05:00

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_harvest_weights'
down_revision = 'expand_tray_format_v1'
branch_labels = None
depends_on = None


def upgrade():
    # Add weight tracking columns to tray_runs
    op.add_column('tray_runs', sa.Column('actual_weight', sa.Float(), nullable=True))
    op.add_column('tray_runs', sa.Column('weight_unit', sa.String(20), nullable=True))


def downgrade():
    op.drop_column('tray_runs', 'actual_weight')
    op.drop_column('tray_runs', 'weight_unit')
