// 관리자 API: 후기 관리, 후기 요청 링크, 홈페이지 문구, 연락처, 최근 기록
// 관리자는 고객 후기 내용을 고치거나 직접 쓸 수 없다. 답변만 쓸 수 있다.

import { audit } from "./auth";
import { randomToken, sha256Hex } from "./crypto";
import { fail, json, readJson } from "./http";
import { cleanContent, photoResponse, photosFor, TOKEN_TTL_MS, type ReviewRow } from "./reviews";
import { loadSettings, normalizeMobile, saveSettings, TEXT_FIELDS, textValues, validKakaoChannelId } from "./settings";
import type { Ctx } from "./types";

const STATUSES = ["pending", "published", "hidden"] as const;

function reviewTarget(r: { id: number; nickname: string }): string {
  return `후기 #${r.id} (${r.nickname})`;
}

function idParam(ctx: Ctx): number | null {
  const raw = ctx.params.id ?? "";
  return /^\d{1,12}$/.test(raw) ? Number(raw) : null;
}

async function findReview(ctx: Ctx): Promise<ReviewRow | null> {
  const id = idParam(ctx);
  if (id === null) return null;
  return ctx.env.DB.prepare("SELECT id, nickname, service, content, status, reply, created_at FROM reviews WHERE id = ?1")
    .bind(id)
    .first<ReviewRow>();
}

export async function me(): Promise<Response> {
  return json({ ok: true });
}

export async function listReviews(ctx: Ctx): Promise<Response> {
  const status = ctx.url.searchParams.get("status") ?? "pending";
  if (!(STATUSES as readonly string[]).includes(status)) return fail(400, "잘못된 요청입니다.");
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, nickname, service, content, status, reply, created_at FROM reviews WHERE status = ?1 ORDER BY created_at DESC, id DESC LIMIT 200",
  )
    .bind(status)
    .all<ReviewRow>();
  const photos = await photosFor(ctx, results.map((r) => r.id), true);
  const counts = await ctx.env.DB.prepare("SELECT status, COUNT(*) AS n FROM reviews GROUP BY status").all<{ status: string; n: number }>();
  return json({
    ok: true,
    counts: Object.fromEntries(STATUSES.map((s) => [s, counts.results.find((c) => c.status === s)?.n ?? 0])),
    reviews: results.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      service: r.service,
      content: r.content,
      status: r.status,
      reply: r.reply,
      createdAt: r.created_at,
      photos: (photos.get(r.id) ?? []).map((p) => ({ id: p.id, hidden: p.hidden === 1, url: `/api/admin/photos/${p.id}` })),
    })),
  });
}

async function setStatus(ctx: Ctx, status: "published" | "hidden", action: string): Promise<Response> {
  const review = await findReview(ctx);
  if (!review) return fail(404, "후기를 찾을 수 없습니다.");
  await ctx.env.DB.prepare("UPDATE reviews SET status = ?1, updated_at = ?2 WHERE id = ?3").bind(status, ctx.now, review.id).run();
  await audit(ctx.env, ctx.now, action, reviewTarget(review));
  return json({ ok: true });
}

export const publishReview = (ctx: Ctx) => setStatus(ctx, "published", "후기 공개");
export const hideReview = (ctx: Ctx) => setStatus(ctx, "hidden", "후기 숨김");

export async function deleteReview(ctx: Ctx): Promise<Response> {
  const review = await findReview(ctx);
  if (!review) return fail(404, "후기를 찾을 수 없습니다.");
  const { results } = await ctx.env.DB.prepare("SELECT r2_key FROM review_photos WHERE review_id = ?1")
    .bind(review.id)
    .all<{ r2_key: string }>();
  if (results.length > 0) await ctx.env.PHOTOS.delete(results.map((p) => p.r2_key));
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM review_photos WHERE review_id = ?1").bind(review.id),
    ctx.env.DB.prepare("UPDATE review_tokens SET review_id = NULL WHERE review_id = ?1").bind(review.id),
    ctx.env.DB.prepare("DELETE FROM reviews WHERE id = ?1").bind(review.id),
  ]);
  await audit(ctx.env, ctx.now, "후기 삭제", reviewTarget(review));
  return json({ ok: true });
}

export async function saveReply(ctx: Ctx): Promise<Response> {
  const review = await findReview(ctx);
  if (!review) return fail(404, "후기를 찾을 수 없습니다.");
  const body = await readJson(ctx.request);
  if (!body || typeof body.reply !== "string") return fail(400, "잘못된 요청입니다.");
  if (body.reply.trim() === "") {
    await ctx.env.DB.prepare("UPDATE reviews SET reply = NULL, reply_updated_at = ?1, updated_at = ?1 WHERE id = ?2").bind(ctx.now, review.id).run();
    await audit(ctx.env, ctx.now, "답변 지움", reviewTarget(review));
    return json({ ok: true });
  }
  const reply = cleanContent(body.reply, 1, 1000);
  if (!reply) return fail(400, "답변은 1000자까지 쓸 수 있습니다.");
  await ctx.env.DB.prepare("UPDATE reviews SET reply = ?1, reply_updated_at = ?2, updated_at = ?2 WHERE id = ?3").bind(reply, ctx.now, review.id).run();
  await audit(ctx.env, ctx.now, review.reply ? "답변 고침" : "답변 씀", reviewTarget(review));
  return json({ ok: true });
}

async function findPhoto(ctx: Ctx) {
  const id = ctx.params.id ?? "";
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  return ctx.env.DB.prepare(
    "SELECT p.id, p.r2_key, p.review_id, r.nickname FROM review_photos p JOIN reviews r ON r.id = p.review_id WHERE p.id = ?1",
  )
    .bind(id)
    .first<{ id: string; r2_key: string; review_id: number; nickname: string }>();
}

async function setPhotoHidden(ctx: Ctx, hidden: 0 | 1, action: string): Promise<Response> {
  const photo = await findPhoto(ctx);
  if (!photo) return fail(404, "사진을 찾을 수 없습니다.");
  await ctx.env.DB.prepare("UPDATE review_photos SET hidden = ?1 WHERE id = ?2").bind(hidden, photo.id).run();
  await audit(ctx.env, ctx.now, action, `${reviewTarget({ id: photo.review_id, nickname: photo.nickname })}의 사진`);
  return json({ ok: true });
}

export const hidePhoto = (ctx: Ctx) => setPhotoHidden(ctx, 1, "사진 숨김");
export const showPhoto = (ctx: Ctx) => setPhotoHidden(ctx, 0, "사진 다시 보이기");

export async function deletePhoto(ctx: Ctx): Promise<Response> {
  const photo = await findPhoto(ctx);
  if (!photo) return fail(404, "사진을 찾을 수 없습니다.");
  await ctx.env.PHOTOS.delete(photo.r2_key);
  await ctx.env.DB.prepare("DELETE FROM review_photos WHERE id = ?1").bind(photo.id).run();
  await audit(ctx.env, ctx.now, "사진 삭제", `${reviewTarget({ id: photo.review_id, nickname: photo.nickname })}의 사진`);
  return json({ ok: true });
}

export async function getAdminPhoto(ctx: Ctx): Promise<Response> {
  const photo = await findPhoto(ctx);
  if (!photo) return fail(404, "사진을 찾을 수 없습니다.");
  const object = await ctx.env.PHOTOS.get(photo.r2_key);
  if (!object) return fail(404, "사진을 찾을 수 없습니다.");
  return photoResponse(object, "private, no-store");
}

export async function createReviewLink(ctx: Ctx): Promise<Response> {
  const token = randomToken(32); // 256비트
  const expiresAt = ctx.now + TOKEN_TTL_MS;
  await ctx.env.DB.prepare("INSERT INTO review_tokens (token_hash, created_at, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await sha256Hex(token), ctx.now, expiresAt)
    .run();
  await audit(ctx.env, ctx.now, "후기 요청 링크 만듦");
  return json({ ok: true, url: `${ctx.url.origin}/review/write?t=${token}`, expiresAt }, 201);
}

export async function getSettings(ctx: Ctx): Promise<Response> {
  const stored = await loadSettings(ctx.env);
  return json({
    ok: true,
    texts: TEXT_FIELDS.map((f) => ({ key: f.key, label: f.label, max: f.max, default: f.default, value: textValues(stored)[f.key] })),
    contact: { kakaoChannelId: stored.kakao_channel_id ?? "", smsNumber: stored.sms_number ?? "" },
  });
}

export async function saveTexts(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request);
  const texts = body?.texts;
  if (!texts || typeof texts !== "object") return fail(400, "잘못된 요청입니다.");
  const input = texts as Record<string, unknown>;
  const stored = await loadSettings(ctx.env);
  const current = textValues(stored);
  const changes: Record<string, string> = {};
  const changedLabels: string[] = [];
  for (const field of TEXT_FIELDS) {
    const raw = input[field.key];
    if (raw === undefined) continue;
    if (typeof raw !== "string") return fail(400, "잘못된 요청입니다.");
    const value = raw.replace(/\s+/g, " ").trim();
    if (value === "") return fail(400, `"${field.label}" 칸이 비어 있습니다.`);
    if ([...value].length > field.max) return fail(400, `"${field.label}"은(는) ${field.max}자까지 쓸 수 있습니다.`);
    if (value !== current[field.key]) {
      changes[field.key] = value;
      changedLabels.push(field.label);
    }
  }
  for (const key of Object.keys(input)) {
    if (!TEXT_FIELDS.some((f) => f.key === key)) return fail(400, "고칠 수 없는 항목입니다.");
  }
  if (changedLabels.length === 0) return json({ ok: true, changed: 0 });
  await saveSettings(ctx.env, changes, ctx.now);
  await audit(ctx.env, ctx.now, "홈페이지 문구 바꿈", changedLabels.join(", "));
  return json({ ok: true, changed: changedLabels.length });
}

export async function saveContact(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request);
  if (!body || typeof body.kakaoChannelId !== "string" || typeof body.smsNumber !== "string") return fail(400, "잘못된 요청입니다.");
  const kakao = body.kakaoChannelId.trim();
  if (kakao !== "" && !validKakaoChannelId(kakao)) {
    return fail(400, "카카오톡 채널 ID는 _ 로 시작하는 영문·숫자입니다. (예: _abcde)");
  }
  let sms = "";
  if (body.smsNumber.trim() !== "") {
    const normalized = normalizeMobile(body.smsNumber);
    if (!normalized) return fail(400, "휴대폰 번호는 010 으로 시작하는 11자리 숫자로 적어 주세요. (예: 010-1234-5678)");
    sms = normalized;
  }
  const stored = await loadSettings(ctx.env);
  const changed: string[] = [];
  if ((stored.kakao_channel_id ?? "") !== kakao) changed.push(kakao ? "카카오톡 채널 ID" : "카카오톡 채널 ID 지움");
  if ((stored.sms_number ?? "") !== sms) changed.push(sms ? "문자 받을 번호" : "문자 받을 번호 지움");
  await saveSettings(ctx.env, { kakao_channel_id: kakao, sms_number: sms }, ctx.now);
  if (changed.length > 0) await audit(ctx.env, ctx.now, "연락처 설정 바꿈", changed.join(", "));
  return json({ ok: true });
}

export async function listAudit(ctx: Ctx): Promise<Response> {
  const beforeParam = ctx.url.searchParams.get("before");
  const before = beforeParam && /^\d{1,12}$/.test(beforeParam) ? Number(beforeParam) : null;
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, created_at, action, target FROM audit_log WHERE (?1 IS NULL OR id < ?1) ORDER BY id DESC LIMIT 101",
  )
    .bind(before)
    .all<{ id: number; created_at: number; action: string; target: string }>();
  return json({
    ok: true,
    entries: results.slice(0, 100).map((e) => ({ id: e.id, createdAt: e.created_at, action: e.action, target: e.target })),
    hasMore: results.length > 100,
  });
}
