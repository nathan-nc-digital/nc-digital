-- Applied manually via `wrangler d1 execute --file=`, not `wrangler d1 migrations apply` (no migrations_dir configured).
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'doing', 'done')),
  eta TEXT,
  assigned_to TEXT NOT NULL CHECK (assigned_to IN ('nathan', 'ben')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
