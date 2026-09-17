-- Apply with the existing project's D1 execute workflow, before deploying CRM_ENABLED=true.
CREATE TABLE IF NOT EXISTS crm_tickets (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  submission_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  service TEXT NOT NULL DEFAULT '',
  source_page TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','open','waiting','closed','spam')),
  assigned_to TEXT NOT NULL DEFAULT 'nathan' CHECK(assigned_to IN ('nathan','ben')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  follow_up_at TEXT,
  job_id INTEGER REFERENCES jobs(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_inbound_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_ticket_status_updated ON crm_tickets(status,updated_at);
CREATE INDEX IF NOT EXISTS crm_ticket_email ON crm_tickets(email);
CREATE TABLE IF NOT EXISTS crm_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES crm_tickets(id),
  kind TEXT NOT NULL CHECK(kind IN ('inbound','outbound','note','event','notification')),
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  delivery TEXT NOT NULL DEFAULT 'received' CHECK(delivery IN ('received','queued','sending','sent','failed','unknown','cancelled')),
  provider_id TEXT UNIQUE,
  request_key TEXT UNIQUE,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_message_ticket ON crm_messages(ticket_id,created_at);
CREATE INDEX IF NOT EXISTS crm_message_queue ON crm_messages(delivery,created_at);
CREATE TABLE IF NOT EXISTS crm_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crm_limits (key TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at INTEGER NOT NULL);
