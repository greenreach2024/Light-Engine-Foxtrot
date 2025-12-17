"""expand tray format fields

Revision ID: expand_tray_format_v1
Revises: 412078c6c077
Create Date: 2025-12-16 19:30:00

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = 'expand_tray_format_v1'
down_revision = '412078c6c077'
branch_labels = None
depends_on = None

def upgrade():
    # Add system and material info
    op.add_column('tray_formats', sa.Column('system_type', sa.String(50), nullable=True))
    op.add_column('tray_formats', sa.Column('tray_material', sa.String(50), nullable=True))
    op.add_column('tray_formats', sa.Column('description', sa.String(500), nullable=True))
    
    # Add yield forecasting fields
    op.add_column('tray_formats', sa.Column('target_weight_per_site', sa.Float, nullable=True))
    op.add_column('tray_formats', sa.Column('weight_unit', sa.String(20), nullable=True))
    op.add_column('tray_formats', sa.Column('is_weight_based', sa.Boolean, nullable=False, server_default='0'))
    
    # Add crowd-sourced tracking
    op.add_column('tray_formats', sa.Column('is_custom', sa.Boolean, nullable=False, server_default='0'))
    op.add_column('tray_formats', sa.Column('created_by_farm_id', sa.String(36), nullable=True))
    op.add_column('tray_formats', sa.Column('is_approved', sa.Boolean, nullable=False, server_default='1'))
    op.add_column('tray_formats', sa.Column('approval_notes', sa.String(500), nullable=True))

def downgrade():
    op.drop_column('tray_formats', 'approval_notes')
    op.drop_column('tray_formats', 'is_approved')
    op.drop_column('tray_formats', 'created_by_farm_id')
    op.drop_column('tray_formats', 'is_custom')
    op.drop_column('tray_formats', 'is_weight_based')
    op.drop_column('tray_formats', 'weight_unit')
    op.drop_column('tray_formats', 'target_weight_per_site')
    op.drop_column('tray_formats', 'description')
    op.drop_column('tray_formats', 'tray_material')
    op.drop_column('tray_formats', 'system_type')
