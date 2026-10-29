// 관리자 확인: Cloudflare Access 가 요청에 붙여 주는 Cf-Access-Jwt-Assertion(JWT)을 서버에서 다시 검증한다.
// Access 를 거치지 않은 요청, Access 가 꺼졌거나 잘못 설정된 경우에도 여기서 막힌다(fail-closed).
// 앱 자체의 아이디·로그인 기능은 없다. 로그인은 Access(이메일 일회용 PIN)가 맡는다.

import { fromBase64url } from "./crypto";
import type { Ctx, Env } from "./types";

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
/** 서버 시계 차이 허용 범위(초) */
export const CLOCK_SKEW_SEC = 60;
/** Access 공개키를 다시 받아 오는 주기 */
export const JWKS_TTL_MS = 60 * 60 * 1000;
/** 모르는 kid 가 와도 이 시간 안에는 공개키를 다시 받지 않는다(외부 요청 남발 방지) */
export const JWKS_REFETCH_MIN_MS = 60 * 1000;
const MAX_JWT_LENGTH = 8 * 1024;

// 팀 도메인은 이 형식만 받는다. 다른 주소의 공개키를 믿게 만들 수 없다.
const TEAM_DOMAIN_PATTERN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
// Access 애플리케이션의 AUD 태그(64자리 16진수)
const AUD_PATTERN = /^[0-9a-f]{64}$/;
// 관리자 이메일 1개. 쉼표 등으로 여러 개를 넣을 수 없다.
const EMAIL_PATTERN = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

export interface AccessConfig {
  teamDomain: string;
  aud: string;
  adminEmail: string;
}

/** 환경 변수 3개가 모두 있고 형식이 맞을 때만 설정을 돌려준다. */
export function accessConfig(env: Env): AccessConfig | null {
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  const aud = (env.CF_ACCESS_AUD ?? "").trim();
  const adminEmail = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!TEAM_DOMAIN_PATTERN.test(teamDomain)) return null;
  if (!AUD_PATTERN.test(aud)) return null;
  if (!EMAIL_PATTERN.test(adminEmail)) return null;
  return { teamDomain, aud, adminEmail };
}

// ---------- Access 공개키(JWKS) ----------

interface KeyCache {
  teamDomain: string;
  fetchedAt: number;
  keys: Map<string, CryptoKey>;
}

// 같은 워커 인스턴스 안에서만 유지되는 메모리 캐시
let keyCache: KeyCache | null = null;

const RSA_PARAMS = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

async function fetchKeys(teamDomain: string): Promise<Map<string, CryptoKey> | null> {
  try {
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
    if (res.status !== 200) return null;
    const data = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(data.keys)) return null;
    const keys = new Map<string, CryptoKey>();
    for (const jwk of data.keys as Record<string, unknown>[]) {
      if (!jwk || jwk.kty !== "RSA" || typeof jwk.kid !== "string" || typeof jwk.n !== "string" || typeof jwk.e !== "string") continue;
      if (jwk.alg !== undefined && jwk.alg !== "RS256") continue;
      try {
        const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, RSA_PARAMS, false, ["verify"]);
        keys.set(jwk.kid, key);
      } catch {
        // 읽을 수 없는 키는 건너뛴다.
      }
    }
    return keys;
  } catch {
    return null;
  }
}

async function signingKey(teamDomain: string, kid: string, now: number): Promise<CryptoKey | null> {
  const cached = keyCache && keyCache.teamDomain === teamDomain ? keyCache : null;
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) {
    const key = cached.keys.get(kid);
    if (key) return key;
    // 키가 바뀌었을 수 있으니 다시 받되, 너무 자주 받지는 않는다.
    if (now - cached.fetchedAt < JWKS_REFETCH_MIN_MS) return null;
  }
  const keys = await fetchKeys(teamDomain);
  if (!keys) return null;
  keyCache = { teamDomain, fetchedAt: now, keys };
  return keys.get(kid) ?? null;
}

// ---------- JWT 검증 ----------

function decodeJson(part: string): Record<string, unknown> | null {
  const bytes = fromBase64url(part);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 서명·aud·iss·exp·nbf 가 모두 맞으면 클레임을, 아니면 null 을 돌려준다. */
export async function verifyAccessJwt(token: string, config: AccessConfig, now: number): Promise<Record<string, unknown> | null> {
  if (token.length > MAX_JWT_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodeJson(headerPart);
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string") return null;
  const signature = fromBase64url(signaturePart);
  if (!signature || signature.length === 0) return null;

  const key = await signingKey(config.teamDomain, header.kid, now);
  if (!key) return null;
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify(RSA_PARAMS, key, signature, signed))) return null;

  const claims = decodeJson(payloadPart);
  if (!claims) return null;
  if (claims.iss !== `https://${config.teamDomain}`) return null;
  const aud = claims.aud;
  const audOk = typeof aud === "string" ? aud === config.aud : Array.isArray(aud) && aud.includes(config.aud);
  if (!audOk) return null;
  const nowSec = now / 1000;
  if (typeof claims.exp !== "number" || nowSec >= claims.exp + CLOCK_SKEW_SEC) return null;
  if (typeof claims.nbf !== "number" || nowSec + CLOCK_SKEW_SEC < claims.nbf) return null;
  return claims;
}

export type AdminCheck = { ok: true; email: string } | { ok: false; status: 401 | 403 | 503; message: string };

/** 관리자 API 요청마다 부른다. */
export async function checkAdmin(ctx: Ctx): Promise<AdminCheck> {
  const config = accessConfig(ctx.env);
  if (!config) {
    return { ok: false, status: 503, message: "관리자 화면 설정이 끝나지 않았습니다. 설정을 맡은 분께 연락해 주세요." };
  }
  const token = ctx.request.headers.get(ACCESS_JWT_HEADER);
  if (!token) return { ok: false, status: 401, message: "로그인이 필요합니다." };
  const claims = await verifyAccessJwt(token, config, ctx.now);
  if (!claims) return { ok: false, status: 401, message: "로그인이 필요합니다." };
  if (typeof claims.email !== "string" || claims.email.toLowerCase() !== config.adminEmail) {
    return { ok: false, status: 403, message: "이 계정은 관리자로 등록되어 있지 않습니다." };
  }
  return { ok: true, email: claims.email.toLowerCase() };
}
