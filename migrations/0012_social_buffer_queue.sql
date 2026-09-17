CREATE TABLE IF NOT EXISTS social_buffer_queue_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT,
  expires_at TEXT NOT NULL
);
INSERT OR IGNORE INTO social_buffer_queue_lock (id, expires_at) VALUES (1, '2000-01-01');
