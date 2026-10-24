-- Tasks get a start date next to the due date, so a task covers a range (YYYY-MM-DD, both optional).
ALTER TABLE tasks ADD COLUMN start_date TEXT;
