-- Earlier GSC Insights refreshes (the latest 20 per property), so each refresh can show what
-- improved and what declined since a previous one.
CREATE TABLE IF NOT EXISTS gsc_snapshot_history (site TEXT NOT NULL, fetched_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(site, fetched_at));
