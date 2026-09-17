CREATE TABLE IF NOT EXISTS keyword_reports (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  query TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  report TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS keyword_reports_lookup ON keyword_reports(fingerprint, created_at DESC);
CREATE TABLE IF NOT EXISTS keyword_research_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
INSERT OR IGNORE INTO keyword_research_lock VALUES (1, '', '1970-01-01T00:00:00.000Z');
