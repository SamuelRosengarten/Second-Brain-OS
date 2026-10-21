-- Soft delete for tasks: a deleted task keeps its id and is hidden until restored or purged (auto-purged after 30 days).
ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_tasks_deleted ON tasks(deleted_at);
