-- Applied manually via `wrangler d1 execute --file=`, not `wrangler d1 migrations apply` (no migrations_dir configured).
ALTER TABLE jobs ADD COLUMN completed_at TEXT;
