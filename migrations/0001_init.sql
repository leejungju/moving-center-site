-- 고객 후기, 후기 요청 링크, 관리자 세션, 로그인 제한, 관리자 기록, 설정값
-- 시각은 모두 1970-01-01 UTC 기준 밀리초(INTEGER)로 저장한다.

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('가정이사', '원룸이사', '사무실이사', '보관이사')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'hidden')),
  source TEXT NOT NULL CHECK (source IN ('invite', 'open')),
  reply TEXT,
  reply_updated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_reviews_status_id ON reviews (status, id DESC);

CREATE TABLE review_photos (
  id TEXT PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_review_photos_review ON review_photos (review_id, position);

-- 후기 요청 링크. 토큰 원문은 저장하지 않고 SHA-256 해시만 저장한다.
CREATE TABLE review_tokens (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  review_id INTEGER REFERENCES reviews (id) ON DELETE SET NULL
);

-- 관리자 세션. 쿠키 값의 SHA-256 해시만 저장한다.
CREATE TABLE admin_sessions (
  session_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 로그인 실패 기록과 잠금. IP는 해시로만 저장한다.
CREATE TABLE login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX idx_login_failures_ip ON login_failures (ip_hash, attempted_at);

CREATE TABLE login_locks (
  ip_hash TEXT PRIMARY KEY,
  locked_until INTEGER NOT NULL
);

-- 공개 후기 양식(토큰 없음)의 IP당 하루 작성 수 제한용 기록
CREATE TABLE open_review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_open_review_log_ip ON open_review_log (ip_hash, created_at);

-- 관리자 행동 기록
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT ''
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
