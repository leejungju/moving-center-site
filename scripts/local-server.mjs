// 시험·캡처용 로컬 서버: 빈 저장소에 마이그레이션을 적용하고 wrangler pages dev 를 띄운다.
// 원격(Cloudflare 계정) 작업은 하지 않는다.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" };

/**
 * @param {{ port: number, bindings: Record<string, string> }} options
 */
export async function startLocalServer({ port, bindings }) {
  const persist = mkdtempSync(join(tmpdir(), "moving-center-local-"));
  const migrate = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", persist], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  if (migrate.status !== 0) throw new Error("migration failed\n" + migrate.stdout + migrate.stderr);

  const args = [wrangler, "pages", "dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", persist];
  for (const [k, v] of Object.entries(bindings)) args.push("--binding", `${k}=${v}`);
  const child = spawn(process.execPath, args, { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error("wrangler exited\n" + log);
    try {
      const res = await fetch(url + "/api/settings");
      if (res.ok) break;
    } catch {
      // 아직 시작 중
    }
    if (Date.now() > deadline) throw new Error("wrangler did not start\n" + log);
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    url,
    persist,
    log: () => log,
    async stop() {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // 이미 종료됨
      }
      await new Promise((r) => setTimeout(r, 500));
      rmSync(persist, { recursive: true, force: true });
    },
  };
}

/** 쿠키를 들고 다니는 아주 작은 API 클라이언트 */
export function apiClient(baseUrl) {
  let cookie = "";
  async function call(method, path, body) {
    const headers = { Origin: baseUrl, Accept: "application/json" };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + path, { method, headers, body: payload });
    const setCookie = res.headers.get("Set-Cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return { call, cookie: () => cookie };
}
