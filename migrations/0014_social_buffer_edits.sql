CREATE TABLE IF NOT EXISTS social_buffer_edits (
  post_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  expected_text TEXT NOT NULL,
  replacement_text TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT,
  PRIMARY KEY (post_id, channel_id),
  FOREIGN KEY (post_id, channel_id) REFERENCES social_deliveries(post_id, channel_id)
);
