// 공개 후기: 목록, 사진, 작성 링크 확인, 후기 제출

import { randomId, sha256Hex } from "./crypto";
import { fail, json, readBodyLimited } from "./http";
import { checkJpeg, MAX_PHOTO_BYTES } from "./jpeg";
import { loadSettings, openReviewActive } from "./settings";
import type { Ctx } from "./types";

export const SERVICES = ["가정이사", "원룸이사", "사무실이사", "보관이사"] as const;
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_PHOTOS = 3;
export const OPEN_REVIEW_DAILY_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 후기 제출 본문 상한: 사진 3장 x 5MB + 글·양식 여유 1MB */
export const MAX_BODY_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + 1024 * 1024;
const PUBLIC_PAGE_SIZE = 20;

export interface ReviewRow {
  id: number;
  nickname: string;
  service: string;
  content: string;
  status: string;
  reply: string | null;
  created_at: number;
}

interface PhotoRow {
  id: string;
  review_id: number;
  hidden: number;
}

// 줄바꿈·탭 외의 제어 문자와 글자 방향을 바꾸는 문자는 받지 않는다.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/;

function charLength(text: string): number {
  return [...text].length;
}

export function cleanNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (CONTROL_CHARS.test(text)) return null;
  const n = charLength(text);
  return n >= 2 && n <= 10 ? text : null;
}

export function cleanContent(value: unknown, min = 10, max = 1000): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (CONTROL_CHARS.test(text.replace(/[\n\t]/g, ""))) return null;
  const n = charLength(text);
  return n >= min && n <= max ? text : null;
}

/** 공개 승인된 후기 목록(최신순)과 숨기지 않은 사진 */
export async function listPublicReviews(ctx: Ctx): Promise<Response> {
  const beforeParam = ctx.url.searchParams.get("before");
  const before = beforeParam && /^\d{1,12}$/.test(beforeParam) ? Number(beforeParam) : null;
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, nickname, service, content, status, reply, created_at FROM reviews
     WHERE status = 'published' AND (?1 IS NULL OR id < ?1)
     ORDER BY created_at DESC, id DESC LIMIT ?2`,
  )
    .bind(before, PUBLIC_PAGE_SIZE + 1)
    .all<ReviewRow>();
  const page = results.slice(0, PUBLIC_PAGE_SIZE);
  const photos = await photosFor(ctx, page.map((r) => r.id), false);
  return json({
    ok: true,
    reviews: page.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      service: r.service,
      content: r.content,
      reply: r.reply,
      createdAt: r.created_at,
      photos: (photos.get(r.id) ?? []).map((p) => ({ url: `/api/photos/${p.id}` })),
    })),
    hasMore: results.length > PUBLIC_PAGE_SIZE,
  });
}

export async function photosFor(ctx: Ctx, reviewIds: number[], includeHidden: boolean): Promise<Map<number, PhotoRow[]>> {
  const map = new Map<number, PhotoRow[]>();
  if (reviewIds.length === 0) return map;
  const placeholders = reviewIds.map((_, i) => `?${i + 1}`).join(", ");
  const hiddenFilter = includeHidden ? "" : "AND hidden = 0";
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, review_id, hidden FROM review_photos WHERE review_id IN (${placeholders}) ${hiddenFilter} ORDER BY review_id, position`,
  )
    .bind(...reviewIds)
    .all<PhotoRow>();
  for (const p of results) {
    const list = map.get(p.review_id) ?? [];
    list.push(p);
    map.set(p.review_id, list);
  }
  return map;
}

export function photoResponse(object: R2ObjectBody, cacheControl: string): Response {
  return new Response(object.body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": cacheControl },
  });
}

/** 공개 승인된 후기의 숨기지 않은 사진만 내보낸다. */
export async function getPublicPhoto(ctx: Ctx): Promise<Response> {
  const id = ctx.params.id ?? "";
  if (!/^[0-9a-f]{32}$/.test(id)) return fail(404, "사진을 찾을 수 없습니다.");
  const row = await ctx.env.DB.prepare(
    `SELECT p.r2_key FROM review_photos p JOIN reviews r ON r.id = p.review_id
     WHERE p.id = ?1 AND p.hidden = 0 AND r.status = 'published'`,
  )
    .bind(id)
    .first<{ r2_key: string }>();
  if (!row) return fail(404, "사진을 찾을 수 없습니다.");
  const object = await ctx.env.PHOTOS.get(row.r2_key);
  if (!object) return fail(404, "사진을 찾을 수 없습니다.");
  // 관리자가 숨기거나 지우면 바로 반영되도록 매번 확인하게 한다.
  return photoResponse(object, "no-cache");
}

type TokenState = "valid" | "used" | "expired" | "invalid";

async function tokenState(ctx: Ctx, token: string): Promise<TokenState> {
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(token)) return "invalid";
  const row = await ctx.env.DB.prepare("SELECT expires_at, used_at FROM review_tokens WHERE token_hash = ?1")
    .bind(await sha256Hex(token))
    .first<{ expires_at: number; used_at: number | null }>();
  if (!row) return "invalid";
  if (row.used_at !== null) return "used";
  if (row.expires_at <= ctx.now) return "expired";
  return "valid";
}

const TOKEN_MESSAGES: Record<Exclude<TokenState, "valid">, string> = {
  used: "이미 후기를 작성한 링크입니다. 소중한 후기 감사합니다.",
  expired: "링크의 사용 기간(30일)이 지났습니다. 업체에 새 링크를 요청해 주세요.",
  invalid: "올바르지 않은 링크입니다. 받은 링크 주소를 다시 확인해 주세요.",
};

/** 작성 화면이 처음 열릴 때 쓸 수 있는 상태인지 알려 준다. */
export async function checkWriteAccess(ctx: Ctx): Promise<Response> {
  const token = ctx.url.searchParams.get("t");
  if (token) {
    const state = await tokenState(ctx, token);
    if (state === "valid") return json({ ok: true, mode: "invite" });
    return json({ ok: false, reason: state, message: TOKEN_MESSAGES[state] });
  }
  const stored = await loadSettings(ctx.env);
  if (openReviewActive(stored, ctx.env)) {
    return json({ ok: true, mode: "open", turnstileSiteKey: stored.turnstile_site_key });
  }
  return json({ ok: false, reason: "closed", message: "후기는 업체에서 보내 드린 링크로만 작성할 수 있습니다." });
}

function ipHash(prefix: string, ip: string): Promise<string> {
  return sha256Hex(`${prefix}:${ip}`);
}

/** Turnstile 서버 확인. 성공이고, 토큰이 이 사이트(요청 호스트)에서 발급된 것이어야 한다. */
async function verifyTurnstile(secret: string, response: string, ip: string, hostname: string): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", response);
  form.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = (await res.json()) as { success?: unknown; hostname?: unknown };
    return data.success === true && data.hostname === hostname;
  } catch {
    return false;
  }
}

/** 후기 제출. 항상 승인 대기로 저장한다. */
export async function submitReview(ctx: Ctx): Promise<Response> {
  const { env, now } = ctx;
  const contentType = ctx.request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return fail(400, "잘못된 요청입니다.");
  }
  const body = await readBodyLimited(ctx.request, MAX_BODY_BYTES);
  if (body === "too_large") return fail(413, "사진 용량이 너무 큽니다.");

  let form: FormData;
  try {
    form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    return fail(400, "잘못된 요청입니다.");
  }

  const nickname = cleanNickname(form.get("nickname"));
  if (!nickname) return fail(400, "별명은 2~10자로 적어 주세요.");
  const service = form.get("service");
  if (typeof service !== "string" || !(SERVICES as readonly string[]).includes(service)) {
    return fail(400, "이용 서비스를 골라 주세요.");
  }
  const content = cleanContent(form.get("content"));
  if (!content) return fail(400, "후기 내용은 10~1000자로 적어 주세요.");
  if (form.get("consent") !== "yes") return fail(400, "개인정보 수집·이용 안내에 동의해 주세요.");

  const files = form.getAll("photos").filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (files.length > MAX_PHOTOS) return fail(400, "사진은 3장까지 올릴 수 있습니다.");
  const photos: Uint8Array[] = [];
  for (const file of files) {
    if (file.size > MAX_PHOTO_BYTES) return fail(400, "사진 한 장은 5MB 이하여야 합니다.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkJpeg(bytes);
    if (check === "too_large") return fail(400, "사진 한 장은 5MB 이하여야 합니다.");
    if (check === "not_jpeg") return fail(400, "JPEG 사진만 올릴 수 있습니다.");
    if (check === "has_metadata") return fail(400, "위치 정보 등 사진 정보가 남아 있는 사진은 올릴 수 없습니다.");
    photos.push(bytes);
  }

  const token = form.get("t");
  let tokenHash: string | null = null;
  let source: "invite" | "open";
  if (typeof token === "string" && token !== "") {
    source = "invite";
    const state = await tokenState(ctx, token);
    if (state !== "valid") return fail(410, TOKEN_MESSAGES[state], { reason: state });
    tokenHash = await sha256Hex(token);
    // 사용 완료 처리. 동시에 두 번 제출돼도 한 번만 성공한다.
    const claimed = await env.DB.prepare(
      "UPDATE review_tokens SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1",
    )
      .bind(now, tokenHash)
      .run();
    if (claimed.meta.changes !== 1) return fail(410, TOKEN_MESSAGES.used, { reason: "used" });
  } else {
    source = "open";
    const stored = await loadSettings(env);
    if (!openReviewActive(stored, env)) return fail(403, "후기는 업체에서 보내 드린 링크로만 작성할 수 있습니다.");
    const ipKey = await ipHash("open-review", ctx.ip);
    await env.DB.prepare("DELETE FROM open_review_log WHERE created_at <= ?1").bind(now - DAY_MS).run();
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM open_review_log WHERE ip_hash = ?1 AND created_at > ?2")
      .bind(ipKey, now - DAY_MS)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= OPEN_REVIEW_DAILY_LIMIT) return fail(429, "하루에 작성할 수 있는 후기 수를 넘었습니다. 내일 다시 해 주세요.");
    const captcha = form.get("cf-turnstile-response");
    if (typeof captcha !== "string" || captcha === "" || !(await verifyTurnstile(env.TURNSTILE_SECRET_KEY!, captcha, ctx.ip, ctx.url.hostname))) {
      return fail(400, "자동 입력 방지 확인에 실패했습니다. 다시 해 주세요.");
    }
    await env.DB.prepare("INSERT INTO open_review_log (ip_hash, created_at) VALUES (?1, ?2)").bind(ipKey, now).run();
  }

  let reviewId: number | null = null;
  const uploadedKeys: string[] = [];
  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews (nickname, service, content, status, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?5) RETURNING id`,
    )
      .bind(nickname, service, content, source, now)
      .first<{ id: number }>();
    if (!inserted) throw new Error("insert failed");
    reviewId = inserted.id;
    const statements: D1PreparedStatement[] = [];
    for (const [position, bytes] of photos.entries()) {
      const photoId = randomId();
      const key = `reviews/${reviewId}/${photoId}.jpg`;
      await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
      uploadedKeys.push(key);
      statements.push(
        env.DB.prepare("INSERT INTO review_photos (id, review_id, r2_key, position, hidden, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)").bind(
          photoId,
          reviewId,
          key,
          position,
          now,
        ),
      );
    }
    if (tokenHash) {
      statements.push(env.DB.prepare("UPDATE review_tokens SET review_id = ?1 WHERE token_hash = ?2").bind(reviewId, tokenHash));
    }
    if (statements.length > 0) await env.DB.batch(statements);
  } catch {
    // 저장 도중 실패하면 되돌리고 링크를 다시 쓸 수 있게 한다.
    if (uploadedKeys.length > 0) await env.PHOTOS.delete(uploadedKeys);
    if (reviewId !== null) await env.DB.prepare("DELETE FROM reviews WHERE id = ?1").bind(reviewId).run();
    if (tokenHash) await env.DB.prepare("UPDATE review_tokens SET used_at = NULL, review_id = NULL WHERE token_hash = ?1").bind(tokenHash).run();
    return fail(500, "저장하지 못했습니다. 잠시 후 다시 해 주세요.");
  }
  return json({ ok: true, message: "후기가 접수되었습니다. 업체 확인 후 홈페이지에 올라갑니다. 감사합니다." }, 201);
}
