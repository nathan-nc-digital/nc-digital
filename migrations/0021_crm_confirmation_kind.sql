-- Adds a 'confirmation' message kind for the automatic "ticket opened" email sent to a
-- customer the moment they submit an enquiry. This is a table rebuild because SQLite
-- cannot alter a CHECK constraint in place. All existing rows and columns are preserved.
-- crm_message_attempts.message_id references this table. Following SQLite's documented
-- procedure for altering a table other tables have a foreign key to, constraint
-- enforcement is switched off for the rebuild and back on immediately after.
PRAGMA foreign_keys=OFF;
CREATE TABLE crm_messages_new (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES crm_tickets(id),
  kind TEXT NOT NULL CHECK(kind IN ('inbound','outbound','note','event','notification','confirmation')),
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  delivery TEXT NOT NULL DEFAULT 'received' CHECK(delivery IN ('received','queued','sending','sent','failed','unknown','cancelled')),
  provider_id TEXT UNIQUE,
  request_key TEXT UNIQUE,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  full_body TEXT,
  source_html TEXT,
  send_context INTEGER CHECK(send_context IN (0,1)),
  quote_id TEXT REFERENCES crm_quotes(id),
  quote_revision INTEGER,
  delivery_confirmed_by TEXT,
  delivery_confirmation_note TEXT,
  delivery_confirmed_at TEXT
);
INSERT INTO crm_messages_new(id,ticket_id,kind,author,body,delivery,provider_id,request_key,error,created_at,updated_at,full_body,source_html,send_context,quote_id,quote_revision,delivery_confirmed_by,delivery_confirmation_note,delivery_confirmed_at)
  SELECT id,ticket_id,kind,author,body,delivery,provider_id,request_key,error,created_at,updated_at,full_body,source_html,send_context,quote_id,quote_revision,delivery_confirmed_by,delivery_confirmation_note,delivery_confirmed_at
  FROM crm_messages;
DROP TABLE crm_messages;
ALTER TABLE crm_messages_new RENAME TO crm_messages;

CREATE INDEX crm_message_ticket ON crm_messages(ticket_id,created_at);
CREATE INDEX crm_message_queue ON crm_messages(delivery,created_at);

INSERT OR REPLACE INTO crm_state(key,value) VALUES('confirmation_schema','1');
PRAGMA foreign_keys=ON;
