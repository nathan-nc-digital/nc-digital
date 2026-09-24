-- Live Search Console data for the admin: the latest insights snapshot per property, URL Inspection
-- results per sitemap page (with the date each page first appeared), a DataForSEO spend ledger
-- written by every paid lookup, and small admin settings such as the monthly spend budget.
CREATE TABLE IF NOT EXISTS gsc_snapshots (site TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gsc_index_pages (
  site TEXT NOT NULL, url TEXT NOT NULL, in_sitemap INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','indexed','not-indexed','unknown')),
  verdict TEXT, coverage_state TEXT, page_fetch_state TEXT, last_crawl_time TEXT, google_canonical TEXT, user_canonical TEXT, inspected_at TEXT,
  PRIMARY KEY(site, url)
);
CREATE INDEX IF NOT EXISTS gsc_index_due ON gsc_index_pages(site, in_sitemap, inspected_at);
CREATE TABLE IF NOT EXISTS gsc_index_runs (
  site TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'all', started_at TEXT, finished_at TEXT, sitemap_checked_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS dataforseo_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, tool TEXT NOT NULL, endpoint TEXT NOT NULL, cost REAL NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS dataforseo_usage_at ON dataforseo_usage(at);
CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
