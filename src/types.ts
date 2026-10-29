export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  /** Cloudflare Zero Trust 팀 도메인 (예: 팀이름.cloudflareaccess.com) */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** Access 애플리케이션의 AUD 태그(64자리) */
  CF_ACCESS_AUD?: string;
  /** 관리자 이메일 1개 */
  ADMIN_EMAIL?: string;
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
  /** 관리자 API 에서 Access 확인을 통과한 관리자 이메일 */
  adminEmail?: string;
}

export type Handler = (ctx: Ctx) => Promise<Response>;
