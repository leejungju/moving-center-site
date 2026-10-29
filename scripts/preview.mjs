// 미리보기 화면(preview/)을 실제 화면 HTML(index.html, admin/index.html, review/write.html)에서 만든다.
//   npm run preview          만들기
//   npm run preview -- --check   지금 파일이 실제 HTML 과 맞는지 확인만(다르면 종료 코드 1)
// 실제 HTML 은 그대로 두고, 미리보기 쪽에만 noindex·고정 띠·가짜 API 스크립트를 넣는다.
// 서버 값(문구 기본값, 사진 상한, 링크 기간)은 src/ 에서 읽어 preview/server-values.js 로 쓴다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const BAR_TEXT = "<strong>미리보기 화면입니다.</strong> 실제 고객 후기·연락처가 아니며, 입력한 내용은 이 브라우저에만 저장됩니다.";

/** 화면별 설정. up 은 preview/ 폴더까지 거슬러 올라가는 상대 주소, assets 는 [실제 화면의 주소, 미리보기의 주소] */
const PAGES = [
  {
    kind: "public",
    src: "index.html",
    out: "preview/index.html",
    up: "",
    assets: [
      ['href="style.css"', 'href="../style.css"'],
      ['src="js/site.js"', 'src="../js/site.js"'],
    ],
    stylesheet: '<link rel="stylesheet" href="../style.css">',
    script: '<script src="../js/site.js" defer></script>',
    extra: "",
  },
  {
    kind: "admin",
    src: "admin/index.html",
    out: "preview/admin/index.html",
    up: "../",
    assets: [
      ['href="../app.css"', 'href="../../app.css"'],
      ['src="../js/admin.js"', 'src="../../js/admin.js"'],
    ],
    stylesheet: '<link rel="stylesheet" href="../../app.css">',
    script: '<script src="../../js/admin.js" defer></script>',
    extra: "<p>미리보기 관리자 화면은 로그인 없이 열립니다. 실제로는 관리자 이메일로 받은 6자리 숫자로 로그인합니다.</p>",
  },
  {
    kind: "review",
    src: "review/write.html",
    out: "preview/review/write.html",
    up: "../",
    assets: [
      ['href="../app.css"', 'href="../../app.css"'],
      ['src="../js/review-write.js"', 'src="../../js/review-write.js"'],
    ],
    stylesheet: '<link rel="stylesheet" href="../../app.css">',
    script: '<script src="../../js/review-write.js" defer></script>',
    extra: "<p>후기 작성 화면은 미리보기 관리자 화면의 「후기 요청 링크」에서 만든 링크로 열어 보세요.</p>",
  },
];

/**
 * text 안에 from 이 정확히 한 번 있어야 바꾼다(실제 HTML 이 바뀌어 맞지 않으면 멈춘다).
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @param {string} where
 */
function replaceOnce(text, from, to, where) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${where}: "${from}" 가 ${count}번 있습니다(1번이어야 함)`);
  return text.replace(from, () => to);
}

function bar(page) {
  const links = [
    ["public", "공개 페이지", `${page.up}index.html`],
    ["admin", "관리자 화면", `${page.up}admin/`],
    ["review", "후기 작성 화면", `${page.up}review/write.html`],
  ]
    .map(([kind, label, href]) => `      <a href="${href}"${kind === page.kind ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("\n");
  return [
    '  <section id="preview-bar" class="preview-bar" aria-label="미리보기 안내">',
    `    <p>${BAR_TEXT}</p>`,
    page.extra ? `    ${page.extra}` : "",
    '    <p id="preview-storage-warn" class="preview-bar-warn" hidden>이 브라우저에 저장할 수 없어, 새로고침하거나 다른 화면으로 옮기면 입력한 내용이 사라집니다.</p>',
    '    <nav class="preview-bar-nav" aria-label="미리보기 화면 이동">',
    links,
    '      <button id="preview-reset" type="button" class="preview-reset">미리보기 초기화</button>',
    "    </nav>",
    "  </section>",
  ]
    .filter(Boolean)
    .join("\n");
}

function previewHtml(page) {
  const where = page.src;
  let html = readFileSync(join(root, page.src), "utf8");
  html = replaceOnce(
    html,
    "<!DOCTYPE html>\n",
    `<!DOCTYPE html>\n<!-- 미리보기 화면입니다. scripts/preview.mjs 가 ${page.src} 에서 만듭니다. 직접 고치지 말고 npm run preview 를 실행하세요. -->\n`,
    where,
  );
  html = replaceOnce(html, '<html lang="ko">', `<html lang="ko" data-preview="1" data-preview-page="${page.kind}">`, where);
  html = replaceOnce(html, "<title>", "<title>[미리보기] ", where);
  if (!html.includes('<meta name="robots" content="noindex, nofollow">')) {
    html = replaceOnce(
      html,
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n',
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="robots" content="noindex, nofollow">\n',
      where,
    );
  }
  for (const [from, to] of page.assets) html = replaceOnce(html, from, to, where);
  html = replaceOnce(html, page.stylesheet, `${page.stylesheet}\n  <link rel="stylesheet" href="${page.up}preview.css">`, where);
  html = replaceOnce(
    html,
    page.script,
    `<script src="${page.up}server-values.js" defer></script>\n  <script src="${page.up}preview.js" defer></script>\n  ${page.script}`,
    where,
  );
  html = replaceOnce(html, "<body>\n", `<body>\n${bar(page)}\n`, where);
  return html;
}

async function serverValues() {
  const bundled = await build({
    stdin: {
      contents: [
        'export { TEXT_FIELDS } from "./src/settings";',
        'export { MAX_PHOTOS, MAX_PHOTO_BYTES, MAX_PHOTO_LABEL, MAX_BODY_BYTES } from "./src/limits";',
        'export { SERVICES, TOKEN_TTL_MS } from "./src/reviews";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    logLevel: "silent",
  });
  const mod = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
  const values = {
    textFields: mod.TEXT_FIELDS.map((f) => ({ key: f.key, label: f.label, max: f.max, default: f.default })),
    maxPhotos: mod.MAX_PHOTOS,
    maxPhotoBytes: mod.MAX_PHOTO_BYTES,
    maxPhotoLabel: mod.MAX_PHOTO_LABEL,
    maxBodyBytes: mod.MAX_BODY_BYTES,
    tokenTtlMs: mod.TOKEN_TTL_MS,
    services: [...mod.SERVICES],
  };
  return [
    "// 미리보기 가짜 API 가 쓰는 서버 값. scripts/preview.mjs 가 src/ 에서 뽑아 만듭니다. 직접 고치지 마세요.",
    '"use strict";',
    `/** @type {any} */ (window).movingCenterPreviewValues = ${JSON.stringify(values, null, 2)};`,
    "",
  ].join("\n");
}

const outputs = PAGES.map((page) => [page.out, previewHtml(page)]);
outputs.push(["preview/server-values.js", await serverValues()]);

let stale = 0;
for (const [file, content] of outputs) {
  const path = join(root, file);
  let current = null;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = null;
  }
  if (current === content) continue;
  if (check) {
    console.error(`미리보기 파일이 실제 화면과 맞지 않습니다: ${file} (npm run preview 로 다시 만드세요)`);
    stale++;
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`만듦: ${file}`);
}
if (stale > 0) process.exit(1);
console.log(check ? "preview ok: 미리보기 파일이 최신입니다." : "preview ok");
