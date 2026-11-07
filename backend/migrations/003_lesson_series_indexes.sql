CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_series_start ON lessons(series_id,starts_at_utc) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_series_active ON lesson_series(status,weekday);
