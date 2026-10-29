// 실제 화면(index.html, admin/, review/)을 서버 API 없는 정적 서버로 여는 시험.
// - 하위 경로: 저장소를 /moving-center-site/ 아래로 제공(GitHub Pages 흉내)
// - 맨 앞 경로: dist/ 를 / 로 제공(Cloudflare Pages 흉내, API 는 page.route 로 대신 답함)
// 1440px·360px 두 폭에서 같은 결과여야 한다. 외부 주소(글꼴 등)는 막는다.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page, type Route } from "playwright";
// @ts-expect-error 타입 선언 없는 .mjs 도우미
import { startStaticServer } from "../scripts/static-server.mjs";

// page.evaluate·waitForFunction 안의 코드는 브라우저에서 실행된다. 시험용 tsconfig 에는 DOM 타입이 없어 이름만 선언한다.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;
declare function getComputedStyle(element: unknown): any;
/* eslint-enable @typescript-eslint/no-explicit-any */

interface StaticServer {
  url: string;
  origin: string;
  requests: { path: string; status: number }[];
  stop(): Promise<void>;
}

const PREFIX = "/moving-center-site";
let sub: StaticServer;
let top: StaticServer;
let browser: Browser;

beforeAll(async () => {
  sub = await startStaticServer({ root: process.cwd(), prefix: PREFIX });
  top = await startStaticServer({ root: "dist", prefix: "" });
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await sub?.stop();
  await top?.stop();
});

const MODES = [
  { name: "하위 경로", server: () => sub },
  { name: "맨 앞 경로", server: () => top },
] as const;
const WIDTHS = [1440, 360] as const;

/** index.html 기본 문구와 같아야 하는 「무료 견적 문의」 안내(js/site.js 의 QUOTE_DESC) */
const DESC = {
  phone: "전화로 바로 문의해 주세요. 이사 일정과 지역을 알려 주시면 견적을 안내해 드립니다.",
  sms: "전화로 바로 문의하시거나, 휴대폰에서는 문자로 견적을 문의하실 수 있습니다.",
  kakao: "전화로 바로 문의하시거나, 카카오톡으로 견적을 문의하실 수 있습니다.",
  all: "전화로 바로 문의하시거나, 카카오톡 또는 휴대폰 문자로 견적을 문의하실 수 있습니다.",
};

type ApiReply = { status: number; body: unknown } | "404";
interface PageOptions {
  settings?: ApiReply;
  reviews?: ApiReply;
  /** 이 이름으로 끝나는 파일을 404 로 만든다 */
  broken?: string[];
}

const json = (body: unknown) => ({ status: 200, body });
const settings = (kakaoChannelId: string, smsNumber: string, texts: Record<string, string> = {}) =>
  json({ ok: true, texts, kakaoChannelId, smsNumber });
const review = (id: number, nickname: string) => ({
  id,
  nickname,
  service: "가정이사",
  content: "시험용 후기입니다. 친절하게 잘 옮겨 주셨어요.",
  reply: null,
  createdAt: Date.UTC(2026, 9, id),
  photos: [],
});

async function fulfill(route: Route, reply: ApiReply | undefined) {
  if (!reply || reply === "404") return route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" });
  return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
}

async function openPage(server: StaticServer, path: string, width: number, options: PageOptions = {}): Promise<{ page: Page; failed: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const failed: string[] = [];
  page.on("response", (res) => {
    if (res.status() >= 400) failed.push(new URL(res.url()).pathname);
  });
  let answered = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== server.origin) return route.abort();
    if ((options.broken ?? []).some((name) => url.pathname.endsWith(name))) {
      return route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" });
    }
    if (url.pathname === "/api/settings" || url.pathname === "/api/reviews") {
      await fulfill(route, url.pathname === "/api/settings" ? options.settings : options.reviews);
      answered++;
      return;
    }
    return route.continue();
  });
  await page.goto(server.url + path, { waitUntil: "load" });
  // 공개 페이지는 site.js 가 설정·후기 API 를 둘 다 받고 화면에 반영할 때까지 기다린다(site.js 가 없으면 요청도 없다).
  if (path === "/" && !(options.broken ?? []).includes("/js/site.js")) {
    for (let i = 0; i < 100 && answered < 2; i++) await page.waitForTimeout(50);
    expect(answered).toBe(2);
  }
  await page.waitForTimeout(150);
  return { page, failed };
}

/** 화면에 실제로 그려지는지(hidden·display:none·크기 0 이 아닌지) */
const shown = (page: Page, selector: string) => page.locator(selector).isVisible();

describe.each(MODES)("실제 공개 페이지 ($name)", ({ server }) => {
  describe.each(WIDTHS)("%ipx", (width) => {
    it("설정을 받지 못하면(API 404) 카카오 버튼·문자 양식이 안 보이고 안내는 전화만", async () => {
      const { page } = await openPage(server(), "/", width);
      expect(await shown(page, "#kakao-chat")).toBe(false);
      expect(await page.getAttribute("#kakao-chat", "href")).toBeNull();
      expect(await shown(page, "#sms-form")).toBe(false);
      expect(await page.textContent("#quote-desc")).toBe(DESC.phone);
      expect(await page.textContent("[data-setting=step1_desc]")).toBe("전화나 홈페이지 문의로 이사 일정과 지역을 알려 주세요.");
      await page.close();
    });

    it("스크립트 파일이 404 여도 링크 없는 카카오 버튼·문자 양식이 보이지 않는다", async () => {
      const { page, failed } = await openPage(server(), "/", width, {
        broken: ["/js/site.js"],
        settings: settings("_test", "010-1234-5678"),
        reviews: json({ ok: true, reviews: [review(1, "시험 고객1")], hasMore: false }),
      });
      expect(failed.some((p) => p.endsWith("/js/site.js"))).toBe(true);
      expect(await shown(page, "#kakao-chat")).toBe(false);
      expect(await shown(page, "#sms-form")).toBe(false);
      expect(await shown(page, "#reviews")).toBe(false);
      expect(await page.textContent("#quote-desc")).toBe(DESC.phone);
      await page.close();
    });

    it("스타일 파일이 404 여도 카카오 버튼·문자 양식이 보이지 않는다", async () => {
      const { page } = await openPage(server(), "/", width, { broken: ["/style.css"], settings: settings("", "") });
      expect(await shown(page, "#kakao-chat")).toBe(false);
      expect(await shown(page, "#sms-form")).toBe(false);
      await page.close();
    });

    it.each([
      { label: "카카오만", kakao: "_test", sms: "", seeKakao: true, seeSms: false, desc: DESC.kakao },
      { label: "문자만", kakao: "", sms: "010-1234-5678", seeKakao: false, seeSms: true, desc: DESC.sms },
      { label: "둘 다", kakao: "_test", sms: "01012345678", seeKakao: true, seeSms: true, desc: DESC.all },
      { label: "형식이 틀린 값", kakao: "test channel", sms: "02-123-4567", seeKakao: false, seeSms: false, desc: DESC.phone },
    ])("설정값이 있으면($label) 해당 수단만 보이고 안내 문구가 바뀐다", async ({ kakao, sms, seeKakao, seeSms, desc }) => {
      const { page } = await openPage(server(), "/", width, { settings: settings(kakao, sms) });
      await page.waitForFunction((d) => document.getElementById("quote-desc")?.textContent === d, desc);
      expect(await shown(page, "#kakao-chat")).toBe(seeKakao);
      expect(await shown(page, "#sms-form")).toBe(seeSms);
      if (seeKakao) {
        expect(await page.getAttribute("#kakao-chat", "href")).toBe("https://pf.kakao.com/_test/chat");
        expect(await page.getAttribute("#kakao-chat", "target")).toBe("_blank");
        expect(await page.getAttribute("#kakao-chat", "rel")).toBe("noopener noreferrer");
      }
      await page.close();
    });

    it("관리자가 저장한 이용 절차 1단계 문구가 있으면 그 값을 쓴다", async () => {
      const { page } = await openPage(server(), "/", width, { settings: settings("", "", { step1_desc: "관리자가 저장한 시험 문구" }) });
      await page.waitForFunction(() => document.querySelector("[data-setting=step1_desc]")?.textContent === "관리자가 저장한 시험 문구");
      await page.close();
    });

    it("후기 API 를 받지 못하면 섹션 전체를 숨긴다(404, 모양이 다른 응답)", async () => {
      for (const reviews of ["404", json({ ok: true }), { status: 500, body: { ok: false } }] as ApiReply[]) {
        const { page } = await openPage(server(), "/", width, { reviews });
        expect(await shown(page, "#reviews")).toBe(false);
        expect(await shown(page, "#nav-reviews")).toBe(false);
        await page.close();
      }
    });

    it("후기가 0건이면 제목과 「아직 등록된 후기가 없습니다.」를 보여 준다", async () => {
      const { page } = await openPage(server(), "/", width, { reviews: json({ ok: true, reviews: [], hasMore: false }) });
      await page.waitForSelector("#reviews:not([hidden])");
      expect(await shown(page, "#reviews-title")).toBe(true);
      expect(await shown(page, "#review-empty")).toBe(true);
      expect(await page.textContent("#review-empty")).toBe("아직 등록된 후기가 없습니다.");
      expect(await page.locator(".review-card").count()).toBe(0);
      expect(await shown(page, "#review-more")).toBe(false);
      await page.close();
    });

    it("후기가 2건이면 목록을 보여 준다", async () => {
      const { page } = await openPage(server(), "/", width, {
        reviews: json({ ok: true, reviews: [review(2, "시험 고객2"), review(1, "시험 고객1")], hasMore: false }),
      });
      await page.waitForSelector("#reviews:not([hidden]) .review-card");
      expect(await page.locator(".review-card").count()).toBe(2);
      expect(await page.locator(".review-name").allTextContents()).toEqual(["시험 고객2", "시험 고객1"]);
      expect(await shown(page, "#review-empty")).toBe(false);
      await page.close();
    });
  });
});

describe.each(MODES)("실제 관리자·후기 작성 화면 ($name)", ({ server }) => {
  describe.each(WIDTHS)("%ipx", (width) => {
    it.each(["/admin/", "/review/write?t=" + "A".repeat(43), "/review/write.html"])(
      "%s: CSS·스크립트가 상대 주소로 열리고, API 가 없으면 「이 주소에서는 사용할 수 없습니다」만 보인다",
      async (path) => {
        const { page, failed } = await openPage(server(), path, width);
        await page.waitForFunction('document.body.textContent.includes("이 주소에서는 사용할 수 없습니다")');
        // API 말고는 404 가 없어야 한다(app.css, js/*.js 를 찾았다).
        expect(failed.filter((p) => !p.startsWith("/api/"))).toEqual([]);
        // app.css 가 적용됐다(배경색 --sky).
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(245, 249, 255)");
        expect(await page.locator("input:visible, textarea:visible, select:visible, button[type=submit]:visible").count()).toBe(0);
        expect(await page.isVisible("#loading")).toBe(false);
        await page.close();
      },
    );
  });
});

describe("상대 주소", () => {
  it("관리자·후기 작성 화면 HTML 은 / 로 시작하는 CSS·스크립트·이미지·내부 링크가 없다(Access 로그아웃만 예외)", () => {
    for (const file of ["admin/index.html", "review/write.html"]) {
      const html = readFileSync(file, "utf8");
      const absolute = [...html.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
      expect(absolute.filter((u) => u !== "/cdn-cgi/access/logout"), file).toEqual([]);
    }
    expect(readFileSync("admin/index.html", "utf8")).toContain('href="/cdn-cgi/access/logout"');
  });
});
