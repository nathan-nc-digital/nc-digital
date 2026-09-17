-- Allow tasks to be created before a date is known. Existing dates and links are preserved.
-- This is a table rebuild because SQLite cannot alter a NOT NULL constraint in place.
DROP TRIGGER IF EXISTS crm_tasks_active_account_insert;
DROP TRIGGER IF EXISTS crm_tasks_active_account_update;
DROP TRIGGER IF EXISTS crm_tasks_opportunity_account_insert;
DROP TRIGGER IF EXISTS crm_tasks_opportunity_account_update;
DROP TRIGGER IF EXISTS crm_account_archive_guard;
DROP TRIGGER IF EXISTS crm_opportunity_account_guard;

CREATE TABLE crm_tasks_new (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  account_id TEXT REFERENCES crm_accounts(id), opportunity_id TEXT REFERENCES crm_opportunities(id),
  ticket_id TEXT REFERENCES crm_tickets(id), service_id TEXT REFERENCES crm_services(id),
  owner TEXT NOT NULL DEFAULT 'nathan' CHECK(owner='nathan'),
  kind TEXT NOT NULL DEFAULT 'followup' CHECK(kind IN ('followup','call','meeting','onboarding','renewal','task')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  due_date TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','cancelled')),
  completed_at TEXT, external_key TEXT UNIQUE, version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO crm_tasks_new(id,title,description,account_id,opportunity_id,ticket_id,service_id,owner,kind,priority,due_date,status,completed_at,external_key,version,archived_at,created_at,updated_at)
  SELECT id,title,description,account_id,opportunity_id,ticket_id,service_id,owner,kind,priority,due_date,status,completed_at,external_key,version,archived_at,created_at,updated_at
  FROM crm_tasks;
DROP TABLE crm_tasks;
ALTER TABLE crm_tasks_new RENAME TO crm_tasks;

CREATE INDEX crm_tasks_due ON crm_tasks(status,due_date);
CREATE INDEX crm_tasks_opportunity ON crm_tasks(opportunity_id,status);
CREATE INDEX crm_tasks_account ON crm_tasks(account_id,status);

CREATE TRIGGER crm_tasks_active_account_insert BEFORE INSERT ON crm_tasks
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_tasks_active_account_update BEFORE UPDATE ON crm_tasks
WHEN NEW.account_id IS NOT NULL AND NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_accounts WHERE id=NEW.account_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'crm_parent_archived'); END;
CREATE TRIGGER crm_tasks_opportunity_account_insert BEFORE INSERT ON crm_tasks
WHEN NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_opportunities WHERE id=NEW.opportunity_id AND account_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'crm_relationship_mismatch'); END;
CREATE TRIGGER crm_tasks_opportunity_account_update BEFORE UPDATE ON crm_tasks
WHEN NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_opportunities WHERE id=NEW.opportunity_id AND account_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'crm_relationship_mismatch'); END;
CREATE TRIGGER crm_account_archive_guard BEFORE UPDATE OF archived_at ON crm_accounts
WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL AND (
EXISTS(SELECT 1 FROM crm_opportunities o JOIN crm_stages s ON s.id=o.stage_id WHERE o.account_id=NEW.id AND o.archived_at IS NULL AND s.outcome IN ('open','future')) OR
EXISTS(SELECT 1 FROM crm_services WHERE account_id=NEW.id AND archived_at IS NULL AND status IN ('active','paused')) OR
EXISTS(SELECT 1 FROM crm_tasks WHERE account_id=NEW.id AND archived_at IS NULL AND status='open') OR
EXISTS(SELECT 1 FROM crm_quotes WHERE account_id=NEW.id AND archived_at IS NULL AND status IN ('draft','queued','sent')))
BEGIN SELECT RAISE(ABORT,'crm_customer_has_open_work'); END;
CREATE TRIGGER crm_opportunity_account_guard BEFORE UPDATE OF account_id ON crm_opportunities
WHEN NEW.account_id<>OLD.account_id AND (EXISTS(SELECT 1 FROM crm_tasks WHERE opportunity_id=OLD.id) OR EXISTS(SELECT 1 FROM crm_quotes WHERE opportunity_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'crm_linked_opportunity_cannot_move'); END;

INSERT OR REPLACE INTO crm_state(key,value) VALUES('task_dates_schema','1');
