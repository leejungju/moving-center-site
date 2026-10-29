-- 관리자 로그인을 Cloudflare Access 로 바꾸면서 앱 자체 로그인(세션·로그인 실패 기록·잠금)을 없앴다.
-- 더 이상 쓰지 않는 표를 지운다. 0001_init.sql 은 이미 적용된 기록이므로 고치지 않는다.

DROP TABLE IF EXISTS admin_sessions;
DROP INDEX IF EXISTS idx_login_failures_ip;
DROP TABLE IF EXISTS login_failures;
DROP TABLE IF EXISTS login_locks;
