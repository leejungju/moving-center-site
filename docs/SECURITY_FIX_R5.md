# 보안 수정 보고서 R5 — R4 지적 사항(SR4-1 ~ SR4-8) 처리

| 항목 | 값 |
| --- | --- |
| 기준 | `bff91f2` (R4 보고서 추가 커밋, 브랜치 `claude/compassionate-feynman-vvfed6`, PR #2) |
| 범위 | `docs/SECURITY_REVIEW_R4.md` 의 SR4-1 ~ SR4-8. 그 밖의 기능·화면 구성·문구, 상호·대표번호·사업자등록번호·웹사이트 주소·canonical 은 바꾸지 않음 |
| 날짜 | 2026-10-29 |
| 전제 | Workers 무료 요금제(요청당 CPU 10ms). 원격 작업(wrangler login/deploy/publish/`--remote`)·외부 주소 접속 없음(localhost, npm 레지스트리만) |

시작 시 `git log --oneline -3` 원문:

```
bff91f2 보안 재검수 보고서 R4 추가 (docs/SECURITY_REVIEW_R4.md)
a385e12 관리자 로그인을 Cloudflare Access 로 전환하고 보안 검수 R2 지적 사항 수정
418a6d8 보안 검수 보고서 R2 추가 (docs/SECURITY_REVIEW_R2.md)
```

## 1. 항목별 처리

| 번호 | 처리 | 내용 | 근거(파일:줄) |
| --- | --- | --- | --- |
| SR4-1 | **고침** | 장당 상한 5MB → **500KB(512000)**, 본문 상한 16MB → **3 x 512000 + 524288 = 2,060,288 바이트**. 상한은 `src/limits.ts` 한 곳에서만 정의하고 서버 검사·서버 오류 문구(`사진 한 장은 500KB 이하여야 합니다.`)·작성 화면이 모두 이 값을 쓴다. 작성 화면은 상수를 따로 두지 않고 `/api/review/check` 응답의 `maxPhotoBytes` 를 받는다(값이 없으면 양식을 열지 않음). 화면은 긴 변 1600px 에서 품질 0.85 → 0.75 → 0.65 → 0.55 → 0.5, 그래도 넘으면 1280px, 1024px 로 같은 순서를 반복하고, 끝까지 넘으면 "사진이 너무 큽니다. 다른 사진을 골라 주세요." 를 보인다. 측정: 사진 3장 x 약 500KB 제출 workerd 3.8~7ms(아래 4절). | `src/limits.ts:5-13`, `src/jpeg.ts:6,26`, `src/reviews.ts:6,14,150,155,186,211,214`, `js/review-write.js:10-15,102-146,191,300-304`, `README.md:34` |
| SR4-2 | **고침** | `normalizeEmail`: 앞뒤 공백 제거 → `[\x21-\x7e]` 만 허용(아니면 null) → `A-Z` 만 소문자로. `ADMIN_EMAIL` 이 ASCII 가 아니면 설정 거부(503), JWT `email` 이 ASCII 가 아니면 403. 켈빈 기호 `Kim@example.com` 은 이제 403. | `src/auth.ts:24-25,33-38,44,47,165-169` |
| SR4-3 | **고침** | 받아오기 실패(비 200, JSON 아님, `keys` 배열 아님, 연결 실패·5초 시간 초과)와 **읽을 수 있는 키 0개**는 정상 캐시에 넣지 않고 이전 캐시도 버리며 30초 음성 캐시(`keyFailure`)에 기록 — 그동안은 다시 받지 않고 관리자 요청 거부(401). 키 1개 이상인 정상 응답만 60초 캐시(`JWKS_TTL_MS` 1시간 → 60초, 모르는 kid 도 60초 안에는 재요청 없음). | `src/auth.ts:11-15,60-62,71,94-109` |
| SR4-4 | **고침** | EOI(FFD9) 뒤에 1바이트라도 남으면 `not_jpeg`. APP0 는 길이 정확히 16 + `JFIF\0` + 미리보기 가로·세로 0 일 때만 허용(긴 APP0·미리보기 그림·JFXX 거부). | `src/jpeg.ts:3-4,21-23,38,47-49` |
| SR4-5 | **고침** | 시험 추가(아래 2절 목록). 시험 수 60(R4) → **78**. | `test/api.test.ts`, `test/unit.test.ts`, `test/browser.test.ts`, `test/helpers.ts`, `test/worker.ts` |
| SR4-6 | **고침** | README Access 절차: 경로를 `admin`, `admin/*`, `api/admin/*` 세 줄로 풀어 `/admin`·`/admin/`·`/admin/` 하위·`/api/admin/` 하위를 모두 덮게 함; pages.dev 주소와 미리보기 주소 `*.moving-center-site.pages.dev` 에도 같은 세 경로(모두 9줄); www 없는 주소를 붙일 때도 같은 경로; 환경 변수 3개는 **프로덕션과 미리보기 두 곳 모두**; 배포 뒤 첫 확인을 "로그인하지 않은 창에서 `/admin` → `/admin/` → `/api/admin/reviews` 순서로 열어 모두 Access 화면이 나오는지(pages.dev·미리보기 주소도)"로 바꿈. 대시보드에서 실제 매칭이 맞는지는 계정이 없어 확인하지 못했다(배포 뒤 확인 목록으로 확인하게 둠). | `README.md:141-151,156,166-170` |
| SR4-7 | **고침** | 후기 본문을 청크 배열에 모아 이어 붙이던 복사(`readBodyLimited`)를 없애고, `limitedBodyStream` 이 만든 스트림을 `formData()` 에 바로 넘긴다. Content-Length 가 있으면 상한 초과 시 바로 413, 아니면 런타임 내장 `FixedLengthStream` 으로 실제 길이를 강제(더 길면 첫 조각 뒤 읽기 중단, 짧으면 오류 → 400). Content-Length 가 없을 때(chunked)만 JS `TransformStream` 으로 세다가 상한에서 멈춤 → 413. 처음에는 모든 경우를 JS 로 셌는데 workerd 에서 사진 3장 본문 처리가 약 12ms 로 **이전보다 느려져**(4절 표) 내장 스트림으로 바꿨다. 메모리(Node 측정, 3 x 약 500KB): 사진 3장 `arrayBuffer` 까지 살아 있는 ArrayBuffer **4.39MB → 2.92MB**(본문 1.46MB 복사본 1개 감소). | `src/http.ts:59-88`, `src/reviews.ts:186-195`, `test/worker.ts:7-37`, `test/api.test.ts:774-788` |
| SR4-8 | **남김** | R4 판단대로 401/403/503 구분은 그대로 둔다. 503 은 README 의 관리자 자가 진단에 쓰이고, 403 은 요청자 자신의 이메일에 대한 답이라 열거 가치가 없다. SR4-2 로 ASCII 아닌 `ADMIN_EMAIL` 도 503 이 된다(설정 오류로 보는 것이 맞음). | `src/auth.ts:155-170`, `src/router.ts:101-105` |

### 남는 한계

- **Content-Length 없는(chunked) 큰 본문**: JS 로 세는 경로라 3 x 500KB 본문 처리에 workerd 측정 약 12~15ms 가 들어 무료 요금제 10ms 를 넘을 수 있다. 브라우저의 `fetch(FormData)` 는 항상 Content-Length 를 보내므로(작성 화면 경로) 고객 제출은 해당되지 않고, API 를 직접 chunked 로 부르는 사람의 그 요청만 실패(1102)한다. 상한(2,060,288 바이트)은 그대로 지켜진다.
- **"사진이 너무 큽니다" 안내**: Chromium 에서는 긴 변 1024px·품질 0.5 이면 완전 무작위 잡음 사진도 약 40만 바이트라 500KB 를 넘지 않아, 이 안내는 다른 브라우저(색 하위 표본화를 하지 않는 경우 등)용 안전장치다. 시험은 서버 응답의 상한을 20KB 로 바꿔 화면 경로를 확인한다(`test/browser.test.ts:157-218`).
- **CPU 절대값**: 이 컨테이너의 workerd 는 3천만 회 루프가 161~177ms(R4 측정 환경은 21ms)로 느린 편이다. 운영 Cloudflare 의 CPU 와 다를 수 있다. 같은 기계에서 이전 방식(본문 이어 붙이기) 본문 처리 8.1ms, 새 방식 2.1ms 로 비교했다.
- **Access 대시보드 경로 표기**: 계정이 없어 실제 대시보드에서 `admin` 과 `admin/*` 가 의도대로 매칭되는지 확인하지 못했다. README "3. 배포 뒤 확인할 것" 첫 항목으로 배포 직후 확인한다. 어느 경우든 서버는 JWT 없는 요청을 거부한다(fail-closed).

## 2. 추가·변경한 시험

| 파일:줄 | 시험 |
| --- | --- |
| `test/api.test.ts:164` | exp 경계: 만료 + 60초의 1ms 전 200, 그 순간·1ms 뒤 401 |
| `test/api.test.ts:172` | nbf 경계: nbf - 60초의 1ms 전 401, 그 순간·1ms 뒤 200 |
| `test/api.test.ts:180` | 이메일 앞뒤 공백·ASCII 대소문자 무시 200, 켈빈 기호·점 없는 ı·키릴 а·제로폭·전각 @·널 문자 403 |
| `test/api.test.ts:194` | ASCII 아닌 `ADMIN_EMAIL` 이면 정상 JWT 도 503 |
| `test/api.test.ts:265` | JWKS 500 / 302 / JSON 아님 / `keys` 배열 아님 / 연결 실패 → 401, 30초 안 재요청 0회, 정상 복구 뒤에도 29.999초까지 401, 30초에 200 |
| `test/api.test.ts:286` | 정상 캐시가 지난 뒤 실패하면 이전 키를 쓰지 않고 401, 30초 뒤 회복 |
| `test/api.test.ts:302` | 빈 키 목록·n 깨진 키·EC 키만 → 401(캐시 안 함), 정상 키로 30초 뒤 회복, 회복 뒤 60초 캐시 |
| `test/api.test.ts:471` | 장당 512001 바이트 거부(문구 `사진 한 장은 500KB 이하여야 합니다.`), 512000 바이트 3장 통과 |
| `test/api.test.ts:485` | EOI 뒤 HTML·EXIF JPEG 덧붙임, 긴 APP0, 미리보기 있는 APP0 → 400 |
| `test/api.test.ts:505` | `/api/review/check` 가 `maxPhotoBytes: 512000` 을 돌려줌 |
| `test/api.test.ts:767` | 500KB 3장 본문 201 |
| `test/api.test.ts:774` | 선언 길이보다 긴·짧은 본문 거부(긴 본문은 첫 조각 뒤 중단), chunked 는 상한에서 중단 |
| `test/api.test.ts:790` | 양식 전체가 상한 초과 → Content-Length 있을 때·chunked 모두 413, 저장 0건 |
| `test/unit.test.ts:26,32` | ASCII 아닌 관리자 이메일 거부, `normalizeEmail` |
| `test/unit.test.ts:41,48` | 공용 상수 값, 작성 화면 스크립트에 상한 숫자가 없고 서버 값을 씀 |
| `test/unit.test.ts:81,100,118` | APP0 형식, EOI 뒤 바이트, 512000/512001 |
| `test/browser.test.ts:157` | 1600x1200 잡음 PNG → 1280x960·500KB 이하로 저장, 상한을 넘으면 "사진이 너무 큽니다" 안내 |

## 3. 검증 결과 원문

### 3-1. typecheck / lint / build / test / audit / html-validate

| 명령 | 종료 코드 | 결과 |
| --- | --- | --- |
| `npm run typecheck` | 0 | `tsc -p tsconfig.json && tsc -p tsconfig.test.json && tsc -p tsconfig.browser.json` |
| `npm run lint` | 0 | `eslint .` |
| `npm run build` | 0 | `build ok: dist/ (정적 파일), functions/ 묶기 확인` |
| `npm test` | 0 | `Test Files  3 passed (3)` / `Tests  78 passed (78)` / `Duration  58.42s` |
| `npm audit` | 0 | `found 0 vulnerabilities` |
| `npx html-validate admin/index.html index.html review/write.html` | 0 | (출력 없음) |

### 3-2. 뮤테이션 (복사본, `npx vitest run test/api.test.ts test/unit.test.ts`, 기준 69개 통과)

| # | 무력화 | 변경 | 무력화 결과 | 실패한 시험 | 복구 뒤 |
| --- | --- | --- | --- | --- | --- |
| M1 | 장당 500KB 검사 | `src/reviews.ts` `if (file.size > MAX_PHOTO_BYTES) …` 삭제 + `src/jpeg.ts` `if (bytes.length > MAX_PHOTO_BYTES) return "too_large";` 삭제 | 2 failed / 67 passed, exit=1 | 「500KB(512000 바이트)를 넘으면 거부」, 「JPEG 가 아니거나 500KB 를 넘거나 4장 이상이면 거부한다」 | 69 passed, exit=0 |
| M2 | EOI 뒤 데이터 검사 | `return i + 2 === bytes.length ? "ok" : "not_jpeg";` → `return "ok";` | 2 failed / 67 passed, exit=1 | 「EOI 뒤에 데이터가 붙었거나 APP0 형식이 틀린 JPEG 는 거부한다」, 「EOI 뒤에 바이트가 남아 있으면 거부」 | 69 passed, exit=0 |
| M3 | ASCII 이메일 검사 | `if (!ASCII_EMAIL_CHARS.test(text)) return null;` 삭제 | 3 failed / 66 passed, exit=1 | 「ADMIN_EMAIL 에 ASCII 가 아닌 글자가 있으면 정상 JWT 도 거부한다」(`expected 200 to be 503`), 「관리자 이메일에 ASCII 가 아닌 글자가 있으면 거부한다」, 「이메일 비교용 정규화…」 | 69 passed, exit=0 |
| M4 | JWKS 음성 캐시 | `if (keyFailure && … < JWKS_FAILURE_TTL_MS) return null;` 삭제 | 3 failed / 66 passed, exit=1 | 「공개키 받아오기가 실패하면 거부하고, 30초 동안은 다시 받지 않는다」(`expected 4 to be 1`), 「빈 공개키 목록…」(`expected 2 to be 1`), 「정상 캐시가 지난 뒤…」(`expected 200 to be 401`) | 69 passed, exit=0 |
| M5 | 빈 키 목록 거부 | `if (!keys \|\| keys.size === 0) {` → `if (!keys) {` | 1 failed / 68 passed, exit=1 | 「빈 공개키 목록(읽을 수 있는 키 0개)은 캐시하지 않고 거부하며, 그 뒤 정상 키가 오면 회복한다」(`expected 401 to be 200`) | 69 passed, exit=0 |

## 4. CPU 측정 (workerd)

방법: miniflare(workerd) 안의 탐침 워커가 운영과 같은 `handleApi` 를 부른다. D1·R2 는 I/O 없는 가짜로 바꿔 대기 시간을 빼고, 본문은 워커 메모리에 미리 넣어 전송 대기를 뺐다(따라서 측정값 ≈ CPU 시간). 요청에는 브라우저와 같이 Content-Length 를 붙였다. 사진은 4번 실험의 실제 저장본(510,878 바이트) 3장, 본문 1,533,852 바이트. workerd 시계는 1ms 단위라 "1회" 표본(10회)과 "20회·50회 평균" 표본(10개)을 함께 적는다. 같은 측정을 두 번 돌렸다.

| 작업 | 1회 x 10 (최소 / 중앙 / 최대) | 평균 표본 x 10 (최소 / 중앙 / 최대) | 10ms 대비 |
| --- | --- | --- | --- |
| 후기 제출, 사진 3장 x 500KB (1차) | 5 / 5 / 6 ms | 20회 평균 4.10 / 4.55 / 5.85 ms | **통과** (약 절반) |
| 후기 제출, 사진 3장 x 500KB (2차) | 5 / 6 / 7 ms | 20회 평균 3.80 / 4.45 / 4.80 ms | **통과** |
| 후기 제출, 사진 0장 (1차 / 2차) | 0 / 0 / 1 ms | 50회 평균 0.30 / 0.34 / 0.46, 0.14 / 0.25 / 0.34 ms | 통과 |
| 관리자 API 1건(`GET /api/admin/reviews`, JWT 검증·공개키 캐시 적중) (1차 / 2차) | 0 / 0 / 1 ms | 50회 평균 0.10 / 0.13 / 0.18, 0.08 / 0.10 / 0.18 ms | 통과 |

본문 처리 구간 비교(사진 3장 본문, 20회 평균의 중앙값): 내장 `formData()` 만 1.48ms, `FixedLengthStream` 경유 2.10ms(채택), 이전 방식(청크 모아 이어 붙이기) 8.10ms, JS `TransformStream` 경유 11.65ms(처음 시도, 버림), JPEG 검사 3장 1.48ms. Content-Length 없이(chunked) 같은 본문을 보내면 전체 12.5~23ms 로 10ms 를 넘는다(1절 남는 한계).

## 5. 실제 브라우저 경로 실험

운영 Functions 묶음 + `dist/` 를 miniflare 로 띄우고(`scripts/local-server.mjs`) Playwright Chromium 으로 후기 링크를 열어 `#photo-input` 에 3장을 한 번에 넣고 제출, 관리자 API 로 저장본을 받았다. 시험 사진은 PIL 로 만든 4000x3000, 품질 95, EXIF(기종 + GPS 위도·경도) 포함.

```
사진 준비 시간 8248ms, 미리보기 3장, 화면 오류 문구: ""
제출 결과: "후기가 접수되었습니다. 업체 확인 후 홈페이지에 올라갑니다. 감사합니다."
저장본 1 (A_normal.jpg, 원본 4369399B): 96648B, 1600x1200, checkJpeg=ok, Exif=false, GPS=false, TestPhone=false
저장본 2 (B_detail.jpg, 원본 9698122B): 510878B, 1600x1200, checkJpeg=ok, Exif=false, GPS=false, TestPhone=false
저장본 3 (C_noise.jpg, 원본 14084397B): 404447B, 1600x1200, checkJpeg=ok, Exif=false, GPS=false, TestPhone=false
저장된 사진 수: 3
```

A = 그라데이션·건물 모양·약한 잡음(일반 사진), B = 잎·잔디 같은 세부 + 잡음, C = 완전 무작위 잡음(최악). 세 장 모두 성공, 1600x1200 유지. 줄이기 단계 확인용 추가 실험(무작위 잡음 PNG, 축소 평균 효과가 적어 더 어려움):

```
저장본 1 (D_noise1600.png, 1600x1200): 461753B, 1280x960, checkJpeg=ok
저장본 2 (E_noise2000.png, 2000x1500): 458557B, 1280x960, checkJpeg=ok
저장본 3 (F_noise1024.png, 1024x768): 450614B, 1024x768, checkJpeg=ok
```

## 6. 바뀐 파일과 범위

`git diff --stat bff91f2..HEAD` 와 파일별 이유는 이 문서를 올린 커밋의 PR 보고에 함께 적는다. `docs/SECURITY_REVIEW_R4.md` 는 고치지 않았다.
