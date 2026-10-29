import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accessConfig } from "../src/auth";
import { checkJpeg } from "../src/jpeg";
import { TEXT_FIELDS } from "../src/settings";
import { fakeJpeg } from "./helpers";

describe("Access 설정값 형식", () => {
  const good = { CF_ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com", CF_ACCESS_AUD: "a".repeat(64), ADMIN_EMAIL: "admin@example.com" };
  const env = (over: Record<string, string | undefined>) => ({ DB: null, PHOTOS: null, ...good, ...over }) as never;
  it("세 값이 모두 맞으면 설정을 돌려준다", () => {
    expect(accessConfig(env({}))).toEqual({ teamDomain: "test-team.cloudflareaccess.com", aud: "a".repeat(64), adminEmail: "admin@example.com" });
    expect(accessConfig(env({ ADMIN_EMAIL: " Admin@Example.com " }))?.adminEmail).toBe("admin@example.com");
  });
  it("팀 도메인은 <이름>.cloudflareaccess.com 형식만 받는다", () => {
    for (const d of ["", "cloudflareaccess.com", "evil.example.com", "a.cloudflareaccess.com.evil.example", "a.b.cloudflareaccess.com", "A.cloudflareaccess.com", "https://a.cloudflareaccess.com", "a.cloudflareaccess.com/x", "a.cloudflareaccess.com:443", "a.cloudflareaccess.com@evil.example", "a_b.cloudflareaccess.com"]) {
      expect(accessConfig(env({ CF_ACCESS_TEAM_DOMAIN: d })), d).toBeNull();
    }
  });
  it("AUD 는 64자리 16진수, 관리자 이메일은 1개만", () => {
    for (const over of [{ CF_ACCESS_AUD: "a".repeat(63) }, { CF_ACCESS_AUD: "g".repeat(64) }, { CF_ACCESS_AUD: undefined }, { ADMIN_EMAIL: "a@example.com,b@example.com" }, { ADMIN_EMAIL: "a@example.com b@example.com" }, { ADMIN_EMAIL: "admin" }, { ADMIN_EMAIL: undefined }]) {
      expect(accessConfig(env(over)), JSON.stringify(over)).toBeNull();
    }
  });
});

describe("JPEG 검사", () => {
  it("정상 JPEG 는 통과", () => {
    expect(checkJpeg(fakeJpeg())).toBe("ok");
  });
  it("EXIF(APP1) 구간이 있으면 거부", () => {
    expect(checkJpeg(fakeJpeg({ exif: true }))).toBe("has_metadata");
  });
  it("APP2~APP15, COM, 모르는 구간은 모두 거부하고 영상 구간(DQT·DHT·SOF·DRI)은 통과", () => {
    for (let marker = 0xe1; marker <= 0xef; marker++) {
      expect(checkJpeg(fakeJpeg({ segment: { marker, payload: [1, 2, 3] } })), marker.toString(16)).toBe("has_metadata");
    }
    for (const marker of [0xfe, 0xf0, 0xfd, 0xc8, 0xde, 0xdf, 0x02]) {
      expect(checkJpeg(fakeJpeg({ segment: { marker, payload: [1, 2, 3] } })), marker.toString(16)).toBe("has_metadata");
    }
    for (const marker of [0xdb, 0xc4, 0xc0, 0xc2, 0xdd]) {
      expect(checkJpeg(fakeJpeg({ segment: { marker, payload: [0, 4] } })), marker.toString(16)).toBe("ok");
    }
  });
  it("APP0 는 JFIF 머리말만 받는다(JFXX 등은 거부)", () => {
    const base = fakeJpeg();
    const jfxx = new Uint8Array(base);
    jfxx.set([0x4a, 0x46, 0x58, 0x58], 6); // "JFXX"
    expect(checkJpeg(jfxx)).toBe("has_metadata");
    const short = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9]);
    expect(checkJpeg(short)).toBe("has_metadata");
  });
  it("압축 데이터 뒤에 나오는 APP1 도 찾아낸다", () => {
    const base = fakeJpeg();
    const app1 = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    const sneaky = new Uint8Array([...base.slice(0, -2), ...app1, 0xff, 0xd9]);
    expect(checkJpeg(sneaky)).toBe("has_metadata");
  });
  it("JPEG 시작 바이트가 아니면 거부", () => {
    expect(checkJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("not_jpeg");
    expect(checkJpeg(new Uint8Array([0xff, 0xd8]))).toBe("not_jpeg");
  });
  it("5MB 를 넘으면 거부", () => {
    expect(checkJpeg(fakeJpeg({ size: 5 * 1024 * 1024 + 1 }))).toBe("too_large");
    expect(checkJpeg(fakeJpeg({ size: 5 * 1024 * 1024 }))).toBe("ok");
  });
});

describe("홈페이지 문구 기본값", () => {
  it("설정 기본값이 index.html 문구와 같다(불러오지 못해도 같은 문구가 보이도록)", () => {
    const html = readFileSync("index.html", "utf8");
    for (const field of TEXT_FIELDS) {
      const match = html.match(new RegExp(`data-setting="${field.key}">([^<]*)<`));
      expect(match?.[1], field.key).toBe(field.default);
    }
    expect(html.match(/data-setting="/g)).toHaveLength(TEXT_FIELDS.length);
  });

  it("상호·대표번호·사업자등록번호·canonical 은 그대로이고 설정으로 바꿀 수 없다", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('<link rel="canonical" href="https://www.kor2404.co.kr/">');
    expect(html).toContain("名品 포장이사공사 대한익스프레스");
    expect(html).toContain("사업자등록번호 : 215-23-16684");
    expect(html).toContain("대표전화 : 1661-7624");
    expect(html).toContain("홈페이지 : www.kor2404.co.kr");
    for (const field of TEXT_FIELDS) {
      expect(field.default).not.toMatch(/대한익스프레스|1661|215-23/);
    }
  });

  it("공개 페이지에 연습 안내 문구와 인라인 스크립트가 없다", () => {
    for (const page of ["index.html", "admin/index.html", "review/write.html"]) {
      const html = readFileSync(page, "utf8");
      expect(html, page).not.toContain("\uC5F0\uC2B5\uC6A9"); // 예전 연습 안내 문구
      expect(html, page).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(html, page).not.toMatch(/\son[a-z]+=/);
    }
  });
});
