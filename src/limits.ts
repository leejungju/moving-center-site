// 후기 사진 크기 상한. 이 파일에서만 정한다.
// 서버 검사(src/jpeg.ts, src/reviews.ts), 오류 문구, 후기 작성 화면(/api/review/check 응답으로 받음)이 모두 이 값을 쓴다.
// 무료 요금제(요청당 CPU 10ms)에서 사진 3장을 해석·검사할 수 있는 크기로 정했다.

export const MAX_PHOTOS = 3;
/** 사진 1장 상한(바이트): 500KB */
export const MAX_PHOTO_BYTES = 500 * 1024;
/** 글·양식 구분자 등을 위한 여유(바이트): 512KB */
export const BODY_SLACK_BYTES = 512 * 1024;
/** 후기 제출 본문 상한: 사진 3장 x 500KB + 여유 512KB */
export const MAX_BODY_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + BODY_SLACK_BYTES;
/** 화면·오류 문구에 쓰는 사진 1장 상한 표기 */
export const MAX_PHOTO_LABEL = `${MAX_PHOTO_BYTES / 1024}KB`;
