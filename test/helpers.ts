// 시험 도우미: miniflare(workerd) 안에서 실제 API 코드(test/worker.ts → src/router.ts)를 돌린다.
// D1·R2 는 메모리, 외부 요청(Access 공개키, Turnstile)은 miniflare 의 outboundService 로 가로챈다.
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare, Response as MfResponse } from "miniflare";
// @ts-expect-error 타입 선언 없는 .mjs 도우미
import { accessBindings, createTestAccess, TEST_ADMIN_EMAIL, TEST_AUD, TEST_TEAM_DOMAIN, TURNSTILE_VERIFY_URL } from "../scripts/test-access.mjs";
// @ts-expect-error 타입 선언 없는 .mjs 도우미
import { applyMigrations, encodeMultipart } from "../scripts/local-server.mjs";

export { TEST_ADMIN_EMAIL, TEST_AUD, TEST_TEAM_DOMAIN };

export const ORIGIN = "https://site.test";
export const NOW = Date.UTC(2026, 9, 1, 3, 0, 0);
export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;

const TABLES = ["review_photos", "review_tokens", "reviews", "open_review_log", "audit_log", "settings"];

export interface SignOptions {
  now?: number;
  kid?: string;
  wrongKey?: boolean;
  header?: Record<string, unknown>;
}

export interface TestAccess {
  jwks: { keys: Record<string, unknown>[] };
  sign(claims?: Record<string, unknown>, opts?: SignOptions): Promise<string>;
}

/** 시험에서 직접 읽고 쓰는 D1·R2 와, 요청을 보낼 miniflare */
export interface TestEnv {
  DB: D1Database;
  PHOTOS: R2Bucket;
  mf: Miniflare;
}

export interface TestContext {
  env: TestEnv;
  access: TestAccess;
  /** 워커가 보낸 외부 요청 주소 */
  outboundCalls: string[];
  /** Turnstile 확인 요청을 받을 가짜 응답. 받은 양식을 넘겨준다. */
  turnstile: { reply: (form: FormData) => Record<string, unknown> };
  /** Access 공개키 요청에 돌려줄 응답을 바꾼다. reply 가 null 을 돌려주면 정상 공개키 목록, "network" 면 연결 실패. */
  certs: { reply: () => { status: number; body: string } | "network" | null };
  dispose(): Promise<void>;
}

let workerScript: Promise<string> | null = null;
function bundleWorker(): Promise<string> {
  workerScript ??= build({ entryPoints: ["test/worker.ts"], bundle: true, format: "esm", target: "es2022", write: false, logLevel: "silent" }).then(
    (r) => r.outputFiles[0]!.text,
  );
  return workerScript;
}

/**
 * @param bindings 환경 변수. 기본은 시험용 Access 값 3개. 값을 undefined 로 주면 그 변수를 뺀다.
 */
export async function createTestEnv(bindings: Record<string, string | undefined> = {}): Promise<TestContext> {
  const access = (await createTestAccess()) as TestAccess;
  const outboundCalls: string[] = [];
  const turnstile: TestContext["turnstile"] = { reply: () => ({ success: false }) };
  const certs: TestContext["certs"] = { reply: () => null };
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...accessBindings(), ...bindings })) if (typeof v === "string") merged[k] = v;

  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "api-test",
          modules: true,
          script: await bundleWorker(),
          compatibilityDate: "2025-09-01",
          bindings: merged,
          d1Databases: { DB: "test-db" },
          r2Buckets: ["PHOTOS"],
          outboundService: async (request: Request) => {
            outboundCalls.push(request.url);
            const url = new URL(request.url);
            const json = (data: unknown) => new MfResponse(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
            if (url.pathname === "/cdn-cgi/access/certs") {
              const override = certs.reply();
              if (override === "network") throw new Error("연결 실패(시험)");
              if (override) return new MfResponse(override.body, { status: override.status, headers: { "Content-Type": "application/json" } });
              return json(access.jwks);
            }
            if (request.url === TURNSTILE_VERIFY_URL) return json(turnstile.reply(await request.formData()));
            return new MfResponse("외부 요청 차단(시험)", { status: 599 });
          },
        },
      ],
    }),
  );
  await mf.ready;
  const env: TestEnv = { DB: await mf.getD1Database("DB"), PHOTOS: (await mf.getR2Bucket("PHOTOS")) as unknown as R2Bucket, mf };
  await applyMigrations(env.DB);
  return {
    env,
    access,
    outboundCalls,
    turnstile,
    certs,
    async dispose() {
      await mf.dispose();
    },
  };
}

export async function resetData(env: TestEnv): Promise<void> {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const listed = await env.PHOTOS.list();
  if (listed.objects.length > 0) await env.PHOTOS.delete(listed.objects.map((o) => o.key));
}

export interface CallOptions {
  method?: string;
  /** Cf-Access-Jwt-Assertion 헤더 값(관리자 JWT) */
  jwt?: string;
  /** null 이면 Origin 헤더를 보내지 않는다. 기본은 이 사이트 주소. */
  origin?: string | null;
  ip?: string;
  json?: unknown;
  form?: FormData;
  body?: ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
  now?: number;
}

export async function call(env: TestEnv, path: string, opts: CallOptions = {}): Promise<Response> {
  const method = opts.method ?? (opts.json !== undefined || opts.form || opts.body ? "POST" : "GET");
  const headers = new Headers({ "CF-Connecting-IP": opts.ip ?? "203.0.113.10", "X-Test-Now": String(opts.now ?? NOW), ...opts.headers });
  if (opts.origin !== null && method !== "GET") headers.set("Origin", opts.origin ?? ORIGIN);
  if (opts.jwt) headers.set("Cf-Access-Jwt-Assertion", opts.jwt);
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    // Node 의 FormData 를 miniflare 쪽으로 그대로 넘기면 글자로 바뀌므로, 먼저 multipart 바이트로 만든다.
    const encoded = (await encodeMultipart(opts.form)) as { contentType: string; bytes: Uint8Array<ArrayBuffer> };
    headers.set("Content-Type", encoded.contentType);
    body = encoded.bytes;
  } else if (opts.body) {
    body = opts.body;
  }
  const init = { method, headers, body, ...(opts.body ? { duplex: "half" } : {}) };
  return (await env.mf.dispatchFetch(ORIGIN + path, init as never)) as unknown as Response;
}

export async function createToken(env: TestEnv, jwt: string, now = NOW): Promise<string> {
  const res = await call(env, "/api/admin/review-links", { method: "POST", jwt, now });
  const data = (await res.json()) as { url: string };
  return new URL(data.url).searchParams.get("t")!;
}

/** 가짜 JPEG(검사용 구조만 갖춘 바이트). exif=true 면 APP1(Exif) 구간을, segment 를 주면 그 마커의 구간을 APP0 뒤에 넣는다. */
export function fakeJpeg(options: { exif?: boolean; size?: number; segment?: { marker: number; payload: number[] } } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  // APP0 JFIF
  parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
  if (options.segment) {
    const len = options.segment.payload.length + 2;
    parts.push(0xff, options.segment.marker, len >> 8, len & 0xff, ...options.segment.payload);
  }
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

export async function submitWithToken(env: TestEnv, token: string, fields: Parameters<typeof reviewForm>[0] = {}, photos: Uint8Array[] = [], now = NOW) {
  return call(env, "/api/reviews", { form: reviewForm({ t: token, ...fields }, photos), now });
}

export async function readJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
