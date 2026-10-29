# 보안 수정 보고서 R3 — SECURITY_REVIEW_R2 지적 사항 처리

| 항목 | 값 |
| --- | --- |
| 기준 커밋 | `418a6d8` (브랜치 `claude/compassionate-feynman-vvfed6`, PR #2) |
| 날짜 | 2026-10-29 |
| 확정 결정 | DP-1: 관리자 로그인을 Cloudflare Access 로 바꾼다(앱 아이디·비밀번호 로그인 제거) |
| 원격 작업 | 없음. `wrangler login`/`deploy`/`publish`/`--remote` 미사용, 외부 주소 접속 없음(npm 레지스트리만). |

`docs/SECURITY_REVIEW_R2.md` 는 고치지 않았다. 아래 줄 번호는 이 보고서와 같은 커밋 기준이다.

## 1. SR-1 ~ SR-12 처리 표

판정: **고침** = 코드를 바꿔 해결 / **해소** = 원인이 된 기능이 없어져 문제 자체가 사라짐 / **남김** = 그대로 둠(이유 기재).

| 번호 | 판정 | 처리 내용 | 근거(파일:줄) |
| --- | --- | --- | --- |
| SR-1 | **고침** | 앱 로그인·PBKDF2(Web Crypto 경로와 직접 구현 모두)·로그인 실패 잠금·앱 세션·`scripts/hash-password.mjs` 를 삭제했다. 관리자 API 는 요청마다 `Cf-Access-Jwt-Assertion` 을 RS256 서명(JWKS, 메모리 캐시, `kid` 선택)·`iss`·`aud`·`exp`·`nbf`(오차 60초)·`email` 로 검증한다. 요청당 계산은 RSA 서명 확인 1회(공개키 연산, 수 ms 이하)뿐이라 무료 요금제 CPU 10ms 문제가 사라진다. 쓰지 않는 표는 새 마이그레이션으로 지웠다. | `src/auth.ts:35-37`(설정 형식), `:54-78`(JWKS), `:80-92`(캐시·kid), `:115`(alg), `:122`(서명), `:126`(iss), `:128-129`(aud), `:131-132`(exp·nbf), `:141-150`(fail-closed·email); `src/router.ts:76-80`; `src/crypto.ts`(PBKDF2 삭제); `migrations/0002_remove_password_login.sql:4-7` |
| SR-2 | **고침** | 본문을 스트림으로 읽으며 바이트를 세고, 상한(사진 3장 x 5MB + 1MB = 16MB)을 넘는 즉시 `reader.cancel()` 후 413. `Content-Length` 가 상한보다 크면 읽기 전에 413. 헤더가 없어도(chunked) 같은 상한. 관리자 JSON 본문(`readJson`)도 같은 함수를 쓴다. | `src/http.ts:32-55`(`:34` 선언값, `:43` 누적값), `:61`; `src/reviews.ts:15`, `:187-188`; 시험 `test/api.test.ts:597`, `:621`, `:637` |
| SR-3 | **고침** | 관리자 화면의 로그인 입력 칸을 없앴다. `/api/admin/me` 가 JSON 으로 답하지 않거나 연결에 실패하면(GitHub Pages 의 404 등) 입력 칸 없이 "이 주소에서는 사용할 수 없습니다"만 보인다. 401/403/503 이면 안내 문구 + Access 로그아웃 링크만 보인다. 후기 작성 화면도 API 확인 실패 시 같은 안내만 보이고 양식을 열지 않는다. 로그아웃은 `/cdn-cgi/access/logout`. | `admin/index.html:20`, `:27-37`; `js/admin.js:153`, `:513-534`; `js/review-write.js:265-301`; 시험 `test/browser.test.ts:197`, `:208`, `:225`; 캡처 `docs/screens/admin-unavailable-360.png` |
| SR-4 | **고침** | 환경 변수 3개(`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAIL`) 각각을 없앤(또는 빈 값) 워커에 **정상 서명된 JWT** 를 보내 503 과 "공개키를 받으러 나가지 않음"을 단언한다. 가드가 없으면 다른 단계(iss·aud·email·도메인)에서 401/403 이 되거나 통과하므로 503 단언이 깨진다 — 아래 뮤테이션 4·5 에서 실제로 실패함을 확인. | `src/auth.ts:35-37`, `:141-143`; 시험 `test/api.test.ts:173-188`, `:190`, `:199`; `test/unit.test.ts:15`, `:20` |
| SR-5 | **고침** (IP 한계는 **남김**, 문서화) | Turnstile 서버 확인에서 `success === true` 이고 `hostname` 이 요청 호스트와 같을 때만 통과. 시험은 보낸 `secret`/`response`/`remoteip` 값과 hostname 불일치 거부를 확인한다. IP 단위 하루 3건 제한은 IP 변경으로 넘길 수 있고 공용 IP 이용자끼리 같이 묶이는 한계를 README 에 적었다(공개 양식은 기본 꺼짐 유지). | `src/reviews.ts:174`, `:246`; `README.md:104-107`; 시험 `test/api.test.ts:551`, `:580` |
| SR-6 | **해소** | IP 단위 로그인 잠금은 앱 로그인과 함께 사라졌다(`login_failures`·`login_locks` 표 삭제, 로그인 라우트 없음 → 404). 로그인 시도 제한은 Access(일회용 PIN)가 맡으며, 같은 공인 IP 의 제3자가 관리자를 잠글 앱 경로가 없다. | `src/router.ts:28-50`(login/logout 라우트 없음); `migrations/0002_remove_password_login.sql:5-7`; 시험 `test/api.test.ts:223` |
| SR-7 | **고침** | 정적 파일 전체(HTML 포함) `_headers` 의 `/*` 와 API 응답 공통 헤더에 `Strict-Transport-Security: max-age=31536000`. | `_headers:3`; `src/http.ts:8`; 시험 `test/browser.test.ts:243`(HTML), `test/api.test.ts:646`(API) |
| SR-8 | **고침** | 공개 사진 응답을 `Cache-Control: no-cache` 로 바꿨다(매번 서버 확인 → 숨김·삭제 즉시 반영). | `src/reviews.ts:124`; 시험 `test/api.test.ts:384`(Cache-Control 단언) |
| SR-9 | **고침** | 구간 허용 목록 방식: SOI/EOI/RSTn, APP0(JFIF 머리말일 때만), SOF0~15(JPG 예약 C8 제외)·DHT·DAC·DQT·DRI·DNL·SOS 만 허용. APP1~APP15·COM·그 밖의 구간이 있으면 거부. Chromium 캔버스 JPEG 는 ICC(APP2)를 넣으므로 후기 작성 화면이 다시 그린 JPEG 에서 APP1~15·COM 을 빼고 올린다(sRGB 라 색 변화 없음). | `src/jpeg.ts:16-19`, `:44-50`; `js/review-write.js:55-94`, `:124`; 시험 `test/api.test.ts:355`, `test/unit.test.ts:34`, `:45`, `test/browser.test.ts:112` |
| SR-10 | **고침** | `vitest` 3.2.7 → 5.0.5 (취약한 `@vitest/mocker`·`tinypool` 제거). 시험이 miniflare 를 직접 쓰므로 `miniflare`·`esbuild` 를 wrangler 가 쓰는 것과 같은 판으로 명시. `npm audit`: **found 0 vulnerabilities**(종료 코드 0). 올리지 못한 패키지 없음. | `package.json` devDependencies; `package-lock.json` |
| SR-11 | **해소** | 저장소에 로그인 비밀값이 더 이상 없다. `.dev.vars.example` 은 가짜 Access 값만 담고, 서버에는 시험용 계정·해시가 없다. 시험용 JWT 서명 키는 실행할 때마다 메모리에서 새로 만들고 저장하지 않는다. 예시 값을 실수로 대시보드에 넣어도, Access 정책·AUD(Cloudflare 가 무작위로 발급, 타인이 고를 수 없음)·이메일이 맞지 않으면 통과하지 않는다. | `.dev.vars.example:7-9`; `scripts/test-access.mjs:26-27`; `src/auth.ts:128-129`, `:148` |
| SR-12 | **해소** | 앱 세션(`admin_sessions`, 12시간, D1 수동 삭제 절차)이 없어졌다. 세션은 Access 가 관리하며(README: 세션 30일), 끊어야 할 때는 Zero Trust 대시보드에서 사용자 세션을 취소하거나 정책의 이메일을 바꾸면 된다. 앱은 매 요청 JWT 의 `exp` 와 `email` 을 다시 확인하므로 정책에서 빠진 이메일의 새 토큰은 403. | `migrations/0002_remove_password_login.sql:4`; `src/auth.ts:131`, `:148`; `README.md:143` |

## 2. 검증 결과

| 명령 | 종료 코드 | 결과 |
| --- | --- | --- |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run build` | 0 | `build ok: dist/ (정적 파일), functions/ 묶기 확인` |
| `npm test` | 0 | `Test Files 3 passed (3)`, `Tests 60 passed (60)` — API 39, 단위 13, 브라우저 8 |
| `npm audit` | 0 | `found 0 vulnerabilities` |
| `npx html-validate admin/index.html index.html review/write.html` | 0 | 출력 없음 |

시험 방식: API 시험은 `test/worker.ts` 를 esbuild 로 묶어 miniflare(workerd) 안에서 실제 `src/router.ts` 를 실행하고, 워커의 외부 요청(Access 공개키, Turnstile)은 miniflare `outboundService` 로 가로챈다. 브라우저 시험·캡처는 `wrangler pages functions build` 결과물과 정적 파일 서버(`_headers` 적용)를 miniflare 로 띄우고, 브라우저 요청에 시험용 JWT 헤더를 붙인다(Access 가장자리 역할). 운영 코드(`src/`, `functions/`)에는 인증 우회 스위치나 개발용 예외 경로가 없다. 시험 전용 입구 `test/worker.ts` 는 시각을 정하는 `X-Test-Now` 만 읽으며 운영 묶음에 들어가지 않는다.

### 필수 새 시험

| 요구 | 시험(파일:줄) |
| --- | --- |
| 헤더 없음 401 | `test/api.test.ts:105` |
| 서명 틀림 401 | `test/api.test.ts:124` |
| aud 틀림 401 | `test/api.test.ts:139` |
| iss 틀림 401 | `test/api.test.ts:146` |
| 만료 401 | `test/api.test.ts:152` |
| 다른 email 403 | `test/api.test.ts:163` |
| 환경 변수 3개 각각 없음 거부 | `test/api.test.ts:173-188` (3개 시험, 각각 없음·빈 값) |
| 팀 도메인 형식 틀림 거부 | `test/api.test.ts:199`, `test/unit.test.ts:15` |
| 정상 JWT 200 | `test/api.test.ts:116` |
| Content-Length 없는 초과 본문 413 | `test/api.test.ts:597` |
| APP13 또는 COM 이 있는 JPEG 거부 | `test/api.test.ts:355`, `test/unit.test.ts:34` |
| Turnstile hostname 불일치 거부 | `test/api.test.ts:580` |

### 뮤테이션 검증

저장소 복사본(scratchpad)에서 하나씩 무력화 → `npx vitest run test/api.test.ts test/unit.test.ts` → 복구. 무력화 전 `Tests 52 passed (52)`, 8개 모두 복구 후 `Tests 52 passed (52)`. (브라우저 시험은 제외.)

| # | 무력화한 로직 | 변경 | 결과 | 실패한 시험 |
| --- | --- | --- | --- | --- |
| 1 | 서명 검증 | `src/auth.ts:122` 줄 삭제 | 1 failed / 51 passed | 서명이 틀리면 401 |
| 2 | aud 확인 | `src/auth.ts:129` 줄 삭제 | 1 failed / 51 passed | aud 가 다르면 401 |
| 3 | email 확인 | `src/auth.ts:148` 이메일 비교 제거 | 1 failed / 51 passed | 관리자가 아닌 email 은 403 |
| 4 | fail-closed 가드 | `src/auth.ts:36-37`(AUD·이메일 누락/형식 거부) 삭제 | 4 failed / 48 passed | 환경 변수 CF_ACCESS_AUD 없음, 환경 변수 ADMIN_EMAIL 없음, AUD·EMAIL 형식, 단위 「AUD 는 64자리…」 |
| 5 | 팀 도메인 형식 검사 | `src/auth.ts:35` 줄 삭제 | 3 failed / 49 passed | 팀 도메인 형식 틀림, 환경 변수 CF_ACCESS_TEAM_DOMAIN 없음, 단위 「팀 도메인은 …형식만」 |
| 6 | 스트림 크기 상한 | `src/http.ts:43` → `if (false) {` | 1 failed / 51 passed | Content-Length 없이(chunked) 초과 본문 413 (`expected 400 to be 413`) |
| 7 | Origin 확인 | `src/http.ts:75` → `return true;` | 1 failed / 51 passed | 잘못된 Origin 은 정상 JWT 가 있어도 403 |
| 8 | 공개 목록 승인 조건 | `src/reviews.ts` 목록 쿼리 `status = 'published' AND` 제거 | 2 failed / 50 passed | 제출된 후기는 승인 대기…공개 목록에 나오지 않는다, 공개 양식 승인 대기 저장 |

주: 첫 회차에서 chunked 413 시험이 관계없는 뮤테이션(2, 5)에서도 간헐적으로 실패했다. 서버가 413 을 먼저 보내고 연결을 닫을 때 시험 클라이언트가 아직 쓰는 중이면 생기는 경합이었다. 시험 스트림이 상한 + 1MB 를 보낸 뒤 3초 쉬도록 고쳐(`test/api.test.ts:597-619`) 경합을 없앴고, 위 표는 고친 뒤 다시 돌린 결과다(이후 단독 반복 5회, 전체 반복 모두 통과).

### 남은 `pbkdf2|password|비밀번호` 검색 결과

`grep -r -n -i -E "pbkdf2|password|비밀번호" --exclude-dir=node_modules --exclude-dir=.git .` 에 남는 줄과 이유:

| 위치 | 남아도 되는 이유 |
| --- | --- |
| `README.md:35`, `:75`, `:76` | "비밀번호 입력 칸·로그인이 없다"는 설명 |
| `test/browser.test.ts:204`, `:232` | 화면에 `input[type=password]` 가 0개임을 확인하는 시험 |
| `test/api.test.ts:224` | 없어진 `/api/admin/login` 이 404 임을 확인하는 시험의 가짜 본문 |
| `docs/SECURITY_REVIEW_R2.md` (여러 줄) | 이전 검수 보고서 원문(고치지 않기로 함) |

## 3. 운영 전에 사람이 할 일

README 「나중에 Cloudflare 에 올릴 때 할 일」 2·3절: Zero Trust 팀 도메인, 자체 호스팅 Access 애플리케이션(`/admin*`, `/api/admin*`, pages.dev 주소 포함), 허용 이메일 1개, 일회용 PIN, 세션 30일, AUD 확인, 환경 변수 3개, 배포 뒤 확인, GitHub Pages 는 이전 완료 후 끄기.
