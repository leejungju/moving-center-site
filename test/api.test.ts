import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BODY_SLACK_BYTES, MAX_BODY_BYTES, MAX_PHOTO_BYTES } from "../src/limits";
import {
  call,
  createTestEnv,
  createToken,
  DAY,
  fakeJpeg,
  MINUTE,
  NOW,
  ORIGIN,
  readJson,
  resetData,
  reviewForm,
  submitWithToken,
  TEST_ADMIN_EMAIL,
  TEST_AUD,
  TEST_TEAM_DOMAIN,
  type TestContext,
  type TestEnv,
} from "./helpers";

interface AdminReview {
  id: number;
  nickname: string;
  content: string;
  status: string;
  reply: string | null;
  photos: { id: string; hidden: boolean; url: string }[];
}
interface PublicReview {
  id: number;
  nickname: string;
  content: string;
  reply: string | null;
  photos: { url: string }[];
}

let t: TestContext;
let env: TestEnv;
const NOW_SEC = Math.floor(NOW / 1000);

beforeAll(async () => {
  t = await createTestEnv();
  env = t.env;
});
afterAll(async () => {
  await t.dispose();
});
beforeEach(async () => {
  await resetData(env);
});

/** 관리자(시험용 이메일)의 정상 Access JWT */
function adminJwt(claims: Record<string, unknown> = {}, opts: Parameters<TestContext["access"]["sign"]>[1] = {}): Promise<string> {
  return t.access.sign(claims, { now: NOW, ...opts });
}

/** 다른 환경 변수로 띄운 별도 워커에서 fn 을 실행한다. */
async function withEnv(bindings: Record<string, string | undefined>, fn: (c: TestContext) => Promise<void>): Promise<void> {
  const other = await createTestEnv(bindings);
  try {
    await fn(other);
  } finally {
    await other.dispose();
  }
}

function certsCalls(c: TestContext): number {
  return c.outboundCalls.filter((u) => u.endsWith("/cdn-cgi/access/certs")).length;
}

async function adminReviews(jwt: string, status: string): Promise<AdminReview[]> {
  const res = await call(env, `/api/admin/reviews?status=${status}`, { jwt });
  expect(res.status).toBe(200);
  return (await readJson<{ reviews: AdminReview[] }>(res)).reviews;
}

async function publicReviews(): Promise<PublicReview[]> {
  const res = await call(env, "/api/reviews");
  expect(res.status).toBe(200);
  return (await readJson<{ reviews: PublicReview[] }>(res)).reviews;
}

/** 링크로 후기를 하나 쓰고 그 id 를 돌려준다. */
async function writeReview(jwt: string, fields: Parameters<typeof submitWithToken>[2] = {}, photos: Uint8Array[] = []): Promise<number> {
  const token = await createToken(env, jwt);
  const res = await submitWithToken(env, token, fields, photos);
  expect(res.status).toBe(201);
  const pending = await adminReviews(jwt, "pending");
  return pending[0]!.id;
}

const ADMIN_ROUTES = [
  ["GET", "/api/admin/me"],
  ["GET", "/api/admin/reviews?status=pending"],
  ["GET", "/api/admin/audit"],
  ["GET", "/api/admin/settings"],
  ["POST", "/api/admin/review-links"],
  ["POST", "/api/admin/reviews/1/publish"],
  ["DELETE", "/api/admin/reviews/1"],
  ["PUT", "/api/admin/settings/contact"],
] as const;

describe("관리자 인증 (Cloudflare Access JWT)", () => {
  it("헤더가 없으면 관리자 API 는 모두 401 (CF_Authorization 쿠키만으로는 통과하지 않는다)", async () => {
    for (const [method, path] of ADMIN_ROUTES) {
      const res = await call(env, path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    const cookieOnly = await call(env, "/api/admin/me", { headers: { Cookie: `CF_Authorization=${await adminJwt()}` } });
    expect(cookieOnly.status).toBe(401);
    const links = await env.DB.prepare("SELECT COUNT(*) AS n FROM review_tokens").first<{ n: number }>();
    expect(links?.n).toBe(0);
  });

  it("정상 JWT 는 200 (이메일 대소문자는 무시)", async () => {
    const res = await call(env, "/api/admin/me", { jwt: await adminJwt() });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true, email: TEST_ADMIN_EMAIL });
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ email: "Admin@Example.COM" }) })).status).toBe(200);
    expect((await call(env, "/api/admin/review-links", { method: "POST", jwt: await adminJwt() })).status).toBe(201);
  });

  it("서명이 틀리면 401 (다른 키, 내용 바꿔치기, alg 바꾸기, 모르는 kid)", async () => {
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({}, { wrongKey: true }) })).status).toBe(401);

    const good = await adminJwt();
    const [h, , sig] = good.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ aud: [TEST_AUD], email: TEST_ADMIN_EMAIL, exp: NOW_SEC + 9999, nbf: NOW_SEC, iss: `https://${TEST_TEAM_DOMAIN}`, admin: true })).toString("base64url");
    expect((await call(env, "/api/admin/me", { jwt: `${h}.${forgedPayload}.${sig}` })).status).toBe(401);

    const none = Buffer.from(JSON.stringify({ alg: "none", kid: "test-kid-1" })).toString("base64url");
    expect((await call(env, "/api/admin/me", { jwt: `${none}.${good.split(".")[1]}.` })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({}, { header: { alg: "HS256" } }) })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({}, { kid: "unknown-kid" }) })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt: "not-a-jwt" })).status).toBe(401);
  });

  it("aud 가 다르면 401", async () => {
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ aud: ["f".repeat(64)] }) })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ aud: "f".repeat(64) }) })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ aud: [] }) })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ aud: TEST_AUD }) })).status).toBe(200);
  });

  it("iss 가 다르면 401", async () => {
    for (const iss of ["https://other-team.cloudflareaccess.com", `http://${TEST_TEAM_DOMAIN}`, TEST_TEAM_DOMAIN, undefined]) {
      expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ iss }) })).status, String(iss)).toBe(401);
    }
  });

  it("만료됐거나 아직 유효하지 않으면 401 (허용 오차 60초)", async () => {
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ exp: NOW_SEC - 61 }) })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ exp: NOW_SEC - 30 }) })).status).toBe(200);
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ exp: undefined }) })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ nbf: NOW_SEC + 61 }) })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt: await adminJwt({ nbf: undefined }) })).status).toBe(401);
    // 정상 JWT 도 1시간 뒤(만료 + 60초 지남)에는 거부
    const jwt = await adminJwt();
    expect((await call(env, "/api/admin/me", { jwt, now: NOW + 60 * MINUTE + 61 * 1000 })).status).toBe(401);
  });

  it("exp 경계: 만료 + 60초 직전(1ms 전)은 통과, 그 순간부터 거부", async () => {
    const jwt = await adminJwt({ exp: NOW_SEC });
    const edge = (NOW_SEC + 60) * 1000;
    expect((await call(env, "/api/admin/me", { jwt, now: edge - 1 })).status).toBe(200);
    expect((await call(env, "/api/admin/me", { jwt, now: edge })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt, now: edge + 1 })).status).toBe(401);
  });

  it("nbf 경계: nbf - 60초 직전(1ms 전)은 거부, 그 순간부터 통과", async () => {
    const jwt = await adminJwt({ nbf: NOW_SEC + 120 });
    const edge = (NOW_SEC + 120 - 60) * 1000;
    expect((await call(env, "/api/admin/me", { jwt, now: edge - 1 })).status).toBe(401);
    expect((await call(env, "/api/admin/me", { jwt, now: edge })).status).toBe(200);
    expect((await call(env, "/api/admin/me", { jwt, now: edge + 1 })).status).toBe(200);
  });

  it("email 은 앞뒤 공백을 지우고 ASCII 대소문자만 무시해 비교한다(켈빈 기호 등 ASCII 아닌 글자는 403)", async () => {
    await withEnv({ ADMIN_EMAIL: "kim@example.com" }, async (c) => {
      const status = async (email: string) => (await call(c.env, "/api/admin/me", { jwt: await c.access.sign({ email }, { now: NOW }) })).status;
      expect(await status("kim@example.com")).toBe(200);
      expect(await status("KIM@Example.COM")).toBe(200);
      expect(await status("  kim@example.com ")).toBe(200);
      // U+212A KELVIN SIGN: "\u212Aim".toLowerCase() === "kim"
      expect("\u212Aim@example.com".toLowerCase()).toBe("kim@example.com");
      for (const email of ["\u212Aim@example.com", "k\u0131m@example.com", "kim@ex\u0430mple.com", "kim@example.com\u200b", "kim\uff20example.com", "kim@example.com\u0000"]) {
        expect(await status(email), JSON.stringify(email)).toBe(403);
      }
    });
  });

  it("ADMIN_EMAIL 에 ASCII 가 아닌 글자가 있으면 정상 JWT 도 거부한다", async () => {
    for (const adminEmail of ["\u212Aim@example.com", "kim@ex\u0430mple.com"]) {
      await withEnv({ ADMIN_EMAIL: adminEmail }, async (c) => {
        for (const email of [adminEmail, "kim@example.com"]) {
          const jwt = await c.access.sign({ email }, { now: NOW });
          expect((await call(c.env, "/api/admin/me", { jwt })).status, JSON.stringify([adminEmail, email])).toBe(503);
        }
      });
    }
  });

  it("관리자가 아닌 email 은 403", async () => {
    for (const email of ["someone@example.com", "admin@example.com.evil.example", "", undefined]) {
      const res = await call(env, "/api/admin/me", { jwt: await adminJwt({ email }) });
      expect(res.status, String(email)).toBe(403);
    }
    const res = await call(env, "/api/admin/review-links", { method: "POST", jwt: await adminJwt({ email: "someone@example.com" }) });
    expect(res.status).toBe(403);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM review_tokens").first("n")).toBe(0);
  });

  for (const name of ["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "ADMIN_EMAIL"]) {
    it(`환경 변수 ${name} 가 없으면 정상 JWT 도 거부한다(fail-closed)`, async () => {
      for (const value of [undefined, ""]) {
        await withEnv({ [name]: value }, async (c) => {
          const jwt = await c.access.sign({}, { now: NOW });
          const me = await call(c.env, "/api/admin/me", { jwt });
          expect(me.status, `${name}=${String(value)}`).toBe(503);
          expect((await readJson<{ error: string }>(me)).error).toContain("설정");
          expect((await call(c.env, "/api/admin/review-links", { method: "POST", jwt })).status).toBe(503);
          expect(await c.env.DB.prepare("SELECT COUNT(*) AS n FROM review_tokens").first("n")).toBe(0);
          // 설정이 없으면 공개키를 받으러 나가지도 않는다.
          expect(certsCalls(c)).toBe(0);
        });
      }
    });
  }

  it("CF_ACCESS_AUD·ADMIN_EMAIL 형식이 틀리면 거부한다", async () => {
    for (const bindings of [{ CF_ACCESS_AUD: "abc" }, { ADMIN_EMAIL: "admin@example.com,someone@example.com" }, { ADMIN_EMAIL: "admin" }]) {
      await withEnv(bindings, async (c) => {
        const jwt = await c.access.sign({ email: bindings.ADMIN_EMAIL ?? TEST_ADMIN_EMAIL, aud: [bindings.CF_ACCESS_AUD ?? TEST_AUD] }, { now: NOW });
        expect((await call(c.env, "/api/admin/me", { jwt })).status, JSON.stringify(bindings)).toBe(503);
      });
    }
  });

  it("팀 도메인 형식이 틀리면 거부한다(다른 주소의 공개키를 믿지 않는다)", async () => {
    // 가로채기는 어느 주소든 공개키를 돌려주고, JWT 의 iss 도 그 주소로 맞췄다. 형식 검사가 없으면 200 이 된다.
    for (const domain of ["evil.example.com", "test-team.cloudflareaccess.com.evil.example", "a.cloudflareaccess.com@evil.example"]) {
      await withEnv({ CF_ACCESS_TEAM_DOMAIN: domain }, async (c) => {
        const jwt = await c.access.sign({ iss: `https://${domain}` }, { now: NOW });
        expect((await call(c.env, "/api/admin/me", { jwt })).status, domain).toBe(503);
        expect(c.outboundCalls, domain).toEqual([]);
      });
    }
  });

  it("공개키는 메모리에 캐시하고, 모르는 kid 가 와도 60초 안에는 다시 받지 않는다", async () => {
    await withEnv({}, async (c) => {
      for (let i = 0; i < 3; i++) expect((await call(c.env, "/api/admin/me", { jwt: await c.access.sign({}, { now: NOW }) })).status).toBe(200);
      expect(certsCalls(c)).toBe(1);
      expect((await call(c.env, "/api/admin/me", { jwt: await c.access.sign({}, { now: NOW, kid: "rotated" }) })).status).toBe(401);
      expect(certsCalls(c)).toBe(1);
      const later = NOW + 2 * MINUTE;
      expect((await call(c.env, "/api/admin/me", { jwt: await c.access.sign({}, { now: later, kid: "rotated" }), now: later })).status).toBe(401);
      expect(certsCalls(c)).toBe(2);
      expect(c.outboundCalls.every((u) => u === `https://${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`)).toBe(true);
    });
  });

  it("공개키 받아오기가 실패하면 거부하고, 30초 동안은 다시 받지 않는다", async () => {
    const failures = [{ status: 500, body: "{}" }, { status: 302, body: "" }, { status: 200, body: "not json" }, { status: 200, body: '{"keys":"x"}' }, "network"] as const;
    for (const failure of failures) {
      await withEnv({}, async (c) => {
        const label = JSON.stringify(failure);
        c.certs.reply = () => failure;
        const jwt = await c.access.sign({}, { now: NOW });
        for (const at of [0, 10_000, 20_000, 29_999]) {
          expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + at })).status, `${label} +${at}`).toBe(401);
        }
        expect(certsCalls(c), label).toBe(1);
        // 정상으로 돌아와도 30초가 지나기 전에는 거부, 지나면 다시 받아 통과
        c.certs.reply = () => null;
        expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + 29_999 })).status, label).toBe(401);
        expect(certsCalls(c), label).toBe(1);
        expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + 30_000 })).status, label).toBe(200);
        expect(certsCalls(c), label).toBe(2);
      });
    }
  });

  it("정상 캐시가 지난 뒤 받아오기가 실패하면 이전 공개키를 쓰지 않고 거부한다", async () => {
    await withEnv({}, async (c) => {
      const jwt = await c.access.sign({}, { now: NOW });
      expect((await call(c.env, "/api/admin/me", { jwt })).status).toBe(200);
      c.certs.reply = () => ({ status: 503, body: "" });
      expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + 59_999 })).status).toBe(200); // 60초 캐시 안
      expect(certsCalls(c)).toBe(1);
      expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + 60_000 })).status).toBe(401);
      expect(certsCalls(c)).toBe(2);
      c.certs.reply = () => null;
      expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + 89_999 })).status).toBe(401);
      expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + 90_000 })).status).toBe(200);
      expect(certsCalls(c)).toBe(3);
    });
  });

  it("빈 공개키 목록(읽을 수 있는 키 0개)은 캐시하지 않고 거부하며, 그 뒤 정상 키가 오면 회복한다", async () => {
    const empties = [{ keys: [] }, { keys: [{ kid: "test-kid-1", kty: "RSA", n: "!!", e: "AQAB" }] }, { keys: [{ kid: "test-kid-1", kty: "EC", crv: "P-256", x: "a", y: "b" }] }];
    for (const empty of empties) {
      await withEnv({}, async (c) => {
        const label = JSON.stringify(empty);
        c.certs.reply = () => ({ status: 200, body: JSON.stringify(empty) });
        const jwt = await c.access.sign({}, { now: NOW });
        expect((await call(c.env, "/api/admin/me", { jwt })).status, label).toBe(401);
        expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + 10_000 })).status, label).toBe(401);
        expect(certsCalls(c), label).toBe(1);
        c.certs.reply = () => null;
        expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + 30_000 })).status, label).toBe(200);
        expect(certsCalls(c), label).toBe(2);
        // 회복한 뒤에는 정상 캐시(60초)
        expect((await call(c.env, "/api/admin/me", { jwt, now: NOW + 89_999 })).status, label).toBe(200);
        expect(certsCalls(c), label).toBe(2);
      });
    }
  });

  it("앱 자체 로그인·로그아웃 API 는 없다", async () => {
    expect((await call(env, "/api/admin/login", { json: { id: "x", password: "y" } })).status).toBe(404);
    expect((await call(env, "/api/admin/logout", { method: "POST" })).status).toBe(404);
  });

  it("잘못된 Origin 의 상태 변경 요청은 정상 JWT 가 있어도 403", async () => {
    const jwt = await adminJwt();
    const id = await writeReview(jwt);
    const evil = await call(env, `/api/admin/reviews/${id}/publish`, { method: "POST", jwt, origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const missing = await call(env, `/api/admin/reviews/${id}/publish`, { method: "POST", jwt, origin: null });
    expect(missing.status).toBe(403);
    const nullOrigin = await call(env, `/api/admin/reviews/${id}/publish`, { method: "POST", jwt, origin: "null" });
    expect(nullOrigin.status).toBe(403);
    const lookalike = await call(env, `/api/admin/reviews/${id}`, { method: "DELETE", jwt, origin: "https://site.test.evil.example" });
    expect(lookalike.status).toBe(403);
    expect((await adminReviews(jwt, "pending")).length).toBe(1);
    // 올바른 Origin 이면 통과
    const ok = await call(env, `/api/admin/reviews/${id}/publish`, { jwt, method: "POST", origin: ORIGIN });
    expect(ok.status).toBe(200);
  });
});

describe("후기 요청 링크와 후기 작성", () => {
  it("링크 토큰은 256비트 무작위 값이고 DB 에는 해시만 저장한다", async () => {
    const jwt = await adminJwt();
    const res = await call(env, "/api/admin/review-links", { method: "POST", jwt });
    expect(res.status).toBe(201);
    const data = await readJson<{ url: string; expiresAt: number }>(res);
    expect(data.url).toMatch(/^https:\/\/site\.test\/review\/write\?t=[A-Za-z0-9_-]{43}$/);
    expect(data.expiresAt).toBe(NOW + 30 * DAY);
    const token = new URL(data.url).searchParams.get("t")!;
    const rows = await env.DB.prepare("SELECT token_hash FROM review_tokens").all<{ token_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]!.token_hash).not.toBe(token);
    expect(rows.results[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("제출된 후기는 승인 대기로 저장되고 공개 목록에 나오지 않는다", async () => {
    const jwt = await adminJwt();
    const id = await writeReview(jwt);
    expect(await publicReviews()).toEqual([]);
    const pending = await adminReviews(jwt, "pending");
    expect(pending.map((r) => r.id)).toEqual([id]);

    await call(env, `/api/admin/reviews/${id}/publish`, { jwt, method: "POST" });
    expect((await publicReviews()).map((r) => r.id)).toEqual([id]);

    await call(env, `/api/admin/reviews/${id}/hide`, { jwt, method: "POST" });
    expect(await publicReviews()).toEqual([]);
    // 숨김은 되돌릴 수 있다
    await call(env, `/api/admin/reviews/${id}/publish`, { jwt, method: "POST" });
    expect((await publicReviews()).map((r) => r.id)).toEqual([id]);
  });

  it("공개 목록은 최신순이고 업체 답변을 포함한다", async () => {
    const jwt = await adminJwt();
    const first = await writeReview(jwt, { nickname: "테스트 고객1" });
    const second = await writeReview(jwt, { nickname: "테스트 고객2" });
    // 두 번째 후기를 더 늦게 쓴 것으로 만든다
    await env.DB.prepare("UPDATE reviews SET created_at = ?1 WHERE id = ?2").bind(NOW + MINUTE, second).run();
    for (const id of [first, second]) await call(env, `/api/admin/reviews/${id}/publish`, { jwt, method: "POST" });
    await call(env, `/api/admin/reviews/${first}/reply`, { method: "PUT", jwt, json: { reply: "이용해 주셔서 감사합니다." } });
    const list = await publicReviews();
    expect(list.map((r) => r.nickname)).toEqual(["테스트 고객2", "테스트 고객1"]);
    expect(list[1]!.reply).toBe("이용해 주셔서 감사합니다.");
  });

  it("사용된 토큰은 다시 쓸 수 없다", async () => {
    const jwt = await adminJwt();
    const token = await createToken(env, jwt);
    expect((await submitWithToken(env, token)).status).toBe(201);
    const again = await submitWithToken(env, token, { nickname: "테스트 고객2" });
    expect(again.status).toBe(410);
    expect((await readJson<{ reason: string }>(again)).reason).toBe("used");
    const check = await readJson<{ ok: boolean; reason: string }>(await call(env, `/api/review/check?t=${token}`));
    expect(check).toMatchObject({ ok: false, reason: "used" });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM reviews").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("만료된 토큰(30일 경과)은 거부한다", async () => {
    const jwt = await adminJwt();
    const token = await createToken(env, jwt, NOW);
    const later = NOW + 30 * DAY;
    const res = await submitWithToken(env, token, {}, [], later);
    expect(res.status).toBe(410);
    expect((await readJson<{ reason: string }>(res)).reason).toBe("expired");
    const check = await readJson<{ ok: boolean; reason: string }>(await call(env, `/api/review/check?t=${token}`, { now: later }));
    expect(check).toMatchObject({ ok: false, reason: "expired" });
    // 하루 전에는 쓸 수 있다
    expect((await submitWithToken(env, token, {}, [], later - DAY)).status).toBe(201);
  });

  it("엉터리 토큰과 토큰 없는 요청은 거부한다(공개 양식이 꺼져 있을 때)", async () => {
    expect((await submitWithToken(env, "A".repeat(43))).status).toBe(410);
    const noToken = await call(env, "/api/reviews", { form: reviewForm() });
    expect(noToken.status).toBe(403);
    const check = await readJson<{ ok: boolean; reason: string }>(await call(env, "/api/review/check"));
    expect(check).toMatchObject({ ok: false, reason: "closed" });
  });

  it("입력값 검사: 별명 2~10자, 서비스 목록, 내용 10~1000자, 동의 필수", async () => {
    const jwt = await adminJwt();
    const token = await createToken(env, jwt);
    const cases: Parameters<typeof submitWithToken>[2][] = [
      { nickname: "가" },
      { nickname: "열한글자가넘는별명입니다" },
      { service: "해외이사" },
      { content: "짧아요" },
      { content: "가".repeat(1001) },
      { consent: "" },
    ];
    for (const fields of cases) {
      const res = await submitWithToken(env, token, fields);
      expect(res.status, JSON.stringify(fields)).toBe(400);
    }
    // 검사에 걸린 제출은 토큰을 쓰지 않는다
    expect((await submitWithToken(env, token, { nickname: "테스트", content: "가".repeat(1000) })).status).toBe(201);
  });

  it("EXIF 가 있는 JPEG 는 거부한다", async () => {
    const jwt = await adminJwt();
    const token = await createToken(env, jwt);
    const res = await submitWithToken(env, token, {}, [fakeJpeg({ exif: true })]);
    expect(res.status).toBe(400);
    expect((await readJson<{ error: string }>(res)).error).toContain("사진 정보");
    expect((await env.PHOTOS.list()).objects).toHaveLength(0);
    // 토큰은 그대로 쓸 수 있다
    expect((await submitWithToken(env, token, {}, [fakeJpeg()])).status).toBe(201);
  });

  it("APP13(IPTC)·COM(주석) 등 사진 정보 구간이 있는 JPEG 는 거부한다", async () => {
    const jwt = await adminJwt();
    const token = await createToken(env, jwt);
    const iptc = [...Buffer.from("Photoshop 3.0\0"), 0x38, 0x42, 0x49, 0x4d, 0x04, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    for (const segment of [
      { marker: 0xed, payload: iptc },
      { marker: 0xfe, payload: [...Buffer.from("test comment: 010-0000-0000")] },
      { marker: 0xe2, payload: [...Buffer.from("ICC_PROFILE\0")] },
    ]) {
      const res = await submitWithToken(env, token, {}, [fakeJpeg({ segment })]);
      expect(res.status, segment.marker.toString(16)).toBe(400);
      expect((await readJson<{ error: string }>(res)).error).toContain("사진 정보");
    }
    expect((await env.PHOTOS.list()).objects).toHaveLength(0);
    expect((await submitWithToken(env, token, {}, [fakeJpeg()])).status).toBe(201);
  });

  it("JPEG 가 아니거나 500KB 를 넘거나 4장 이상이면 거부한다", async () => {
    const jwt = await adminJwt();
    const token = await createToken(env, jwt);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect((await submitWithToken(env, token, {}, [png])).status).toBe(400);
    const tooBig = await submitWithToken(env, token, {}, [fakeJpeg({ size: MAX_PHOTO_BYTES + 1 })]);
    expect(tooBig.status).toBe(400);
    expect((await readJson<{ error: string }>(tooBig)).error).toBe("사진 한 장은 500KB 이하여야 합니다.");
    expect((await submitWithToken(env, token, {}, [fakeJpeg(), fakeJpeg({ size: MAX_PHOTO_BYTES + 1 }), fakeJpeg()])).status).toBe(400);
    expect((await submitWithToken(env, token, {}, [fakeJpeg(), fakeJpeg(), fakeJpeg(), fakeJpeg()])).status).toBe(400);
    expect((await env.PHOTOS.list()).objects).toHaveLength(0);
    expect((await submitWithToken(env, token, {}, [fakeJpeg({ size: MAX_PHOTO_BYTES }), fakeJpeg(), fakeJpeg()])).status).toBe(201);
  });

  it("EOI 뒤에 데이터가 붙었거나 APP0 형식이 틀린 JPEG 는 거부한다", async () => {
    const jwt = await adminJwt();
    const token = await createToken(env, jwt);
    const base = fakeJpeg();
    const html = [...Buffer.from("<html><script>alert(1)</script></html>")];
    const payload = new Array<number>(1024).fill(0x41);
    const longLen = 16 + payload.length;
    const bad = [
      new Uint8Array([...base, ...html]),
      new Uint8Array([...base, ...fakeJpeg({ exif: true })]),
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, longLen >> 8, longLen & 0xff, ...base.slice(6, 20), ...payload, ...base.slice(20)]),
      new Uint8Array([...base.slice(0, 4), 0x00, 0x13, ...base.slice(6, 18), 0x01, 0x01, 0xaa, 0xbb, 0xcc, ...base.slice(20)]),
    ];
    for (const [i, photo] of bad.entries()) {
      expect((await submitWithToken(env, token, {}, [photo])).status, String(i)).toBe(400);
    }
    expect((await env.PHOTOS.list()).objects).toHaveLength(0);
    expect((await submitWithToken(env, token, {}, [base])).status).toBe(201);
  });

  it("작성 화면 확인 응답은 사진 1장 상한(공용 상수)을 알려 준다", async () => {
    const token = await createToken(env, await adminJwt());
    const check = await readJson<{ ok: boolean; maxPhotoBytes: number }>(await call(env, `/api/review/check?t=${token}`));
    expect(check).toMatchObject({ ok: true, maxPhotoBytes: MAX_PHOTO_BYTES });
  });
});

describe("사진 공개", () => {
  it("숨긴 사진은 공개 응답에 나오지 않는다", async () => {
    const jwt = await adminJwt();
    const id = await writeReview(jwt, {}, [fakeJpeg(), fakeJpeg()]);
    const photos = (await adminReviews(jwt, "pending"))[0]!.photos;
    expect(photos).toHaveLength(2);
    const [keep, hide] = photos as [AdminReview["photos"][0], AdminReview["photos"][0]];

    // 승인 전에는 사진도 공개되지 않는다
    expect((await call(env, `/api/photos/${keep.id}`)).status).toBe(404);

    await call(env, `/api/admin/reviews/${id}/publish`, { jwt, method: "POST" });
    expect((await call(env, `/api/admin/photos/${hide.id}/hide`, { method: "POST", jwt })).status).toBe(200);

    const list = await publicReviews();
    expect(list[0]!.photos.map((p) => p.url)).toEqual([`/api/photos/${keep.id}`]);
    expect(JSON.stringify(list)).not.toContain(hide.id);
    expect((await call(env, `/api/photos/${hide.id}`)).status).toBe(404);
    const shown = await call(env, `/api/photos/${keep.id}`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("Content-Type")).toBe("image/jpeg");
    expect(shown.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(shown.headers.get("Cache-Control")).toBe("no-cache");

    // 관리자는 숨긴 사진도 볼 수 있고, 다시 보이게 할 수 있다
    expect((await call(env, `/api/admin/photos/${hide.id}`, { jwt })).status).toBe(200);
    expect((await call(env, `/api/admin/photos/${hide.id}`)).status).toBe(401);
    await call(env, `/api/admin/photos/${hide.id}/show`, { method: "POST", jwt });
    expect((await publicReviews())[0]!.photos).toHaveLength(2);

    // 후기를 숨기면 사진도 공개되지 않는다
    await call(env, `/api/admin/reviews/${id}/hide`, { jwt, method: "POST" });
    expect((await call(env, `/api/photos/${keep.id}`)).status).toBe(404);
  });

  it("사진 삭제와 후기 삭제는 R2 에서도 지운다", async () => {
    const jwt = await adminJwt();
    const id = await writeReview(jwt, {}, [fakeJpeg(), fakeJpeg()]);
    const photos = (await adminReviews(jwt, "pending"))[0]!.photos;
    expect((await env.PHOTOS.list()).objects).toHaveLength(2);
    expect((await call(env, `/api/admin/photos/${photos[0]!.id}`, { method: "DELETE", jwt })).status).toBe(200);
    expect((await env.PHOTOS.list()).objects).toHaveLength(1);
    expect((await call(env, `/api/admin/reviews/${id}`, { method: "DELETE", jwt })).status).toBe(200);
    expect((await env.PHOTOS.list()).objects).toHaveLength(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reviews").first("n")).toBe(0);
  });
});

describe("관리자 기능", () => {
  it("관리자는 고객 글을 고치거나 후기를 직접 쓸 수 없다(답변만 가능)", async () => {
    const jwt = await adminJwt();
    const id = await writeReview(jwt);
    for (const [method, path] of [
      ["PUT", `/api/admin/reviews/${id}`],
      ["PATCH", `/api/admin/reviews/${id}`],
      ["POST", "/api/admin/reviews"],
    ] as const) {
      const res = await call(env, path, { method, jwt, json: { content: "관리자가 바꾼 글" } });
      expect([404, 405], `${method} ${path}`).toContain(res.status);
    }
    const reply = await call(env, `/api/admin/reviews/${id}/reply`, { method: "PUT", jwt, json: { reply: "감사합니다", content: "관리자가 바꾼 글" } });
    expect(reply.status).toBe(200);
    const review = (await adminReviews(jwt, "pending"))[0]!;
    expect(review.content).toBe("테스트 후기입니다. 친절하게 잘 옮겨 주셨어요.");
    expect(review.reply).toBe("감사합니다");
  });

  it("관리자 행동은 모두 최근 기록에 남는다", async () => {
    const jwt = await adminJwt();
    const id = await writeReview(jwt, {}, [fakeJpeg()]);
    const photoId = (await adminReviews(jwt, "pending"))[0]!.photos[0]!.id;
    await call(env, `/api/admin/reviews/${id}/publish`, { jwt, method: "POST" });
    await call(env, `/api/admin/photos/${photoId}/hide`, { method: "POST", jwt });
    await call(env, `/api/admin/reviews/${id}/reply`, { method: "PUT", jwt, json: { reply: "감사합니다" } });
    await call(env, `/api/admin/reviews/${id}/hide`, { jwt, method: "POST" });
    await call(env, "/api/admin/settings/contact", { method: "PUT", jwt, json: { kakaoChannelId: "_test", smsNumber: "010-0000-0000" } });
    await call(env, "/api/admin/settings/texts", { method: "PUT", jwt, json: { texts: { hero_lead: "테스트 소개 문구" } } });
    await call(env, `/api/admin/reviews/${id}`, { method: "DELETE", jwt });
    const res = await call(env, "/api/admin/audit", { jwt });
    const entries = (await readJson<{ entries: { action: string; target: string }[] }>(res)).entries;
    expect(entries.map((e) => e.action).reverse()).toEqual([
      "후기 요청 링크 만듦",
      "후기 공개",
      "사진 숨김",
      "답변 씀",
      "후기 숨김",
      "연락처 설정 바꿈",
      "홈페이지 문구 바꿈",
      "후기 삭제",
    ]);
    expect(entries[0]!.target).toBe(`후기 #${id} (테스트 고객)`);
  });

  it("연락처 설정: 010 번호 형식만 받고 공개 설정에 반영한다", async () => {
    const jwt = await adminJwt();
    for (const smsNumber of ["02-123-4567", "011-1234-5678", "010-123-456", "01012345678a"]) {
      const res = await call(env, "/api/admin/settings/contact", { method: "PUT", jwt, json: { kakaoChannelId: "", smsNumber } });
      expect(res.status, smsNumber).toBe(400);
    }
    const bad = await call(env, "/api/admin/settings/contact", { method: "PUT", jwt, json: { kakaoChannelId: "javascript:alert(1)", smsNumber: "" } });
    expect(bad.status).toBe(400);
    const ok = await call(env, "/api/admin/settings/contact", { method: "PUT", jwt, json: { kakaoChannelId: "_test", smsNumber: "010-0000-0000" } });
    expect(ok.status).toBe(200);
    const pub = await readJson<{ kakaoChannelId: string; smsNumber: string }>(await call(env, "/api/settings"));
    expect(pub).toMatchObject({ kakaoChannelId: "_test", smsNumber: "01000000000" });
  });

  it("홈페이지 문구: 정해진 항목만 고칠 수 있다", async () => {
    const jwt = await adminJwt();
    const res = await call(env, "/api/admin/settings/texts", { method: "PUT", jwt, json: { texts: { company_name: "다른 상호" } } });
    expect(res.status).toBe(400);
    const tooLong = await call(env, "/api/admin/settings/texts", { method: "PUT", jwt, json: { texts: { hero_badge: "가".repeat(41) } } });
    expect(tooLong.status).toBe(400);
    const ok = await call(env, "/api/admin/settings/texts", { method: "PUT", jwt, json: { texts: { hero_badge: "테스트 제목" } } });
    expect(ok.status).toBe(200);
    const pub = await readJson<{ texts: Record<string, string> }>(await call(env, "/api/settings"));
    expect(pub.texts.hero_badge).toBe("테스트 제목");
    expect(Object.keys(pub).sort()).toEqual(["kakaoChannelId", "ok", "smsNumber", "texts"]);
  });

  it("SQL 처럼 보이는 입력도 글자 그대로 저장한다(바인딩 파라미터)", async () => {
    const jwt = await adminJwt();
    const nasty = "'); DROP TABLE reviews; -- 테스트";
    const id = await writeReview(jwt, { nickname: "테스트'--", content: nasty });
    const review = (await adminReviews(jwt, "pending")).find((r) => r.id === id)!;
    expect(review.content).toBe(nasty);
    expect(review.nickname).toBe("테스트'--");
  });
});

describe("공개 후기 양식(토큰 없음)", () => {
  async function enableOpenReview() {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('open_review_enabled', '1', 0)"),
      env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('turnstile_site_key', '1x00000000000000000000AA', 0)"),
    ]);
  }

  it("기본으로 꺼져 있고, 켜도 Turnstile 비밀 키가 없으면 쓸 수 없다", async () => {
    await enableOpenReview();
    const res = await call(env, "/api/reviews", { form: reviewForm({ "cf-turnstile-response": "x" } as never) });
    expect(res.status).toBe(403);
  });

  describe("Turnstile 비밀 키가 있을 때", () => {
    let o: TestContext;
    beforeAll(async () => {
      o = await createTestEnv({ TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" });
    });
    afterAll(async () => {
      await o.dispose();
    });
    beforeEach(async () => {
      await resetData(o.env);
      o.turnstile.reply = () => ({ success: true, hostname: "site.test" });
    });
    async function enable() {
      await o.env.DB.batch([
        o.env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('open_review_enabled', '1', 0)"),
        o.env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('turnstile_site_key', '1x00000000000000000000AA', 0)"),
      ]);
    }
    const form = () => {
      const f = reviewForm();
      f.append("cf-turnstile-response", "test-response");
      return f;
    };

    it("켜져 있으면 Turnstile 확인 뒤 승인 대기로 저장하고 IP당 하루 3건으로 제한한다", async () => {
      await enable();
      const seen: Record<string, string>[] = [];
      o.turnstile.reply = (f) => {
        seen.push(Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)])));
        return { success: true, hostname: "site.test" };
      };
      const check = await readJson<{ ok: boolean; mode: string; turnstileSiteKey: string }>(await call(o.env, "/api/review/check"));
      expect(check).toMatchObject({ ok: true, mode: "open", turnstileSiteKey: "1x00000000000000000000AA" });

      const noCaptcha = await call(o.env, "/api/reviews", { form: reviewForm() });
      expect(noCaptcha.status).toBe(400);
      for (let i = 0; i < 3; i++) {
        expect((await call(o.env, "/api/reviews", { form: form(), now: NOW + i })).status).toBe(201);
      }
      expect((await call(o.env, "/api/reviews", { form: form(), now: NOW + 10 })).status).toBe(429);
      expect((await call(o.env, "/api/reviews", { form: form(), ip: "203.0.113.99", now: NOW + 10 })).status).toBe(201);
      expect((await call(o.env, "/api/reviews", { form: form(), now: NOW + DAY })).status).toBe(201);
      // 서버가 비밀 키·응답 토큰·IP 를 실제로 보냈다
      expect(seen[0]).toEqual({ secret: "1x0000000000000000000000000000000AA", response: "test-response", remoteip: "203.0.113.10" });
      const pub = await call(o.env, "/api/reviews");
      expect((await readJson<{ reviews: unknown[] }>(pub)).reviews).toEqual([]);
      const statuses = await o.env.DB.prepare("SELECT DISTINCT status, source FROM reviews").all();
      expect(statuses.results).toEqual([{ status: "pending", source: "open" }]);

      o.turnstile.reply = () => ({ success: false, hostname: "site.test" });
      expect((await call(o.env, "/api/reviews", { form: form(), ip: "203.0.113.50" })).status).toBe(400);
    });

    it("Turnstile 응답의 hostname 이 이 사이트가 아니면 거부한다", async () => {
      await enable();
      for (const hostname of ["evil.example", "site.test.evil.example", undefined]) {
        o.turnstile.reply = () => ({ success: true, hostname });
        const res = await call(o.env, "/api/reviews", { form: form(), ip: "203.0.113.60" });
        expect(res.status, String(hostname)).toBe(400);
      }
      expect(await o.env.DB.prepare("SELECT COUNT(*) AS n FROM reviews").first("n")).toBe(0);
      o.turnstile.reply = () => ({ success: true, hostname: "site.test" });
      expect((await call(o.env, "/api/reviews", { form: form(), ip: "203.0.113.60" })).status).toBe(201);
    });
  });
});

describe("업로드 본문 크기 상한 (사진 3장 x 500KB + 512KB)", () => {
  const LIMIT = MAX_BODY_BYTES;

  it("Content-Length 없이(chunked) 보낸 초과 본문은 읽다가 멈추고 413", async () => {
    // 상한 + 1MB 까지 보낸 뒤에는 3초 쉬었다가 끝낸다. 서버가 상한에서 멈추면 그 전에 413 을 답하고,
    // 상한 검사가 없다면 본문 끝까지 읽은 뒤 400(양식 오류)이 된다. 쉬는 동안에는 쓰지 않으므로 연결이 끊겨도 시험이 흔들리지 않는다.
    const chunk = new Uint8Array(64 * 1024).fill(0x41);
    // 조각(64KB) 단위로 보내므로 멈추는 지점도 조각 경계에 맞춘다.
    const stopAt = Math.ceil((LIMIT + 1024 * 1024) / chunk.byteLength) * chunk.byteLength;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (pulled >= stopAt) {
          await new Promise((r) => setTimeout(r, 3000));
          controller.close();
          return;
        }
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const res = await call(env, "/api/reviews", { body, headers: { "Content-Type": "multipart/form-data; boundary=x" } });
    expect(res.status).toBe(413);
    expect(pulled).toBeGreaterThan(LIMIT);
    expect(pulled).toBeLessThanOrEqual(stopAt);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reviews").first("n")).toBe(0);
  });

  it("Content-Length 가 상한보다 크면 본문을 읽지 않고 바로 413", async () => {
    // 첫 64KB 만 보내고 멈춘 스트림. 서버가 본문을 기다리지 않고 바로 답해야 이 시험이 끝난다.
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled > 0) return new Promise<void>(() => {});
        pulled += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const res = await call(env, "/api/reviews", { body, headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(LIMIT + 1) } });
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(64 * 1024);
    await body.cancel().catch(() => {});
  });

  it("상한 안의 본문(500KB 사진 3장)은 받는다", async () => {
    const jwt = await adminJwt();
    const token = await createToken(env, jwt);
    const photos = [fakeJpeg({ size: MAX_PHOTO_BYTES }), fakeJpeg({ size: MAX_PHOTO_BYTES }), fakeJpeg({ size: MAX_PHOTO_BYTES })];
    expect((await submitWithToken(env, token, {}, photos)).status).toBe(201);
  });

  it("실제 본문이 선언한 Content-Length 와 다르면 거부하고, 더 길면 그 자리에서 읽기를 멈춘다", async () => {
    const probe = async (q: string) => readJson<{ result: string; pulled: number }>(await env.mf.dispatchFetch(`${ORIGIN}/__test/body-limit?${q}` as never) as unknown as Response);
    const longer = await probe(`declared=1000&actual=${4 * LIMIT}&max=${LIMIT}`);
    expect(longer.result).toBe("error");
    expect(longer.pulled).toBeLessThanOrEqual(2 * 64 * 1024);
    expect((await probe(`declared=5000&actual=1000&max=${LIMIT}`)).result).toBe("error");
    // 상한보다 큰 선언 길이는 본문을 읽지 않고 거부한다(스트림이 만들어질 때 미리 당기는 첫 조각만 있다).
    expect(await probe(`declared=${LIMIT + 1}&actual=${4 * LIMIT}&max=${LIMIT}`)).toEqual({ result: "too_large", pulled: 64 * 1024 });
    expect((await probe(`declared=${LIMIT}&actual=${LIMIT}&max=${LIMIT}`)).result).toBe(`read ${LIMIT}`);
    // Content-Length 가 없으면 바이트 수를 세다가 상한에서 멈춘다.
    const chunked = await probe(`actual=${4 * LIMIT}&max=${LIMIT}`);
    expect(chunked.result).toBe("error too_large");
    expect(chunked.pulled).toBeLessThanOrEqual(LIMIT + 2 * 64 * 1024);
    expect((await probe(`actual=${LIMIT}&max=${LIMIT}`)).result).toBe(`read ${LIMIT}`);
  });

  it("양식 전체가 상한을 넘으면 413 (Content-Length 가 있을 때와 없을 때 모두)", async () => {
    const jwt = await adminJwt();
    const token = await createToken(env, jwt);
    const photos = [fakeJpeg({ size: MAX_PHOTO_BYTES }), fakeJpeg({ size: MAX_PHOTO_BYTES }), fakeJpeg({ size: MAX_PHOTO_BYTES })];
    const form = reviewForm({ t: token }, photos);
    form.append("padding", "x".repeat(BODY_SLACK_BYTES));
    const withLength = await call(env, "/api/reviews", { form });
    expect(withLength.status).toBe(413);

    // 같은 바이트를 Content-Length 없이(chunked) 보낸다.
    const encoded = new Response(form);
    const contentType = encoded.headers.get("Content-Type")!;
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(LIMIT);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(sent, sent + 64 * 1024));
        sent += 64 * 1024;
      },
    });
    const chunked = await call(env, "/api/reviews", { body, headers: { "Content-Type": contentType } });
    expect(chunked.status).toBe(413);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reviews").first("n")).toBe(0);
    expect((await env.PHOTOS.list()).objects).toHaveLength(0);
  });
});

describe("API 응답 보안 헤더", () => {
  it("모든 API 응답에 nosniff, CSP, frame-ancestors 를 붙인다", async () => {
    for (const path of ["/api/settings", "/api/reviews", "/api/admin/me", "/api/nothing"]) {
      const res = await call(env, path);
      expect(res.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
      expect(res.headers.get("Content-Security-Policy"), path).toContain("frame-ancestors 'none'");
      expect(res.headers.get("Strict-Transport-Security"), path).toBe("max-age=31536000");
    }
  });
});
