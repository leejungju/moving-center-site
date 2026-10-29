// /api/* 요청을 처리한다. functions/api/[[path]].ts 가 이 함수를 부른다.

import * as admin from "./admin";
import { checkAdmin } from "./auth";
import { fail, json, originAllowed, withSecurityHeaders } from "./http";
import { checkWriteAccess, getPublicPhoto, listPublicReviews, submitReview } from "./reviews";
import { loadSettings, textValues } from "./settings";
import type { Ctx, Env, Handler } from "./types";

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  /** Cloudflare Access 로 확인된 관리자만 쓸 수 있는가 */
  admin?: boolean;
}

async function publicSettings(ctx: Ctx): Promise<Response> {
  const stored = await loadSettings(ctx.env);
  return json({
    ok: true,
    texts: textValues(stored),
    kakaoChannelId: stored.kakao_channel_id ?? "",
    smsNumber: stored.sms_number ?? "",
  });
}

const ROUTES: Route[] = [
  { method: "GET", pattern: /^\/api\/settings$/, handler: publicSettings },
  { method: "GET", pattern: /^\/api\/reviews$/, handler: listPublicReviews },
  { method: "POST", pattern: /^\/api\/reviews$/, handler: submitReview },
  { method: "GET", pattern: /^\/api\/photos\/(?<id>[^/]+)$/, handler: getPublicPhoto },
  { method: "GET", pattern: /^\/api\/review\/check$/, handler: checkWriteAccess },

  { method: "GET", pattern: /^\/api\/admin\/me$/, handler: admin.me, admin: true },
  { method: "GET", pattern: /^\/api\/admin\/reviews$/, handler: admin.listReviews, admin: true },
  { method: "POST", pattern: /^\/api\/admin\/reviews\/(?<id>[^/]+)\/publish$/, handler: admin.publishReview, admin: true },
  { method: "POST", pattern: /^\/api\/admin\/reviews\/(?<id>[^/]+)\/hide$/, handler: admin.hideReview, admin: true },
  { method: "PUT", pattern: /^\/api\/admin\/reviews\/(?<id>[^/]+)\/reply$/, handler: admin.saveReply, admin: true },
  { method: "DELETE", pattern: /^\/api\/admin\/reviews\/(?<id>[^/]+)$/, handler: admin.deleteReview, admin: true },
  { method: "GET", pattern: /^\/api\/admin\/photos\/(?<id>[^/]+)$/, handler: admin.getAdminPhoto, admin: true },
  { method: "POST", pattern: /^\/api\/admin\/photos\/(?<id>[^/]+)\/hide$/, handler: admin.hidePhoto, admin: true },
  { method: "POST", pattern: /^\/api\/admin\/photos\/(?<id>[^/]+)\/show$/, handler: admin.showPhoto, admin: true },
  { method: "DELETE", pattern: /^\/api\/admin\/photos\/(?<id>[^/]+)$/, handler: admin.deletePhoto, admin: true },
  { method: "POST", pattern: /^\/api\/admin\/review-links$/, handler: admin.createReviewLink, admin: true },
  { method: "GET", pattern: /^\/api\/admin\/settings$/, handler: admin.getSettings, admin: true },
  { method: "PUT", pattern: /^\/api\/admin\/settings\/texts$/, handler: admin.saveTexts, admin: true },
  { method: "PUT", pattern: /^\/api\/admin\/settings\/contact$/, handler: admin.saveContact, admin: true },
  { method: "GET", pattern: /^\/api\/admin\/audit$/, handler: admin.listAudit, admin: true },
];

const SAFE_METHODS = new Set(["GET", "HEAD"]);

async function route(request: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method === "HEAD" ? "GET" : request.method;
  const candidates = ROUTES.filter((r) => r.pattern.test(url.pathname));
  if (candidates.length === 0) return fail(404, "찾을 수 없습니다.");
  const matched = candidates.find((r) => r.method === method);
  if (!matched) return fail(405, "허용되지 않는 요청입니다.");

  // 상태를 바꾸는 요청은 Origin 이 이 사이트여야 한다(다른 사이트에서 보낸 요청 차단).
  if (!SAFE_METHODS.has(request.method) && !originAllowed(request, url)) {
    return fail(403, "허용되지 않는 요청입니다.");
  }

  const ctx: Ctx = {
    request,
    env,
    url,
    params: { ...(url.pathname.match(matched.pattern)?.groups ?? {}) },
    now,
    ip: request.headers.get("CF-Connecting-IP") ?? "unknown",
  };

  if (matched.admin) {
    const check = await checkAdmin(ctx);
    if (!check.ok) return fail(check.status, check.message);
    ctx.adminEmail = check.email;
  }
  return matched.handler(ctx);
}

export async function handleApi(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  let response: Response;
  try {
    response = await route(request, env, now);
  } catch (error) {
    console.error(error);
    response = fail(500, "잠시 문제가 생겼습니다. 잠시 후 다시 해 주세요.");
  }
  return withSecurityHeaders(response);
}
