CREATE TABLE IF NOT EXISTS website_audits(id TEXT PRIMARY KEY, url TEXT NOT NULL, client TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS website_audits_url ON website_audits(url, created_at);
CREATE TABLE IF NOT EXISTS website_audit_lock(id INTEGER PRIMARY KEY, owner TEXT, expires_at TEXT NOT NULL);
INSERT OR IGNORE INTO website_audit_lock VALUES(1,NULL,'2000-01-01');
