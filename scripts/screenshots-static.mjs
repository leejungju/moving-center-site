// 하위 경로(GitHub Pages 흉내, 서버 API 없음)의 실제 화면과 미리보기 화면을 docs/screens/ 에 캡처한다.
//   npm run screenshots:static
// 외부 주소(글꼴 등)는 막고 로컬 정적 서버만 연다. 미리보기 자료는 브라우저 안의 가짜 자료다.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "./static-server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs/screens");
mkdirSync(out, { recursive: true });

const server = await startStaticServer({ root, prefix: "/moving-center-site" });
const browser = await chromium.launch();

/** @param {number} width */
async function newPage(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: width === 360 ? 2 : 1 });
  await context.route("**/*", (route) => (new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort()));
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  return page;
}

/** 지연 로딩 그림을 모두 불러온다. */
async function loadImages(page) {
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll("img")];
    imgs.forEach((img) => (img.loading = "eager"));
    await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => img.addEventListener("load", r, { once: true })))));
  });
}

try {
  // 하위 경로 실제 공개 페이지의 견적 영역 (API 없음 → 전화만)
  for (const width of [1440, 360]) {
    const page = await newPage(width);
    await page.goto(server.url + "/", { waitUntil: "load" });
    // API 가 없으므로 설정·후기 요청이 실패해 카카오·문자·후기는 숨김 그대로다. 실패 처리가 끝날 때까지 잠깐 기다린다.
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.querySelectorAll(".site-header, .floating-call").forEach((n) => (n.style.visibility = "hidden"));
    });
    await page.locator("#quote").screenshot({ path: join(out, `gh-public-quote-${width}.png`) });
    await page.context().close();
  }

  // 하위 경로 실제 관리자 화면 (이 주소에서는 사용할 수 없습니다)
  const admin = await newPage(360);
  await admin.goto(server.url + "/admin/", { waitUntil: "load" });
  await admin.waitForSelector("#unavailable-view:not([hidden])");
  await admin.screenshot({ path: join(out, "gh-admin-360.png"), fullPage: true });
  await admin.context().close();

  // 미리보기 공개 페이지 후기 영역 (고정 띠가 보이도록 후기 영역까지 내린 화면)
  const preview = await newPage(360);
  await preview.goto(server.url + "/preview/", { waitUntil: "load" });
  await preview.waitForSelector("#reviews:not([hidden]) .review-card");
  await loadImages(preview);
  // 맨 위 고정 띠 바로 아래에 후기 영역이 오도록 내린 뒤, 띠 + 후기 영역 높이로 캡처한다.
  const size = await preview.evaluate(() => {
    document.querySelectorAll(".site-header, .floating-call").forEach((n) => (n.style.visibility = "hidden"));
    const bar = document.getElementById("preview-bar");
    const reviews = document.getElementById("reviews");
    return { bar: bar.offsetHeight, top: reviews.offsetTop, height: reviews.offsetHeight };
  });
  await preview.setViewportSize({ width: 360, height: size.bar + size.height });
  await preview.evaluate((y) => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, y);
  }, size.top - size.bar);
  await preview.screenshot({ path: join(out, "preview-public-reviews-360.png") });
  await preview.context().close();

  // 미리보기 관리자 후기 관리 (승인 대기)
  const previewAdmin = await newPage(360);
  await previewAdmin.goto(server.url + "/preview/admin/", { waitUntil: "load" });
  await previewAdmin.waitForSelector("#view-reviews:not([hidden]) .review-item");
  await loadImages(previewAdmin);
  await previewAdmin.screenshot({ path: join(out, "preview-admin-reviews-360.png"), fullPage: true });
  await previewAdmin.context().close();

  console.log("screenshots saved to docs/screens/ (gh-*, preview-*)");
} finally {
  await browser.close();
  await server.stop();
}
