export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  /** 관리자 아이디 */
  ADMIN_ID?: string;
  /** scripts/hash-password.mjs 로 만든 비밀번호 해시 */
  ADMIN_PASSWORD_HASH?: string;
  /** 공개 후기 양식을 켤 때만 필요한 Turnstile 비밀 키 */
  TURNSTILE_SECRET_KEY?: string;
}

export interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  now: number;
  ip: string;
}

export type Handler = (ctx: Ctx) => Promise<Response>;
