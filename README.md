# 名品 포장이사공사 대한익스프레스 홈페이지

지금은 GitHub Pages 로 `index.html`, `style.css`(와 `js/site.js`)만 공개되고 있습니다.
이 저장소에는 나중에 **Cloudflare Pages(Functions + D1 + R2)** 로 옮길 때 쓸 고객 후기 기능과 관리자 화면이 함께 들어 있습니다.
아직 Cloudflare 계정은 없으며, 지금까지의 실행·시험은 모두 로컬(이 컴퓨터 안)에서만 했습니다.

> 상호, 대표번호, 사업자등록번호, 웹사이트 주소, canonical 링크는 HTML 에 고정되어 있고 관리자 화면에서도 바꿀 수 없습니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `index.html`, `style.css`, `js/site.js` | 공개 홈페이지. API 를 불러오지 못하면(GitHub Pages) HTML 문구 그대로 보이고, 후기·문자 견적 양식·카카오톡 버튼은 숨겨집니다. |
| `review/write.html`, `js/review-write.js` | 고객 후기 작성 화면 (`/review/write?t=토큰`) |
| `admin/index.html`, `js/admin.js` | 관리자 화면 (`/admin`) |
| `app.css` | 후기 작성·관리자 화면 공통 스타일(큰 글씨, 큰 버튼) |
| `_headers` | 정적 파일 보안 헤더(CSP, nosniff, Referrer-Policy, frame-ancestors, noindex) |
| `functions/api/[[path]].ts` | Pages Functions 진입점. `/api/*` 를 `src/router.ts` 로 넘깁니다. |
| `src/` | 서버 코드(TypeScript): 라우터, 로그인·세션, 후기, 관리자 API, 사진 검사, 암호 함수 |
| `migrations/` | D1 데이터베이스 마이그레이션 |
| `wrangler.toml` | Pages 설정(D1 `DB`, R2 `PHOTOS`). 지금은 로컬 전용 가짜 `database_id` |
| `scripts/hash-password.mjs` | 관리자 비밀번호 해시 만들기 |
| `scripts/build.mjs` | `dist/` 에 정적 파일 모으기 + Functions 묶기 확인 |
| `scripts/local-server.mjs`, `scripts/screenshots.mjs` | 시험·캡처용 로컬 서버, 화면 캡처 |
| `test/` | 시험(API, 단위, 헤드리스 브라우저) |
| `docs/screens/` | 로컬 실행 화면 캡처(가짜 시험 데이터) |

### 기능 요약

- **문자 견적 문의**: 이름(선택)·출발지·도착지·이사 희망일·이사 종류·메모를 적으면 그 내용이 채워진 문자 앱이 열립니다(`sms:` 링크). 서버로 보내거나 저장하지 않습니다. 받을 번호는 설정값 `sms_number`, 비어 있으면 양식이 숨겨집니다. PC 사용자를 위해 대표번호 전화 안내를 함께 둡니다.
- **카카오톡 문의**: 설정값 `kakao_channel_id` 가 있으면 `https://pf.kakao.com/{값}/chat` 으로 연결, 없으면 숨김.
- **고객 후기**: 관리자가 공개한 후기만 최신순으로 보입니다(별명, 이용 서비스, 작성일, 내용, 숨기지 않은 사진, 업체 답변).
- **후기 작성(로그인 없음)**: 관리자가 만든 1회용 링크로만 씁니다. 토큰은 256비트 무작위 값, DB 에는 SHA-256 해시만 저장, 30일 유효, 1건 제출하면 사용 완료. 제출된 후기는 "승인 대기"로 저장됩니다.
- **사진**: 브라우저에서 긴 변 1600px 이하 JPEG 로 다시 그려 위치 정보 등을 없앤 뒤 올립니다. 서버는 JPEG 시작 바이트, 장당 5MB, EXIF(APP1) 구간 유무를 검사합니다. R2 사진은 직접 공개하지 않고, 공개된 후기의 숨기지 않은 사진만 `/api/photos/{id}` 로 내보냅니다.
- **관리자 화면** `/admin`: 후기 관리(승인 대기/공개 중/숨김, 공개·숨기기·삭제·답변, 사진 숨기기·삭제), 후기 요청 링크 만들기·복사, 홈페이지 문구, 연락처 설정, 최근 기록(모든 관리자 행동).
  - 첫 화면의 큰 제목(`名品 포장이사공사 대한익스프레스`)은 상호이므로 고칠 수 없습니다. "첫 화면 제목"으로는 그 위의 짧은 문구(`전국 포장이사 · 무료 방문 견적`)를 고칩니다.
- **공개 후기 양식(토큰 없이 누구나)**: 기본으로 꺼져 있습니다. 아래 "공개 후기 양식 켜기" 참고.

## 로컬 실행

필요한 것: Node.js 22 이상.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run dev
```

- `npm run dev` 는 `dist/` 를 만들고, 로컬 D1 에 마이그레이션을 적용한 뒤 `http://localhost:8788` 에서 실행합니다. D1·R2 데이터는 `.wrangler/` 폴더(로컬)에만 저장됩니다.
- `.dev.vars.example` 의 관리자 계정은 시험용입니다: 아이디 `test-admin`, 비밀번호 `test-password-change-me`.
- wrangler 명령은 모두 로컬 모드(`--local`, `pages dev`)로만 쓰며, 사용 통계 전송은 끕니다(`WRANGLER_SEND_METRICS=false`, `wrangler.toml` 의 `send_metrics = false`).

### 검사 명령

| 명령 | 내용 |
| --- | --- |
| `npm run typecheck` | TypeScript 검사(서버, 시험, 브라우저 JS 의 JSDoc) |
| `npm run lint` | ESLint (`innerHTML` 등 사용 금지 규칙 포함) |
| `npm run build` | `dist/` 생성, 인라인 스크립트 검사, Functions 묶기 확인 |
| `npm test` | build 후 vitest: API 시험(로컬 D1·R2), 단위 시험, 헤드리스 브라우저 시험 |
| `npx html-validate index.html admin/index.html review/write.html` | HTML 검사 |
| `npm run screenshots` | 가짜 시험 데이터로 `docs/screens/` 캡처 |

브라우저 시험은 Playwright(Chromium)를 씁니다. 처음이면 `npx playwright install chromium` 이 필요할 수 있습니다.

## 관리자 계정 만들기

계정은 하나뿐이고 회원가입 기능은 없습니다. 아이디와 비밀번호 해시는 **환경 변수로만** 받습니다.

| 환경 변수 | 값 |
| --- | --- |
| `ADMIN_ID` | 관리자 아이디 |
| `ADMIN_PASSWORD_HASH` | 아래 스크립트로 만든 해시 |

1. 해시 만들기(비밀번호는 화면에 보이지 않고 저장되지 않습니다):

   ```bash
   npm run hash-password
   ```

   새 비밀번호를 두 번 입력하면 `pbkdf2-sha256:600000:솔트:해시` 형식의 값이 나옵니다.
   (Web Crypto PBKDF2-SHA256, 무작위 16바이트 솔트, 반복 600000회. 10자 이상만 받습니다.)
2. 로컬: `.dev.vars` 의 `ADMIN_ID`, `ADMIN_PASSWORD_HASH` 를 바꿉니다.
3. Cloudflare: Pages 프로젝트 → 설정 → 환경 변수에서 두 값을 **암호화(Secret)** 로 넣습니다.

### 비밀번호 바꾸기

관리자 화면에는 비밀번호 변경 기능이 없습니다. 바꾸려면:

1. `npm run hash-password` 로 새 해시를 만듭니다.
2. Cloudflare 대시보드에서 `ADMIN_PASSWORD_HASH` 값을 새 해시로 바꿉니다(아이디도 바꾸려면 `ADMIN_ID` 도).
3. 다시 배포해야 새 값이 적용됩니다(대시보드에서 마지막 배포 "다시 시도" 또는 새로 배포).
4. 이미 로그인된 세션을 모두 끊으려면 로컬이 아닌 원격 D1 에서 `DELETE FROM admin_sessions;` 를 실행합니다.

### 로그인 보안

- 로그인 실패는 IP당 15분에 5회까지, 넘으면 15분 동안 잠깁니다(6번째부터 거부). 실패 응답은 아이디·비밀번호 중 무엇이 틀렸는지 알리지 않습니다. IP 는 해시로만 저장합니다.
- 세션: 256비트 무작위 값, DB 에는 해시만 저장, 쿠키 `__Host-sid`(HttpOnly·Secure·SameSite=Strict), 12시간 만료, 로그아웃하면 즉시 삭제.
- 상태를 바꾸는 모든 요청은 Origin 헤더가 사이트 주소와 같아야 하고(403), 관리자 요청은 세션도 있어야 합니다(401).

## 공개 후기 양식 켜기 (선택, 기본은 꺼짐)

토큰 없이 누구나 후기를 쓰게 하려면 세 가지가 모두 있어야 합니다. 이때도 후기는 승인 대기로 저장되고, IP당 하루 3건으로 제한됩니다.

1. Cloudflare Turnstile 위젯을 만들고 비밀 키를 환경 변수 `TURNSTILE_SECRET_KEY` 로 넣습니다.
2. 설정값(사이트 키, 켜기)을 D1 에 넣습니다:

   ```bash
   npx wrangler d1 execute DB --remote --command "INSERT INTO settings (key, value, updated_at) VALUES ('turnstile_site_key', '사이트키', 0), ('open_review_enabled', '1', 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
   ```

   (로컬에서 시험할 때는 `--remote` 대신 `--local` 과 Cloudflare 시험용 사이트 키 `1x00000000000000000000AA` 를 씁니다.)
3. 끄려면 `open_review_enabled` 를 `'0'` 으로 바꿉니다.

Turnstile 주소(`https://challenges.cloudflare.com`)는 `/review/*` 페이지의 CSP 에만 들어 있습니다.

## 나중에 Cloudflare 에 올릴 때 할 일

계정은 아직 정하지 않았습니다. 정한 뒤 아래 순서로 진행합니다.

- [ ] Cloudflare 계정 만들기(업체 명의 권장), 2단계 인증 켜기
- [ ] `npx wrangler login` (이때 처음으로 원격 작업을 합니다)
- [ ] D1 만들기: `npx wrangler d1 create moving-center-db` → 나온 `database_id` 를 `wrangler.toml` 에 넣기
- [ ] 원격 D1 에 마이그레이션: `npx wrangler d1 migrations apply DB --remote`
- [ ] R2 버킷 만들기: `npx wrangler r2 bucket create moving-center-review-photos` (**공개 접근은 켜지 않습니다.** 사진은 함수를 거쳐서만 나갑니다)
- [ ] Pages 프로젝트 만들기(GitHub 저장소 연결): 빌드 명령 `npm run build`, 출력 폴더 `dist`
- [ ] Pages 프로젝트에 D1(`DB`), R2(`PHOTOS`) 바인딩 연결(wrangler.toml 로 자동 적용되는지 대시보드에서 확인)
- [ ] 환경 변수(Secret): `ADMIN_ID`, `ADMIN_PASSWORD_HASH` (필요하면 `TURNSTILE_SECRET_KEY`)
- [ ] **CPU 시간 확인**: 로그인할 때 PBKDF2 600000회 계산에 로컬 기준 약 0.15초가 걸립니다. Workers 무료 요금제는 요청당 CPU 시간이 매우 짧아(10ms) 로그인이 실패할 수 있습니다. 배포 후 로그인을 꼭 시험하고, 실패하면 유료 요금제(Workers Paid)를 쓰거나 반복 횟수 조정을 검토해야 합니다. (Web Crypto 가 600000회를 거부하는 환경에서는 같은 결과를 내는 직접 구현으로 넘어가며, 이때는 약 0.9초가 걸립니다.)
- [ ] 사용자 도메인 `www.kor2404.co.kr` 연결, DNS 이전, HTTPS 확인
- [ ] 배포 후 확인: 응답 헤더(CSP·nosniff·noindex), `/admin` 로그인, 후기 링크 만들기→작성→승인→공개 목록, 사진 숨김
- [ ] 관리자 화면 "연락처 설정"에서 카카오톡 채널 ID, 문자 받을 휴대폰 번호 입력(홈페이지에 공개됨을 업체와 확인)
- [ ] GitHub Pages 끄기(이전이 끝난 뒤). GitHub Pages 에서는 `/admin`, `/review/write` 화면 파일도 보이지만 API 가 없어 쓸 수 없습니다.
- [ ] 개인정보 처리방침에 후기 수집 항목(별명, 이용 서비스, 내용, 사진)과 삭제 요청 방법 반영 검토
- [ ] D1 백업 방법 정하기(Time Travel 또는 정기 내보내기)
