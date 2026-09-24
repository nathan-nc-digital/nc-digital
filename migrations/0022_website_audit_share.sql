-- Private client links for website audit reports: an unguessable token opens a read-only,
-- client-safe view at /report/<token>. Views are counted so follow-ups can be timed.
ALTER TABLE website_audits ADD COLUMN share_token TEXT;
ALTER TABLE website_audits ADD COLUMN share_created_at TEXT;
ALTER TABLE website_audits ADD COLUMN share_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE website_audits ADD COLUMN share_last_viewed_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS website_audits_share_token ON website_audits(share_token);
