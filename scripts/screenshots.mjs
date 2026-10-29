// 로컬 서버를 띄우고 가짜 시험 데이터("테스트 고객")를 넣은 뒤 화면을 docs/screens/ 에 캡처한다.
//   npm run screenshots
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { apiClient, startLocalServer } from "./local-server.mjs";
import { hashPassword } from "./hash-password.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs/screens");
mkdirSync(out, { recursive: true });

const PASSWORD = "test-password-screens";
const server = await startLocalServer({
  port: 8791,
  bindings: { ADMIN_ID: "test-admin", ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD), TURNSTILE_SECRET_KEY: "" },
});
const browser = await chromium.launch();

try {
  const admin = apiClient(server.url);
  if ((await admin.call("POST", "/api/admin/login", { id: "test-admin", password: PASSWORD })).status !== 200) throw new Error("login");
  await admin.call("PUT", "/api/admin/settings/contact", { kakaoChannelId: "_test", smsNumber: "010-0000-0000" });

  // 시험용 그림(PNG)을 브라우저에서 만든다. 실제 사진이 아니다.
  const drawPage = await browser.newPage();
  await drawPage.goto(server.url + "/review/write");
  async function testPicture(label, hue) {
    const data = await drawPage.evaluate(
      async ([text, h]) => {
        const c = document.createElement("canvas");
        c.width = 1200;
        c.height = 900;
        const g = c.getContext("2d");
        g.fillStyle = `hsl(${h}, 55%, 82%)`;
        g.fillRect(0, 0, 1200, 900);
        g.fillStyle = `hsl(${h}, 45%, 55%)`;
        for (let i = 0; i < 6; i++) g.fillRect(120 + i * 160, 420 - (i % 3) * 90, 140, 280 + (i % 3) * 90);
        g.fillStyle = "#ffffff";
        g.fillRect(0, 700, 1200, 200);
        g.fillStyle = "#1d2433";
        g.font = "bold 72px sans-serif";
        g.textAlign = "center";
        g.fillText(text, 600, 830);
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      },
      [label, hue],
    );
    return Buffer.from(data);
  }

  const reviews = [
    { nickname: "테스트 고객1", service: "가정이사", content: "시험용 후기입니다. 포장부터 정리까지 꼼꼼하게 해 주셔서 좋았습니다.\n다음에도 이용하고 싶어요.", pictures: [["테스트 사진 1", 210], ["테스트 사진 2", 30]], publish: true, reply: "시험용 답변입니다. 이용해 주셔서 감사합니다." },
    { nickname: "테스트 고객2", service: "원룸이사", content: "시험용 후기입니다. 약속한 시간에 맞춰 오셔서 빠르게 끝났습니다.", pictures: [["테스트 사진 3", 140]], publish: true },
    { nickname: "테스트 고객3", service: "사무실이사", content: "시험용 후기입니다. 사무실 컴퓨터와 서류를 안전하게 옮겨 주셨습니다.", pictures: [], publish: true },
    { nickname: "테스트 고객4", service: "보관이사", content: "시험용 후기입니다. 승인 대기 화면 캡처용으로 남겨 둔 글입니다.", pictures: [["테스트 사진 4", 280], ["테스트 사진 5", 90]], publish: false },
    { nickname: "테스트 고객5", service: "가정이사", content: "시험용 후기입니다. 승인 대기 상태의 두 번째 글입니다.", pictures: [], publish: false },
  ];

  const writePage = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
  for (const [index, r] of reviews.entries()) {
    const link = (await admin.call("POST", "/api/admin/review-links")).data.url;
    await writePage.goto(link);
    await writePage.waitForSelector("#review-form:not([hidden])");
    await writePage.fill("#nickname", r.nickname);
    await writePage.check(`input[name=service][value=${r.service}]`, { force: true });
    await writePage.fill("#content", r.content);
    if (r.pictures.length > 0) {
      const files = [];
      for (const [label, hue] of r.pictures) files.push({ name: `${label}.png`, mimeType: "image/png", buffer: await testPicture(label, hue) });
      await writePage.setInputFiles("#photo-input", files);
      await writePage.waitForFunction((n) => document.querySelectorAll("#photo-previews img").length === n, r.pictures.length);
    }
    await writePage.check("#consent");
    if (index === 3) await writePage.screenshot({ path: join(out, "review-write-360.png"), fullPage: true });
    await writePage.click("#submit-button");
    await writePage.waitForSelector("#status.notice-ok");
  }
  await writePage.close();

  const pending = (await admin.call("GET", "/api/admin/reviews?status=pending")).data.reviews;
  for (const r of reviews.filter((x) => x.publish)) {
    const row = pending.find((p) => p.nickname === r.nickname);
    await admin.call("POST", `/api/admin/reviews/${row.id}/publish`);
    if (r.reply) await admin.call("PUT", `/api/admin/reviews/${row.id}/reply`, { reply: r.reply });
  }

  // 공개 페이지
  for (const width of [360, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: width === 360 ? 2 : 1 });
    await page.goto(server.url + "/", { waitUntil: "load" });
    await page.waitForSelector("#reviews:not([hidden]) .review-card");
    // 지연 로딩 사진을 모두 불러온 뒤 캡처한다.
    await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll("img")];
      imgs.forEach((img) => (img.loading = "eager"));
      await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => img.addEventListener("load", r, { once: true })))));
      await document.fonts.ready;
    });
    await page.screenshot({ path: join(out, `public-${width}.png`), fullPage: true });
    // 부분 캡처에서는 고정 헤더·전화 버튼을 가린다(캡처할 때만, 페이지 파일은 바뀌지 않음).
    await page.evaluate(() => {
      document.querySelectorAll(".site-header, .floating-call").forEach((n) => (n.style.visibility = "hidden"));
    });
    await page.locator("#reviews").screenshot({ path: join(out, `public-reviews-${width}.png`) });
    await page.locator("#quote").screenshot({ path: join(out, `public-quote-${width}.png`) });
    await page.close();
  }

  // 관리자 화면 (휴대폰 360px, 후기 관리는 1440px 도)
  const mobile = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
  await mobile.goto(server.url + "/admin/", { waitUntil: "load" });
  await mobile.waitForSelector("#login-view:not([hidden])");
  await mobile.fill("#login-id", "test-admin");
  await mobile.screenshot({ path: join(out, "admin-login-360.png"), fullPage: true });
  await mobile.fill("#login-password", PASSWORD);
  await mobile.click("#login-button");
  await mobile.waitForSelector("#view-reviews:not([hidden]) .review-item");
  await mobile.screenshot({ path: join(out, "admin-reviews-pending-360.png"), fullPage: true });
  await mobile.click("[data-view=contact]");
  await mobile.waitForFunction(() => document.querySelector("#sms-number").value !== "");
  await mobile.screenshot({ path: join(out, "admin-contact-360.png"), fullPage: true });
  await mobile.click("[data-view=links]");
  await mobile.click("#make-link");
  await mobile.waitForSelector("#link-output:not([hidden])");
  await mobile.screenshot({ path: join(out, "admin-links-360.png"), fullPage: true });
  await mobile.click("[data-view=audit]");
  await mobile.waitForSelector("#audit-list li");
  await mobile.screenshot({ path: join(out, "admin-audit-360.png"), fullPage: true });

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.context().addCookies(await mobile.context().cookies());
  await desktop.goto(server.url + "/admin/", { waitUntil: "load" });
  await desktop.waitForSelector("#view-reviews:not([hidden]) .review-item");
  await desktop.screenshot({ path: join(out, "admin-reviews-pending-1440.png"), fullPage: true });

  console.log("screenshots saved to docs/screens/");
} finally {
  await browser.close();
  await server.stop();
}
