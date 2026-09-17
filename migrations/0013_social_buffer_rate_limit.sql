CREATE TABLE IF NOT EXISTS social_buffer_api_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  retry_at TEXT NOT NULL
);
INSERT OR IGNORE INTO social_buffer_api_state (id, retry_at) VALUES (1, '2000-01-01');
