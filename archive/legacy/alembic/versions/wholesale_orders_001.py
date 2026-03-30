"""Create wholesale order tables

Revision ID: wholesale_orders_001
Revises: 
Create Date: 2025-12-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = 'wholesale_orders_001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Main wholesale orders table
    op.create_table(
        'wholesale_orders',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('buyer_id', sa.Integer(), nullable=False),
        sa.Column('buyer_name', sa.String(255), nullable=False),
        sa.Column('buyer_email', sa.String(255), nullable=False),
        sa.Column('buyer_phone', sa.String(50)),
        sa.Column('delivery_address', sa.Text(), nullable=False),
        sa.Column('delivery_city', sa.String(100), nullable=False),
        sa.Column('delivery_province', sa.String(50), nullable=False),
        sa.Column('delivery_postal_code', sa.String(20), nullable=False),
        sa.Column('delivery_instructions', sa.Text()),
        sa.Column('total_amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('platform_fee', sa.Numeric(10, 2), default=0),
        sa.Column('status', sa.String(50), nullable=False, index=True),
        sa.Column('payment_intent_id', sa.String(255), unique=True),
        sa.Column('payment_captured_at', sa.DateTime()),
        sa.Column('fulfillment_cadence', sa.String(50), default='one_time'),
        sa.Column('verification_deadline', sa.DateTime()),
        sa.Column('created_at', sa.DateTime(), default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), default=sa.func.now(), onupdate=sa.func.now()),
    )
    
    # Farm sub-orders table
    op.create_table(
        'farm_sub_orders',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('wholesale_order_id', sa.Integer(), sa.ForeignKey('wholesale_orders.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('farm_id', sa.String(50), nullable=False, index=True),
        sa.Column('status', sa.String(50), nullable=False, index=True),
        sa.Column('sub_total', sa.Numeric(10, 2), nullable=False),
        sa.Column('farm_payout_amount', sa.Numeric(10, 2)),
        sa.Column('farm_payout_transfer_id', sa.String(255)),
        sa.Column('verification_response', sa.String(50)),  # accepted, declined, modified
        sa.Column('verification_responded_at', sa.DateTime()),
        sa.Column('verification_deadline', sa.DateTime()),
        sa.Column('decline_reason', sa.Text()),
        sa.Column('pickup_qr_code', sa.String(255), unique=True),
        sa.Column('picked_up_at', sa.DateTime()),
        sa.Column('payment_captured_at', sa.DateTime()),
        sa.Column('farm_paid_at', sa.DateTime()),
        sa.Column('created_at', sa.DateTime(), default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), default=sa.func.now(), onupdate=sa.func.now()),
    )
    
    # Order line items table
    op.create_table(
        'order_line_items',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('sub_order_id', sa.Integer(), sa.ForeignKey('farm_sub_orders.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('sku_id', sa.Integer()),
        sa.Column('product_name', sa.String(255), nullable=False),
        sa.Column('quantity', sa.Numeric(10, 2), nullable=False),
        sa.Column('unit', sa.String(50), nullable=False),
        sa.Column('price_per_unit', sa.Numeric(10, 2), nullable=False),
        sa.Column('line_total', sa.Numeric(10, 2), nullable=False),
        sa.Column('original_quantity', sa.Numeric(10, 2)),  # For tracking modifications
        sa.Column('modified_quantity', sa.Numeric(10, 2)),
        sa.Column('modification_reason', sa.Text()),
        sa.Column('created_at', sa.DateTime(), default=sa.func.now()),
    )
    
    # Farm substitutions table (for alternative farm matching)
    op.create_table(
        'farm_substitutions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('original_sub_order_id', sa.Integer(), sa.ForeignKey('farm_sub_orders.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('alternative_farm_id', sa.String(50), nullable=False),
        sa.Column('status', sa.String(50), nullable=False),  # pending, accepted, declined
        sa.Column('price_difference', sa.Numeric(10, 2)),  # Price variance from original
        sa.Column('distance_difference_km', sa.Numeric(10, 2)),
        sa.Column('requested_at', sa.DateTime(), default=sa.func.now()),
        sa.Column('responded_at', sa.DateTime()),
        sa.Column('decline_reason', sa.Text()),
    )
    
    # Pickup confirmations table
    op.create_table(
        'pickup_confirmations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('sub_order_id', sa.Integer(), sa.ForeignKey('farm_sub_orders.id', ondelete='CASCADE'), nullable=False),
        sa.Column('qr_code_scanned', sa.String(255), nullable=False),
        sa.Column('confirmed_by_farm_id', sa.String(50)),
        sa.Column('confirmed_at', sa.DateTime(), default=sa.func.now()),
        sa.Column('buyer_signature', sa.Text()),  # Optional digital signature
        sa.Column('notes', sa.Text()),
    )
    
    # Indexes for performance
    op.create_index('idx_orders_buyer', 'wholesale_orders', ['buyer_id', 'created_at'])
    op.create_index('idx_orders_status_created', 'wholesale_orders', ['status', 'created_at'])
    op.create_index('idx_sub_orders_farm_status', 'farm_sub_orders', ['farm_id', 'status'])
    op.create_index('idx_sub_orders_deadline', 'farm_sub_orders', ['verification_deadline'])


def downgrade():
    op.drop_table('pickup_confirmations')
    op.drop_table('farm_substitutions')
    op.drop_table('order_line_items')
    op.drop_table('farm_sub_orders')
    op.drop_table('wholesale_orders')
