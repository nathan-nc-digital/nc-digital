-- Email Nathan when a prospect opens their shared website review: share_alert_due is set by the
-- public page on a first open (or a return visit after a gap) and cleared once the alert is sent.
ALTER TABLE website_audits ADD COLUMN share_alert_due TEXT;
ALTER TABLE website_audits ADD COLUMN share_alerted_at TEXT;
CREATE INDEX IF NOT EXISTS website_audits_alert_due ON website_audits(share_alert_due);
