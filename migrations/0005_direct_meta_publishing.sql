ALTER TABLE social_deliveries ADD COLUMN provider TEXT NOT NULL DEFAULT 'buffer';
ALTER TABLE social_deliveries ADD COLUMN next_attempt_at TEXT;
ALTER TABLE social_deliveries ADD COLUMN provider_state TEXT;
CREATE INDEX social_meta_due ON social_deliveries(provider, status, next_attempt_at);
