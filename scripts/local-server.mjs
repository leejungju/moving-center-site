// 시험·캡처용 로컬 서버.
// miniflare 로 실제 Pages Functions 묶음(wrangler pages functions build 결과)과
// 정적 파일 서버(_headers 적용)를 띄운다. 워커의 외부 요청은 outboundService 로 가로채
// 가짜 Access 공개키(scripts/test-access.mjs)만 돌려준다. 원격(Cloudflare 계정) 작업과 외부 접속은 하지 않는다.
//
// 먼저 npm run build 로 dist/ 와 .wrangler/functions-build/ 를 만들어야 한다.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare, Response as MfResponse } from "miniflare";
import { unstable_generateASSETSBinding } from "wrangler";
import { accessBindings, createTestAccess } from "./test-access.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** migrations/*.sql 을 순서대로 적용한다. */
export async function applyMigrations(db) {
  const dir = join(root, "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
}

/** 워커의 외부 요청 가로채기: Access 공개키 주소만 답하고 나머지는 막는다. */
export function outboundHandler(jwks, extra = async () => null) {
  const calls = [];
  async function handler(request) {
    calls.push(request.url);
    const url = new URL(request.url);
    const custom = await extra(request);
    if (custom) return custom;
    if (url.pathname === "/cdn-cgi/access/certs") {
      return new MfResponse(JSON.stringify(jwks), { headers: { "Content-Type": "application/json" } });
    }
    return new MfResponse("외부 요청 차단(시험)", { status: 599 });
  }
  return { handler, calls };
}

/**
 * @param {{ bindings?: Record<string, string> }} [options]
 */
export async function startLocalServer(options = {}) {
  const access = await createTestAccess();
  const outbound = outboundHandler(access.jwks);
  const abort = new AbortController();
  const assets = await unstable_generateASSETSBinding({ log: new Log(LogLevel.WARN), directory: join(root, "dist"), signal: abort.signal });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "moving-center-site",
          modules: true,
          scriptPath: join(root, ".wrangler/functions-build/index.js"),
          compatibilityDate: "2025-09-01",
          bindings: { ...accessBindings(), ...(options.bindings ?? {}) },
          serviceBindings: { ASSETS: assets },
          d1Databases: { DB: "local-db" },
          r2Buckets: ["PHOTOS"],
          outboundService: outbound.handler,
        },
      ],
      host: "127.0.0.1",
    }),
  );
  const url = String(await mf.ready).replace(/\/$/, "");
  await applyMigrations(await mf.getD1Database("DB"));

  return {
    url,
    access,
    outbound,
    log: () => "",
    async stop() {
      abort.abort();
      await mf.dispose();
    },
  };
}

/**
 * FormData 를 multipart/form-data 바이트로 만든다.
 * (wrangler 의 정적 파일 바인딩을 만든 뒤에는 전역 Request/FormData 가 바뀌어
 *  fetch 가 FormData 를 "[object FormData]" 글자로 보내므로 직접 만든다.)
 * @param {FormData} form
 */
export async function encodeMultipart(form) {
  const boundary = "----test-boundary-" + crypto.randomUUID();
  const enc = new TextEncoder();
  const parts = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    } else {
      const filename = value.name || "blob";
      const type = value.type || "application/octet-stream";
      parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`));
      parts.push(new Uint8Array(await value.arrayBuffer()));
      parts.push(enc.encode("\r\n"));
    }
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  return { contentType: `multipart/form-data; boundary=${boundary}`, bytes };
}

/**
 * 관리자 API 클라이언트. Access 가 붙여 주는 것처럼 매 요청에 시험용 JWT 헤더를 붙인다.
 * @param {string} baseUrl
 * @param {() => Promise<string>} token
 */
export function apiClient(baseUrl, token) {
  async function call(method, path, body) {
    const headers = { Origin: baseUrl, Accept: "application/json", "Cf-Access-Jwt-Assertion": await token() };
    let payload;
    if (body instanceof FormData) {
      const encoded = await encodeMultipart(body);
      headers["Content-Type"] = encoded.contentType;
      payload = encoded.bytes;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + path, { method, headers, body: payload });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return { call };
}

/**
 * 브라우저에서 이 서버로 가는 요청에만 시험용 JWT 헤더를 붙인다(Access 가장자리가 하는 일을 흉내 낸다).
 * @param {import("playwright").BrowserContext | import("playwright").Page} target
 * @param {string} baseUrl
 * @param {() => Promise<string>} token
 */
export async function attachAccessHeader(target, baseUrl, token) {
  await target.route(baseUrl + "/**", async (route) => {
    const headers = { ...route.request().headers(), "cf-access-jwt-assertion": await token() };
    await route.continue({ headers });
  });
}
