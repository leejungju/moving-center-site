// 정적 파일을 dist/ 로 모은다(Cloudflare Pages 의 출력 폴더).
// functions/ 는 wrangler 가 따로 묶으므로 여기서는 묶을 수 있는지만 확인한다.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
// 미리보기(preview/)는 GitHub Pages 에서만 쓰는 화면이라 배포 산출물에 넣지 않는다.
const files = ["index.html", "style.css", "app.css", "_headers", "js", "admin", "review"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const f of files) cpSync(join(root, f), join(dist, f), { recursive: true });

// 인라인 스크립트가 없는지 확인한다(CSP 에서 막힌다).
for (const page of ["index.html", "admin/index.html", "review/write.html"]) {
  const html = readFileSync(join(dist, page), "utf8");
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\son[a-z]+\s*=/i.test(html)) {
    console.error(`인라인 스크립트가 있습니다: ${page}`);
    process.exit(1);
  }
}

if (existsSync(join(dist, "preview"))) {
  console.error("dist/ 에 미리보기(preview/)가 들어 있습니다.");
  process.exit(1);
}

execFileSync(
  process.execPath,
  [join(root, "node_modules/wrangler/bin/wrangler.js"), "pages", "functions", "build", "functions", "--outdir", join(root, ".wrangler/functions-build")],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
console.log("build ok: dist/ (정적 파일), functions/ 묶기 확인");
