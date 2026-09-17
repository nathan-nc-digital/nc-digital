-- Additive CRM upgrade. Apply ONCE after 0015, with a verified backup first.
-- Retain all legacy ticket IDs, references, messages and job relationships.
CREATE TABLE crm_accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  lifecycle TEXT NOT NULL DEFAULT 'prospect' CHECK(lifecycle IN ('prospect','customer','inactive')),
  notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX crm_accounts_name ON crm_accounts(name COLLATE NOCASE);
CREATE INDEX crm_accounts_email ON crm_accounts(email);
CREATE TABLE crm_contacts (
  id TEXT PRIMARY KEY, account_id TEXT REFERENCES crm_accounts(id), name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', job_title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX crm_contacts_account ON crm_contacts(account_id);
CREATE INDEX crm_contacts_email ON crm_contacts(email);
CREATE INDEX crm_contacts_phone ON crm_contacts(phone);
CREATE TABLE crm_stages (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
  probability INTEGER NOT NULL CHECK(probability BETWEEN 0 AND 100),
  outcome TEXT NOT NULL DEFAULT 'open' CHECK(outcome IN ('open','won','lost','future')),
  version INTEGER NOT NULL DEFAULT 1, archived_at TEXT
);
INSERT INTO crm_stages(id,name,position,probability,outcome) VALUES
 ('new','New opportunity',10,10,'open'),('qualified','Qualified',20,30,'open'),
 ('preparation','Quote preparation',30,50,'open'),('quoted','Quote sent',40,65,'open'),
 ('decision','Decision',50,80,'open'),('won','Won',60,100,'won'),
 ('lost','Lost',70,0,'lost'),('future','Future opportunity',80,10,'future');
CREATE TABLE crm_opportunities (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES crm_accounts(id),
  contact_id TEXT REFERENCES crm_contacts(id), ticket_id TEXT REFERENCES crm_tickets(id),
  title TEXT NOT NULL, service TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
  stage_id TEXT NOT NULL REFERENCES crm_stages(id), owner TEXT NOT NULL DEFAULT 'nathan' CHECK(owner='nathan'),
  value_pence INTEGER NOT NULL DEFAULT 0 CHECK(value_pence BETWEEN 0 AND 1000000000),
  expected_close TEXT, outcome_reason TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  stage_changed_at TEXT NOT NULL, won_at TEXT, lost_at TEXT, archived_at TEXT,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX crm_opportunities_account ON crm_opportunities(account_id,updated_at);
CREATE INDEX crm_opportunities_stage ON crm_opportunities(stage_id,updated_at);
CREATE TABLE crm_tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  account_id TEXT REFERENCES crm_accounts(id), opportunity_id TEXT REFERENCES crm_opportunities(id),
  ticket_id TEXT REFERENCES crm_tickets(id), service_id TEXT REFERENCES crm_services(id),
  owner TEXT NOT NULL DEFAULT 'nathan' CHECK(owner='nathan'),
  kind TEXT NOT NULL DEFAULT 'followup' CHECK(kind IN ('followup','call','meeting','onboarding','renewal','task')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','cancelled')),
  completed_at TEXT, external_key TEXT UNIQUE, version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX crm_tasks_due ON crm_tasks(status,due_date);
CREATE INDEX crm_tasks_opportunity ON crm_tasks(opportunity_id,status);
CREATE INDEX crm_tasks_account ON crm_tasks(account_id,status);
CREATE TABLE crm_quotes (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL REFERENCES crm_accounts(id),
  opportunity_id TEXT REFERENCES crm_opportunities(id), ticket_id TEXT REFERENCES crm_tickets(id),
  title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','sent','accepted','rejected','expired')),
  currency TEXT NOT NULL DEFAULT 'GBP' CHECK(currency='GBP'), expires_on TEXT NOT NULL,
  terms TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  total_pence INTEGER NOT NULL DEFAULT 0 CHECK(total_pence>=0),
  revision INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
  sent_at TEXT, accepted_at TEXT, acceptance_note TEXT, archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX crm_quotes_account ON crm_quotes(account_id,updated_at);
CREATE TABLE crm_quote_items (
  id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES crm_quotes(id), position INTEGER NOT NULL,
  description TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
  unit_pence INTEGER NOT NULL CHECK(unit_pence BETWEEN 0 AND 1000000000),
  vat_bps INTEGER NOT NULL DEFAULT 0 CHECK(vat_bps BETWEEN 0 AND 10000),
  frequency TEXT NOT NULL DEFAULT 'once' CHECK(frequency IN ('once','monthly','quarterly','annual')),
  net_pence INTEGER NOT NULL, tax_pence INTEGER NOT NULL, total_pence INTEGER NOT NULL
);
CREATE INDEX crm_quote_items_quote ON crm_quote_items(quote_id,position);
CREATE TABLE crm_quote_revisions (
  id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES crm_quotes(id), revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL, created_at TEXT NOT NULL, author TEXT NOT NULL,
  UNIQUE(quote_id,revision)
);
CREATE TABLE crm_services (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES crm_accounts(id), quote_id TEXT REFERENCES crm_quotes(id),
  name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  price_pence INTEGER NOT NULL CHECK(price_pence BETWEEN 0 AND 1000000000),
  frequency TEXT NOT NULL CHECK(frequency IN ('monthly','quarterly','annual','once')),
  starts_on TEXT NOT NULL, renews_on TEXT, ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled')),
  cancellation_reason TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX crm_services_account ON crm_services(account_id,status);
CREATE INDEX crm_services_renewal ON crm_services(status,renews_on);
CREATE TABLE crm_activities (
  id TEXT PRIMARY KEY, account_id TEXT REFERENCES crm_accounts(id),
  opportunity_id TEXT REFERENCES crm_opportunities(id), ticket_id TEXT REFERENCES crm_tickets(id),
  kind TEXT NOT NULL, body TEXT NOT NULL, author TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX crm_activities_account ON crm_activities(account_id,created_at,id);
CREATE TABLE crm_audit (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX crm_audit_record ON crm_audit(entity,entity_id,created_at);
CREATE TABLE crm_drafts (
  owner TEXT NOT NULL, draft_key TEXT NOT NULL, body TEXT NOT NULL, request_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY(owner,draft_key)
);
ALTER TABLE crm_tickets ADD COLUMN submission_hash TEXT;
ALTER TABLE crm_tickets ADD COLUMN account_id TEXT REFERENCES crm_accounts(id);
ALTER TABLE crm_tickets ADD COLUMN contact_id TEXT REFERENCES crm_contacts(id);
ALTER TABLE crm_tickets ADD COLUMN archived_at TEXT;
ALTER TABLE crm_messages ADD COLUMN full_body TEXT;
ALTER TABLE crm_messages ADD COLUMN source_html TEXT;
ALTER TABLE crm_messages ADD COLUMN send_context INTEGER CHECK(send_context IN (0,1));
ALTER TABLE crm_messages ADD COLUMN quote_id TEXT REFERENCES crm_quotes(id);
ALTER TABLE crm_messages ADD COLUMN quote_revision INTEGER;
CREATE INDEX crm_ticket_updated ON crm_tickets(updated_at,id);
CREATE INDEX crm_ticket_followup ON crm_tickets(follow_up_at) WHERE follow_up_at IS NOT NULL AND archived_at IS NULL;
CREATE INDEX crm_ticket_account ON crm_tickets(account_id,updated_at);
CREATE INDEX crm_limit_expiry ON crm_limits(expires_at);
CREATE TABLE crm_message_attempts (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES crm_messages(id),
  started_at TEXT NOT NULL, finished_at TEXT, outcome TEXT NOT NULL, provider_id TEXT
);
CREATE INDEX crm_attempt_message ON crm_message_attempts(message_id,started_at);
-- Preserve existing follow-up commitments without inventing customer identities.
INSERT INTO crm_tasks(id,title,ticket_id,owner,kind,due_date,external_key,created_at,updated_at)
 SELECT 'followup-'||id,'Follow up: '||name,id,'nathan','followup',CASE WHEN datetime(follow_up_at)>=datetime(strftime('%Y',follow_up_at)||'-03-31','-6 days','weekday 0','+1 hour') AND datetime(follow_up_at)<datetime(strftime('%Y',follow_up_at)||'-10-31','-6 days','weekday 0','+1 hour') THEN date(follow_up_at,'+1 hour') ELSE date(follow_up_at) END,'ticket-followup:'||id,created_at,updated_at
 FROM crm_tickets WHERE follow_up_at IS NOT NULL AND status NOT IN ('closed','spam');


-- Enforce parent availability inside the transaction, including concurrent archive/create.
CREATE TRIGGER crm_contacts_active_account_insert BEFORE INSERT ON crm_contacts
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_contacts_active_account_update BEFORE UPDATE ON crm_contacts
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_opportunities_active_account_insert BEFORE INSERT ON crm_opportunities
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_opportunities_active_account_update BEFORE UPDATE ON crm_opportunities
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_tasks_active_account_insert BEFORE INSERT ON crm_tasks
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_tasks_active_account_update BEFORE UPDATE ON crm_tasks
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_quotes_active_account_insert BEFORE INSERT ON crm_quotes
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_quotes_active_account_update BEFORE UPDATE ON crm_quotes
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_services_active_account_insert BEFORE INSERT ON crm_services
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_services_active_account_update BEFORE UPDATE ON crm_services
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_account_archive_guard BEFORE UPDATE OF archived_at ON crm_accounts
WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL AND (
EXISTS(SELECT 1 FROM crm_opportunities o JOIN crm_stages s ON s.id=o.stage_id WHERE o.account_id=NEW.id AND o.archived_at IS NULL AND s.outcome IN ('open','future')) OR
EXISTS(SELECT 1 FROM crm_services WHERE account_id=NEW.id AND archived_at IS NULL AND status IN ('active','paused')) OR
EXISTS(SELECT 1 FROM crm_tasks WHERE account_id=NEW.id AND archived_at IS NULL AND status='open') OR
EXISTS(SELECT 1 FROM crm_quotes WHERE account_id=NEW.id AND archived_at IS NULL AND status IN ('draft','queued','sent')))
BEGIN SELECT RAISE(ABORT,'crm_customer_has_open_work'); END;
CREATE TRIGGER crm_tasks_opportunity_account_insert BEFORE INSERT ON crm_tasks
WHEN NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_opportunities WHERE id=NEW.opportunity_id AND account_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'crm_relationship_mismatch'); END;
CREATE TRIGGER crm_tasks_opportunity_account_update BEFORE UPDATE ON crm_tasks
WHEN NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_opportunities WHERE id=NEW.opportunity_id AND account_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'crm_relationship_mismatch'); END;
CREATE TRIGGER crm_quotes_opportunity_account_insert BEFORE INSERT ON crm_quotes
WHEN NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_opportunities WHERE id=NEW.opportunity_id AND account_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'crm_relationship_mismatch'); END;
CREATE TRIGGER crm_quotes_opportunity_account_update BEFORE UPDATE ON crm_quotes
WHEN NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_opportunities WHERE id=NEW.opportunity_id AND account_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'crm_relationship_mismatch'); END;
CREATE TRIGGER crm_opportunity_account_guard BEFORE UPDATE OF account_id ON crm_opportunities
WHEN NEW.account_id<>OLD.account_id AND (EXISTS(SELECT 1 FROM crm_tasks WHERE opportunity_id=OLD.id) OR EXISTS(SELECT 1 FROM crm_quotes WHERE opportunity_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'crm_linked_opportunity_cannot_move'); END;
INSERT INTO crm_state(key,value) VALUES('workspace_schema','1');
