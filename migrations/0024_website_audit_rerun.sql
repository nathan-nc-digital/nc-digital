-- Re-running an audit in place keeps its client link. While the update runs, the public link keeps
-- showing the last completed version, held here and cleared when the new run completes.
ALTER TABLE website_audits ADD COLUMN previous_state TEXT;
