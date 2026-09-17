-- Applied manually via `wrangler d1 execute --file=`, not `wrangler d1 migrations apply` (no migrations_dir configured).
CREATE TABLE IF NOT EXISTS job_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('nathan', 'ben')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
