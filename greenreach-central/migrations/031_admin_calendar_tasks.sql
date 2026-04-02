-- Migration 031: Admin Calendar Events and Tasks
-- Adds calendar events, tasks, and task reminders for GreenReach Central admin team management

CREATE TABLE IF NOT EXISTS admin_calendar_events (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(500) NOT NULL,
  description     TEXT,
  event_date      DATE NOT NULL,
  start_time      TIME,
  end_time        TIME,
  all_day         BOOLEAN NOT NULL DEFAULT FALSE,
  location        VARCHAR(500),
  category        VARCHAR(100) DEFAULT 'general',
  recurrence      VARCHAR(50),
  recurrence_end  DATE,
  assigned_to     TEXT[],
  created_by      VARCHAR(255),
  status          VARCHAR(50) NOT NULL DEFAULT 'scheduled',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cal_events_date ON admin_calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_cal_events_status ON admin_calendar_events(status);
CREATE INDEX IF NOT EXISTS idx_cal_events_category ON admin_calendar_events(category);

CREATE TABLE IF NOT EXISTS admin_tasks (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(500) NOT NULL,
  description     TEXT,
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority        VARCHAR(50) NOT NULL DEFAULT 'medium',
  due_date        DATE,
  due_time        TIME,
  assigned_to     VARCHAR(255),
  category        VARCHAR(100) DEFAULT 'general',
  tags            TEXT[],
  completed_at    TIMESTAMPTZ,
  completed_by    VARCHAR(255),
  created_by      VARCHAR(255),
  parent_task_id  INTEGER REFERENCES admin_tasks(id) ON DELETE SET NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON admin_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON admin_tasks(due_date) WHERE status != 'completed';
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON admin_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON admin_tasks(priority) WHERE status != 'completed';

CREATE TABLE IF NOT EXISTS admin_task_reminders (
  id              SERIAL PRIMARY KEY,
  task_id         INTEGER REFERENCES admin_tasks(id) ON DELETE CASCADE,
  event_id        INTEGER REFERENCES admin_calendar_events(id) ON DELETE CASCADE,
  remind_at       TIMESTAMPTZ NOT NULL,
  method          VARCHAR(50) NOT NULL DEFAULT 'in_app',
  recipient       VARCHAR(255),
  sent            BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reminder_has_target CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_reminders_pending ON admin_task_reminders(remind_at) WHERE sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_reminders_task ON admin_task_reminders(task_id);
CREATE INDEX IF NOT EXISTS idx_reminders_event ON admin_task_reminders(event_id);
