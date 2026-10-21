-- Redesign: time estimates on tasks (the Week plan sums them per day) and project/due hints on captures
-- (the phone Capture screen lets you pick them before the AI has seen the text).
ALTER TABLE tasks ADD COLUMN estimate_min INTEGER;
ALTER TABLE captures ADD COLUMN hint_project_id TEXT;
ALTER TABLE captures ADD COLUMN hint_due TEXT;
