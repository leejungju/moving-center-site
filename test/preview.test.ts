// 미리보기(preview/) 시험: 하위 경로(GitHub Pages 흉내) 정적 서버, 서버 API 없음, 외부 주소 차단.
// 가짜 API 는 브라우저 localStorage 에만 저장한다. 시험마다 새 브라우저 창(빈 저장소)에서 시작한다.
// 실제 화면·배포 산출물과 미리보기가 섞이지 않는지도 여기서 확인한다.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { checkJpeg } from "../src/jpeg";
// @ts-expect-error 타입 선언 없는 .mjs 도우미
import { startStaticServer } from "../scripts/static-server.mjs";

// page.evaluate·waitForFunction 안의 코드는 브라우저에서 실행된다. 시험용 tsconfig 에는 DOM 타입이 없어 이름만 선언한다.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;
declare const window: any;
declare class Image {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  decode(): Promise<void>;
}
type HTMLInputElement = any;
type HTMLImageElement = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

interface StaticServer {
  url: string;
  origin: string;
  stop(): Promise<void>;
}

const BAR_TEXT = "미리보기 화면입니다. 실제 고객 후기·연락처가 아니며, 입력한 내용은 이 브라우저에만 저장됩니다.";
const STORAGE_KEY = "moving-center-site:preview:v1";
let server: StaticServer;
let browser: Browser;

beforeAll(async () => {
  server = await startStaticServer({ root: process.cwd(), prefix: "/moving-center-site" });
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await server?.stop();
});

const PUBLIC = () => server.url + "/preview/";
const ADMIN = () => server.url + "/preview/admin/";
const WRITE = () => server.url + "/preview/review/write.html";

/** 외부 주소를 막고, 확인 창은 "확인"을 누르는 새 브라우저 창 */
async function newContext(width = 360, init?: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  await context.route("**/*", (route) => (new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort()));
  if (init) await context.addInitScript(init);
  context.on("page", (page) => {
    page.on("dialog", (dialog) => void dialog.accept());
  });
  return context;
}

async function openPublic(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(PUBLIC());
  await page.waitForSelector("#reviews:not([hidden]) .review-card");
  return page;
}

async function openAdmin(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(ADMIN());
  await page.waitForSelector("#view-reviews:not([hidden]) #review-items > *");
  return page;
}

async function makeLink(admin: Page): Promise<string> {
  await admin.click("[data-view=links]");
  await admin.click("#make-link");
  await admin.waitForSelector("#link-output:not([hidden])");
  return admin.inputValue("#link-text");
}

async function writeReview(page: Page, link: string, nickname: string, photo?: Buffer): Promise<void> {
  await page.goto(link);
  await page.waitForSelector("#review-form:not([hidden])");
  await page.fill("#nickname", nickname);
  await page.check("input[name=service][value=보관이사]", { force: true });
  await page.fill("#content", "미리보기에서 시험으로 써 본 후기입니다.");
  if (photo) {
    await page.setInputFiles("#photo-input", { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo });
    await page.waitForSelector("#photo-previews img");
  }
  await page.check("#consent");
  await page.click("#submit-button");
  await page.waitForSelector("#status:not([hidden])");
}

const reviewNames = (page: Page) => page.locator(".review-card .review-name").allTextContents();

describe.each([1440, 360])("미리보기 고정 띠·예시 표시 (하위 경로, %ipx)", (width) => {
  it.each([
    ["공개 페이지", "/preview/"],
    ["관리자 화면", "/preview/admin/"],
    ["후기 작성 화면", "/preview/review/write.html"],
  ])("%s: 맨 위에 고정 띠, 초기화 버튼, 세 화면 링크가 있다", async (_name, path) => {
    const context = await newContext(width);
    const page = await context.newPage();
    await page.goto(server.url + path);
    await page.waitForLoadState("networkidle");
    const bar = page.locator("#preview-bar");
    expect(await bar.isVisible()).toBe(true);
    expect(await bar.locator("p").first().textContent()).toBe(BAR_TEXT);
    expect(await page.isVisible("#preview-reset")).toBe(true);
    expect(await bar.getByRole("link").allTextContents()).toEqual(["공개 페이지", "관리자 화면", "후기 작성 화면"]);
    expect((await bar.boundingBox())?.y).toBe(0);
    // 아래로 내려도 맨 위에 붙어 있다.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.getElementById("preview-bar")!.getBoundingClientRect().top)).toBe(0);
    // 띠의 링크로 다른 미리보기 화면에 갈 수 있다.
    for (const link of await bar.getByRole("link").all()) {
      const res = await page.request.get(new URL((await link.getAttribute("href"))!, page.url()).href);
      expect(res.status()).toBe(200);
    }
    await context.close();
  });

  it("공개 페이지: 예시 후기 4건, 카드마다 「예시」, 사진 2건·답변 2건, 카카오·문자 양식이 보인다", async () => {
    const context = await newContext(width);
    const page = await openPublic(context);
    expect(await reviewNames(page)).toEqual(["예시 고객4", "예시 고객3", "예시 고객2", "예시 고객1"]);
    expect(await page.locator(".review-card .preview-badge").allTextContents()).toEqual(["예시", "예시", "예시", "예시"]);
    for (const badge of await page.locator(".review-card .preview-badge").all()) expect(await badge.isVisible()).toBe(true);
    expect(await page.locator(".review-card:has(.review-photos img)").count()).toBe(2);
    expect(await page.locator(".review-card:has(.review-reply)").count()).toBe(2);
    // 사진은 preview/img 의 직접 그린 그림(SVG)이다.
    const srcs = await page.locator(".review-photos img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
    expect(srcs.length).toBe(3);
    for (const src of srcs) expect(src).toMatch(/\/moving-center-site\/preview\/img\/example-[a-z]+\.svg$/);
    expect(await page.isVisible("#kakao-chat")).toBe(true);
    expect(await page.isVisible("#sms-form")).toBe(true);
    await context.close();
  });
});

describe("미리보기 공개 페이지 동작", () => {
  it("카카오 버튼은 안내만 보여 주고 밖으로 나가지 않는다", async () => {
    const context = await newContext();
    const page = await openPublic(context);
    const before = page.url();
    let popups = 0;
    context.on("page", () => popups++);
    await page.click("#kakao-chat");
    await page.waitForSelector("dialog.preview-dialog[open]");
    expect(await page.textContent("dialog.preview-dialog")).toContain("미리보기: 실제로는 카카오톡 채널 채팅이 열립니다.");
    await page.waitForTimeout(300);
    expect(page.url()).toBe(before);
    expect(popups).toBe(0);
    await context.close();
  });

  it("문자 양식은 보내질 문자 내용을 화면에 보여 주고 문자 앱을 열지 않는다", async () => {
    const context = await newContext();
    const page = await openPublic(context);
    const before = page.url();
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => navigations.push(frame.url()));
    await page.fill("#f-name", "시험");
    await page.fill("#f-from", "서울 강남구");
    await page.fill("#f-to", "경기 수원시");
    await page.fill("#f-memo", "엘리베이터 있음");
    await page.click("#sms-form button[type=submit]");
    await page.waitForSelector("dialog.preview-dialog[open]");
    expect(await page.textContent(".preview-dialog-detail")).toBe(
      "받는 번호: 010-0000-0000\n\n[홈페이지 견적 문의]\n이름: 시험\n출발지: 서울 강남구\n도착지: 경기 수원시\n이사 희망일: 미정\n이사 종류: 가정이사\n메모: 엘리베이터 있음",
    );
    await page.waitForTimeout(300);
    expect(page.url()).toBe(before);
    expect(navigations).toEqual([]);
    await context.close();
  });
});

describe("미리보기 관리자 화면", () => {
  it("로그인 없이 열리고 실제 로그인 방법 안내가 있으며, 처음에 승인 대기 2건이 있다", async () => {
    const context = await newContext();
    const admin = await openAdmin(context);
    expect(await admin.textContent("#preview-bar")).toContain("실제로는 관리자 이메일로 받은 6자리 숫자로 로그인합니다.");
    expect(await admin.textContent("#tab-pending")).toBe("승인 대기 (2)");
    expect(await admin.textContent("#tab-published")).toBe("공개 중 (4)");
    expect(await admin.locator(".review-item .review-meta strong").allTextContents()).toEqual(["예시 고객6", "예시 고객5"]);
    expect(await admin.locator(".review-item .preview-badge").count()).toBe(2);
    expect(await admin.locator("input[type=password]").count()).toBe(0);
    // 로그아웃은 미리보기에서 열지 않고 안내만 보여 준다.
    await admin.click("#logout-link");
    await admin.waitForSelector("dialog.preview-dialog[open]");
    expect(admin.url()).toBe(ADMIN());
    await context.close();
  });

  it("승인 대기 후기를 공개하면 미리보기 공개 페이지에 나타난다", async () => {
    const context = await newContext();
    const admin = await openAdmin(context);
    await admin.locator(".review-item", { hasText: "예시 고객5" }).getByRole("button", { name: "공개하기" }).click();
    await admin.waitForFunction(() => document.getElementById("tab-pending")?.textContent === "승인 대기 (1)");
    const page = await openPublic(context);
    expect(await reviewNames(page)).toEqual(["예시 고객5", "예시 고객4", "예시 고객3", "예시 고객2", "예시 고객1"]);
    await context.close();
  });

  it("숨기기·답변·사진 숨기기·사진 삭제·후기 삭제가 공개 페이지와 최근 기록에 반영된다", async () => {
    const context = await newContext();
    const admin = await openAdmin(context);
    await admin.click("#tab-published");
    await admin.waitForSelector(".review-item");
    const first = admin.locator(".review-item", { hasText: "예시 고객1" });
    await first.getByRole("button", { name: "사진 숨기기" }).first().click();
    await admin.waitForSelector(".review-item:has-text('예시 고객1') .badge-hidden");
    await admin.locator(".review-item", { hasText: "예시 고객1" }).getByRole("button", { name: "사진 삭제" }).nth(1).click();
    await admin.waitForFunction(() => [...document.querySelectorAll(".review-item")].find((n) => n.textContent!.includes("예시 고객1"))!.querySelectorAll(".admin-photo").length === 1);
    const second = admin.locator(".review-item", { hasText: "예시 고객2" });
    await second.getByRole("button", { name: "답변 쓰기" }).click();
    await second.locator("textarea").fill("미리보기 시험 답변입니다.");
    await second.getByRole("button", { name: "답변 저장" }).click();
    await second.locator(".reply-box").waitFor();
    await admin.locator(".review-item", { hasText: "예시 고객3" }).getByRole("button", { name: "숨기기" }).click();
    await admin.waitForFunction(() => document.getElementById("tab-published")?.textContent === "공개 중 (3)");
    await admin.locator(".review-item", { hasText: "예시 고객4" }).getByRole("button", { name: "삭제", exact: true }).click();
    await admin.waitForFunction(() => document.getElementById("tab-published")?.textContent === "공개 중 (2)");

    const page = await openPublic(context);
    expect(await reviewNames(page)).toEqual(["예시 고객2", "예시 고객1"]);
    expect(await page.locator(".review-card", { hasText: "예시 고객1" }).locator(".review-photos img").count()).toBe(0);
    expect(await page.locator(".review-card", { hasText: "예시 고객2" }).locator(".review-reply p").textContent()).toBe("미리보기 시험 답변입니다.");

    await admin.click("[data-view=audit]");
    await admin.waitForSelector("#audit-list li");
    const actions = await admin.locator("#audit-list .audit-action").allTextContents();
    expect(actions.slice(0, 5)).toEqual(["후기 삭제", "후기 숨김", "답변 씀", "사진 삭제", "사진 숨김"]);
    await context.close();
  });

  it("홈페이지 문구를 고치면 미리보기 공개 페이지에 반영된다", async () => {
    const context = await newContext();
    const admin = await openAdmin(context);
    await admin.click("[data-view=texts]");
    await admin.waitForSelector("#text-hero_badge");
    await admin.fill("#text-hero_badge", "미리보기 시험 제목");
    await admin.fill("#text-step1_desc", "미리보기 시험 1단계 문구");
    await admin.click("#texts-form button[type=submit]");
    await admin.waitForSelector("#toast:not([hidden])");
    const page = await openPublic(context);
    expect(await page.textContent("[data-setting=hero_badge]")).toBe("미리보기 시험 제목");
    expect(await page.textContent("[data-setting=step1_desc]")).toBe("미리보기 시험 1단계 문구");
    await context.close();
  });

  it("연락처를 비우면 미리보기 공개 페이지의 카카오 버튼·문자 양식이 사라지고 안내 문구가 전화만으로 바뀐다", async () => {
    const context = await newContext();
    const before = await openPublic(context);
    expect(await before.isVisible("#kakao-chat")).toBe(true);
    const admin = await openAdmin(context);
    await admin.click("[data-view=contact]");
    await admin.waitForFunction(() => (document.getElementById("kakao-id") as HTMLInputElement).value === "_example");
    await admin.fill("#kakao-id", "");
    await admin.click("#contact-form button[type=submit]");
    await admin.waitForSelector("#toast:not([hidden])");
    let page = await openPublic(context);
    expect(await page.isVisible("#kakao-chat")).toBe(false);
    expect(await page.isVisible("#sms-form")).toBe(true);
    expect(await page.textContent("#quote-desc")).toBe("전화로 바로 문의하시거나, 휴대폰에서는 문자로 견적을 문의하실 수 있습니다.");
    await admin.fill("#sms-number", "");
    await admin.click("#contact-form button[type=submit]");
    await admin.waitForFunction(() => (document.getElementById("sms-number") as HTMLInputElement).value === "");
    page = await openPublic(context);
    expect(await page.isVisible("#kakao-chat")).toBe(false);
    expect(await page.isVisible("#sms-form")).toBe(false);
    expect(await page.textContent("#quote-desc")).toBe("전화로 바로 문의해 주세요. 이사 일정과 지역을 알려 주시면 견적을 안내해 드립니다.");
    // 형식이 틀린 값은 실제 서버처럼 거부한다.
    await admin.fill("#kakao-id", "잘못된 값");
    await admin.click("#contact-form button[type=submit]");
    await admin.waitForFunction(() => document.getElementById("toast")?.textContent?.includes("_ 로 시작하는"));
    await context.close();
  });

  it("후기가 0건이면 미리보기 공개 페이지에 빈 안내가 나온다", async () => {
    const context = await newContext();
    await context.addInitScript(`try { localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify({ version: 1, nextReviewId: 1, nextAuditId: 1, reviews: [], tokens: [], settings: {}, audit: [] })); } catch (e) {}`);
    const page = await context.newPage();
    await page.goto(PUBLIC());
    await page.waitForSelector("#reviews:not([hidden]) #review-empty:not([hidden])");
    expect(await page.textContent("#review-empty")).toBe("아직 등록된 후기가 없습니다.");
    await context.close();
  });
});

describe("미리보기 후기 작성 화면", () => {
  /** 가짜 EXIF 가 든 2400x1800 JPEG (사람 없는 단색 그림) */
  async function bigJpegWithExif(page: Page): Promise<Buffer> {
    const jpeg = (await page.evaluate(`(async () => {
      const c = document.createElement("canvas");
      c.width = 2400; c.height = 1800;
      const g = c.getContext("2d");
      g.fillStyle = "#4a90d9"; g.fillRect(0, 0, 2400, 1800);
      g.fillStyle = "#ffffff"; g.fillRect(600, 450, 1200, 900);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    })()`)) as number[];
    const exif = [0xff, 0xe1, 0x00, 0x16, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    const out = Buffer.from([...jpeg.slice(0, 2), ...exif, ...jpeg.slice(2)]);
    expect(checkJpeg(new Uint8Array(out))).toBe("has_metadata");
    return out;
  }

  it("관리자에서 만든 링크로 쓰면 사진을 줄이고 메타데이터를 지워 브라우저에 저장하고, 승인 대기에 나타난다", async () => {
    const context = await newContext();
    const admin = await openAdmin(context);
    const link = await makeLink(admin);
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/moving-center-site\/preview\/review\/write\.html\?t=[A-Za-z0-9_-]{43}$/);
    const writer = await context.newPage();
    await writer.goto(PUBLIC());
    await writeReview(writer, link, "미리보기 손님", await bigJpegWithExif(writer));
    expect(await writer.textContent("#status")).toContain("후기가 접수되었습니다");

    // 저장된 사진: 메타데이터 없는 JPEG, 긴 변 1600px
    const stored = JSON.parse((await writer.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!);
    const review = stored.reviews.find((r: { nickname: string }) => r.nickname === "미리보기 손님");
    expect(review.status).toBe("pending");
    expect(review.photos).toHaveLength(1);
    const bytes = new Uint8Array(Buffer.from(review.photos[0].src.replace(/^data:image\/jpeg;base64,/, ""), "base64"));
    expect(checkJpeg(bytes)).toBe("ok");
    const size = await writer.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, review.photos[0].src);
    expect(size).toEqual([1600, 1200]);

    await admin.click("[data-view=reviews]");
    await admin.click("#tab-pending");
    await admin.waitForFunction(() => document.getElementById("tab-pending")?.textContent === "승인 대기 (3)");
    const item = admin.locator(".review-item", { hasText: "미리보기 손님" });
    expect(await item.count()).toBe(1);
    expect(await item.locator(".admin-photo img").evaluate((img) => (img as HTMLImageElement).src.startsWith("data:image/jpeg;base64,"))).toBe(true);
    await context.close();
  });

  it("같은 링크는 한 번만 쓸 수 있다(다시 열기·다시 보내기 모두 거부)", async () => {
    const context = await newContext();
    const admin = await openAdmin(context);
    const link = await makeLink(admin);
    const first = await context.newPage();
    await first.goto(link);
    await first.waitForSelector("#review-form:not([hidden])");
    // 두 번째 창에서 먼저 보낸다.
    const second = await context.newPage();
    await writeReview(second, link, "먼저 보낸 손님");
    expect(await second.textContent("#status")).toContain("후기가 접수되었습니다");
    // 다시 열면 안내만 보인다.
    await second.goto(link);
    await second.waitForSelector("#status.notice-error");
    expect(await second.textContent("#status")).toBe("이미 후기를 작성한 링크입니다. 소중한 후기 감사합니다.");
    expect(await second.isVisible("#review-form")).toBe(false);
    // 먼저 열어 둔 창에서 보내도 거부된다.
    await first.fill("#nickname", "나중 손님");
    await first.check("input[name=service][value=원룸이사]", { force: true });
    await first.fill("#content", "같은 링크로 두 번째 보내기 시험입니다.");
    await first.check("#consent");
    await first.click("#submit-button");
    await first.waitForSelector("#status.notice-error");
    expect(await first.textContent("#status")).toBe("이미 후기를 작성한 링크입니다. 소중한 후기 감사합니다.");
    await admin.click("[data-view=reviews]");
    await admin.waitForFunction(() => document.getElementById("tab-pending")?.textContent === "승인 대기 (3)");
    expect(await admin.locator(".review-item", { hasText: "나중 손님" }).count()).toBe(0);
    await context.close();
  });

  it("사용 기간이 지난 링크, 잘못된 링크, 링크 없이 연 화면은 입력 칸 없이 안내만 보여 준다", async () => {
    const context = await newContext();
    const admin = await openAdmin(context);
    const link = await makeLink(admin);
    await admin.click("#preview-expire-link");
    await admin.waitForSelector("dialog.preview-dialog[open]");
    const page = await context.newPage();
    for (const [url, message] of <[string, string][]>[
      [link, "링크의 사용 기간(30일)이 지났습니다. 업체에 새 링크를 요청해 주세요."],
      [WRITE() + "?t=" + "A".repeat(43), "올바르지 않은 링크입니다. 받은 링크 주소를 다시 확인해 주세요."],
      [WRITE(), "후기는 업체에서 보내 드린 링크로만 작성할 수 있습니다."],
    ]) {
      await page.goto(url);
      await page.waitForSelector("#status.notice-error");
      expect(await page.textContent("#status")).toBe(message);
      expect(await page.locator("#review-form input:visible, #review-form textarea:visible").count()).toBe(0);
    }
    await context.close();
  });

  it("30일이 지나면 링크가 만료된다(시계를 31일 뒤로)", async () => {
    const context = await newContext();
    const admin = await openAdmin(context);
    const link = await makeLink(admin);
    const later = await browser.newContext({ viewport: { width: 360, height: 800 } });
    await later.route("**/*", (route) => (new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort()));
    const storage = await context.storageState();
    const saved = storage.origins.find((o) => o.origin === server.origin)!.localStorage.find((i) => i.name === STORAGE_KEY)!.value;
    await later.addInitScript(
      `try { localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(saved)}); } catch (e) {}
       const realNow = Date.now; Date.now = () => realNow() + 31 * 24 * 60 * 60 * 1000;`,
    );
    const page = await later.newPage();
    await page.goto(link);
    await page.waitForSelector("#status.notice-error");
    expect(await page.textContent("#status")).toContain("사용 기간(30일)이 지났습니다");
    await later.close();
    await context.close();
  });
});

describe("미리보기 초기화·저장소", () => {
  it("초기화하면 처음 상태(공개 4건, 승인 대기 2건, 카카오·문자 연락처)로 돌아간다", async () => {
    const context = await newContext();
    const admin = await openAdmin(context);
    await admin.locator(".review-item", { hasText: "예시 고객5" }).getByRole("button", { name: "공개하기" }).click();
    await admin.waitForFunction(() => document.getElementById("tab-pending")?.textContent === "승인 대기 (1)");
    await admin.click("[data-view=contact]");
    await admin.waitForFunction(() => (document.getElementById("kakao-id") as HTMLInputElement).value === "_example");
    await admin.fill("#kakao-id", "");
    await admin.click("#contact-form button[type=submit]");
    await admin.waitForSelector("#toast:not([hidden])");

    const page = await openPublic(context);
    expect(await page.locator(".review-card").count()).toBe(5);
    expect(await page.isVisible("#kakao-chat")).toBe(false);
    await Promise.all([page.waitForEvent("load"), page.click("#preview-reset")]);
    await page.waitForSelector("#reviews:not([hidden]) .review-card");
    expect(await reviewNames(page)).toEqual(["예시 고객4", "예시 고객3", "예시 고객2", "예시 고객1"]);
    expect(await page.isVisible("#kakao-chat")).toBe(true);
    expect(await page.isVisible("#sms-form")).toBe(true);

    await admin.reload();
    await admin.waitForSelector("#view-reviews:not([hidden]) .review-item");
    expect(await admin.textContent("#tab-pending")).toBe("승인 대기 (2)");
    await context.close();
  });

  it("localStorage 를 쓸 수 없으면 메모리로 동작하고 안내를 보여 준다", async () => {
    const context = await newContext(
      360,
      `Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });`,
    );
    const admin = await openAdmin(context);
    expect(await admin.isVisible("#preview-storage-warn")).toBe(true);
    await admin.locator(".review-item", { hasText: "예시 고객5" }).getByRole("button", { name: "공개하기" }).click();
    await admin.waitForFunction(() => document.getElementById("tab-pending")?.textContent === "승인 대기 (1)");
    await context.close();
  });
});

describe("실제 화면·배포 산출물과 미리보기 분리", () => {
  /** @returns 폴더 안 모든 파일 경로 */
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  it("npm run build 의 dist/ 에 preview/ 가 없다", () => {
    expect(existsSync("dist/index.html")).toBe(true);
    expect(existsSync("dist/preview")).toBe(false);
    for (const file of walk("dist")) {
      expect(file).not.toMatch(/(^|\/)preview(\/|\.)|server-values/);
      expect(readFileSync(file, "utf8"), file).not.toMatch(/preview\/|preview\.(?:js|css)|server-values/);
    }
  });

  it("index.html·admin/·review/·src/·functions/ 는 preview 를 참조하지 않고, js/ 는 preview/ 파일을 불러오지 않는다", () => {
    const files = ["index.html", ...walk("admin"), ...walk("review"), ...walk("src"), ...walk("functions")];
    // preview/ 폴더 경로, 미리보기 파일, 미리보기 연결점(data-preview, movingCenterPreview) 어느 것도 없어야 한다.
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/preview\/|preview\.(?:js|css)|server-values|data-preview|movingCenterPreview/i);
    // js/ 는 미리보기 페이지가 넘겨주는 설정(data-preview, movingCenterPreview)만 읽고, preview/ 파일은 불러오지 않는다.
    for (const file of walk("js")) expect(readFileSync(file, "utf8"), file).not.toMatch(/preview\/|preview\.(?:js|css)|server-values/i);
  });

  it("미리보기 html 은 모두 noindex 이고 실제 HTML 에서 만든 최신 파일이다", () => {
    const pages = walk("preview").filter((f) => f.endsWith(".html"));
    expect(pages.sort()).toEqual(["preview/admin/index.html", "preview/index.html", "preview/review/write.html"]);
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      expect(html, page).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html, page).toContain('data-preview="1"');
      expect(html, page).toContain(BAR_TEXT.replace("미리보기 화면입니다. ", "미리보기 화면입니다.</strong> "));
    }
    // scripts/preview.mjs --check: 실제 HTML·서버 값과 다르면 실패
    execFileSync(process.execPath, ["scripts/preview.mjs", "--check"], { stdio: "pipe" });
  });

  it("미리보기 그림은 직접 그린 SVG 이고 외부 주소·스크립트를 쓰지 않는다", () => {
    const images = walk("preview/img");
    expect(images.length).toBeGreaterThan(0);
    for (const file of images) {
      expect(file).toMatch(/\.svg$/);
      const svg = readFileSync(file, "utf8");
      expect(svg, file).not.toMatch(/<script|<image|href=|url\(/i);
    }
  });
});
