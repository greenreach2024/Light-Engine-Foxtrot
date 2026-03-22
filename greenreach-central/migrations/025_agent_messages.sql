-- Migration 025: Inter-Agent Messaging
-- Creates the agent_messages table for F.A.Y.E. <-> E.V.I.E. communication.
-- Messages have types (directive, escalation, observation, response, status_update),
-- priority levels, JSONB context for threading by farm/order/domain,
-- and read/unread status tracking.

CREATE TABLE IF NOT EXISTS agent_messages (
  id SERIAL PRIMARY KEY,
  sender VARCHAR(20) NOT NULL,
  recipient VARCHAR(20) NOT NULL,
  message_type VARCHAR(30) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  priority VARCHAR(10) DEFAULT 'normal',
  reply_to_id INTEGER REFERENCES agent_messages(id),
  status VARCHAR(10) DEFAULT 'unread',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast unread message retrieval per agent
CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient_status
  ON agent_messages (recipient, status, created_at DESC);

-- Index for context-based lookups (e.g. all messages about a specific farm)
CREATE INDEX IF NOT EXISTS idx_agent_messages_context
  ON agent_messages USING gin (context);

-- Index for message threading (reply chains)
CREATE INDEX IF NOT EXISTS idx_agent_messages_reply_to
  ON agent_messages (reply_to_id) WHERE reply_to_id IS NOT NULL;
