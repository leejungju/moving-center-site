// 시험·캡처용 정적 파일 서버. 서버 API 가 없고 _headers 도 적용하지 않는 GitHub Pages 를 흉내 낸다.
//   - prefix "/moving-center-site" 면 https://leejungju.github.io/moving-center-site/ 같은 하위 경로,
//     prefix "" 면 맨 앞 경로(Cloudflare Pages 처럼 dist/ 를 그대로)로 연다.
//   - 폴더 주소는 index.html, 확장자 없는 주소는 .html 을 찾는다(GitHub Pages 와 같음).
//   - 없는 파일과 /api/... 는 HTML 404 화면으로 답한다.
// 외부 접속은 하지 않는다(127.0.0.1 에서만 연다).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

/**
 * @param {{ root: string, prefix?: string }} options
 * @returns {Promise<{ url: string, origin: string, requests: { path: string, status: number }[], stop(): Promise<void> }>}
 */
export async function startStaticServer({ root, prefix = "" }) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const send = (status, type, body, headers = {}) => {
      requests.push({ path, status });
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
      res.end(body);
    };
    const notFound = () => send(404, "text/html; charset=utf-8", "<!DOCTYPE html><title>404</title><h1>404</h1>");
    if (prefix && path === prefix) return send(301, "text/plain", "", { Location: prefix + "/" });
    if (!path.startsWith(prefix + "/")) return notFound();
    const rel = normalize(path.slice(prefix.length));
    if (rel.split(sep).includes("..")) return notFound();
    let file = join(root, rel);
    try {
      const info = await stat(file);
      if (info.isDirectory()) {
        if (!path.endsWith("/")) return send(301, "text/plain", "", { Location: path + "/" });
        file = join(file, "index.html");
      }
    } catch {
      if (!extname(file)) file += ".html";
    }
    try {
      const body = await readFile(file);
      send(200, TYPES[extname(file)] ?? "application/octet-stream", body);
    } catch {
      notFound();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return {
    origin,
    url: origin + prefix,
    requests,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
