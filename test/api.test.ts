import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/types";
import {
  ADMIN_ID,
  ADMIN_PASSWORD,
  call,
  createTestEnv,
  createToken,
  DAY,
  fakeJpeg,
  login,
  MINUTE,
  NOW,
  readJson,
  resetData,
  reviewForm,
  submitWithToken,
  type TestContext,
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
let env: Env;

beforeAll(async () => {
  t = await createTestEnv();
  env = t.env;
});
afterAll(async () => {
  await t.dispose();
});
beforeEach(async () => {
  await resetData(env);
  vi.unstubAllGlobals();
});

async function adminReviews(cookie: string, status: string): Promise<AdminReview[]> {
  const res = await call(env, `/api/admin/reviews?status=${status}`, { cookie });
  expect(res.status).toBe(200);
  return (await readJson<{ reviews: AdminReview[] }>(res)).reviews;
}

async function publicReviews(): Promise<PublicReview[]> {
  const res = await call(env, "/api/reviews");
  expect(res.status).toBe(200);
  return (await readJson<{ reviews: PublicReview[] }>(res)).reviews;
}

/** 링크로 후기를 하나 쓰고 그 id 를 돌려준다. */
async function writeReview(cookie: string, fields: Parameters<typeof submitWithToken>[2] = {}, photos: Uint8Array[] = []): Promise<number> {
  const token = await createToken(env, cookie);
  const res = await submitWithToken(env, token, fields, photos);
  expect(res.status).toBe(201);
  const pending = await adminReviews(cookie, "pending");
  return pending[0]!.id;
}

describe("관리자 인증", () => {
  it("로그인하지 않은 관리자 API 요청은 401로 거부한다", async () => {
    for (const [method, path] of [
      ["GET", "/api/admin/me"],
      ["GET", "/api/admin/reviews?status=pending"],
      ["GET", "/api/admin/audit"],
      ["GET", "/api/admin/settings"],
      ["POST", "/api/admin/review-links"],
      ["POST", "/api/admin/reviews/1/publish"],
      ["DELETE", "/api/admin/reviews/1"],
      ["PUT", "/api/admin/settings/contact"],
    ] as const) {
      const res = await call(env, path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    // 가짜 세션 쿠키도 거부
    const forged = await call(env, "/api/admin/reviews?status=pending", { cookie: "__Host-sid=" + "A".repeat(43) });
    expect(forged.status).toBe(401);
    const links = await env.DB.prepare("SELECT COUNT(*) AS n FROM review_tokens").first<{ n: number }>();
    expect(links?.n).toBe(0);
  });

  it("잘못된 Origin 의 상태 변경 요청은 세션이 있어도 403으로 거부한다", async () => {
    const cookie = await login(env);
    const id = await writeReview(cookie);
    const evil = await call(env, `/api/admin/reviews/${id}/publish`, { method: "POST", cookie, origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const missing = await call(env, `/api/admin/reviews/${id}/publish`, { method: "POST", cookie, origin: null });
    expect(missing.status).toBe(403);
    const lookalike = await call(env, `/api/admin/reviews/${id}`, { method: "DELETE", cookie, origin: "https://site.test.evil.example" });
    expect(lookalike.status).toBe(403);
    const loginCsrf = await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: ADMIN_PASSWORD }, origin: "https://evil.example" });
    expect(loginCsrf.status).toBe(403);
    expect((await adminReviews(cookie, "pending")).length).toBe(1);
    // 올바른 Origin 이면 통과
    const ok = await call(env, `/api/admin/reviews/${id}/publish`, { cookie, method: "POST" });
    expect(ok.status).toBe(200);
  });

  it("로그인 쿠키는 HttpOnly·Secure·SameSite=Strict 이고 DB 에는 해시만 저장한다", async () => {
    const res = await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: ADMIN_PASSWORD } });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/^__Host-sid=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=43200");
    const token = setCookie.split(";")[0]!.split("=")[1]!;
    const row = await env.DB.prepare("SELECT session_hash, expires_at - created_at AS ttl FROM admin_sessions").first<{ session_hash: string; ttl: number }>();
    expect(row!.session_hash).not.toContain(token);
    expect(row!.session_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.ttl).toBe(12 * 60 * MINUTE);
  });

  it("세션은 12시간 뒤 만료되고 로그아웃하면 즉시 폐기된다", async () => {
    const cookie = await login(env);
    expect((await call(env, "/api/admin/me", { cookie, now: NOW + 12 * 60 * MINUTE - 1 })).status).toBe(200);
    expect((await call(env, "/api/admin/me", { cookie, now: NOW + 12 * 60 * MINUTE })).status).toBe(401);

    const cookie2 = await login(env);
    expect((await call(env, "/api/admin/logout", { method: "POST", cookie: cookie2 })).status).toBe(200);
    expect((await call(env, "/api/admin/me", { cookie: cookie2 })).status).toBe(401);
  });

  it("로그인 실패 응답은 아이디와 비밀번호 중 무엇이 틀렸는지 알리지 않는다", async () => {
    const wrongId = await call(env, "/api/admin/login", { json: { id: "someone", password: ADMIN_PASSWORD } });
    const wrongPw = await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: "wrong-password" } });
    expect(wrongId.status).toBe(401);
    expect(wrongPw.status).toBe(401);
    expect(await wrongId.text()).toBe(await wrongPw.text());
  });

  it("로그인 6회째는 잠금(5회 실패 뒤 15분 동안 맞는 비밀번호도 거부)", async () => {
    const ip = "198.51.100.7";
    for (let i = 1; i <= 5; i++) {
      const res = await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: `wrong-${i}` }, ip, now: NOW + i * MINUTE });
      expect(res.status, `시도 ${i}`).toBe(401);
    }
    const sixth = await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: ADMIN_PASSWORD }, ip, now: NOW + 6 * MINUTE });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Set-Cookie")).toBeNull();
    // 다른 IP 는 영향 없음
    expect((await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: ADMIN_PASSWORD }, ip: "198.51.100.8", now: NOW + 6 * MINUTE })).status).toBe(200);
    // 잠금 중 (5번째 실패 + 15분 직전)
    expect((await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: ADMIN_PASSWORD }, ip, now: NOW + 5 * MINUTE + 15 * MINUTE - 1 })).status).toBe(429);
    // 15분이 지나면 다시 로그인 가능
    expect((await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: ADMIN_PASSWORD }, ip, now: NOW + 5 * MINUTE + 15 * MINUTE })).status).toBe(200);
  });

  it("15분이 지난 실패는 횟수에 넣지 않는다", async () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < 4; i++) await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: "wrong" }, ip, now: NOW });
    await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: "wrong" }, ip, now: NOW + 16 * MINUTE });
    const res = await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: ADMIN_PASSWORD }, ip, now: NOW + 17 * MINUTE });
    expect(res.status).toBe(200);
  });

  it("환경 변수가 없으면 아무도 로그인할 수 없다", async () => {
    const bare: Env = { DB: env.DB, PHOTOS: env.PHOTOS };
    const res = await call(bare, "/api/admin/login", { json: { id: "", password: "" } });
    expect(res.status).toBe(401);
  });
});

describe("후기 요청 링크와 후기 작성", () => {
  it("링크 토큰은 256비트 무작위 값이고 DB 에는 해시만 저장한다", async () => {
    const cookie = await login(env);
    const res = await call(env, "/api/admin/review-links", { method: "POST", cookie });
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
    const cookie = await login(env);
    const id = await writeReview(cookie);
    expect(await publicReviews()).toEqual([]);
    const pending = await adminReviews(cookie, "pending");
    expect(pending.map((r) => r.id)).toEqual([id]);

    await call(env, `/api/admin/reviews/${id}/publish`, { cookie, method: "POST" });
    expect((await publicReviews()).map((r) => r.id)).toEqual([id]);

    await call(env, `/api/admin/reviews/${id}/hide`, { cookie, method: "POST" });
    expect(await publicReviews()).toEqual([]);
    // 숨김은 되돌릴 수 있다
    await call(env, `/api/admin/reviews/${id}/publish`, { cookie, method: "POST" });
    expect((await publicReviews()).map((r) => r.id)).toEqual([id]);
  });

  it("공개 목록은 최신순이고 업체 답변을 포함한다", async () => {
    const cookie = await login(env);
    const first = await writeReview(cookie, { nickname: "테스트 고객1" });
    const second = await writeReview(cookie, { nickname: "테스트 고객2" });
    // 두 번째 후기를 더 늦게 쓴 것으로 만든다
    await env.DB.prepare("UPDATE reviews SET created_at = ?1 WHERE id = ?2").bind(NOW + MINUTE, second).run();
    for (const id of [first, second]) await call(env, `/api/admin/reviews/${id}/publish`, { cookie, method: "POST" });
    await call(env, `/api/admin/reviews/${first}/reply`, { method: "PUT", cookie, json: { reply: "이용해 주셔서 감사합니다." } });
    const list = await publicReviews();
    expect(list.map((r) => r.nickname)).toEqual(["테스트 고객2", "테스트 고객1"]);
    expect(list[1]!.reply).toBe("이용해 주셔서 감사합니다.");
  });

  it("사용된 토큰은 다시 쓸 수 없다", async () => {
    const cookie = await login(env);
    const token = await createToken(env, cookie);
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
    const cookie = await login(env);
    const token = await createToken(env, cookie, NOW);
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
    const cookie = await login(env);
    const token = await createToken(env, cookie);
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
    const cookie = await login(env);
    const token = await createToken(env, cookie);
    const res = await submitWithToken(env, token, {}, [fakeJpeg({ exif: true })]);
    expect(res.status).toBe(400);
    expect((await readJson<{ error: string }>(res)).error).toContain("사진 정보");
    expect((await env.PHOTOS.list()).objects).toHaveLength(0);
    // 토큰은 그대로 쓸 수 있다
    expect((await submitWithToken(env, token, {}, [fakeJpeg()])).status).toBe(201);
  });

  it("JPEG 가 아니거나 5MB 를 넘거나 4장 이상이면 거부한다", async () => {
    const cookie = await login(env);
    const token = await createToken(env, cookie);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect((await submitWithToken(env, token, {}, [png])).status).toBe(400);
    expect((await submitWithToken(env, token, {}, [fakeJpeg({ size: 5 * 1024 * 1024 + 1 })])).status).toBe(400);
    expect((await submitWithToken(env, token, {}, [fakeJpeg(), fakeJpeg(), fakeJpeg(), fakeJpeg()])).status).toBe(400);
    expect((await submitWithToken(env, token, {}, [fakeJpeg({ size: 5 * 1024 * 1024 }), fakeJpeg(), fakeJpeg()])).status).toBe(201);
  });
});

describe("사진 공개", () => {
  it("숨긴 사진은 공개 응답에 나오지 않는다", async () => {
    const cookie = await login(env);
    const id = await writeReview(cookie, {}, [fakeJpeg(), fakeJpeg()]);
    const photos = (await adminReviews(cookie, "pending"))[0]!.photos;
    expect(photos).toHaveLength(2);
    const [keep, hide] = photos as [AdminReview["photos"][0], AdminReview["photos"][0]];

    // 승인 전에는 사진도 공개되지 않는다
    expect((await call(env, `/api/photos/${keep.id}`)).status).toBe(404);

    await call(env, `/api/admin/reviews/${id}/publish`, { cookie, method: "POST" });
    expect((await call(env, `/api/admin/photos/${hide.id}/hide`, { method: "POST", cookie })).status).toBe(200);

    const list = await publicReviews();
    expect(list[0]!.photos.map((p) => p.url)).toEqual([`/api/photos/${keep.id}`]);
    expect(JSON.stringify(list)).not.toContain(hide.id);
    expect((await call(env, `/api/photos/${hide.id}`)).status).toBe(404);
    const shown = await call(env, `/api/photos/${keep.id}`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("Content-Type")).toBe("image/jpeg");
    expect(shown.headers.get("X-Content-Type-Options")).toBe("nosniff");

    // 관리자는 숨긴 사진도 볼 수 있고, 다시 보이게 할 수 있다
    expect((await call(env, `/api/admin/photos/${hide.id}`, { cookie })).status).toBe(200);
    expect((await call(env, `/api/admin/photos/${hide.id}`)).status).toBe(401);
    await call(env, `/api/admin/photos/${hide.id}/show`, { method: "POST", cookie });
    expect((await publicReviews())[0]!.photos).toHaveLength(2);

    // 후기를 숨기면 사진도 공개되지 않는다
    await call(env, `/api/admin/reviews/${id}/hide`, { cookie, method: "POST" });
    expect((await call(env, `/api/photos/${keep.id}`)).status).toBe(404);
  });

  it("사진 삭제와 후기 삭제는 R2 에서도 지운다", async () => {
    const cookie = await login(env);
    const id = await writeReview(cookie, {}, [fakeJpeg(), fakeJpeg()]);
    const photos = (await adminReviews(cookie, "pending"))[0]!.photos;
    expect((await env.PHOTOS.list()).objects).toHaveLength(2);
    expect((await call(env, `/api/admin/photos/${photos[0]!.id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await env.PHOTOS.list()).objects).toHaveLength(1);
    expect((await call(env, `/api/admin/reviews/${id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await env.PHOTOS.list()).objects).toHaveLength(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reviews").first("n")).toBe(0);
  });
});

describe("관리자 기능", () => {
  it("관리자는 고객 글을 고치거나 후기를 직접 쓸 수 없다(답변만 가능)", async () => {
    const cookie = await login(env);
    const id = await writeReview(cookie);
    for (const [method, path] of [
      ["PUT", `/api/admin/reviews/${id}`],
      ["PATCH", `/api/admin/reviews/${id}`],
      ["POST", "/api/admin/reviews"],
    ] as const) {
      const res = await call(env, path, { method, cookie, json: { content: "관리자가 바꾼 글" } });
      expect([404, 405], `${method} ${path}`).toContain(res.status);
    }
    const reply = await call(env, `/api/admin/reviews/${id}/reply`, { method: "PUT", cookie, json: { reply: "감사합니다", content: "관리자가 바꾼 글" } });
    expect(reply.status).toBe(200);
    const review = (await adminReviews(cookie, "pending"))[0]!;
    expect(review.content).toBe("테스트 후기입니다. 친절하게 잘 옮겨 주셨어요.");
    expect(review.reply).toBe("감사합니다");
  });

  it("관리자 행동은 모두 최근 기록에 남는다", async () => {
    const cookie = await login(env);
    const id = await writeReview(cookie, {}, [fakeJpeg()]);
    const photoId = (await adminReviews(cookie, "pending"))[0]!.photos[0]!.id;
    await call(env, `/api/admin/reviews/${id}/publish`, { cookie, method: "POST" });
    await call(env, `/api/admin/photos/${photoId}/hide`, { method: "POST", cookie });
    await call(env, `/api/admin/reviews/${id}/reply`, { method: "PUT", cookie, json: { reply: "감사합니다" } });
    await call(env, `/api/admin/reviews/${id}/hide`, { cookie, method: "POST" });
    await call(env, "/api/admin/settings/contact", { method: "PUT", cookie, json: { kakaoChannelId: "_test", smsNumber: "010-0000-0000" } });
    await call(env, "/api/admin/settings/texts", { method: "PUT", cookie, json: { texts: { hero_lead: "테스트 소개 문구" } } });
    await call(env, `/api/admin/reviews/${id}`, { method: "DELETE", cookie });
    const res = await call(env, "/api/admin/audit", { cookie });
    const entries = (await readJson<{ entries: { action: string; target: string }[] }>(res)).entries;
    expect(entries.map((e) => e.action).reverse()).toEqual([
      "로그인",
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
    const cookie = await login(env);
    for (const smsNumber of ["02-123-4567", "011-1234-5678", "010-123-456", "01012345678a"]) {
      const res = await call(env, "/api/admin/settings/contact", { method: "PUT", cookie, json: { kakaoChannelId: "", smsNumber } });
      expect(res.status, smsNumber).toBe(400);
    }
    const bad = await call(env, "/api/admin/settings/contact", { method: "PUT", cookie, json: { kakaoChannelId: "javascript:alert(1)", smsNumber: "" } });
    expect(bad.status).toBe(400);
    const ok = await call(env, "/api/admin/settings/contact", { method: "PUT", cookie, json: { kakaoChannelId: "_test", smsNumber: "010-0000-0000" } });
    expect(ok.status).toBe(200);
    const pub = await readJson<{ kakaoChannelId: string; smsNumber: string }>(await call(env, "/api/settings"));
    expect(pub).toMatchObject({ kakaoChannelId: "_test", smsNumber: "01000000000" });
  });

  it("홈페이지 문구: 정해진 항목만 고칠 수 있다", async () => {
    const cookie = await login(env);
    const res = await call(env, "/api/admin/settings/texts", { method: "PUT", cookie, json: { texts: { company_name: "다른 상호" } } });
    expect(res.status).toBe(400);
    const tooLong = await call(env, "/api/admin/settings/texts", { method: "PUT", cookie, json: { texts: { hero_badge: "가".repeat(41) } } });
    expect(tooLong.status).toBe(400);
    const ok = await call(env, "/api/admin/settings/texts", { method: "PUT", cookie, json: { texts: { hero_badge: "테스트 제목" } } });
    expect(ok.status).toBe(200);
    const pub = await readJson<{ texts: Record<string, string> }>(await call(env, "/api/settings"));
    expect(pub.texts.hero_badge).toBe("테스트 제목");
    expect(Object.keys(pub).sort()).toEqual(["kakaoChannelId", "ok", "smsNumber", "texts"]);
  });

  it("SQL 처럼 보이는 입력도 글자 그대로 저장한다(바인딩 파라미터)", async () => {
    const cookie = await login(env);
    const nasty = "'); DROP TABLE reviews; -- 테스트";
    const id = await writeReview(cookie, { nickname: "테스트'--", content: nasty });
    const review = (await adminReviews(cookie, "pending")).find((r) => r.id === id)!;
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

  it("켜져 있으면 Turnstile 확인 뒤 승인 대기로 저장하고 IP당 하루 3건으로 제한한다", async () => {
    await enableOpenReview();
    const openEnv: Env = { ...env, TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };
    const verify = vi.fn(async () => new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", verify);

    const check = await readJson<{ ok: boolean; mode: string; turnstileSiteKey: string }>(await call(openEnv, "/api/review/check"));
    expect(check).toMatchObject({ ok: true, mode: "open", turnstileSiteKey: "1x00000000000000000000AA" });

    const form = () => {
      const f = reviewForm();
      f.append("cf-turnstile-response", "test-response");
      return f;
    };
    const noCaptcha = await call(openEnv, "/api/reviews", { form: reviewForm() });
    expect(noCaptcha.status).toBe(400);
    for (let i = 0; i < 3; i++) {
      expect((await call(openEnv, "/api/reviews", { form: form(), now: NOW + i })).status).toBe(201);
    }
    expect((await call(openEnv, "/api/reviews", { form: form(), now: NOW + 10 })).status).toBe(429);
    expect((await call(openEnv, "/api/reviews", { form: form(), ip: "203.0.113.99", now: NOW + 10 })).status).toBe(201);
    expect((await call(openEnv, "/api/reviews", { form: form(), now: NOW + DAY })).status).toBe(201);
    expect(verify).toHaveBeenCalled();
    expect(await publicReviews()).toEqual([]);
    const statuses = await env.DB.prepare("SELECT DISTINCT status, source FROM reviews").all();
    expect(statuses.results).toEqual([{ status: "pending", source: "open" }]);

    verify.mockImplementation(async () => new Response(JSON.stringify({ success: false })));
    expect((await call(openEnv, "/api/reviews", { form: form(), ip: "203.0.113.50" })).status).toBe(400);
  });
});

describe("API 응답 보안 헤더", () => {
  it("모든 API 응답에 nosniff, CSP, frame-ancestors 를 붙인다", async () => {
    for (const path of ["/api/settings", "/api/reviews", "/api/admin/me", "/api/nothing"]) {
      const res = await call(env, path);
      expect(res.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
      expect(res.headers.get("Content-Security-Policy"), path).toContain("frame-ancestors 'none'");
    }
  });
});
