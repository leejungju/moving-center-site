// 올라온 사진 검사: JPEG 인지, 크기가 맞는지, EXIF(APP1) 구간이 없는지

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type JpegCheck = "ok" | "not_jpeg" | "too_large" | "has_exif";

function isStandalone(marker: number): boolean {
  // TEM, RST0~7 은 길이 필드가 없다.
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

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
    if (marker === 0xe1) return "has_exif"; // APP1: EXIF, XMP
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
