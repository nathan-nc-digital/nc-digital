-- Additive CRM productivity upgrade. Apply after 0018 with a verified backup.
-- Saved views are private to their owner and store only validated list filters.
CREATE TABLE crm_saved_views (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL CHECK(owner='nathan'),
  entity TEXT NOT NULL CHECK(entity IN ('accounts','opportunities','tasks','quotes','services')),
  name TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX crm_saved_views_owner ON crm_saved_views(owner,entity,archived_at,name COLLATE NOCASE);
CREATE UNIQUE INDEX crm_saved_views_name ON crm_saved_views(owner,entity,name COLLATE NOCASE) WHERE archived_at IS NULL;
INSERT INTO crm_state(key,value) VALUES('saved_views_schema','1');
