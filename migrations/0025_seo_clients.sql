-- Saved SEO clients (property pairing, name variations, enquiry events, ranking searches) and
-- private client links with open alerts for SEO reports.
CREATE TABLE IF NOT EXISTS seo_clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, property TEXT NOT NULL, site TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT 'all',
  brand_terms TEXT NOT NULL DEFAULT '[]', enquiry_events TEXT NOT NULL DEFAULT '[]', keywords TEXT NOT NULL DEFAULT '[]',
  location_code INTEGER, location_name TEXT, contact_name TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE analytics_reports ADD COLUMN client_id TEXT;
ALTER TABLE analytics_reports ADD COLUMN share_token TEXT;
ALTER TABLE analytics_reports ADD COLUMN share_created_at TEXT;
ALTER TABLE analytics_reports ADD COLUMN share_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_reports ADD COLUMN share_last_viewed_at TEXT;
ALTER TABLE analytics_reports ADD COLUMN share_alert_due TEXT;
ALTER TABLE analytics_reports ADD COLUMN share_alerted_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS analytics_reports_share_token ON analytics_reports(share_token);
CREATE INDEX IF NOT EXISTS analytics_reports_client ON analytics_reports(client_id, created_at);
CREATE INDEX IF NOT EXISTS analytics_reports_alert_due ON analytics_reports(share_alert_due);
