ALTER TABLE lesson_students ADD COLUMN actual_teacher_id INTEGER REFERENCES teachers(id);
ALTER TABLE lesson_students ADD COLUMN confirmed_by INTEGER REFERENCES users(id);
