// 올라온 사진 검사: JPEG 인지, 크기가 맞는지, 사진 정보(메타데이터) 구간이 없는지
//
// 영상에 필요한 구간과 APP0(JFIF)만 허용한다. APP1~APP15(EXIF, XMP, IPTC 등), COM(주석),
// 그 밖에 모르는 구간이 하나라도 있으면 거부한다.

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type JpegCheck = "ok" | "not_jpeg" | "too_large" | "has_metadata";

function isStandalone(marker: number): boolean {
  // RST0~7 은 길이 필드가 없다.
  return marker >= 0xd0 && marker <= 0xd7;
}

/** 영상 데이터에 필요한 구간: SOF0~15(DHT·JPG 제외), DHT, DAC, DQT, DRI, DNL, SOS */
function isImageSegment(marker: number): boolean {
  if (marker >= 0xc0 && marker <= 0xcf) return marker !== 0xc8; // C4=DHT, CC=DAC 포함, C8(JPG 예약)은 제외
  return marker === 0xdb || marker === 0xdd || marker === 0xdc || marker === 0xda;
}

const JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"

export function checkJpeg(bytes: Uint8Array): JpegCheck {
  if (bytes.length > MAX_PHOTO_BYTES) return "too_large";
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return "not_jpeg";

  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return "not_jpeg";
    const marker = bytes[i + 1];
    if (marker === undefined) return "not_jpeg";
    if (marker === 0xff) {
      i += 1; // 채움 바이트
      continue;
    }
    if (marker === 0xd9) return "ok"; // EOI
    if (isStandalone(marker)) {
      i += 2;
      continue;
    }
    if (i + 3 >= bytes.length) return "not_jpeg";
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2) return "not_jpeg";
    if (marker === 0xe0) {
      // APP0 는 JFIF 머리말만 받는다(JFXX 미리보기 그림 등은 거부).
      if (length < 2 + JFIF.length || JFIF.some((b, k) => bytes[i + 4 + k] !== b)) return "has_metadata";
    } else if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
      return "has_metadata"; // APP1~APP15, COM
    } else if (!isImageSegment(marker)) {
      return "has_metadata"; // 그 밖에 모르는 구간
    }
    let next = i + 2 + length;
    if (next > bytes.length) return "not_jpeg";
    if (marker === 0xda) {
      // SOS 뒤의 압축 데이터는 다음 마커가 나올 때까지 건너뛴다.
      while (next < bytes.length - 1) {
        if (bytes[next] === 0xff) {
          const m = bytes[next + 1]!;
          if (m !== 0x00 && !(m >= 0xd0 && m <= 0xd7)) break;
        }
        next += 1;
      }
      if (next >= bytes.length - 1) return "ok"; // EOI 없이 끝난 파일도 내용 검사는 끝났다.
    }
    i = next;
  }
  return "ok";
}
