"""Add farm notification preferences and device token tables

Revision ID: 20251222_notifications
Revises: wholesale_orders_001
Create Date: 2025-12-22

Adds tables for managing farm notification preferences, device tokens,
and notification delivery tracking for SMS and push notifications.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = '20251222_notifications'
down_revision = 'wholesale_orders_001'
branch_labels = None
depends_on = None


def upgrade():
    # Farm notification preferences and contact info
    op.create_table(
        'farm_notification_preferences',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('farm_id', sa.String(50), nullable=False, unique=True, index=True),
        sa.Column('farm_name', sa.String(255)),
        
        # Contact information
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('phone', sa.String(20)),  # E.164 format: +16135551234
        sa.Column('phone_verified', sa.Boolean(), default=False),
        sa.Column('phone_verified_at', sa.DateTime()),
        
        # Email preferences
        sa.Column('email_enabled', sa.Boolean(), default=True),
        sa.Column('email_new_order', sa.Boolean(), default=True),
        sa.Column('email_deadline_reminder', sa.Boolean(), default=True),
        sa.Column('email_order_modified', sa.Boolean(), default=True),
        sa.Column('email_pickup_ready', sa.Boolean(), default=True),
        sa.Column('email_weekly_summary', sa.Boolean(), default=True),
        
        # SMS preferences
        sa.Column('sms_enabled', sa.Boolean(), default=True),
        sa.Column('sms_new_order', sa.Boolean(), default=True),
        sa.Column('sms_deadline_urgent', sa.Boolean(), default=True),  # < 6 hours
        sa.Column('sms_pickup_ready', sa.Boolean(), default=False),
        
        # Push notification preferences
        sa.Column('push_enabled', sa.Boolean(), default=True),
        sa.Column('push_new_order', sa.Boolean(), default=True),
        sa.Column('push_deadline_reminder', sa.Boolean(), default=True),
        sa.Column('push_order_modified', sa.Boolean(), default=True),
        sa.Column('push_pickup_ready', sa.Boolean(), default=True),
        
        # Quiet hours (don't send notifications during these times)
        sa.Column('quiet_hours_enabled', sa.Boolean(), default=False),
        sa.Column('quiet_hours_start', sa.Time()),  # e.g., 22:00
        sa.Column('quiet_hours_end', sa.Time()),    # e.g., 08:00
        sa.Column('quiet_hours_timezone', sa.String(50), default='America/Toronto'),
        
        # Metadata
        sa.Column('created_at', sa.DateTime(), default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), default=sa.func.now(), onupdate=sa.func.now()),
    )
    
    # Device tokens for push notifications (FCM)
    # Multiple devices per farm (mobile app, tablet, etc.)
    op.create_table(
        'device_tokens',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('farm_id', sa.String(50), nullable=False, index=True),
        sa.Column('device_token', sa.String(500), nullable=False, unique=True, index=True),
        sa.Column('platform', sa.String(20), nullable=False),  # 'ios', 'android', 'web'
        sa.Column('device_name', sa.String(100)),  # Optional: "Peter's iPhone", "Farm iPad"
        sa.Column('device_model', sa.String(100)),  # e.g., "iPhone 13", "iPad Pro"
        sa.Column('app_version', sa.String(50)),
        
        # Token status
        sa.Column('is_active', sa.Boolean(), default=True, index=True),
        sa.Column('last_used_at', sa.DateTime()),
        sa.Column('failed_deliveries', sa.Integer(), default=0),  # Count failed attempts
        sa.Column('disabled_at', sa.DateTime()),  # When token became invalid
        sa.Column('disabled_reason', sa.String(100)),  # 'invalid_token', 'app_uninstalled', etc.
        
        # Topic subscriptions (for group notifications)
        sa.Column('subscribed_topics', postgresql.JSONB(), default=[]),  # ['all_farms', 'ontario_farms', etc.]
        
        # Metadata
        sa.Column('created_at', sa.DateTime(), default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), default=sa.func.now(), onupdate=sa.func.now()),
    )
    
    # Notification delivery log (tracking and debugging)
    op.create_table(
        'notification_logs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('farm_id', sa.String(50), nullable=False, index=True),
        sa.Column('notification_type', sa.String(50), nullable=False, index=True),  # 'new_order', 'deadline', etc.
        sa.Column('channel', sa.String(20), nullable=False, index=True),  # 'email', 'sms', 'push'
        
        # Associated order (if applicable)
        sa.Column('wholesale_order_id', sa.Integer(), sa.ForeignKey('wholesale_orders.id', ondelete='SET NULL')),
        sa.Column('sub_order_id', sa.Integer(), sa.ForeignKey('farm_sub_orders.id', ondelete='SET NULL')),
        
        # Delivery details
        sa.Column('recipient', sa.String(255), nullable=False),  # email, phone, or device token
        sa.Column('status', sa.String(50), nullable=False, index=True),  # 'sent', 'delivered', 'failed', 'bounced'
        sa.Column('sent_at', sa.DateTime(), default=sa.func.now()),
        sa.Column('delivered_at', sa.DateTime()),
        sa.Column('failed_at', sa.DateTime()),
        sa.Column('opened_at', sa.DateTime()),  # Email opened or push clicked
        
        # Error tracking
        sa.Column('error_code', sa.String(100)),
        sa.Column('error_message', sa.Text()),
        
        # Service-specific tracking IDs
        sa.Column('external_id', sa.String(255)),  # Twilio SID, FCM message ID, etc.
        sa.Column('provider_response', postgresql.JSONB()),  # Raw response from service
        
        # Message content (for debugging)
        sa.Column('subject', sa.String(255)),
        sa.Column('message_preview', sa.Text()),  # First 200 chars
        
        # Metadata
        sa.Column('created_at', sa.DateTime(), default=sa.func.now(), index=True),
    )
    
    # Create indexes for common queries
    op.create_index('idx_notification_logs_farm_channel', 'notification_logs', ['farm_id', 'channel'])
    op.create_index('idx_notification_logs_status_created', 'notification_logs', ['status', 'created_at'])
    op.create_index('idx_device_tokens_farm_active', 'device_tokens', ['farm_id', 'is_active'])


def downgrade():
    op.drop_index('idx_device_tokens_farm_active')
    op.drop_index('idx_notification_logs_status_created')
    op.drop_index('idx_notification_logs_farm_channel')
    
    op.drop_table('notification_logs')
    op.drop_table('device_tokens')
    op.drop_table('farm_notification_preferences')
