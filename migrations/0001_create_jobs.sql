CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  user_email      TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'pending',
  original_key    TEXT NOT NULL,
  processed_key   TEXT,
  original_name   TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (state IN ('pending', 'in_progress', 'completed', 'failed'))
);

CREATE INDEX idx_jobs_user_created
  ON jobs (user_email, created_at DESC);
