CREATE TABLE IF NOT EXISTS analytics_reports (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, property TEXT NOT NULL,
 title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 status TEXT NOT NULL, state TEXT NOT NULL, report TEXT, notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS analytics_reports_cache ON analytics_reports(fingerprint,created_at);
CREATE TABLE IF NOT EXISTS analytics_report_data (report_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(report_id,kind));
CREATE TABLE IF NOT EXISTS analytics_report_lock (id INTEGER PRIMARY KEY, owner TEXT, expires_at TEXT NOT NULL);
INSERT OR IGNORE INTO analytics_report_lock(id,expires_at) VALUES(1,'2000-01-01');
