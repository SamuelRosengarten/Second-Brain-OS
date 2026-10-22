-- Internship scout: postings found by the cloud agent, tracked by status. Nothing here is ever sent anywhere.
CREATE TABLE postings (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  url_type TEXT NOT NULL DEFAULT 'posting' CHECK (url_type IN ('posting','search_page')),
  score INTEGER CHECK (score BETWEEN 1 AND 5),
  dates_note TEXT NOT NULL DEFAULT '',
  technologies TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','interested','emailed','applied','interview','rejected','closed')),
  recruiter_email TEXT,
  email_source_url TEXT,
  draft_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  scout_run_id TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_postings_status ON postings(status, score);

CREATE TABLE scout_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','ok','error')),
  found INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  usage_json TEXT,
  notes TEXT NOT NULL DEFAULT '',
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
