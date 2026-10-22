-- Scout automation: one schedule row, the accepted postings you keep, and URLs you denied or replaced (so they are not shown again).
CREATE TABLE scout_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  times TEXT NOT NULL DEFAULT '["12:00"]',
  days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  last_fired TEXT
);
INSERT INTO scout_schedule (id) VALUES (1);

CREATE TABLE saved_postings (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  url_type TEXT NOT NULL DEFAULT 'posting',
  score INTEGER,
  dates_note TEXT NOT NULL DEFAULT '',
  technologies TEXT NOT NULL DEFAULT '',
  recruiter_email TEXT,
  email_source_url TEXT,
  draft_text TEXT NOT NULL DEFAULT '',
  saved_at TEXT NOT NULL
);

CREATE TABLE dismissed_urls (
  url TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
