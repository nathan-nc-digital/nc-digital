-- Additive, after 0016. Keeps failed imports visible without blocking other replies.
CREATE TABLE crm_sync_items (
  provider_id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES crm_tickets(id),
  folder_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  received_at TEXT NOT NULL,
  has_attachment INTEGER NOT NULL DEFAULT 0 CHECK(has_attachment IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','retry','needs_review')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX crm_sync_due ON crm_sync_items(status,next_attempt_at,received_at);
ALTER TABLE crm_messages ADD COLUMN delivery_confirmed_by TEXT;
ALTER TABLE crm_messages ADD COLUMN delivery_confirmation_note TEXT;
ALTER TABLE crm_messages ADD COLUMN delivery_confirmed_at TEXT;
INSERT INTO crm_state(key,value) VALUES('reliability_schema','1');
