// 관리자 로그인, 세션, 로그인 실패 제한, 관리자 기록

import { randomToken, safeStringEqual, sha256Hex, verifyPassword } from "./crypto";
import { fail, getCookie, json, readJson } from "./http";
import type { Ctx, Env } from "./types";

export const SESSION_COOKIE = "__Host-sid";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

const LOGIN_FAILED = "아이디 또는 비밀번호가 맞지 않습니다.";
const LOGIN_LOCKED = "로그인을 여러 번 실패해서 15분 동안 잠겼습니다. 15분 뒤에 다시 해 주세요.";

export async function audit(env: Env, now: number, action: string, target = ""): Promise<void> {
  await env.DB.prepare("INSERT INTO audit_log (created_at, action, target) VALUES (?1, ?2, ?3)").bind(now, action, target).run();
}

export function ipHash(prefix: string, ip: string): Promise<string> {
  return sha256Hex(`${prefix}:${ip}`);
}

function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function login(ctx: Ctx): Promise<Response> {
  const { env, now } = ctx;
  const ipKey = await ipHash("login", ctx.ip);

  const lock = await env.DB.prepare("SELECT locked_until FROM login_locks WHERE ip_hash = ?1")
    .bind(ipKey)
    .first<{ locked_until: number }>();
  if (lock && lock.locked_until > now) {
    return fail(429, LOGIN_LOCKED, { lockedUntil: lock.locked_until });
  }

  const body = await readJson(ctx.request);
  const id = typeof body?.id === "string" ? body.id.slice(0, 200) : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, 500) : "";

  const configured = !!env.ADMIN_ID && !!env.ADMIN_PASSWORD_HASH;
  // 아이디가 틀려도 비밀번호 계산을 똑같이 해서 어느 쪽이 틀렸는지 시간으로도 드러나지 않게 한다.
  const [idOk, passwordOk] = await Promise.all([
    safeStringEqual(id, env.ADMIN_ID ?? ""),
    verifyPassword(password, env.ADMIN_PASSWORD_HASH ?? ""),
  ]);

  if (!configured || !idOk || !passwordOk || id === "") {
    await env.DB.prepare("INSERT INTO login_failures (ip_hash, attempted_at) VALUES (?1, ?2)").bind(ipKey, now).run();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip_hash = ?1 AND attempted_at > ?2")
      .bind(ipKey, now - LOGIN_WINDOW_MS)
      .first<{ n: number }>();
    if ((row?.n ?? 0) >= LOGIN_MAX_FAILURES) {
      await env.DB.prepare(
        "INSERT INTO login_locks (ip_hash, locked_until) VALUES (?1, ?2) ON CONFLICT (ip_hash) DO UPDATE SET locked_until = excluded.locked_until",
      )
        .bind(ipKey, now + LOGIN_LOCK_MS)
        .run();
      await env.DB.prepare("DELETE FROM login_failures WHERE ip_hash = ?1").bind(ipKey).run();
      await audit(env, now, "로그인 실패 (15분 잠금)");
    } else {
      await audit(env, now, "로그인 실패");
    }
    return fail(401, LOGIN_FAILED);
  }

  const token = randomToken(32); // 256비트
  const tokenHash = await sha256Hex(token);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?1").bind(now),
    env.DB.prepare("DELETE FROM login_failures WHERE ip_hash = ?1 OR attempted_at <= ?2").bind(ipKey, now - LOGIN_WINDOW_MS),
    env.DB.prepare("DELETE FROM login_locks WHERE locked_until <= ?1").bind(now),
    env.DB.prepare("INSERT INTO admin_sessions (session_hash, created_at, expires_at) VALUES (?1, ?2, ?3)").bind(
      tokenHash,
      now,
      now + SESSION_TTL_MS,
    ),
  ]);
  await audit(env, now, "로그인");
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL_MS / 1000) });
}

/** 유효한 관리자 세션이면 세션 해시를, 아니면 null 을 돌려준다. */
export async function currentSession(ctx: Ctx): Promise<string | null> {
  const token = getCookie(ctx.request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await ctx.env.DB.prepare("SELECT session_hash FROM admin_sessions WHERE session_hash = ?1 AND expires_at > ?2")
    .bind(tokenHash, ctx.now)
    .first<{ session_hash: string }>();
  return row ? row.session_hash : null;
}

export async function logout(ctx: Ctx): Promise<Response> {
  const sessionHash = await currentSession(ctx);
  if (sessionHash) {
    await ctx.env.DB.prepare("DELETE FROM admin_sessions WHERE session_hash = ?1").bind(sessionHash).run();
    await audit(ctx.env, ctx.now, "로그아웃");
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}
