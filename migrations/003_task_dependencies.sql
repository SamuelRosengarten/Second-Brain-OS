-- Task dependencies ("depends_on must be finished before task_id") and AI-suggested dependencies awaiting the user's review.
CREATE TABLE task_deps (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id <> depends_on)
);
CREATE INDEX idx_task_deps_on ON task_deps(depends_on);

-- A suggestion is only a proposal: it never changes the workflow until accepted. Dismissed pairs are remembered so they are not proposed again.
CREATE TABLE dep_suggestions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,       -- the task that would wait
  depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,    -- the task to finish first
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','dismissed')),
  model TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (task_id, depends_on)
);
