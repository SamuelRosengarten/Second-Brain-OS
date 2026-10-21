-- Second Brain OS initial schema. Markdown files in the vault are the source of truth for note bodies.
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','paused','done','archived')),
  goals TEXT NOT NULL DEFAULT '',
  target_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,            -- relative to the vault dir
  category TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'manual',  -- manual | capture | import | claude
  source_ref TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE note_tags (note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (note_id, tag));
CREATE INDEX idx_note_tags_tag ON note_tags(tag);

-- one FTS row per chunk (chunk_id = chunks.id) so results can cite a precise passage
CREATE VIRTUAL TABLE note_fts USING fts5(note_id UNINDEXED, chunk_id UNINDEXED, title, heading, body, tags, tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  embedding BLOB,
  embed_model TEXT
);
CREATE INDEX idx_chunks_note ON chunks(note_id);

CREATE TABLE project_notes (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, note_id)
);

CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','idea','task','project_note','link','excerpt','file')),
  original_content TEXT NOT NULL,       -- never modified after creation
  content TEXT NOT NULL,                -- user-editable working copy
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','processing','proposed','accepted','dismissed','failed')),
  archived INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  proposal_json TEXT,                   -- AI proposal, kept separate from original content
  model TEXT,
  error TEXT,
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_captures_status ON captures(status, archived);
CREATE INDEX idx_captures_hash ON captures(content_hash);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  capture_id TEXT REFERENCES captures(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,               -- sanitized display name
  stored_path TEXT NOT NULL,            -- relative to attachments dir
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_attachments_hash ON attachments(sha256);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  due_date TEXT,                        -- YYYY-MM-DD
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status, due_date);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  sources_json TEXT,                    -- retrieved passages actually shown to the model
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('imported','duplicate','failed','unsupported')),
  error TEXT,
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','ok','error')),
  detail TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT
);
