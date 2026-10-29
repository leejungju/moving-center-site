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
| `_headers` | 정적 파일 보안 헤더(CSP, nosniff, Referrer-Policy, frame-ancestors, noindex, HSTS) |
| `functions/api/[[path]].ts` | Pages Functions 진입점. `/api/*` 를 `src/router.ts` 로 넘깁니다. |
| `src/` | 서버 코드(TypeScript): 라우터, 관리자 확인(Cloudflare Access JWT 검증, `src/auth.ts`), 후기, 관리자 API, 사진 검사 |
| `migrations/` | D1 데이터베이스 마이그레이션 |
| `wrangler.toml` | Pages 설정(D1 `DB`, R2 `PHOTOS`). 지금은 로컬 전용 가짜 `database_id` |
| `scripts/build.mjs` | `dist/` 에 정적 파일 모으기 + Functions 묶기 확인 |
| `scripts/local-server.mjs`, `scripts/screenshots.mjs` | 시험·캡처용 로컬 서버(miniflare), 화면 캡처 |
| `scripts/test-access.mjs` | **시험 전용** 가짜 Access(실행할 때마다 만드는 시험용 RSA 키로 JWT 서명). 운영 코드는 이 파일을 쓰지 않습니다. |
| `test/` | 시험(API, 단위, 헤드리스 브라우저) |
| `docs/screens/` | 로컬 실행 화면 캡처(가짜 시험 데이터) |

### 기능 요약

- **문자 견적 문의**: 이름(선택)·출발지·도착지·이사 희망일·이사 종류·메모를 적으면 그 내용이 채워진 문자 앱이 열립니다(`sms:` 링크). 서버로 보내거나 저장하지 않습니다. 받을 번호는 설정값 `sms_number`, 비어 있으면 양식이 숨겨집니다. PC 사용자를 위해 대표번호 전화 안내를 함께 둡니다.
- **카카오톡 문의**: 설정값 `kakao_channel_id` 가 있으면 `https://pf.kakao.com/{값}/chat` 으로 연결, 없으면 숨김.
- **고객 후기**: 관리자가 공개한 후기만 최신순으로 보입니다(별명, 이용 서비스, 작성일, 내용, 숨기지 않은 사진, 업체 답변).
- **후기 작성(로그인 없음)**: 관리자가 만든 1회용 링크로만 씁니다. 토큰은 256비트 무작위 값, DB 에는 SHA-256 해시만 저장, 30일 유효, 1건 제출하면 사용 완료. 제출된 후기는 "승인 대기"로 저장됩니다.
- **사진**: 브라우저에서 긴 변 1600px 이하 JPEG 로 다시 그려 위치 정보 등을 없앤 뒤 올립니다. 서버는 JPEG 시작 바이트, 장당 5MB(요청 전체 16MB, 스트림으로 세며 넘으면 바로 413), 구간 종류를 검사해 APP0(JFIF)과 영상 데이터 구간만 받고 APP1~APP15(EXIF·XMP·IPTC·ICC 등)·COM(주석)이 있으면 거부합니다. R2 사진은 직접 공개하지 않고, 공개된 후기의 숨기지 않은 사진만 `/api/photos/{id}` 로 내보냅니다.
- **관리자 화면** `/admin`: 로그인은 Cloudflare Access(이메일로 받는 일회용 PIN)가 맡고, 화면에는 아이디·비밀번호 입력 칸이 없습니다. 후기 관리(승인 대기/공개 중/숨김, 공개·숨기기·삭제·답변, 사진 숨기기·삭제), 후기 요청 링크 만들기·복사, 홈페이지 문구, 연락처 설정, 최근 기록(모든 관리자 행동).
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
- 로컬(`npm run dev`)에는 Cloudflare Access 가 없으므로 관리자 API 는 항상 거부됩니다(정상 동작). 관리자 화면은 `npm test`(가짜 Access 로 시험)나 `npm run screenshots` 로 확인합니다.
- wrangler 명령은 모두 로컬 모드(`--local`, `pages dev`)로만 쓰며, 사용 통계 전송은 끕니다(`WRANGLER_SEND_METRICS=false`, `wrangler.toml` 의 `send_metrics = false`).

### 검사 명령

| 명령 | 내용 |
| --- | --- |
| `npm run typecheck` | TypeScript 검사(서버, 시험, 브라우저 JS 의 JSDoc) |
| `npm run lint` | ESLint (`innerHTML` 등 사용 금지 규칙 포함) |
| `npm run build` | `dist/` 생성, 인라인 스크립트 검사, Functions 묶기 확인 |
| `npm test` | build 후 vitest: API 시험(miniflare 안의 실제 워커 코드, 메모리 D1·R2, 외부 요청 가로채기), 단위 시험, 헤드리스 브라우저 시험 |
| `npx html-validate index.html admin/index.html review/write.html` | HTML 검사 |
| `npm audit` | 의존성 취약점 검사 |
| `npm run screenshots` | 가짜 시험 데이터로 `docs/screens/` 캡처 |

브라우저 시험은 Playwright(Chromium)를 씁니다. 처음이면 `npx playwright install chromium` 이 필요할 수 있습니다.

## 관리자 로그인 (Cloudflare Access)

앱에는 아이디·비밀번호 로그인이 없습니다. `/admin*` 과 `/api/admin*` 은 Cloudflare Access 가 먼저 막고,
허용된 이메일 1개로 받은 일회용 PIN 을 넣어야 들어갈 수 있습니다. 비밀번호를 외우거나 바꿀 일이 없습니다.

서버도 모든 관리자 API 요청에서 Access 가 붙여 준 `Cf-Access-Jwt-Assertion` 을 직접 다시 검증합니다.

| 확인 | 내용 |
| --- | --- |
| 서명 | RS256, 공개키는 `https://{CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` (메모리에 1시간 캐시, `kid` 로 선택) |
| 팀 도메인 | `이름.cloudflareaccess.com` 형식만 받습니다. 다른 주소를 가리키게 할 수 없습니다. |
| aud / iss | `CF_ACCESS_AUD` 와 같아야 하고, `https://{팀 도메인}` 이어야 합니다. |
| 시간 | `exp`·`nbf` 확인(허용 오차 60초) |
| 이메일 | `ADMIN_EMAIL` 과 정확히 같아야 합니다(대소문자 무시). 다르면 403. |
| 설정 누락 | 환경 변수 3개 중 하나라도 없거나 형식이 틀리면 모든 관리자 요청 거부(503). |

| 환경 변수 | 값 |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Zero Trust 팀 도메인. 예: `팀이름.cloudflareaccess.com` (`https://` 없이) |
| `CF_ACCESS_AUD` | Access 애플리케이션의 "Application Audience (AUD) Tag" (64자리) |
| `ADMIN_EMAIL` | 관리자 이메일 1개 |

- 상태를 바꾸는 모든 요청은 Origin 헤더가 사이트 주소와 같아야 합니다(없거나 `null` 이면 403).
- 관리자 화면의 "로그아웃"은 `/cdn-cgi/access/logout` (Access 로그아웃)으로 갑니다.
- 관리자 화면·후기 작성 화면은 API 가 없는 주소(GitHub Pages 등)에서 열리면 입력 칸 없이 "이 주소에서는 사용할 수 없습니다" 안내만 보여 줍니다.

## 공개 후기 양식 켜기 (선택, 기본은 꺼짐)

토큰 없이 누구나 후기를 쓰게 하려면 세 가지가 모두 있어야 합니다. 이때도 후기는 승인 대기로 저장되고, IP당 하루 3건으로 제한됩니다.
서버는 Turnstile 확인 결과가 성공이고 그 `hostname` 이 요청한 사이트 주소와 같을 때만 받습니다.

> **IP 단위 하루 제한의 한계**: 휴대폰 데이터를 껐다 켜거나 VPN·다른 와이파이를 쓰면 IP 가 바뀌어 하루 3건 제한을 넘길 수 있습니다.
> 반대로 같은 회사·아파트 와이파이나 통신사 공용 IP 를 쓰는 서로 다른 고객이 함께 제한될 수도 있습니다.
> Turnstile 이 자동 입력을 막고 모든 후기가 승인 대기로 들어오므로 홈페이지에 바로 보이지는 않지만, 승인 대기 목록이 스팸으로 찰 수는 있습니다.
> 그래서 기본은 꺼 두고, 업체가 보낸 1회용 링크로만 받는 것을 권합니다.

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

### 1. 계정과 저장소

- [ ] Cloudflare 계정 만들기(업체 명의 권장), 2단계 인증 켜기
- [ ] `npx wrangler login` (이때 처음으로 원격 작업을 합니다)
- [ ] D1 만들기: `npx wrangler d1 create moving-center-db` → 나온 `database_id` 를 `wrangler.toml` 에 넣기
- [ ] 원격 D1 에 마이그레이션: `npx wrangler d1 migrations apply DB --remote` (`0001`, `0002` 가 차례로 적용됩니다)
- [ ] R2 버킷 만들기: `npx wrangler r2 bucket create moving-center-review-photos` (**공개 접근은 켜지 않습니다.** 사진은 함수를 거쳐서만 나갑니다)
- [ ] Pages 프로젝트 만들기(GitHub 저장소 연결): 빌드 명령 `npm run build`, 출력 폴더 `dist`
- [ ] Pages 프로젝트에 D1(`DB`), R2(`PHOTOS`) 바인딩 연결(wrangler.toml 로 자동 적용되는지 대시보드에서 확인)
- [ ] 사용자 도메인 `www.kor2404.co.kr` 연결, DNS 이전, HTTPS 확인

### 2. 관리자 로그인(Cloudflare Access) 설정

- [ ] **Zero Trust 팀 도메인 만들기**: 대시보드 → Zero Trust → 처음 들어가면 팀 이름을 정합니다(Free 요금제, 50명까지 무료. 결제 수단 등록을 요구할 수 있음). 팀 도메인은 `팀이름.cloudflareaccess.com` 입니다(설정 → 사용자 지정 페이지에서도 확인 가능).
- [ ] **로그인 방법**: 설정 → 인증 → 로그인 방법에 **일회용 PIN(One-time PIN)** 이 있는지 확인합니다(없으면 추가).
- [ ] **Access 애플리케이션 만들기**: Access → 애플리케이션 → 추가 → **자체 호스팅(Self-hosted)**
  - 경로 두 개를 넣습니다: `www.kor2404.co.kr/admin*`, `www.kor2404.co.kr/api/admin*`
  - Pages 기본 주소(`moving-center-site.pages.dev`)와 미리보기 주소(`*.moving-center-site.pages.dev`)도 같은 두 경로로 추가합니다. (빠뜨려도 서버가 JWT 가 없는 요청을 거부하므로 열리지는 않지만, 그 주소에서는 관리자 화면을 쓸 수 없습니다.)
  - **세션 기간: 30일** (한 달에 한 번 메일로 받은 PIN 을 넣으면 됩니다)
  - 정책: 동작 **허용(Allow)**, 규칙 **이메일(Emails) = 관리자 이메일 1개**. 다른 규칙은 넣지 않습니다.
  - 로그인 방법: 일회용 PIN 만 켭니다.
- [ ] **AUD 값 확인**: 만든 애플리케이션 → 개요(Overview)의 **Application Audience (AUD) Tag** 를 복사합니다(64자리 영문·숫자).
- [ ] **환경 변수 3개 넣기**: Pages 프로젝트 → 설정 → 환경 변수(프로덕션, 필요하면 미리보기에도)
  - `CF_ACCESS_TEAM_DOMAIN` = `팀이름.cloudflareaccess.com` (앞에 `https://` 를 붙이지 않습니다)
  - `CF_ACCESS_AUD` = 위에서 복사한 AUD 값
  - `ADMIN_EMAIL` = Access 정책에 넣은 관리자 이메일과 같은 값
  - (공개 후기 양식을 켤 때만) `TURNSTILE_SECRET_KEY` 를 암호화(Secret)로
  - 환경 변수를 바꾸면 **다시 배포**해야 적용됩니다.
- [ ] 관리자 이메일 계정에도 2단계 인증을 켭니다(PIN 이 이 메일로 오므로 이 계정이 곧 관리자 열쇠입니다).

### 3. 배포 뒤 확인할 것

- [ ] 시크릿 창에서 `https://www.kor2404.co.kr/admin` → Access 로그인 화면(이메일 입력)이 먼저 나오는지
- [ ] 관리자 이메일 → 메일로 온 PIN 입력 → 관리자 화면이 열리고 오른쪽 위에 그 이메일이 보이는지
- [ ] 다른 이메일을 넣으면 PIN 이 오지 않거나 들어갈 수 없는지
- [ ] 로그인하지 않은 상태에서 `https://www.kor2404.co.kr/api/admin/me` → Access 로그인으로 넘어가거나 거부되는지
- [ ] "로그아웃" 을 누르면 Access 로그아웃 화면이 나오고, 다시 `/admin` 을 열면 PIN 을 다시 묻는지
- [ ] 관리자 화면에 "관리자 화면 설정이 끝나지 않았습니다"가 보이면 환경 변수 3개(오타, `https://` 붙임, AUD 복사 누락)를 확인하고 다시 배포
- [ ] 응답 헤더(CSP·nosniff·noindex·`Strict-Transport-Security`), 후기 링크 만들기→작성→승인→공개 목록, 사진 숨김
- [ ] 관리자 화면 "연락처 설정"에서 카카오톡 채널 ID, 문자 받을 휴대폰 번호 입력(홈페이지에 공개됨을 업체와 확인)

### 4. 마무리

- [ ] **GitHub Pages 끄기는 이전이 모두 끝나고 위 확인을 마친 뒤에** 합니다(저장소 Settings → Pages). 그 전까지 GitHub Pages 에서는 `/admin`, `/review/write` 화면 파일이 보이지만 API 가 없어 "이 주소에서는 사용할 수 없습니다" 안내만 나옵니다.
- [ ] 개인정보 처리방침에 후기 수집 항목(별명, 이용 서비스, 내용, 사진)과 삭제 요청 방법 반영 검토
- [ ] D1 백업 방법 정하기(Time Travel 또는 정기 내보내기)
