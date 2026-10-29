# 보안 재검수 보고서 R4 — PR #2 (Cloudflare Access 전환 뒤)

| 항목 | 값 |
| --- | --- |
| 검수 기준 해시 | `a385e121852d35081a3b3c8d3a46e74fb6e16aee` (`a385e12`, 브랜치 `claude/compassionate-feynman-vvfed6`, PR #2) |
| 검수 범위 | `418a6d8..a385e12` 변경분 전체 + Cloudflare Access 인증 전체 |
| 검수 모델 | claude-fable-5-1 (세션 정보 `session_context.model` / `last_served_model` 기준) |
| 날짜 | 2026-10-29 |
| 검수 방식 | 코드 정독 + 로컬 실행(npm ci / typecheck / lint / build / test / audit) + 저장소 복사본(`/tmp` 아래 scratchpad)에서 탐침·뮤테이션·브라우저 실험. 기존 파일은 고치지 않음. 원격 작업(wrangler login/deploy/publish/`--remote`)과 외부 주소 접속 없음(localhost, npm 레지스트리만). |

`git log --oneline -3` 원문:

```
a385e12 관리자 로그인을 Cloudflare Access 로 전환하고 보안 검수 R2 지적 사항 수정
418a6d8 보안 검수 보고서 R2 추가 (docs/SECURITY_REVIEW_R2.md)
a386ca7 고객 후기·관리자 화면 추가 (Cloudflare Pages 이전 준비, 로컬 전용)
```

`docs/SECURITY_REVIEW_R2.md`, `docs/SECURITY_FIX_R3.md` 를 먼저 읽었다. R3 가 "고침/해소"로 표시한 SR-1~SR-12 가 실제 코드에서 그렇게 돼 있는지도 함께 확인했다(아래 3절 판정 표에 흡수).

## 0. 먼저 실행 — 원문 보고

| 명령 | 종료 코드 | 결과 원문 |
| --- | --- | --- |
| `npm ci` | 0 | (npm 새 버전 안내만 출력) |
| `npm run typecheck` | 0 | `tsc -p tsconfig.json && tsc -p tsconfig.test.json && tsc -p tsconfig.browser.json` |
| `npm run lint` | 0 | `eslint .` |
| `npm run build` | 0 | `build ok: dist/ (정적 파일), functions/ 묶기 확인` |
| `npm test` | 0 | `Test Files  3 passed (3)` / `Tests  60 passed (60)` / `Duration  43.55s` |
| `npm audit` | 0 | `found 0 vulnerabilities` |

## 1. 발견 사항 표

심각도: 높음 = 관리자 권한·고객 정보가 위험해지거나 운영 기능이 막힘 / 중간 = 조건이 맞으면 실제 피해 또는 정상 이용 실패 / 낮음 = 방어 깊이·위생 / 정보 = 판단 근거만 기록.

| 번호 | 심각도 | 위치 | 내용 | 재현 방법 | 고칠 방향 |
| --- | --- | --- | --- | --- | --- |
| SR4-1 | **중간** | `src/reviews.ts:187-218`, `src/jpeg.ts:54-64`, `js/review-write.js:9,127` | **후기 제출 1건의 CPU 시간이 무료 요금제 10ms 를 넘을 수 있다.** 측정(7번 항목): 사진 3장 x 5MB 는 workerd 안에서 양식 해석 36~58ms + JPEG 구간 검사 26~32ms(합 60~90ms), 3장 x 2MB 는 15~17ms, 3장 x 1MB 는 7~9ms, 3장 x 300KB 는 2~4ms. 브라우저는 1600px 로 줄이지만 허용 상한이 장당 약 5MB(`MAX_BYTES - 64KB`, 품질 0.4 까지만 낮춤)라서 세부가 많은 사진 3장은 한도를 넘길 수 있다. 넘으면 Cloudflare 가 요청을 끊어(오류 1102) 고객은 "보내지 못했습니다"만 보고, 관리자는 원인을 알 수 없다. 관리자 API 는 요청당 0.05~0.2ms 로 문제 없다. | 복사본에서 miniflare 탐침 워커로 `formData()` + `checkJpeg` x3 시간을 `performance.now()` 로 측정(7번 항목 표). 운영 무료 요금제에서는 1102 오류로 나타나며 로컬에서는 재현되지 않는다. | 서버 장당 상한을 5MB → 1MB 안팎으로 낮추고(`MAX_PHOTO_BYTES`, `MAX_BODY_BYTES` 연동), 브라우저가 품질을 낮춰 장당 1MB 이하가 될 때까지 다시 그리게 한다(`MAX_SIDE` 1280 권장). `checkJpeg` 의 SOS 뒤 훑기를 `indexOf(0xff)` 로 바꾸면 약 1.7배 빨라진다(측정). 또는 유료 요금제(요청당 30초)로 올린다. |
| SR4-2 | 낮음 | `src/auth.ts:34`, `:148`, `:151` | 이메일 비교가 `toLowerCase()` 결과로 이뤄져 **유니코드 특수 소문자화**가 통과한다. 탐침: `ADMIN_EMAIL=kim@example.com` 일 때 JWT `email` 이 `Kim@example.com`(켈빈 기호 K) 이면 200. 공백·전각 `@`·제로폭·널 문자·터키어 İ 는 모두 403(아래 탐침 원문). Access 정책이 이메일 1개만 허용하므로 Access 가 그런 이메일로 로그인시킬 일은 없어 실질 위험은 낮지만, 정책을 "도메인 전체 허용" 등으로 넓히는 순간 두 번째 방어선이 약해진다. | 복사본 `test/r4probe.test.ts` "email 비교 우회 시도". | `claims.email` 이 ASCII(`/^[\x21-\x7e]+$/`)가 아니면 403. 소문자화는 ASCII 범위만(`replace(/[A-Z]/g, …)`). |
| SR4-3 | 낮음 | `src/auth.ts:54-60`, `:86-91` | JWKS 받아오기에 **음성(실패) 캐시가 없다.** 응답이 500/302/JSON 아님/`keys` 배열 아님이면 캐시를 갱신하지 않아, 그동안 들어오는 모든 정상 형식 JWT 요청마다 `…/cdn-cgi/access/certs` 를 다시 부른다(탐침: 3요청 → 3회). 반대로 200 이지만 키를 하나도 읽지 못한 응답(`keys: []`, n/e 깨짐)은 빈 목록으로 60초 캐시돼 그동안 정상 토큰도 401 이다(탐침: 즉시 401, 30초 뒤 401, 61초 뒤 200). 모두 거부(fail-closed)이므로 보안 사고는 아니고, 외부 요청 1:1 증폭과 최대 60초 관리자 거부가 남는다. 모르는 `kid` 반복은 60초에 1회로 잘 묶인다(탐침: 같은 시각 50회 → 0회, 61초 간격 10회 → 10회). `fetch` 에 시간 제한도 없다. | 복사본 `test/r4probe.test.ts` "JWKS 받아오기 실패". | 실패도 10~30초 음성 캐시; `keys` 가 비면 이전 캐시를 유지; `fetch` 에 `AbortSignal.timeout(5000)`. |
| SR4-4 | 낮음 | `src/jpeg.ts:36`, `:44-46`, `:63` | `checkJpeg` 가 **EOI(FFD9) 뒤의 바이트와 APP0(JFIF) 구간 안의 내용을 검사하지 않는다.** 탐침: EOI 뒤에 EXIF 가 든 JPEG 를 통째로 붙여도 `ok`, HTML 을 붙여도 `ok`, APP0 길이를 늘려 60KB 임의 데이터를 넣어도 `ok`. 브라우저 경로는 다시 그린 파일이라 해당 없음(6번 항목). API 를 직접 부르는 사람이 임의 데이터를 사이트 주소 아래 저장·공개할 수 있다(`image/jpeg` + `nosniff` + CSP `default-src 'none'` 이라 HTML 로 해석되지는 않음). | 복사본 `test/r4probe.test.ts` "EOI 뒤에 붙은 데이터". | EOI 뒤에 바이트가 남으면 거부; APP0 는 JFIF 표준 길이(16, 썸네일 없음)만 허용. |
| SR4-5 | 낮음 | `test/api.test.ts` | 시험 공백: (1) JWKS 받아오기 실패·형식 오류 때 거부되는지 직접 다루는 시험이 없다(뮤테이션 B 는 "모르는 kid" 시험이 대신 잡았다). (2) 이메일 유니코드·공백 변형 시험 없음. (3) EOI 뒤 데이터 시험 없음. (4) `exp`/`nbf` 경계값(정확히 60초) 시험 없음. | 10번 항목 표, 2번 항목 탐침. | 위 네 가지를 `test/api.test.ts` 에 추가. |
| SR4-6 | 낮음 | `README.md:141-142`, `:147`, `:157-163` | Access 설정 절차의 빈틈: (1) 경로를 `/admin*`, `/api/admin*` 와일드카드 하나로 적었는데 Cloudflare 대시보드의 와일드카드 지원 여부·표기를 이 세션에서 확인할 수 없었다(외부 접속 금지). (2) apex 도메인(`kor2404.co.kr`, www 없음)을 Pages 에 붙이면 Access 가 덮지 않는다. (3) 미리보기 환경 변수가 "필요하면"이라 미리보기 주소에서는 503 이 된다(fail-closed 라 안전). (4) "배포 뒤 확인" 목록에 `/admin/`(끝 슬래시), `/admin/x`, pages.dev 주소, 쿠키 없이 `/api/admin/reviews` 가 포함돼 있지 않다. 서버가 JWT 없는 요청을 모두 거부하므로 어느 경우도 관리자 화면이 **열리지는 않는다**(9번 항목). | README 정독. | 경로를 `/admin`, `/admin/*`, `/api/admin/*` 로 풀어 적고 대시보드에서 매칭 결과를 확인하는 항목 추가; apex 도메인은 붙이지 않거나 같이 등록; 배포 뒤 확인 목록에 위 네 주소 추가; 미리보기 환경 변수는 "넣는다"로 바꾸거나 "미리보기에서는 관리자 화면을 쓰지 않는다"로 명시. |
| SR4-7 | 낮음 | `src/http.ts:36-55`, `src/reviews.ts:192`, `:212` | 16MB 본문 처리 때 메모리에 복사본이 서너 개 생긴다(청크 배열 + 이어 붙인 배열 + `formData()` 가 만든 파일 + `arrayBuffer()`). 약 50~70MB 로 Workers 한도 128MB 안이지만 여유가 작다. 상한 자체는 chunked·가짜 Content-Length·gzip 모두에서 지켜진다(5번 항목). | 코드 정독. | SR4-1 과 같이 상한을 낮추면 자연히 해결. 또는 청크를 이어 붙이지 않고 `ReadableStream` 을 `TransformStream` 으로 세며 `formData()` 에 바로 넘김. |
| SR4-8 | 정보 | `src/auth.ts:141-150`, `src/router.ts:76-78` | 401/403/503 구분이 알려 주는 것: 503 = 환경 변수 미완료, 401 = JWT 없음/검증 실패, 403 = 다른 이메일. Access 가 정상이면 공격자는 가장자리에서 막혀 이 응답을 보지 못한다. Access 가 빠진 상태에서도 503 은 "설정이 덜 됐다"는 사실만 알려 주고 들어갈 길은 없으며, 403 은 공격자가 이미 아는 자기 이메일에 대한 답이라 열거 가치가 없다(4번 항목). 503 문구는 README 의 관리자 자가 진단에 쓰인다. | — | 그대로 둔다. |

### 배포 전에 반드시 고칠 것

1. **SR4-1** 후기 제출 CPU 시간 — 무료 요금제로 운영하면 사진이 큰 후기가 실패한다. 상한 두 개(장당 1MB 안팎, 브라우저 목표 크기)만 바꾸면 되는 작은 수정이다. 유료 요금제로 올리기로 하면 이 항목은 배포 뒤로 미뤄도 된다.

### 배포 뒤 개선

SR4-2(ASCII 이메일 비교), SR4-3(JWKS 음성 캐시·시간 제한), SR4-4(EOI 뒤 데이터·APP0 길이), SR4-5(시험 보강), SR4-6(README 절차 보강), SR4-7(메모리).

## 2. 검수 항목 1~10 판정 표

| 번호 | 항목 | 판정 | 근거(파일:줄) |
| --- | --- | --- | --- |
| 1 | 시험 전용 입구와 `X-Test-Now` | **문제 없음** | 아래 2-1절. `grep` 결과 `X-Test-Now` 는 `test/worker.ts:8`, `test/helpers.ts:125` 에만 있고, 빌드 산출물(`dist/` 9개 파일, `.wrangler/functions-build/index.js`)과 `functions/api/[[path]].ts` 에 없다. 운영 입구는 `handleApi(context.request, context.env)` 로 `now` 를 넘기지 않아 `Date.now()` 가 쓰인다(`src/router.ts:84`). 실제 요청: 운영 묶음 서버에 만료 JWT + `X-Test-Now`(대소문자, 초 단위, `Date` 헤더 조합) → 모두 401. 같은 요청을 시험 입구에 보내면 200(헤더가 시험 입구에서만 먹힘을 확인). |
| 2 | JWT 검증 | **문제 없음** (SR4-2, SR4-3 은 낮음) | `src/auth.ts:115` `alg !== "RS256"` 또는 `kid` 비문자열이면 즉시 null — none/HS256/RS512/PS256/ES256/소문자/누락/배열, `jwk`·`jku` 헤더, 조각 수 오류, 비 base64url 문자, 9KB 토큰(`:15,109`) 모두 401(탐침 22종). HS256 혼동(공개키를 HMAC 비밀로)도 헤더 단계에서 401. 모르는 kid: 캐시 안에서 60초에 1회만 재요청(`:86`), TTL 1시간(`:12,82`). JWKS 실패·형식 오류 → null → 401(`:60-62,89`), 단 음성 캐시 없음(SR4-3). 서명 대상은 받은 원문 조각 `${headerPart}.${payloadPart}`(`:121`)이며 클레임은 서명 확인 **뒤**에 해석(`:124`) — 재인코딩·키 순서·공백·중복 키 모두 401. `exp`: `now >= exp+60` 거부(`:131`) → `exp=now-60` 401, `now-59` 200; `nbf`: `now+60 < nbf` 거부(`:132`) → `nbf=now+60` 200, `now+61` 401; 문자열·음수 401. `iss` 는 `https://<팀도메인>` 과 완전 일치(`:126`, 끝 슬래시·대문자 401). `aud` 는 문자열 또는 배열 포함(`:128`). 이메일: 대소문자만 무시, 공백·제로폭·널·전각·유사 도메인 403, 켈빈 기호는 통과(SR4-2). |
| 3 | 관리자 API 라우트 전부 같은 검증 | **문제 없음** | 아래 2-3절 라우트 표. `src/router.ts:35-49` 관리자 라우트 15개 모두 `admin: true`, `:76-80` 에서 핸들러 호출 전에 `checkAdmin` 을 거친다. 관리자 라우트 중 `admin: true` 가 빠진 것 없음. 정적 `/admin` 화면(`admin/index.html`, `js/admin.js`)에는 메뉴 이름·API 경로·문구뿐이고 비밀값·데이터가 없다(저장소가 공개라 새 정보도 아님). Access 가 빠져도 `/api/admin/me` 가 401 이라 "관리자 확인이 필요합니다" 안내만 보인다(`js/admin.js:523-531`, 시험 `test/browser.test.ts:208-223`). |
| 4 | 401/403/503 구분의 정보 노출 | **문제 없음** (SR4-8 정보) | `src/auth.ts:141-150`. Access 정상 시 외부에서 볼 수 없고, 비정상 시에도 세 응답 모두 거부라 악용 경로가 없다. |
| 5 | 업로드 스트림 상한 | **문제 없음** (SR4-7 낮음) | `src/http.ts:33-34` Content-Length 가 상한 초과면 읽기 전 413, `:39-46` 스트림을 읽으며 누적 바이트가 상한을 넘는 순간 `cancel()` 후 413 — chunked·거짓 Content-Length 모두 해당(시험 `test/api.test.ts:597,621`). 여러 파트: 전체 본문이 16MB 로 묶이고 파트 수는 `formData()` 가 해석한 뒤 `files.length > 3` 로 거부(`src/reviews.ts:207-208`), 파일 크기는 `file.size` 로 `arrayBuffer()` 전에 거부(`:211`). 압축: workerd 는 요청 본문을 풀지 않고 그대로 넘긴다(에코 워커 탐침: gzip 1052B 보냄 → 받은 길이 1052, 첫 바이트 `1f 8b`). 따라서 20MB 를 20KB 로 압축해 보내도 20KB 로 세어져 양식 오류 400 이 되고, 풀린 크기로 메모리를 쓰게 할 수 없다. |
| 6 | 후기 작성 화면의 GPS EXIF 제거 | **문제 없음** (API 직접 호출 경로는 SR4-4 낮음) | 아래 2-6절. PIL 로 만든 2400x1800 JPEG(APP1 Exif: Make/Model/DateTime + GPS IFD 위도·경도·고도)를 복사본의 실제 Pages Functions 서버 + Chromium 에서 `/review/write?t=…` 로 올림. 저장본 14,920B, 구간 `E0(16) DB DB C0 C4 C4 C4 C4 SOS`, EOI 뒤 0B. APP1·`Exif`·`GPS`·`TestPhone`·GPSInfo 태그 바이트 없음, PIL 재해석 EXIF `{}`, GPS IFD `{}`, 크기 1600x1200. 원리: `js/review-write.js:101-129` 가 캔버스에 다시 그려 새 JPEG 를 만들므로 원본 메타데이터가 통째로 사라지고, `:61-94` 가 캔버스가 넣는 APP2(ICC)·COM 도 뺀다. 서버는 APP1~15·COM 을 거부(`src/jpeg.ts:47-48`, 시험 `test/unit.test.ts:34-44`). |
| 7 | CPU 시간 | **문제 있음 (SR4-1 중간)** | 아래 2-7절 측정표. 관리자 API 1건(JWT 검증 포함) 0.05~0.2ms ≪ 10ms. 후기 제출 1건(사진 3장): 300KB x3 ≈ 2~4ms(통과), 1MB x3 ≈ 7~9ms(아슬), 2MB x3 ≈ 15~17ms(초과), 5MB x3 ≈ 60~90ms(초과). |
| 8 | 0002 마이그레이션 | **문제 없음** | 복사본에서 `wrangler d1 migrations apply DB --local`: `0001_init.sql` 14개 명령, `0002_remove_password_login.sql` 5개 명령 모두 성공(종료 0). 적용 뒤 표: `audit_log, open_review_log, review_photos, review_tokens, reviews, settings`(+ `d1_migrations`, `sqlite_sequence`, `_cf_METADATA`), 인덱스 `idx_open_review_log_ip, idx_review_photos_review, idx_reviews_status_id`. `IF EXISTS` 라 0002 를 다시 실행해도 오류 없음. 지운 표 이름(`admin_sessions`, `login_failures`, `login_locks`, `session_hash`, `locked_until`, `__Host-sid`) grep: `src/`, `functions/`, `js/`, `test/`, `scripts/` 에 없음(마이그레이션 파일과 이전 보고서 2개에만). |
| 9 | README 의 Access 설정 절차 | **문제 있음 (SR4-6 낮음)** | `README.md:141` 경로 `www.kor2404.co.kr/admin*`, `/api/admin*`; `:142` pages.dev 와 `*.pages.dev` 도 같은 두 경로. 와일드카드가 대시보드에서 그대로 통하면 `/admin`, `/admin/`, `/admin/하위`, `/api/admin/하위` 를 모두 덮지만 이 세션에서는 확인 불가. apex 도메인·배포 뒤 확인 목록·미리보기 환경 변수 빈틈은 SR4-6. 어느 경우든 서버가 fail-closed(`src/auth.ts:144-147`)라 **보안 사고가 아니라 사용성 문제**다. |
| 10 | 테스트 신뢰성(뮤테이션) | **문제 없음** — 4종 모두 시험이 잡음 | 아래 2-10절 표. |

### 2-1. 1번 — 산출물 grep 과 운영 입구 실제 요청 원문

```
$ find dist .wrangler/functions-build -type f | sort
.wrangler/functions-build/index.js
dist/_headers  dist/admin/index.html  dist/app.css  dist/index.html
dist/js/admin.js  dist/js/review-write.js  dist/js/site.js  dist/review/write.html  dist/style.css
$ grep -rn -i -E "x-test-now|test/worker|test/helpers|test-access|scripts/" dist .wrangler/functions-build
(없음)
$ grep -rn -E "X-Test-Now|test/" functions/
(없음)
$ grep -n -o -E "handleApi\([^)]*\)" .wrangler/functions-build/index.js
844:handleApi(request, env, now = Date.now()
857:handleApi(context.request, context.env)
```

운영 묶음(`.wrangler/functions-build/index.js` + `dist/`)을 miniflare 로 띄운 서버(`scripts/local-server.mjs` 와 같은 구성)에 보낸 요청:

```
정상 JWT => 200 {"ok":true,"email":"admin@example.com"}
만료 JWT => 401 {"ok":false,"error":"로그인이 필요합니다."}
만료 JWT + X-Test-Now=서명 시각 => 401
만료 JWT + x-test-now(소문자)=서명 시각 => 401
만료 JWT + X-Test-Now=서명 시각(초 단위) => 401
만료 JWT + X-Test-Now + Date 헤더 => 401
```

같은 만료 JWT 를 시험 입구(`test/worker.ts`)에 `X-Test-Now=서명 시각`으로 보내면 200, `X-Test-Now=현재`면 401 — 헤더는 시험 입구에서만 동작한다.

### 2-2. 2번 — JWT 탐침 원문 (복사본 `test/r4probe.test.ts`, 9개 모두 통과)

```
alg/구조: alg none, 서명 빈 값 => 401 | alg none, 서명 있음 => 401 | alg 소문자 rs256 => 401
alg/구조: alg RS512 => 401 | PS256 => 401 | ES256 => 401 | alg 누락 => 401 | alg 배열 => 401
alg/구조: kid 누락 => 401 | kid 숫자 => 401 | kid 빈 문자열 => 401
alg/구조: jwk 헤더에 공개키 끼워 넣기 => 401 | jku 헤더 => 401
alg/구조: 4조각 => 401 | 2조각 => 401 | base64 표준문자(+/) 포함 => 401 | 서명 뒤 패딩 = => 401 | 공백 포함 => 401 | 9KB 토큰 => 401
alg 혼동: HS256(공개키를 비밀로) => 401
모르는 kid 50회(같은 시각) 동안 certs 요청 증가 => 0
모르는 kid, 61초 간격 10회 동안 certs 요청 증가 => 10
TTL(1시간) 지난 뒤 정상 kid: status, certs 증가 => [200,0]   (※ 1시간 뒤 첫 요청은 정상 kid 가 캐시에 있어 재요청 없음)
JWKS 500: 3회 status / certs 요청 증가 => [[401,401,401],3]
JWKS 302 redirect: => [[401,401,401],3]
JWKS 200 but not JSON: => [[401,401,401],3]
JWKS 200 keys not array: => [[401,401,401],3]
JWKS 200 keys with bad n/e: => [[401,401,401],1]
JWKS 200 EC key same kid: => [[401,401,401],1]
JWKS 200 RS256 key but alg HS256 label: => [[401,401,401],1]
JWKS keys:[] 200 응답 뒤: 즉시 / 30초 뒤(정상 JWKS 복구됨) / 61초 뒤 => [401,401,200]
email: 앞뒤 공백 => 403 | 끝 공백 => 403 | 대문자 => 200 | 터키어 İ => 403 | 전각 @ => 403
email: NFD 정규화(변화 없는 문자열) => 200 | 배열 => 403 | null => 403 | 뒤에 널 문자 => 403 | 뒤에 제로폭 문자 => 403
email: 유사 도메인 => 403 | 서브어드레스 => 403 | 점 변형 => 403
email: 켈빈 기호 K + im@example.com vs ADMIN_EMAIL=kim@example.com => 200   (SR4-2)
exp = now-60 (경계, 거부) => 401 | exp = now-59 => 200 | exp = now => 200 | exp 문자열 => 401 | exp 음수 => 401 | exp 소수 => 200
nbf = now+60 (경계, 허용) => 200 | nbf = now+61 => 401 | nbf 문자열 => 401 | iat 미래(검사 안 함) => 200
aud 에 다른 값 섞임 => 200 | aud 객체 => 401 | iss 끝 슬래시 => 401 | iss 대문자 => 401 | type 다름 => 200
payload 키 순서 재인코딩 => 401 | payload 공백 추가 재인코딩 => 401 | payload 중복 키(서명 불일치) => 401
```

### 2-3. 3번 — 관리자 API 라우트 표 (`src/router.ts:28-50`)

| 메서드 | 경로 | 핸들러 | `admin: true` | Origin 확인(`:63`) | 비고 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/me` | `admin.me` | 예 | 해당 없음(GET) | 화면 첫 확인 |
| GET | `/api/admin/reviews` | `admin.listReviews` | 예 | 해당 없음 | |
| POST | `/api/admin/reviews/:id/publish` | `admin.publishReview` | 예 | 예 | |
| POST | `/api/admin/reviews/:id/hide` | `admin.hideReview` | 예 | 예 | |
| PUT | `/api/admin/reviews/:id/reply` | `admin.saveReply` | 예 | 예 | JSON 64KB 상한 |
| DELETE | `/api/admin/reviews/:id` | `admin.deleteReview` | 예 | 예 | R2 도 삭제 |
| GET | `/api/admin/photos/:id` | `admin.getAdminPhoto` | 예 | 해당 없음 | `private, no-store` |
| POST | `/api/admin/photos/:id/hide` | `admin.hidePhoto` | 예 | 예 | |
| POST | `/api/admin/photos/:id/show` | `admin.showPhoto` | 예 | 예 | |
| DELETE | `/api/admin/photos/:id` | `admin.deletePhoto` | 예 | 예 | |
| POST | `/api/admin/review-links` | `admin.createReviewLink` | 예 | 예 | |
| GET | `/api/admin/settings` | `admin.getSettings` | 예 | 해당 없음 | |
| PUT | `/api/admin/settings/texts` | `admin.saveTexts` | 예 | 예 | |
| PUT | `/api/admin/settings/contact` | `admin.saveContact` | 예 | 예 | |
| GET | `/api/admin/audit` | `admin.listAudit` | 예 | 해당 없음 | |
| (없음) | `/api/admin/login`, `/logout` | — | — | — | 라우트 없음 → 404 (시험 `test/api.test.ts:223`) |

순서: 라우트 매칭(404/405) → Origin 확인(403) → `checkAdmin`(503/401/403) → 핸들러. 공개 라우트 5개(`/api/settings`, `/api/reviews` GET/POST, `/api/photos/:id`, `/api/review/check`)는 관리자 확인이 없는 것이 맞다. 경로는 대소문자·`%2F`·`//` 변형이 정규식에 걸리지 않아 404 가 된다(검증 우회 아님).

### 2-6. 6번 — GPS EXIF 사진 실험 원문

```
입력 사진: 80145 bytes, APP1 offset 20 Exif 포함 true GPS IFD 태그 바이트(0x8825) 포함 true
   (PIL: GPSLatitudeRef N, GPSLatitude (37, 33, 59.4), GPSLongitudeRef E, GPSLongitude (126, 58, 40.8), GPSAltitude 38)
저장본: 14920 bytes; 구간: E0(16) DB(67) DB(67) C0(17) C4(25) C4(32) C4(23) C4(27) SOS
저장본에 APP1(FFE1) false | 'Exif' false | 'GPS' false | TestPhone false | GPSInfo 태그 0x8825 false | ICC_PROFILE false | 'JFIF' true
EOI 뒤 바이트 수: 0
PIL 재확인: size (1600, 1200) format JPEG info keys ['jfif', 'jfif_density', 'jfif_unit', 'jfif_version']  EXIF entries: {}  GPS IFD: {}
```

경로: 복사본 `npm run build` → `startLocalServer()`(운영 Functions 묶음 + `dist/`) → Playwright Chromium 으로 후기 링크 열기 → `#photo-input` 에 `gps.jpg` 넣기 → 제출 → 관리자 API 로 저장본 내려받기.

### 2-7. 7번 — CPU 시간 측정표

환경: 이 컨테이너(Intel Xeon 2.1GHz, 4코어). workerd 는 miniflare(`workerd` 1.20261023) 안에서 `performance.now()` 차이(실행 중 시계가 흐르는 것을 먼저 확인: 3천만 회 루프 21ms). Node 는 `process.cpuUsage`. 운영 Cloudflare 의 CPU 가 이보다 빠르거나 느릴 수 있어 절대값보다 10ms 대비 배수를 본다.

| 작업 | workerd 시간 | Node 22 CPU 시간 | 10ms 대비 |
| --- | --- | --- | --- |
| 관리자 API 1건: JWT 검증(RS256 2048, JWKS 캐시 적중) | 0.05~0.1ms | 0.13~0.16ms | 1/60 이하 |
| 후기 제출: 사진 3장 x 300KB — 양식 해석 / 사진 검사 | 1~2ms / 1~2ms | — | 통과 |
| 후기 제출: 사진 3장 x 1MB | 3~5ms / 4ms | — | 7~9ms, 여유 거의 없음 |
| 후기 제출: 사진 3장 x 2MB | 7~9ms / 8ms | — | **초과** |
| 후기 제출: 사진 3장 x 5MB(현재 상한) | 36~58ms / 26~32ms | 194ms(합) | **6~9배 초과** |
| `checkJpeg` 5MB 1장 | ≈9~11ms | 12.7~14.2ms | 단독 초과 |
| (권고 근거) SOS 뒤 훑기 바이트 루프 → `indexOf(0xff)` | — | 5.06ms → 2.91ms | 약 1.7배 |

본문 수신(`readMs` 83~86ms for 15.7MB)은 전송 대기가 섞여 CPU 로 셈하지 않았다. D1·R2 호출은 대기 시간이라 CPU 에 들어가지 않지만 바인딩 호출 자체의 소량 CPU 는 위 표에 포함되지 않았다. 판정: 관리자 API 는 문제 없음, 후기 제출은 사진 크기에 따라 초과(SR4-1).

### 2-10. 10번 — 뮤테이션 표 (복사본 `/tmp/.../scratchpad/mut*`, `npx vitest run test/api.test.ts test/unit.test.ts`, 브라우저 시험 제외)

기준(변경 없음): `Tests 52 passed (52)`. R3 목록(서명·aud·email·fail-closed·팀 도메인·스트림 상한·Origin·승인 조건)에 **없던** 4종을 골랐다.

| # | 무력화한 로직 | 변경(복사본 `src/auth.ts`) | 결과 | 실패한 시험 |
| --- | --- | --- | --- | --- |
| A | alg 확인 | `:115` 에서 `header.alg !== "RS256" \|\|` 제거 | **1 failed** / 51 passed | 「서명이 틀리면 401 (…alg 바꾸기…)」 `expected 200 to be 401` |
| B | JWKS 실패(키 없음) 시 거부 | `:120` `if (!key) return null;` 제거, `:122` 를 `if (key && !(await verify…))` 로 (키를 못 받으면 서명 확인을 건너뜀) | **2 failed** / 50 passed | 「서명이 틀리면 401」(모르는 kid 200), 「공개키는 메모리에 캐시하고…」(200) |
| C | iss 확인 | `:126` 줄 삭제 | **1 failed** / 51 passed | 「iss 가 다르면 401」 `https://other-team.cloudflareaccess.com: expected 200 to be 401` |
| D | exp 확인 | `:131` 줄 삭제 | **1 failed** / 51 passed | 「만료됐거나 아직 유효하지 않으면 401」 `expected 200 to be 401` |

B 는 "JWKS 받아오기 실패" 시험이 아니라 "모르는 kid" 시험이 잡았다 — 받아오기 실패(비 200, JSON 오류)를 직접 다루는 시험은 없다(SR4-5).

## 3. R3 처리 결과의 재확인 (SR-1 ~ SR-12)

| R2 번호 | R3 판정 | R4 확인 |
| --- | --- | --- |
| SR-1 | 고침 | PBKDF2·로그인 라우트·세션 코드 없음(`src/crypto.ts` 49줄, `src/auth.ts` 에 Access JWT 만). 관리자 API CPU 0.05~0.2ms. 확인됨. 다만 후기 제출 쪽 CPU 는 별도 문제(SR4-1). |
| SR-2 | 고침 | `readBodyLimited` 스트림 계수 확인, chunked·gzip·거짓 길이 모두 상한 유지(5번 항목). 확인됨. |
| SR-3 | 고침 | 비밀번호 입력 칸 없음, API 비 JSON 이면 안내만(`js/admin.js:513-532`, 시험 `test/browser.test.ts:225-241`). 확인됨. |
| SR-4 | 고침 | 환경 변수 3개 각각 없음/빈 값 → 503, 공개키 요청 0회(`test/api.test.ts:173-188`). 확인됨. |
| SR-5 | 고침(IP 한계 남김) | `hostname` 일치 확인(`src/reviews.ts:174`), 시험 `:580`. 확인됨. |
| SR-6, SR-11, SR-12 | 해소 | 로그인·세션·시험용 해시 없음, `0002` 가 표 삭제. 확인됨. |
| SR-7 | 고침 | `_headers:3`, `src/http.ts:8` HSTS. 확인됨. |
| SR-8 | 고침 | 공개 사진 `no-cache`(`src/reviews.ts:124`). 확인됨. |
| SR-9 | 고침 | 허용 목록 방식(`src/jpeg.ts:44-51`). 확인됨. EOI 뒤·APP0 내부는 SR4-4. |
| SR-10 | 고침 | `npm audit` 0건. 확인됨. |

## 4. 최종 판정

**「수정 후 배포 가능」**

이유: Cloudflare Access 전환으로 R2 의 높음 항목(로그인 CPU)이 사라졌고, JWT 검증은 alg 고정·서명 선검증·iss/aud/exp/nbf·이메일·fail-closed 가 모두 코드와 실험으로 확인됐다. 시험 전용 시각 헤더는 운영 묶음에 들어가지 않으며, GPS 가 든 실제 사진은 브라우저 경로에서 완전히 제거됐다. 관리자 권한이나 고객 정보가 위험해지는 발견은 없다. 다만 **무료 요금제로 운영한다는 전제**에서 후기 제출(사진 3장)이 요청당 CPU 10ms 를 넘길 수 있어(SR4-1) 고객의 후기 전송이 실패할 수 있다. 이는 상한 상수 두 개를 낮추는 작은 수정이므로 그것을 반영한 뒤 배포하면 된다. 유료 요금제로 올리기로 결정하면 그 결정만으로 「배포 가능」이다. 나머지(SR4-2~SR4-7)는 배포 뒤 개선 항목이다.

## 5. 부록 — 실험 환경과 검수 범위 diff

- 복사본: 저장소를 `node_modules`·`.git`·`dist`·`.wrangler` 제외하고 `/tmp/claude-0/.../scratchpad/{base,mutA_alg,mutB_jwks,mutC_iss,mutD_exp}` 에 복사, `node_modules` 는 심볼릭 링크. `base` 에만 탐침 시험(`test/r4probe.test.ts`, `test/helpers.ts` 에 JWKS 응답 바꿔치기 훅 추가)과 스크립트(`scripts/r4-prod-entry.mjs`, `scripts/r4-gps.mjs`)를 넣었다. 저장소 본체에는 이 보고서 외에 아무것도 추가·수정하지 않았다.
- CPU 측정: `scratchpad/cpu/{bench.mjs,probe.mjs,probe-worker.ts,scan.mjs}`.
- 외부 주소 접속·원격 wrangler 작업 없음. 브라우저 실험은 Playwright Chromium 으로 localhost 만 접속.

검수 범위 `git diff --stat 418a6d8..a385e12` 마지막 줄 원문: `37 files changed, 1956 insertions(+), 1300 deletions(-)`
