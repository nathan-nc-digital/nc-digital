CREATE TABLE IF NOT EXISTS seo_win_reports(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, site TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL, report TEXT);
CREATE INDEX IF NOT EXISTS seo_win_reports_fingerprint ON seo_win_reports(fingerprint,created_at);
CREATE TABLE IF NOT EXISTS seo_win_data(report_id TEXT NOT NULL, kind TEXT NOT NULL, part INTEGER NOT NULL, rows TEXT NOT NULL, PRIMARY KEY(report_id,kind,part));
CREATE TABLE IF NOT EXISTS seo_win_tasks(site TEXT NOT NULL, page TEXT NOT NULL, status TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(site,page));
CREATE TABLE IF NOT EXISTS seo_win_lock(id INTEGER PRIMARY KEY, owner TEXT, expires_at TEXT NOT NULL);
INSERT OR IGNORE INTO seo_win_lock VALUES(1,NULL,'2000-01-01');
