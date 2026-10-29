// 시험 전용 가짜 Cloudflare Access.
// - 실행할 때마다 새 시험용 RSA 키를 만들어 JWT 에 서명한다(키는 어디에도 저장하지 않는다).
// - 워커가 보내는 외부 요청은 miniflare 의 outboundService 로 가로채 이 공개키 목록을 돌려준다.
// 운영 코드(src/, functions/)에는 인증을 건너뛰는 스위치나 개발용 예외 경로가 없다.

/** 시험용 값. 모두 가짜이다. */
export const TEST_TEAM_DOMAIN = "test-team.cloudflareaccess.com";
export const TEST_AUD = "0".repeat(32) + "f".repeat(32);
export const TEST_ADMIN_EMAIL = "admin@example.com";
export const TEST_KID = "test-kid-1";
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

/** @param {Uint8Array | string} data */
function b64url(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @typedef {{ now?: number, kid?: string, wrongKey?: boolean, header?: Record<string, unknown> }} SignOptions
 */

export async function createTestAccess() {
  const main = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]);
  const other = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", main.publicKey);
  const jwks = { keys: [{ kid: TEST_KID, kty: "RSA", alg: "RS256", use: "sig", n: pub.n, e: pub.e }] };

  /**
   * Access 가 붙여 주는 것과 같은 모양의 JWT 를 만든다.
   * @param {Record<string, unknown>} [claims] 덮어쓸 클레임
   * @param {SignOptions} [opts]
   */
  async function sign(claims = {}, opts = {}) {
    const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
    const header = { alg: "RS256", kid: opts.kid ?? TEST_KID, typ: "JWT", ...opts.header };
    const payload = {
      aud: [TEST_AUD],
      email: TEST_ADMIN_EMAIL,
      exp: nowSec + 3600,
      iat: nowSec,
      nbf: nowSec,
      iss: `https://${TEST_TEAM_DOMAIN}`,
      type: "app",
      sub: "00000000-0000-0000-0000-000000000000",
      ...claims,
    };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const key = opts.wrongKey ? other.privateKey : main.privateKey;
    const signature = new Uint8Array(await crypto.subtle.sign(RSA, key, new TextEncoder().encode(input)));
    return `${input}.${b64url(signature)}`;
  }

  return { jwks, sign };
}

export function accessBindings() {
  return { CF_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN, CF_ACCESS_AUD: TEST_AUD, ADMIN_EMAIL: TEST_ADMIN_EMAIL };
}
