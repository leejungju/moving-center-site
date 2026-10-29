// 로컬 서버(miniflare: 실제 Pages Functions 묶음 + 정적 파일 + 가짜 Access)와 헤드리스 브라우저로 확인하는 시험
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { checkJpeg } from "../src/jpeg";
// @ts-expect-error 타입 선언 없는 .mjs 도우미
import { apiClient, attachAccessHeader, startLocalServer } from "../scripts/local-server.mjs";

interface LocalServer {
  url: string;
  access: { sign(claims?: Record<string, unknown>): Promise<string> };
  stop(): Promise<void>;
}
interface Client {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 시험에서 JSON 응답을 그대로 다룬다
  call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }>;
}

let server: LocalServer;
let browser: Browser;
let admin: Client;

/** JPEG 의 SOF 구간에서 가로·세로 크기를 읽는다. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    i += 2 + len;
  }
  return null;
}

async function newReviewLink(): Promise<string> {
  const res = await admin.call("POST", "/api/admin/review-links");
  expect(res.status).toBe(201);
  return res.data.url as string;
}

const adminToken = () => server.access.sign();

/** Access 를 거친 것처럼 JWT 헤더를 붙인 관리자 화면 */
async function adminPage(): Promise<Page> {
  const page = await browser.newPage();
  await attachAccessHeader(page, server.url, adminToken);
  return page;
}

beforeAll(async () => {
  server = await startLocalServer();
  browser = await chromium.launch();
  admin = apiClient(server.url, adminToken);
  const res = await admin.call("GET", "/api/admin/me");
  expect(res.status).toBe(200);
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
});

describe("브라우저 시험", () => {
  it("후기 내용의 <script> 문자열이 실행되지 않고 글자로 보인다", async () => {
    const link = await newReviewLink();
    const token = new URL(link).searchParams.get("t")!;
    const payload = '<script>window.__xss = 1; alert("xss")</script><img src=x onerror="window.__xss = 2"> 테스트 후기';
    const form = new FormData();
    form.append("t", token);
    form.append("nickname", "<b>테스트</b>");
    form.append("service", "원룸이사");
    form.append("content", payload);
    form.append("consent", "yes");
    expect((await admin.call("POST", "/api/reviews", form)).status).toBe(201);
    const pending = await admin.call("GET", "/api/admin/reviews?status=pending");
    const id = pending.data.reviews.find((r: { content: string }) => r.content === payload).id;
    expect((await admin.call("POST", `/api/admin/reviews/${id}/publish`)).status).toBe(200);
    await admin.call("PUT", `/api/admin/reviews/${id}/reply`, { reply: "<script>window.__xss = 3</script> 테스트 답변" });

    const page = await browser.newPage();
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await page.goto(server.url + "/");
    await page.waitForSelector("#reviews:not([hidden]) .review-card");
    const card = page.locator(".review-card", { hasText: "테스트 후기" });
    expect(await card.locator(".review-content").textContent()).toBe(payload);
    expect(await card.locator(".review-name").textContent()).toBe("<b>테스트</b>");
    expect(await card.locator(".review-reply p").textContent()).toBe("<script>window.__xss = 3</script> 테스트 답변");
    expect(await page.locator("#review-list script, #review-list b, #review-list img[src='x']").count()).toBe(0);
    await page.waitForTimeout(300);
    expect(await page.evaluate("window.__xss")).toBeUndefined();
    expect(dialogs).toEqual([]);

    // 관리자 화면에서도 글자로만 보인다
    await attachAccessHeader(page, server.url, adminToken);
    await page.goto(server.url + "/admin/");
    await page.waitForSelector("#app-view:not([hidden])");
    await page.getByRole("tab", { name: /공개 중/ }).click();
    await page.waitForSelector(".review-item");
    expect(await page.locator(".review-item .review-text").first().textContent()).toBe(payload);
    expect(await page.locator(".review-item script, .review-item img[src='x']").count()).toBe(0);
    expect(await page.evaluate("window.__xss")).toBeUndefined();
    expect(dialogs).toEqual([]);
    await page.close();
  });

  it("후기 작성 화면은 사진을 1600px 이하 JPEG 로 다시 그려 EXIF 없이 올린다", async () => {
    const link = await newReviewLink();
    const page = await browser.newPage();
    await page.goto(server.url + "/");
    // 2400x1800 실제 JPEG 를 만들고 가짜 EXIF(APP1)를 끼워 넣는다
    const jpeg = (await page.evaluate(`(async () => {
      const c = document.createElement("canvas");
      c.width = 2400;
      c.height = 1800;
      const g = c.getContext("2d");
      g.fillStyle = "#4a90d9";
      g.fillRect(0, 0, 2400, 1800);
      g.fillStyle = "#ffffff";
      g.fillRect(600, 450, 1200, 900);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    })()`)) as number[];
    const exif = [0xff, 0xe1, 0x00, 0x16, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    const withExif = Buffer.from([...jpeg.slice(0, 2), ...exif, ...jpeg.slice(2)]);
    expect(checkJpeg(new Uint8Array(withExif))).toBe("has_metadata");

    await page.goto(link);
    await page.waitForSelector("#review-form:not([hidden])");
    await page.fill("#nickname", "테스트 고객");
    await page.check("input[name=service][value=보관이사]", { force: true });
    await page.fill("#content", "브라우저 사진 시험용 테스트 후기입니다.");
    await page.setInputFiles("#photo-input", { name: "test.jpg", mimeType: "image/jpeg", buffer: withExif });
    await page.waitForSelector("#photo-previews img");
    await page.check("#consent");
    await page.click("#submit-button");
    await page.waitForSelector("#status.notice-ok");
    expect(await page.textContent("#status")).toContain("접수");
    await page.close();

    const pending = await admin.call("GET", "/api/admin/reviews?status=pending");
    const review = pending.data.reviews.find((r: { content: string }) => r.content.startsWith("브라우저 사진 시험용"));
    expect(review.status).toBe("pending");
    expect(review.photos).toHaveLength(1);
    const photo = await fetch(server.url + review.photos[0].url, { headers: { "Cf-Access-Jwt-Assertion": await adminToken() } });
    const bytes = new Uint8Array(await photo.arrayBuffer());
    expect(checkJpeg(bytes)).toBe("ok");
    expect(jpegSize(bytes)).toEqual({ width: 1600, height: 1200 });
  });

  it("만료·사용된 링크는 안내 문구만 보여 준다", async () => {
    const page = await browser.newPage();
    await page.goto(server.url + "/review/write?t=" + "A".repeat(43));
    await page.waitForSelector("#status.notice-error");
    expect(await page.isHidden("#review-form")).toBe(true);
    await page.goto(server.url + "/review/write");
    await page.waitForSelector("#status.notice-error");
    expect(await page.textContent("#status")).toContain("링크로만");
    await page.close();
  });

  it("API 를 불러오지 못하면 후기·문자 양식·카카오 버튼을 숨기고 HTML 문구를 그대로 보여 준다", async () => {
    await admin.call("PUT", "/api/admin/settings/contact", { kakaoChannelId: "_test", smsNumber: "010-0000-0000" });
    await admin.call("PUT", "/api/admin/settings/texts", { texts: { hero_badge: "테스트 제목 문구" } });

    const online = await browser.newPage();
    await online.goto(server.url + "/");
    await online.waitForSelector("#sms-form:not([hidden])");
    expect(await online.textContent("[data-setting=hero_badge]")).toBe("테스트 제목 문구");
    expect(await online.getAttribute("#kakao-chat", "href")).toBe("https://pf.kakao.com/_test/chat");
    await online.close();

    const offline = await browser.newPage();
    await offline.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" }));
    await offline.goto(server.url + "/");
    await offline.waitForLoadState("networkidle");
    expect(await offline.isHidden("#reviews")).toBe(true);
    expect(await offline.isHidden("#sms-form")).toBe(true);
    expect(await offline.isHidden("#kakao-chat")).toBe(true);
    expect(await offline.textContent("[data-setting=hero_badge]")).toBe("전국 포장이사 · 무료 방문 견적");
    await offline.close();

    await admin.call("PUT", "/api/admin/settings/contact", { kakaoChannelId: "", smsNumber: "" });
    const cleared = await browser.newPage();
    await cleared.goto(server.url + "/");
    await cleared.waitForLoadState("networkidle");
    expect(await cleared.isHidden("#sms-form")).toBe(true);
    expect(await cleared.isHidden("#kakao-chat")).toBe(true);
    await cleared.close();
  });

  it("관리자 화면: 로그인 입력 칸이 없고, 이메일과 Access 로그아웃 링크를 보여 준다", async () => {
    const page = await adminPage();
    await page.goto(server.url + "/admin/");
    await page.waitForSelector("#app-view:not([hidden])");
    expect(await page.textContent("#admin-email")).toBe("admin@example.com");
    expect(await page.getAttribute("#logout-link", "href")).toBe("/cdn-cgi/access/logout");
    expect(await page.isVisible("#logout-link")).toBe(true);
    expect(await page.locator("input[type=password]").count()).toBe(0);
    await page.close();
  });

  it("관리자 화면: JWT 가 없거나 다른 이메일이면 입력 칸 없이 안내만 보여 준다", async () => {
    const noJwt = await browser.newPage();
    await noJwt.goto(server.url + "/admin/");
    await noJwt.waitForSelector("#denied-view:not([hidden])");
    expect(await noJwt.textContent("#denied-message")).toContain("로그인이 필요합니다");
    expect(await noJwt.isHidden("#app-view")).toBe(true);
    expect(await noJwt.locator("input:visible, textarea:visible").count()).toBe(0);
    await noJwt.close();

    const other = await browser.newPage();
    await attachAccessHeader(other, server.url, () => server.access.sign({ email: "someone@example.com" }));
    await other.goto(server.url + "/admin/");
    await other.waitForSelector("#denied-view:not([hidden])");
    expect(await other.textContent("#denied-message")).toContain("관리자로 등록되어 있지 않습니다");
    await other.close();
  });

  it("API 가 없는 주소(GitHub Pages 등)에서는 관리자·후기 작성 화면에 입력 칸 없이 안내만 보여 준다", async () => {
    for (const path of ["/admin/", "/review/write?t=" + "A".repeat(43)]) {
      const page = await adminPage();
      await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" }));
      await page.goto(server.url + path);
      await page.waitForFunction('document.body.textContent.includes("이 주소에서는 사용할 수 없습니다")');
      expect(await page.locator("input:visible, textarea:visible, button[type=submit]:visible").count(), path).toBe(0);
      expect(await page.locator("input[type=password]").count(), path).toBe(0);
      await page.close();
    }
    // 연결 자체가 안 될 때도 같다
    const page = await browser.newPage();
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(server.url + "/admin/");
    await page.waitForSelector("#unavailable-view:not([hidden])");
    await page.close();
  });

  it("정적 페이지 보안 헤더: CSP, nosniff, Referrer-Policy, noindex, HSTS", async () => {
    const home = await fetch(server.url + "/");
    const csp = home.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("font-src https://fonts.gstatic.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("challenges.cloudflare.com");
    expect(home.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(home.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(home.headers.get("X-Robots-Tag")).toBeNull();
    expect(home.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");

    const write = await fetch(server.url + "/review/write?t=x");
    expect(write.headers.get("Content-Security-Policy")).toContain("script-src 'self' https://challenges.cloudflare.com;");
    expect(write.headers.get("Content-Security-Policy")!.split(",")).toHaveLength(1);
    expect(write.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(write.headers.get("Referrer-Policy")).toBe("no-referrer");

    const adminRes = await fetch(server.url + "/admin/");
    expect(adminRes.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(adminRes.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(adminRes.headers.get("Content-Security-Policy")).not.toContain("challenges.cloudflare.com");
  });
});
