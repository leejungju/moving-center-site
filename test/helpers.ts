// 시험 도우미: wrangler 의 로컬 D1·R2(getPlatformProxy)를 쓰고 API 처리 함수를 직접 부른다.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { hashPassword } from "../src/crypto";
import { handleApi } from "../src/router";
import type { Env } from "../src/types";

export const ORIGIN = "https://site.test";
export const ADMIN_ID = "test-admin";
export const ADMIN_PASSWORD = "test-password-1234";
export const NOW = Date.UTC(2026, 9, 1, 3, 0, 0);
export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;

const TABLES = ["review_photos", "review_tokens", "reviews", "admin_sessions", "login_failures", "login_locks", "open_review_log", "audit_log", "settings"];

export interface TestContext {
  env: Env;
  dispose(): Promise<void>;
}

export async function createTestEnv(): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), "moving-center-test-"));
  const proxy = await getPlatformProxy<Env>({ configPath: "wrangler.toml", persist: { path: dir } });
  const sql = readFileSync("migrations/0001_init.sql", "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  await proxy.env.DB.batch(statements.map((s) => proxy.env.DB.prepare(s)));
  const env: Env = {
    DB: proxy.env.DB,
    PHOTOS: proxy.env.PHOTOS,
    ADMIN_ID,
    ADMIN_PASSWORD_HASH: await hashPassword(ADMIN_PASSWORD),
  };
  return {
    env,
    async dispose() {
      await proxy.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function resetData(env: Env): Promise<void> {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const listed = await env.PHOTOS.list();
  if (listed.objects.length > 0) await env.PHOTOS.delete(listed.objects.map((o) => o.key));
}

export interface CallOptions {
  method?: string;
  cookie?: string;
  /** null 이면 Origin 헤더를 보내지 않는다. 기본은 이 사이트 주소. */
  origin?: string | null;
  ip?: string;
  json?: unknown;
  form?: FormData;
  now?: number;
}

export async function call(env: Env, path: string, opts: CallOptions = {}): Promise<Response> {
  const method = opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET");
  const headers = new Headers({ "CF-Connecting-IP": opts.ip ?? "203.0.113.10" });
  if (opts.origin !== null && method !== "GET") headers.set("Origin", opts.origin ?? ORIGIN);
  if (opts.cookie) headers.set("Cookie", opts.cookie);
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  return handleApi(new Request(ORIGIN + path, { method, headers, body }), env, opts.now ?? NOW);
}

export async function login(env: Env, now = NOW, ip?: string): Promise<string> {
  const res = await call(env, "/api/admin/login", { json: { id: ADMIN_ID, password: ADMIN_PASSWORD }, now, ip });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  return setCookie.split(";")[0]!;
}

export async function createToken(env: Env, cookie: string, now = NOW): Promise<string> {
  const res = await call(env, "/api/admin/review-links", { method: "POST", cookie, now });
  const data = (await res.json()) as { url: string };
  return new URL(data.url).searchParams.get("t")!;
}

/** 가짜 JPEG(검사용 구조만 갖춘 바이트). exif=true 면 APP1(Exif) 구간을 넣는다. */
export function fakeJpeg(options: { exif?: boolean; size?: number } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  // APP0 JFIF
  parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
  if (options.exif) {
    // APP1 "Exif\0\0" + 가짜 TIFF 머리말
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08];
    const len = payload.length + 2;
    parts.push(0xff, 0xe1, len >> 8, len & 0xff, ...payload);
  }
  // SOS + 압축 데이터 + EOI
  parts.push(0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00);
  const filler = Math.max(0, (options.size ?? 0) - parts.length - 6);
  for (let i = 0; i < filler; i++) parts.push(i % 2 === 0 ? 0x12 : 0x34);
  parts.push(0x56, 0xff, 0x00, 0x78, 0xff, 0xd9);
  return new Uint8Array(parts);
}

export function reviewForm(fields: Partial<Record<"t" | "nickname" | "service" | "content" | "consent", string>> = {}, photos: Uint8Array[] = []): FormData {
  const form = new FormData();
  const values = { nickname: "테스트 고객", service: "가정이사", content: "테스트 후기입니다. 친절하게 잘 옮겨 주셨어요.", consent: "yes", ...fields };
  for (const [k, v] of Object.entries(values)) if (v !== undefined) form.append(k, v);
  photos.forEach((p, i) => form.append("photos", new Blob([p], { type: "image/jpeg" }), `photo${i + 1}.jpg`));
  return form;
}

export async function submitWithToken(env: Env, token: string, fields: Parameters<typeof reviewForm>[0] = {}, photos: Uint8Array[] = [], now = NOW) {
  return call(env, "/api/reviews", { form: reviewForm({ t: token, ...fields }, photos), now });
}

export async function readJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
