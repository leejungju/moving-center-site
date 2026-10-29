import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePasswordHash, pbkdf2Sha256, pbkdf2Sha256Manual, verifyPassword } from "../src/crypto";
import { checkJpeg } from "../src/jpeg";
import { TEXT_FIELDS } from "../src/settings";
import { fakeJpeg } from "./helpers";

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("PBKDF2-HMAC-SHA256", () => {
  it("RFC 7914 시험 벡터와 같다(직접 구현)", async () => {
    expect(hex(await pbkdf2Sha256Manual(enc.encode("passwd"), enc.encode("salt"), 1))).toBe(
      "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc",
    );
    expect(hex(await pbkdf2Sha256Manual(enc.encode("Password"), enc.encode("NaCl"), 80000))).toBe(
      "4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56",
    );
  });

  it("직접 구현과 Web Crypto 결과가 같다(64바이트보다 긴 비밀번호 포함)", async () => {
    for (const password of ["짧은비번", "x".repeat(64), "긴비밀번호".repeat(20)]) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      expect(hex(await pbkdf2Sha256Manual(enc.encode(password), salt, 1000))).toBe(hex(await pbkdf2Sha256(enc.encode(password), salt, 1000)));
    }
  });

  it("scripts/hash-password.mjs 가 만든 해시(600000회)로 검증된다", async () => {
    const hash = execFileSync(process.execPath, ["scripts/hash-password.mjs"], { input: "test-password-5678\n", encoding: "utf8" }).trim();
    expect(hash).toMatch(/^pbkdf2-sha256:600000:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/);
    expect(await verifyPassword("test-password-5678", hash)).toBe(true);
    expect(await verifyPassword("test-password-5679", hash)).toBe(false);
  });

  it("반복 횟수가 600000 보다 적거나 형식이 틀린 해시는 받지 않는다", async () => {
    expect(parsePasswordHash("pbkdf2-sha256:1000:AAAAAAAAAAAAAAAAAAAAAA:" + "A".repeat(43))).toBeNull();
    expect(parsePasswordHash("sha256:abc")).toBeNull();
    expect(await verifyPassword("", "")).toBe(false);
  });
});

describe("JPEG 검사", () => {
  it("정상 JPEG 는 통과", () => {
    expect(checkJpeg(fakeJpeg())).toBe("ok");
  });
  it("EXIF(APP1) 구간이 있으면 거부", () => {
    expect(checkJpeg(fakeJpeg({ exif: true }))).toBe("has_exif");
  });
  it("압축 데이터 뒤에 나오는 APP1 도 찾아낸다", () => {
    const base = fakeJpeg();
    const app1 = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    const sneaky = new Uint8Array([...base.slice(0, -2), ...app1, 0xff, 0xd9]);
    expect(checkJpeg(sneaky)).toBe("has_exif");
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
