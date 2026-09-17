CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_deliveries (
  post_id TEXT NOT NULL REFERENCES social_posts(id),
  channel_id TEXT NOT NULL,
  service TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  input TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  remote_id TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (post_id, channel_id)
);
CREATE INDEX IF NOT EXISTS social_posts_created ON social_posts(created_at DESC);
