# 보안 검수 보고서 R2 — PR #2 (고객 후기·관리자 기능)

| 항목 | 값 |
| --- | --- |
| 검수 기준 해시 | `a386ca724abdbba95157f2bd78a8547d393db58e` (`a386ca7`, 브랜치 `claude/compassionate-feynman-vvfed6`) |
| 검수 모델 | claude-fable-5-1 (세션 정보 `session_context.model` / `last_served_model` 기준) |
| 날짜 | 2026-10-29 |
| 검수 방식 | 코드 정독 + 로컬 실행(npm ci / typecheck / lint / build / test) + 저장소 복사본(`/tmp` 아래)에서 뮤테이션·탐침 실험. 기존 파일은 고치지 않음. 외부 주소 접속 없음(localhost, npm 레지스트리만). |

`git log --oneline -3` 원문:

```
a386ca7 고객 후기·관리자 화면 추가 (Cloudflare Pages 이전 준비, 로컬 전용)
fb6930c Merge pull request #1 from leejungju/claude/ecstatic-brown-qwgtv4
4ca040a 이사센터 홈페이지 정적 페이지 추가 (index.html, style.css)
```

## 0. 먼저 실행 — 원문 보고

| 명령 | 종료 코드 | 비고 |
| --- | --- | --- |
| `npm ci` | 0 | 설치 중 audit 경고 출력(아래) |
| `npm run typecheck` | 0 | `tsc -p tsconfig.json && tsc -p tsconfig.test.json && tsc -p tsconfig.browser.json` |
| `npm run lint` | 0 | `eslint .` |
| `npm run build` | 0 | `build ok: dist/ (정적 파일), functions/ 묶기 확인` |
| `npm test` | 0 | `Test Files 3 passed (3)`, `Tests 44 passed (44)` — api 27, 브라우저 5, 단위 12 |
| `npm audit` | 1 | 3 vulnerabilities (1 moderate, 2 critical) — 모두 **개발 의존성**(vitest ↔ `@vitest/mocker`, `tinypool`). 배포물(`dist/`, Functions)에는 들어가지 않음. 고치려면 `vitest@5`(breaking) |

`npm audit` 요약 원문:

```
@vitest/mocker  <=4.1.11   Severity: moderate   GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8
tinypool  <=2.1.1          Severity: critical   GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr
3 vulnerabilities (1 moderate, 2 critical)
fix available via `npm audit fix --force`  (Will install vitest@5.0.5, breaking change)
```

## 1. 발견 사항 표

심각도: 높음 = 운영에서 기능이 막히거나 관리자 계정이 위험해짐 / 중간 = 조건이 맞으면 실제 피해 / 낮음 = 방어 깊이·위생.

| 번호 | 심각도 | 위치 | 내용 | 재현 방법 | 고칠 방향 |
| --- | --- | --- | --- | --- | --- |
| SR-1 | **높음** | `src/crypto.ts:171-179`, `src/auth.ts:45-48`, `README.md:135` | 로그인마다 PBKDF2 600000회를 요청 안에서 계산한다. 측정값(아래 A-3): Web Crypto 경로 약 0.1~0.16초, 직접 구현 경로 약 0.6초 CPU. Workers **무료 요금제의 요청당 CPU 10ms** 를 두 경로 모두 수십 배 넘는다. 운영에서 로그인 요청이 CPU 한도 초과(오류 1102)로 끊겨 **관리자가 로그인 자체를 못 하게 될 가능성이 매우 높다.** 아이디가 틀려도 같은 계산을 하므로(의도된 설계) 공격자의 실패 시도 하나하나가 같은 CPU 를 쓴다. | 무료 요금제 Pages 에 배포 후 `/admin` 로그인 → 응답 없음/오류. 로컬에서는 CPU 한도가 없어 재현되지 않는다(아래 측정표). | A-3 권고 참고. 권고안은 (나) Cloudflare Access 로 `/admin`, `/api/admin/*` 를 막고 앱 비밀번호 로그인을 없애는 것. 유지하려면 (가) 유료 요금제 필요. |
| SR-2 | 중간 | `src/reviews.ts:177-185` | 본문 크기 제한이 **클라이언트가 보낸 `Content-Length` 헤더**에만 의존한다. 헤더가 없는(스트리밍/chunked) 요청은 `Number("0")=0` 으로 통과한 뒤 `request.formData()` 가 본문 전체를 메모리에 읽고, 그 다음에야 `file.size` 검사로 거부한다. 탐침 결과: 17MB 본문을 헤더 없이 보내면 `413` 이 아니라 전체를 읽은 뒤 `400`("사진 한 장은 5MB 이하")이 나왔다. 한 요청으로 Cloudflare 본문 상한(무료 100MB)까지 메모리·CPU 를 쓰게 할 수 있다. | 복사본에서 `Request` 를 `ReadableStream` 본문(`duplex: "half"`)으로 만들어 `handleApi` 호출. 헤더 없음 → `400` (전부 읽음), 헤더 있음 → `413`. | `Content-Length` 가 없으면 `411` 로 즉시 거부(브라우저 `fetch(FormData)` 는 항상 보냄). 또는 `request.body` 를 직접 읽으며 누적 바이트가 `MAX_BODY_BYTES` 를 넘는 순간 중단. |
| SR-3 | 중간 | `admin/index.html`, `js/admin.js:113-119,524-531`, `_headers`, `README.md:3,139` | 이 PR 을 지금 main 에 병합하면 GitHub Pages 에 `/admin/`, `/review/write`, 모든 소스가 그대로 올라간다(16번 항목). GitHub Pages 에는 API 가 없으므로 `/api/admin/me` 가 404 → `showLogin()` 이 **정상 로그인 화면을 보여 준다.** 관리자가 그 화면에 실제 아이디·비밀번호를 넣으면 평문 JSON 이 GitHub 서버로 POST 된다(404 응답). `_headers` 도 적용되지 않아 CSP·noindex 헤더가 없다(HTML 의 `<meta name="robots">` 만 남음). | main 병합 → `https://<Pages 주소>/admin/` 접속 → 로그인 폼 표시 → 제출 → "잠시 문제가 생겼습니다". 브라우저 개발자 도구에서 POST 본문에 비밀번호 확인. (프로젝트 페이지 `user.github.io/repo/` 형태면 `/js/admin.js` 절대 경로가 404 라 폼이 안 뜨고, 사용자 도메인(루트)이면 뜬다.) | 병합을 Cloudflare 이전 시점에 맞추거나, `admin.js` 에서 `/api/admin/me` 가 JSON 이 아니면 로그인 폼 대신 "준비 중" 안내만 보이게 한다. GitHub Pages 를 끄기 전까지는 `/admin`, `/review` 를 빌드 산출물에서 빼는 방법도 있다. |
| SR-4 | 낮음 | `test/api.test.ts:171-175`, `src/auth.ts:43,50` | 「환경 변수가 없으면 아무도 로그인할 수 없다」 시험이 `id: ""` 로만 호출한다. 복사본에서 `!configured ||` 와 `id === ""` 조건을 통째로 지워도(mut6) 이 시험은 **그대로 통과**했다. 빈 아이디는 다른 이유로도 실패하기 때문. fail-closed 자체는 코드 구조상 유지되지만(해시가 없으면 `verifyPassword` 가 항상 false), 시험이 그 보호를 증명하지 못한다. | `/tmp` 복사본 `src/auth.ts:50` 을 `if (!idOk \|\| !passwordOk) {` 로 바꾸고 `npx vitest run test/api.test.ts -t "환경 변수가 없으면"` → 통과. | 시험에 `ADMIN_PASSWORD_HASH` 만 비어 있고 아이디는 맞는 경우, `ADMIN_ID` 만 비어 있는 경우, 해시 형식이 틀린 경우(`pbkdf2-sha256:1000:...`)를 추가해 각각 401 을 단언. |
| SR-5 | 낮음 | `src/reviews.ts:160-172, 232-242` | 공개 양식(기본 꺼짐)의 하루 3건 제한은 `CF-Connecting-IP` 해시 기준이라 휴대폰 데이터 재접속·VPN 으로 IP 를 바꾸면 우회된다. Turnstile 검증은 서버에서 하지만 응답의 `hostname`/`action` 을 확인하지 않는다(다른 사이트에 심은 같은 사이트키 위젯의 토큰도 통과). | 공개 양식을 켠 상태에서 IP 를 바꿔 가며 4건 이상 제출. | 켤 때만 해당. siteverify 응답의 `hostname` 이 운영 도메인인지 확인하고, 승인 대기 건수 상한(예: 전체 하루 20건)을 추가. 또는 공개 양식을 계속 꺼 둔다. |
| SR-6 | 낮음 | `src/auth.ts:30-37, 50-62`, `src/router.ts:75` | 로그인 잠금이 IP 단위이므로, 관리자와 **같은 공인 IP** 를 쓰는 제3자(통신사 CGNAT, 같은 사무실/카페 와이파이)가 5번 틀리면 관리자도 15분 잠긴다. 반대로 다른 IP 의 공격자는 관리자를 잠글 수 없다(헤더 위조 불가, 4번 항목). `CF-Connecting-IP` 가 없는 환경에서는 모두 `"unknown"` 한 바구니로 묶인다(Cloudflare 뒤에서는 항상 있음). | 같은 공인 IP 의 두 기기에서 한쪽이 5회 실패 → 다른 쪽 429. | 잠금 안내에 "같은 와이파이의 다른 기기 때문일 수 있음"을 적거나, 계정 단위 잠금을 IP 잠금과 병행(계정 잠금은 공격자가 관리자를 잠글 수 있으므로 시간은 짧게). (나) 안을 택하면 사라지는 문제. |
| SR-7 | 낮음 | `_headers`, `src/http.ts:3-8` | `Strict-Transport-Security` 가 정적·API 응답 어디에도 없다. | 응답 헤더 확인. | Cloudflare 대시보드(SSL/TLS → Edge Certificates → HSTS)에서 켜거나 `_headers` 와 `SECURITY_HEADERS` 에 추가. |
| SR-8 | 낮음 | `src/reviews.ts:123` | 공개 사진이 `Cache-Control: public, max-age=60` 이라 관리자가 숨김·삭제한 뒤에도 최대 60초 동안 브라우저·중간 캐시에서 보일 수 있다. | 공개 사진 열람 → 숨김 → 60초 안에 새로고침. | `private, max-age=60` 또는 `no-store`. 사진은 20건 페이지 단위라 캐시 이득이 작다. |
| SR-9 | 낮음 | `src/jpeg.ts:33` | 서버 메타데이터 검사가 APP1(EXIF/XMP)만 거부한다. APP13(IPTC: 작성자·위치 설명), COM 주석 등은 통과한다. 브라우저 화면은 다시 그려 올리므로 정상 경로에서는 제거되지만, API 를 직접 부르면 개인정보가 담긴 세그먼트가 저장·공개될 수 있다. | `fakeJpeg()` 에 `FF ED`(APP13) 세그먼트를 넣어 제출 → 201. | APP0(JFIF) 외의 모든 APPn·COM 세그먼트를 거부하거나 제거. |
| SR-10 | 낮음 | `package.json` devDependencies | `npm audit`: vitest/tinypool critical 2건, moderate 1건. 개발 의존성이라 배포물에 포함되지 않지만, 시험 실행 환경에서 악성 패키지·파일에 노출될 수 있다. | `npm audit`. | 배포 뒤 `vitest@5` 로 올리고 시험 재확인. |
| SR-11 | 낮음 | `src/crypto.ts`, `.dev.vars.example:6`, `README.md:56` | 시험용 계정(`test-admin` / `test-password-change-me`)의 해시가 공개 저장소에 있다. 운영은 Cloudflare 대시보드 비밀값만 읽으므로 자동으로 쓰일 길은 없지만, 관리자가 실수로 이 값을 대시보드에 복사하면 README 를 읽은 누구나 로그인할 수 있다. | 대시보드에 `.dev.vars.example` 값 입력. | 서버가 알려진 시험용 해시와 같으면 로그인을 거부하고, 시험용 아이디 `test-admin` 도 거부. |
| SR-12 | 정보 | `src/auth.ts:8`, `README.md:92-99` | 세션은 12시간 절대 만료만 있고(연장 없음) 비밀번호를 바꿔도 기존 세션은 원격 D1 에서 `DELETE FROM admin_sessions` 를 손으로 실행해야 끊긴다. 컴퓨터에 능숙하지 않은 관리자에게는 사실상 불가능한 절차. | README 절차. | 로그인 시 `ADMIN_PASSWORD_HASH` 의 앞 16자를 세션 행에 같이 저장하고, 현재 값과 다르면 세션 무효 처리. |

### 배포 전에 반드시 고칠 것

1. **SR-1** 로그인 CPU 한도 — A-3 권고대로 인증 구조를 정하지 않으면 운영에서 로그인이 막힌다.
2. **SR-2** 본문 크기 제한의 `Content-Length` 의존 — 한 줄(`411` 거부)로 막을 수 있다.
3. **SR-3** GitHub Pages 에 로그인 화면이 올라가는 문제 — 병합 시점 조정 또는 `admin.js` 안내 화면. (병합 자체를 Cloudflare 이전과 맞추면 해결.)

### 배포 뒤 개선

SR-4(시험 보강), SR-5(공개 양식 켤 때), SR-6, SR-7(HSTS), SR-8, SR-9, SR-10, SR-11, SR-12.

## 2. A-3: PBKDF2 경로·운영 환경 분석과 세 안 비교

### 경로 선택 (코드)

- `src/crypto.ts:171-179` `pbkdf2Sha256()`: 먼저 Web Crypto `deriveBits` 를 시도하고, **어떤 예외든** 잡히면 `pbkdf2Sha256Manual()` 로 넘어간다. 즉 "100000회 상한" 예외가 나는 환경에서만 직접 구현이 쓰이고, 그 외에는 항상 Web Crypto 다.
- `src/crypto.ts:187-196` `parsePasswordHash()`: 반복 횟수 600000 미만은 거부하므로 (다) 안은 코드 변경 없이는 불가능하다.
- `src/crypto.ts:199-207` `verifyPassword()`: 형식이 틀려도 600000회를 계산한 뒤 false 를 돌려준다(시간 차 방지). `src/auth.ts:45-48` 은 아이디가 틀려도 비밀번호 계산을 한다.

### 직접 구현의 정확성 근거

- `test/unit.test.ts:13-20`: RFC 7914 §11 의 PBKDF2-HMAC-SHA256 시험 벡터 **2개**(`passwd`/`salt`/1회, `Password`/`NaCl`/80000회). RFC 는 64바이트 출력이고 구현은 32바이트(블록 1개)만 내지만, PBKDF2 블록은 독립이라 앞 32바이트 비교는 타당하다.
- `test/unit.test.ts:22-27`: Web Crypto 결과와 무작위 솔트 **3개 비밀번호**(64바이트 경계, 64바이트 초과 포함)를 1000회로 비교.
- `test/unit.test.ts:29-34`: `scripts/hash-password.mjs`(Web Crypto 600000회) 결과를 `verifyPassword` 로 검증 — 단, Node 에서는 Web Crypto 가 600000회를 받으므로 이 시험은 직접 구현 경로를 거치지 않는다.
- 평가: 벡터 수는 적지만 출처(RFC)가 분명하고 80000회 벡터가 반복 루프를 충분히 검증한다. 직접 구현한 SHA-256 압축 함수는 보안 민감 분기가 없어 타이밍 문제는 없다. 남는 위험은 **성능**(아래)과, 직접 구현이 운영에서만 선택되는데 운영과 같은 조건의 시험이 없다는 점이다.

### Workers PBKDF2 반복 상한 — 확인한 사실과 확인 못 한 것

- 이 저장소의 wrangler 4.155.0 이 묶어 쓰는 workerd 1.20261023.1 바이너리에는 `"Pbkdf2 failed: iteration counts above <max> are not supported (requested <n>)"` 문자열이 들어 있다(`strings` 로 확인). 즉 **상한 메커니즘은 실제로 존재하고 값은 설정으로 정해진다.**
- 로컬 workerd(`wrangler dev --local`)에 탐침 워커를 띄워 보니 600000회가 **거부되지 않고** 통과했다(아래 표). 따라서 로컬에서는 항상 Web Crypto 경로가 쓰이고, PR 본문의 "로컬 workerd 기준 약 0.15초"도 그 경로의 값이다.
- 운영 환경의 상한 값(100000으로 알려짐)은 이 세션에서 외부 접속이 금지돼 확정하지 못했다. **어느 쪽이든 결론은 같다**: 상한이 100000이면 직접 구현(약 0.6초 CPU)이, 아니면 Web Crypto(약 0.1~0.16초 CPU)가 쓰이는데 둘 다 무료 요금제 10ms 를 크게 넘는다.

측정값(이 컨테이너, Intel Xeon 2.1GHz, 4코어):

| 경로 | Node 22 CPU 시간(`process.cpuUsage`) | 로컬 workerd 벽시계 시간 |
| --- | --- | --- |
| Web Crypto 600000회 | 158ms | 105ms |
| Web Crypto 100000회 | 25ms | 21ms |
| Web Crypto 20000회 | 4ms | — |
| 직접 구현 600000회 | 635ms | 623ms |
| 직접 구현 100000회 | 208ms | 91ms |

운영에서 실제로 생기는 일(무료 요금제, 요청당 CPU 10ms): `/api/admin/login` 은 D1 조회 2~3회 + PBKDF2 를 한 요청에서 하므로 CPU 한도 초과로 끊기고 관리자는 "서버에 연결하지 못했습니다" 또는 오류 페이지만 본다. 다른 API(후기 목록, 사진, 관리자 화면 나머지)는 영향이 없다. 유료 요금제(요청당 30초)에서는 동작하지만 로그인에 0.1~0.7초가 걸리고, 공격자의 실패 시도 1회가 같은 CPU 를 소비한다(IP 당 15분 5회 제한으로 억제, 포함 CPU 3천만 ms/월이면 약 4만 회분).

### 세 안 비교

| 기준 | (가) Workers 유료($5/월) + 현 구조 | (나) Cloudflare Access(관리자 이메일 1개)로 `/admin`, `/api/admin/*` 차단 | (다) 반복 횟수 하향 |
| --- | --- | --- | --- |
| 보안 | 비밀번호 하나가 유일한 문. 잠금 5회/15분/IP, 600000회 해시, 긴 무작위 비밀번호가 전제. 2단계 인증 없음. | 관리자 화면·API 가 Cloudflare 가장자리에서 먼저 막혀 무차별 대입·CPU 소모·앞으로 생길 관리자 코드 버그 노출이 모두 사라짐. 이메일 일회용 코드 = 사실상 2단계. 관리자 이메일 계정 보안(2단계 인증)이 핵심이 됨. 앱 비밀번호를 **없애면** JWT(`Cf-Access-Jwt-Assertion`) 검증 코드(약 40줄)를 넣어 Access 우회 시 fail-closed 가 되게 해야 함. 앱 비밀번호를 **유지하면** SR-1 이 그대로라 (가)도 같이 필요. | 10ms 안에 들어오려면 약 2만 회 이하(측정 4ms, D1 조회 몫 포함 시 여유 거의 없음). OWASP 권고 600000의 1/30. 비밀번호 하나가 유일한 문이라는 구조는 그대로. 무료 요금제 CPU 한도는 다른 처리(D1 지연 등)와 합산되므로 간헐적 실패 가능. |
| 비용 | 월 $5 + 카드 등록. | Zero Trust Free(50명까지) $0. 가입 시 결제 수단 등록을 요구할 수 있음(확인 필요). | $0. |
| 관리자 사용성 | 아이디·비밀번호 한 번. 가장 단순. 비밀번호 변경은 개발자가 해시 만들어 대시보드 수정(README). | 이메일 입력 → 메일로 온 숫자 6개 입력. 세션 기간을 길게(예: 30일) 두면 한 달에 한 번. 비밀번호를 외울 필요가 없어 "비밀번호 분실"이 없음. 이메일 앱이 휴대폰에 있어야 함. | (가)와 같음. |
| 코드 변경 | 없음. | 앱 로그인 제거 + JWT 검증(중간 규모). 또는 앱 로그인 유지 시 없음. | `PASSWORD_ITERATIONS`/하한 수정, 해시 재생성(작음). |

### 권고

**(나)** 를 권고한다. Cloudflare Access 에 자체 호스트 애플리케이션으로 `<도메인>/admin*` 과 `<도메인>/api/admin*` 두 경로를 넣고, 정책은 "이메일 = 관리자 메일 1개", 로그인 방식은 One-time PIN, 세션 기간 30일. 앱의 아이디·비밀번호 로그인은 **제거**하고, `src/router.ts` 의 `admin: true` 경로에서 `Cf-Access-Jwt-Assertion` 을 Access 공개키로 검증(aud·iss·exp)해 없거나 틀리면 401 로 막는다(Access 가 꺼지거나 잘못 설정돼도 fail-closed). 기존 CSRF Origin 확인과 관리자 기록은 그대로 둔다. 이렇게 하면 SR-1·SR-6·SR-11·SR-12 가 함께 사라지고 월 비용이 없다.

Zero Trust 가입이 부담이면 차선은 **(가)**: 코드 변경 없이 동작하지만 비밀번호 하나에 의존하므로 관리자 비밀번호를 개발자가 무작위 16자 이상으로 만들어 비밀번호 관리 앱에 넣어 주고, Cloudflare 계정 2단계 인증을 켠다. (다)는 단독으로 권하지 않는다.

## 3. 검수 항목 1~18 판정 표

| 번호 | 항목 | 판정 | 근거(파일:줄) |
| --- | --- | --- | --- |
| 1 | 관리자 인증 fail-closed / 시험용 계정 | **문제 없음** (시험 보강은 SR-4, 실수 방지는 SR-11) | `src/auth.ts:43` `configured = !!ADMIN_ID && !!ADMIN_PASSWORD_HASH`, `:50` 비어 있으면 401. 해시 형식 오류 → `src/crypto.ts:187-196` null → `:205` false. `.dev.vars` 는 `.gitignore:4-6` 로 제외, `wrangler.toml` 에 `[vars]` 없음, 운영 비밀값은 대시보드에서만 읽음. |
| 2 | 시간 일정 비교 | **문제 없음** | 아이디: `src/crypto.ts:216-222` 양쪽 SHA-256 후 `constantTimeEqual`(길이 무관). 비밀번호: `:206` 유도값 32바이트 `constantTimeEqual`(`:60-65`). 틀린 아이디·형식 오류에서도 같은 계산(`src/auth.ts:44-48`, `src/crypto.ts:201-205`). |
| 3 | PBKDF2 경로·정확성·운영 영향 | **문제 있음 (SR-1, 높음)** | 2절 참고. |
| 4 | 로그인 실패 제한 | **문제 없음** (공유 IP 는 SR-6) | IP 는 `src/router.ts:75` `CF-Connecting-IP` 만 읽고 `X-Forwarded-For` 등은 보지 않음(Cloudflare 가 직접 채우는 헤더라 위조 불가). 잠금 판단 `src/auth.ts:32-37` 이 본문 읽기(`:39`)와 PBKDF2(`:45-48`)보다 앞. 잠금은 IP 단위라 다른 IP 의 공격자가 관리자를 계속 잠글 수 없음. 시험 `test/api.test.ts:146-161`. |
| 5 | 세션 | **문제 없음** | 로그인마다 새 256비트 토큰 발급, 기존 쿠키를 읽지 않음(`src/auth.ts:69`, 세션 고정 불가). DB 에는 SHA-256 해시만(`:70,75-79`, `migrations/0001_init.sql:38-42`). 만료 확인 `:90-92`, 로그아웃 삭제 `:96-103`. 쿠키 `__Host-sid; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`(`:7,25`), Domain 없음. 시험 `test/api.test.ts:112-136`. |
| 6 | CSRF Origin | **문제 없음** | `src/router.ts:65-67`: GET/HEAD 외 모든 메서드는 핸들러보다 먼저 `originAllowed` 를 통과해야 함. `src/http.ts:53-56`: 헤더 없음 → `origin !== null` 실패 → 403, `"null"` 문자열 → `url.origin` 과 달라 403. 라우트 표는 아래. 시험 `test/api.test.ts:95-110`(없음·다른 사이트·유사 도메인·로그인 CSRF). |
| 7 | 후기 토큰 | **문제 없음** | 난수 `crypto.getRandomValues` 32바이트(`src/crypto.ts:15-18,52-54`), 저장은 SHA-256 해시(`src/admin.ts:145-147`). 제출 시 조건부 `UPDATE ... WHERE used_at IS NULL AND expires_at > ?1` 와 `meta.changes !== 1` 확인(`src/reviews.ts:222-227`) → 동시 제출 1회만 성공. 실패 시 되돌림(`:276-281`). |
| 8 | 업로드 | **문제 있음 (SR-2 중간, SR-9 낮음)** | 개수 상한 3장 `src/reviews.ts:200-201`. JPEG 검사 종료: 모든 분기가 `i` 를 늘리거나 반환(`src/jpeg.ts:17-48`); 복사본에서 잘린 파일 전수·무작위 바이트 뒤집기 2만 회·5MB 악성 패턴 포함 20104회 실행이 43ms 에 끝남. R2 키 `reviews/${reviewId}/${photoId}.jpg` 는 DB 자동 번호와 서버 난수만 사용(`:258-259`). 크기 제한은 `Content-Length` 의존(SR-2). |
| 9 | 공개 양식 | **문제 있음 (SR-5 낮음)** | Turnstile 은 서버에서 `siteverify` 호출, 통신 실패 시 false(`src/reviews.ts:160-172`), 제출 시 필수(`:238-241`). 하루 3건은 IP 해시 기준(`:232-237`)이라 IP 변경으로 우회 가능. 기본 꺼짐(`src/settings.ts:63-65` 세 조건 모두 필요). |
| 10 | HTML 해석 경로 | **문제 없음** | 아래 grep 원문. `js/*.js` 는 모두 `textContent`/`value`/`createElement` 로만 넣고(`js/site.js:27-32,87-93`, `js/admin.js:22-31`, `js/review-write.js:39-49`), ESLint 가 `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval` 을 금지(`eslint.config.js:18-24`). 브라우저 시험 `test/browser.test.ts:63-109` 가 후기·별명·답변의 스크립트 문자열이 글자로만 보임을 확인. 인라인 스크립트는 빌드와 시험에서 차단(`scripts/build.mjs:16-23`, `test/unit.test.ts:88-95`). |
| 11 | 카카오 ID·휴대폰 href | **문제 없음** | 서버 `src/settings.ts:53-61` (`/^010\d{8}$/`, `/^_[A-Za-z0-9]{2,30}$/`), 저장 전 검사 `src/admin.ts:194-203`. 클라이언트도 다시 검사하고 고정 접두어 뒤에 `encodeURIComponent`(`js/site.js:99-101`), `sms:` 는 숫자만(`:109-110,140`). `javascript:` 는 두 검사 모두에서 탈락, 시험 `test/api.test.ts:397-398`. |
| 12 | 비공개 사진 열람 | **문제 없음** (캐시 60초는 SR-8) | `src/reviews.ts:111-124`: ID 는 128비트 난수 hex 32자(`src/crypto.ts:56-58`) 형식 검사 후 `p.hidden = 0 AND r.status = 'published'` JOIN. 삭제는 DB·R2 모두(`src/admin.ts:71-85,125-132`). 시험 `test/api.test.ts:299-342`. |
| 13 | 보안 헤더 적용 범위, noindex | **문제 없음** (HSTS 는 SR-7) | `_headers` 는 정적 파일 전용. API·사진 응답은 `src/router.ts:92` `withSecurityHeaders` → `src/http.ts:3-15`(nosniff, CSP `default-src 'none'; frame-ancestors 'none'`, X-Frame-Options, Referrer-Policy, 기본 `no-store`). 사진은 `Cache-Control` 만 유지(`src/reviews.ts:104-108`). `/admin`, `/admin/*`, `/review/*` 에 `X-Robots-Tag: noindex, nofollow` + HTML `<meta name="robots">`(`admin/index.html:6`, `review/write.html:6`). 시험 `test/browser.test.ts:196-216`, `test/api.test.ts:474-482`. |
| 14 | 오류 응답 내부 정보 | **문제 없음** | `src/router.ts:84-93`: 예외는 `console.error` 로만 남기고 고정 문구 500. 404/405/401/403 도 고정 문구(`:60,62,66,79`). D1 오류 문자열이 응답에 들어가는 경로 없음. |
| 15 | 공개 저장소 비밀값·개인정보 | **문제 없음** | `git log -p --all` 을 `AIza\|secret\|passw\|token=\|api[_-]?key\|PRIVATE KEY\|sk_live\|ghp_\|010-?\d{4}-?\d{4}\|01[016789]\d{7,8}` 로 검색: 모든 `passw*` 는 시험 코드의 가짜 값(`test-password-1234`, `test-password-e2e-1234`, `test-password-screens`, `test-password-change-me` 해시)과 변수명. 키·개인키·실제 휴대폰 번호 없음. **자리표시 번호 `010-0000-0000`**: 6회(`test/api.test.ts:372,399`, `test/browser.test.ts:167`, `scripts/screenshots.mjs:24`, `docs/screens/admin-contact-360.png` 캡처, 이전 main 의 `index.html` 견적 양식 placeholder). 이메일은 git 작성자 noreply 주소뿐. `1661-7624`, `215-23-16684` 는 의도적으로 공개하는 업체 정보. |
| 16 | 지금 main 병합 시 GitHub Pages | **문제 있음 (SR-3 중간)** | `has_pages: true`(API). 병합되면 `index.html`(API 없으면 후기·문자 양식·카카오 버튼 숨김, 시험 `test/browser.test.ts:166-194` 로 확인됨)과 함께 `admin/index.html`, `review/write.html`, `js/*.js`, `src/*.ts`, `test/*`, `migrations/*.sql`, `.dev.vars.example`, `wrangler.toml`, `docs/screens/*.png` 이 모두 정적 파일로 공개된다. 저장소가 이미 공개라 소스 노출 자체는 새 위험이 아니다. 위험은 (1) 로그인 폼이 떠서 실제 비밀번호가 GitHub 로 전송될 수 있음, (2) `_headers` 미적용으로 CSP·noindex 헤더 없음(메타 noindex 는 있음), (3) `/review/write` 가 "링크로만 작성 가능" 안내만 보여 줌(무해). |
| 17 | 필수 테스트 9개의 단언 | **문제 없음** (약한 시험 1건은 SR-4) | 아래 17절. |
| 18 | 뮤테이션 검증 | **문제 없음** — 5종 모두 해당 시험이 실패 | 아래 18절. |

### 6번 — 상태 변경 라우트와 Origin 확인

`src/router.ts:65` 가 핸들러 호출 전에 적용되므로 아래 전부에 걸린다.

| 메서드 | 경로 | 핸들러 | Origin 확인 | 세션 필요 |
| --- | --- | --- | --- | --- |
| POST | `/api/reviews` | `submitReview` | 예 | 아니오(토큰/공개 양식) |
| POST | `/api/admin/login` | `login` | 예 | 아니오 |
| POST | `/api/admin/logout` | `logout` | 예 | 아니오(세션 있으면 삭제) |
| POST | `/api/admin/reviews/:id/publish`, `/hide` | `publishReview`, `hideReview` | 예 | 예 |
| PUT | `/api/admin/reviews/:id/reply` | `saveReply` | 예 | 예 |
| DELETE | `/api/admin/reviews/:id` | `deleteReview` | 예 | 예 |
| POST | `/api/admin/photos/:id/hide`, `/show` | `hidePhoto`, `showPhoto` | 예 | 예 |
| DELETE | `/api/admin/photos/:id` | `deletePhoto` | 예 | 예 |
| POST | `/api/admin/review-links` | `createReviewLink` | 예 | 예 |
| PUT | `/api/admin/settings/texts`, `/contact` | `saveTexts`, `saveContact` | 예 | 예 |
| GET | `/api/settings`, `/api/reviews`, `/api/photos/:id`, `/api/review/check`, `/api/admin/me`, `/api/admin/reviews`, `/api/admin/photos/:id`, `/api/admin/settings`, `/api/admin/audit` | 읽기 전용 | 해당 없음 | admin/* 만 예 |

Origin 헤더 없음 → 403, `Origin: null` → 403(`src/http.ts:55`). 그 외 메서드(OPTIONS, PATCH 등)는 405.

### 10번 — grep 원문

```
$ grep -n -E "innerHTML|outerHTML|insertAdjacentHTML|document\.write|srcdoc|eval\(|new Function|\.href\s*=|location\.href|DOMParser|createContextualFragment|dangerouslySetInnerHTML" index.html admin/index.html review/write.html js/*.js src/*.ts scripts/*.mjs eslint.config.js
js/site.js:101:    link.href = "https://pf.kakao.com/" + encodeURIComponent(channelId) + "/chat";
js/site.js:140:      window.location.href = "sms:" + digits + "?body=" + encodeURIComponent(lines.join("\n"));
eslint.config.js:20:        { property: "innerHTML", message: "textContent 를 쓰세요." },
eslint.config.js:21:        { property: "outerHTML", message: "textContent 를 쓰세요." },
eslint.config.js:22:        { property: "insertAdjacentHTML", message: "textContent 를 쓰세요." },
```

두 `href` 대입은 11번 항목에서 검사한 값(정규식 통과 + 고정 접두어 + `encodeURIComponent`)만 들어간다. HTML 해석 경로(`innerHTML` 계열, `document.write`, `eval`)는 소스에 없다.

### 17번 — 필수 테스트 9개 단언 판정

저장소·PR 본문·댓글에 "필수 테스트 9개" 목록은 없다. README 의 보안 주장(로그인 제한, 세션, Origin, 토큰, 사진 공개 조건, XSS)에 대응하는 9개를 골라 판정했고, 나머지 35개도 모두 읽어 `expect` 없이 통과만 하는 시험이 없음을 확인했다.

| # | 시험 | 위치 | 단언 내용 | 판정 |
| --- | --- | --- | --- | --- |
| 1 | 로그인하지 않은 관리자 API 요청은 401 | `test/api.test.ts:74-93` | 8개 라우트 각각 `status 401`, 위조 쿠키 401, DB 에 링크 0건 | 단언 있음 |
| 2 | 잘못된 Origin 은 403 | `:95-110` | 다른 사이트·헤더 없음·유사 도메인·로그인 CSRF 각각 403, 후기 수 1 유지, 올바른 Origin 200 | 단언 있음 |
| 3 | 쿠키 속성과 해시 저장 | `:112-126` | Set-Cookie 형식·HttpOnly·Secure·SameSite=Strict·Max-Age, DB 값에 토큰 원문 없음·64자 hex·TTL | 단언 있음 |
| 4 | 세션 12시간 만료·로그아웃 폐기 | `:128-136` | 만료 1ms 전 200, 만료 시각 401, 로그아웃 후 401 | 단언 있음 |
| 5 | 6회째 잠금 | `:146-161` | 1~5회 401, 6회째 429 + Set-Cookie 없음, 다른 IP 200, 잠금 해제 직전 429·직후 200 | 단언 있음 |
| 6 | 사용된 토큰 재사용 불가 | `:223-234` | 2회째 410 + reason used, check 응답 used, 후기 1건 | 단언 있음 |
| 7 | 만료 토큰 거부 | `:236-247` | 30일 시점 410 + expired, 하루 전 201 | 단언 있음 |
| 8 | 숨긴·승인 전 사진 비공개 | `:299-330` | 승인 전 404, 숨긴 사진 목록 제외·404, 공개 사진 200 + image/jpeg + nosniff, 관리자 경로 200/401, 후기 숨김 후 404 | 단언 있음 |
| 9 | 후기 내용 `<script>` 가 글자로만 보임(브라우저) | `test/browser.test.ts:63-109` | textContent 일치, `script`/`b`/`img[src=x]` 0개, `window.__xss` undefined, dialog 없음 — 공개·관리자 화면 모두 | 단언 있음 |

단언은 있으나 보호를 증명하지 못하는 시험: 「환경 변수가 없으면 아무도 로그인할 수 없다」(`:171-175`, SR-4). 「켜져 있으면 Turnstile 확인 뒤 …」(`:442-471`)는 `fetch` 스텁이 호출됐는지만 보고 보낸 `secret`/`response` 값은 보지 않는다(낮음).

### 18번 — 뮤테이션 검증 (복사본 `/tmp/.../scratchpad/mutN`, `npx vitest run test/api.test.ts test/unit.test.ts`, 브라우저 시험 제외)

기준 복사본(변경 없음): `Test Files 2 passed`, `Tests 39 passed (39)`.

| # | 무력화한 로직 | 변경(복사본) | 결과 | 실패한 시험 |
| --- | --- | --- | --- | --- |
| mut1 | Origin 확인 | `src/http.ts:55` → `return true;` | **1 failed** / 38 passed | 「잘못된 Origin 의 상태 변경 요청은 세션이 있어도 403」 |
| mut2 | 사진 공개 조건 | `src/reviews.ts:116` `AND p.hidden = 0 AND r.status = 'published'` 제거 | **1 failed** / 38 passed | 「숨긴 사진은 공개 응답에 나오지 않는다」 |
| mut3 | 세션 만료 | `src/auth.ts:90` `AND expires_at > ?2` → `AND ?2 > 0`(바인딩 수 유지) | **1 failed** / 38 passed | 「세션은 12시간 뒤 만료되고 …」(만료 시각에 200) |
| mut4 | 토큰 만료 | `src/reviews.ts:135` 만료 분기 제거 + `:223` `AND expires_at > ?1` 제거 | **1 failed** / 38 passed | 「만료된 토큰(30일 경과)은 거부한다」(201) |
| mut5 | 업로드 크기 제한 | `src/jpeg.ts:3` `MAX_PHOTO_BYTES` 를 500MB 로 | **2 failed** / 37 passed | 「JPEG 가 아니거나 5MB 를 넘거나 …」, 단위 「5MB 를 넘으면 거부」 |
| mut6(추가) | 환경 변수 fail-closed 가드 | `src/auth.ts:50` `!configured \|\|` 와 `id === ""` 제거 | **해당 시험 통과(1 passed)** | 없음 → SR-4 |

주: mut3 의 첫 시도에서 `AND expires_at > ?2` 만 지우자 바인딩 수 불일치로 D1 오류(500)가 나 18개가 실패했다. 이는 뮤테이션이 아니라 복사본 오류라 바인딩을 유지하는 형태로 다시 했다.

## 4. 부록 — 실험 환경

- 복사본: 저장소를 `node_modules`·`.git`·`dist`·`.wrangler` 제외하고 `/tmp/claude-0/.../scratchpad/{base,mut1..mut6,wk}` 에 복사, `node_modules` 는 심볼릭 링크.
- workerd 탐침: `wrangler dev --local --port 8799` 에 `crypto.subtle.deriveBits(PBKDF2)` 와 `pbkdf2Sha256Manual` 을 호출하는 워커를 띄우고 `curl http://127.0.0.1:8799/?mode=…&iter=…` 로 측정. 실험 후 종료.
- 원격 작업(wrangler login/deploy/publish/`--remote`), 외부 주소 접속은 하지 않았다.
