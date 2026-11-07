-- 乐也教学管理系统核心业务结构。旧 courses / bookings 表保留，不删除历史数据。
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openid TEXT UNIQUE,
  phone TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('owner','teacher','guardian')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS family_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES families(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  relationship TEXT NOT NULL DEFAULT 'guardian',
  can_view_schedule INTEGER NOT NULL DEFAULT 1 CHECK(can_view_schedule IN (0,1)),
  can_view_finance INTEGER NOT NULL DEFAULT 1 CHECK(can_view_finance IN (0,1)),
  can_view_growth INTEGER NOT NULL DEFAULT 1 CHECK(can_view_growth IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','revoked')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(family_id,user_id)
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES families(id),
  name TEXT NOT NULL,
  birth_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS student_guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  can_view_schedule INTEGER NOT NULL DEFAULT 1 CHECK(can_view_schedule IN (0,1)),
  can_view_finance INTEGER NOT NULL DEFAULT 1 CHECK(can_view_finance IN (0,1)),
  can_view_growth INTEGER NOT NULL DEFAULT 1 CHECK(can_view_growth IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','revoked')),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  UNIQUE(student_id,user_id)
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK(capacity > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS courses_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '声乐',
  mode TEXT NOT NULL CHECK(mode IN ('one_to_one','small_group','collective','exam')),
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS course_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses_catalog(id),
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  paid_lessons INTEGER NOT NULL CHECK(paid_lessons >= 0),
  bonus_lessons INTEGER NOT NULL DEFAULT 0 CHECK(bonus_lessons >= 0),
  validity_days INTEGER CHECK(validity_days IS NULL OR validity_days > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lesson_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER REFERENCES students(id),
  class_name TEXT,
  course_id INTEGER NOT NULL REFERENCES courses_catalog(id),
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  mode TEXT NOT NULL CHECK(mode IN ('one_to_one','small_group','collective','exam')),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 10 AND 360),
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','ended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER REFERENCES lesson_series(id),
  course_id INTEGER NOT NULL REFERENCES courses_catalog(id),
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  starts_at_utc TEXT NOT NULL,
  ends_at_utc TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK(status IN ('scheduled','rescheduled','studio_cancelled','teacher_unavailable','completed','archived')),
  original_lesson_id INTEGER REFERENCES lessons(id),
  adjustment_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(ends_at_utc > starts_at_utc)
);
CREATE INDEX IF NOT EXISTS idx_lessons_starts ON lessons(starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_lessons_teacher ON lessons(teacher_id,starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_lessons_room ON lessons(room_id,starts_at_utc);
CREATE TABLE IF NOT EXISTS lesson_students (
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  attendance_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(attendance_status IN ('pending','present','student_absent','student_leave','teacher_unavailable','studio_cancelled')),
  teacher_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(teacher_confirmed IN (0,1)),
  confirmed_at TEXT,
  PRIMARY KEY(lesson_id,student_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partially_paid','paid','refunded','cancelled')),
  total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
  received_cents INTEGER NOT NULL DEFAULT 0 CHECK(received_cents >= 0),
  early_activation INTEGER NOT NULL DEFAULT 0 CHECK(early_activation IN (0,1)),
  early_activation_reason TEXT NOT NULL DEFAULT '',
  activated_by INTEGER REFERENCES users(id),
  activated_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  course_id INTEGER NOT NULL REFERENCES courses_catalog(id),
  product_id INTEGER REFERENCES course_products(id),
  product_name_snapshot TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  paid_lessons INTEGER NOT NULL CHECK(paid_lessons >= 0),
  bonus_lessons INTEGER NOT NULL DEFAULT 0 CHECK(bonus_lessons >= 0),
  validity_days INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  method TEXT NOT NULL,
  received_at TEXT NOT NULL,
  reference_note TEXT NOT NULL DEFAULT '',
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS entitlement_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  order_item_id INTEGER REFERENCES order_items(id),
  course_id INTEGER NOT NULL REFERENCES courses_catalog(id),
  paid_lessons INTEGER NOT NULL CHECK(paid_lessons >= 0),
  bonus_lessons INTEGER NOT NULL DEFAULT 0 CHECK(bonus_lessons >= 0),
  starts_on TEXT NOT NULL,
  expires_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','cancelled','refunded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS entitlement_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL REFERENCES entitlement_lots(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  lesson_id INTEGER REFERENCES lessons(id),
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('grant_paid','grant_bonus','consume_paid','consume_bonus','reverse','refund_cancel')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  reference_transaction_id INTEGER REFERENCES entitlement_transactions(id),
  note TEXT NOT NULL DEFAULT '',
  actor_user_id INTEGER REFERENCES users(id),
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_entitlement_transactions_lot ON entitlement_transactions(lot_id,id);
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  requested_cents INTEGER NOT NULL CHECK(requested_cents >= 0),
  approved_cents INTEGER NOT NULL CHECK(approved_cents >= 0),
  actual_refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK(actual_refunded_cents >= 0),
  reason TEXT NOT NULL,
  adjustment_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','paid','cancelled')),
  handled_by INTEGER REFERENCES users(id),
  refunded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lesson_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  internal_note TEXT NOT NULL DEFAULT '',
  parent_summary TEXT NOT NULL DEFAULT '',
  practice_tasks TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_review','published')),
  created_by INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type,entity_id,created_at);
