// 미리보기 전용 스크립트. preview/ 아래 화면에서만 불러온다(실제 화면·서버 코드는 이 파일을 불러오지 않는다).
// - 서버 API(/api/...) 대신 이 브라우저의 localStorage 에만 저장하는 가짜 API 로 답한다(접근이 막히면 메모리).
//   규칙(글자 수, 사진 검사, 링크 1회 사용·30일 만료, 문구·연락처 검사)은 src/ 의 서버 코드와 같게 둔다.
// - 실제 화면 스크립트(js/site.js, js/admin.js, js/review-write.js)에 window.movingCenterPreview 를 넘겨
//   사진 주소, 카카오톡 버튼, 문자 보내기만 미리보기용으로 바꾼다.
// 화면에 넣는 값은 모두 textContent 로 넣는다.
"use strict";

(function () {
  /**
   * scripts/preview.mjs 가 src/ 에서 뽑아 만든 서버 값(preview/server-values.js)
   * @type {{ textFields: { key: string, label: string, max: number, default: string }[], maxPhotos: number, maxPhotoBytes: number, maxPhotoLabel: string, maxBodyBytes: number, tokenTtlMs: number, services: string[] }}
   */
  const SERVER = /** @type {any} */ (window).movingCenterPreviewValues;
  const STORAGE_KEY = "moving-center-site:preview:v1";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const script = /** @type {HTMLScriptElement} */ (document.currentScript);
  /** preview/ 폴더 주소 */
  const BASE = new URL(".", script.src);
  const PAGE = document.documentElement.getAttribute("data-preview-page") || "";

  // ---------- 저장소 ----------
  /**
   * @typedef {{ id: string, hidden: boolean, src: string }} Photo
   * @typedef {{ id: number, nickname: string, service: string, content: string, status: string, reply: string | null, createdAt: number, photos: Photo[] }} Review
   * @typedef {{ token: string, createdAt: number, expiresAt: number, usedAt: number | null }} Token
   * @typedef {{ id: number, createdAt: number, action: string, target: string }} AuditEntry
   * @typedef {{ version: 1, nextReviewId: number, nextAuditId: number, reviews: Review[], tokens: Token[], settings: Record<string, string>, audit: AuditEntry[] }} Store
   */

  /** @type {Store | null} */
  let memory = null;
  let storageBroken = false;

  /** @param {number} length */
  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function randomHex() {
    return Array.from(randomBytes(16), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  /** @param {Uint8Array} bytes */
  function base64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    return btoa(binary);
  }

  /** 처음 상태: 공개 후기 4건(사진 2건·답변 2건), 승인 대기 2건, 카카오톡·문자 연락처 */
  function initialStore() {
    const now = Date.now();
    /** @param {number} days */
    const ago = function (days) {
      return now - days * DAY_MS;
    };
    /** @param {string} file */
    const picture = function (file) {
      return { id: randomHex(), hidden: false, src: "img/" + file };
    };
    /** @type {Review[]} */
    const reviews = [
      {
        id: 1,
        nickname: "예시 고객1",
        service: "가정이사",
        content: "예시 후기입니다. 포장부터 정리까지 꼼꼼하게 해 주셔서 새 집에서 바로 생활할 수 있었습니다.",
        status: "published",
        reply: "예시 답변입니다. 이용해 주셔서 감사합니다. 새 집에서 행복하세요.",
        createdAt: ago(20),
        photos: [picture("example-boxes.svg"), picture("example-room.svg")],
      },
      {
        id: 2,
        nickname: "예시 고객2",
        service: "원룸이사",
        content: "예시 후기입니다. 약속한 시간에 맞춰 오셔서 짐이 적은 원룸 이사가 금방 끝났어요.",
        status: "published",
        reply: null,
        createdAt: ago(14),
        photos: [picture("example-truck.svg")],
      },
      {
        id: 3,
        nickname: "예시 고객3",
        service: "사무실이사",
        content: "예시 후기입니다. 사무실 컴퓨터와 서류를 안전하게 옮겨 주셔서 다음 날 바로 업무를 시작했습니다.",
        status: "published",
        reply: "예시 답변입니다. 업무에 지장이 없도록 일정을 맞춰 드릴 수 있어 다행입니다.",
        createdAt: ago(9),
        photos: [],
      },
      {
        id: 4,
        nickname: "예시 고객4",
        service: "보관이사",
        content: "예시 후기입니다. 입주 날짜가 맞지 않아 짐을 맡겼는데, 보관했다가 원하는 날 그대로 옮겨 주셨습니다.",
        status: "published",
        reply: null,
        createdAt: ago(5),
        photos: [],
      },
      {
        id: 5,
        nickname: "예시 고객5",
        service: "가정이사",
        content: "예시 후기입니다(승인 대기). 무거운 가구도 흠집 없이 옮겨 주셨어요. 관리자 화면에서 공개해 보세요.",
        status: "pending",
        reply: null,
        createdAt: ago(2),
        photos: [picture("example-room.svg")],
      },
      {
        id: 6,
        nickname: "예시 고객6",
        service: "원룸이사",
        content: "예시 후기입니다(승인 대기). 견적 상담이 친절했고 추가 비용 없이 깔끔하게 끝났습니다.",
        status: "pending",
        reply: null,
        createdAt: ago(1),
        photos: [],
      },
    ];
    /** @type {AuditEntry[]} */
    const audit = [];
    [1, 2, 3, 4].forEach(function (id, i) {
      const r = reviews[id - 1];
      audit.push({ id: i + 1, createdAt: r.createdAt + 3600000, action: "후기 공개", target: "후기 #" + r.id + " (" + r.nickname + ")" });
    });
    /** @type {Store} */
    const store = {
      version: 1,
      nextReviewId: 7,
      nextAuditId: audit.length + 1,
      reviews: reviews,
      tokens: [],
      settings: { kakao_channel_id: "_example", sms_number: "01000000000" },
      audit: audit,
    };
    return store;
  }

  /**
   * 다른 탭(관리자 화면 ↔ 후기 작성 화면)에서 바꾼 내용도 보이도록 매번 저장소에서 다시 읽는다.
   * @returns {Store}
   */
  function load() {
    if (storageBroken && memory) return memory;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.version === 1 && Array.isArray(data.reviews)) {
          memory = /** @type {Store} */ (data);
          return memory;
        }
      }
    } catch (e) {
      storageBroken = true;
    }
    const fresh = initialStore();
    save(fresh);
    return fresh;
  }

  /** @param {Store} store */
  function save(store) {
    memory = store;
    if (storageBroken) return showStorageWarning();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      // 저장 공간이 없거나 막힌 브라우저: 이 화면을 닫기 전까지만 메모리에 둔다.
      storageBroken = true;
      showStorageWarning();
    }
  }

  function showStorageWarning() {
    const warn = document.getElementById("preview-storage-warn");
    if (warn) warn.hidden = false;
  }

  function resetStore() {
    memory = null;
    storageBroken = false;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // 메모리만 비운다.
    }
  }

  /**
   * @param {Store} store
   * @param {string} action
   * @param {string} [target]
   */
  function audit(store, action, target) {
    store.audit.push({ id: store.nextAuditId++, createdAt: Date.now(), action: action, target: target || "" });
  }

  // ---------- 서버와 같은 검사 (src/reviews.ts, src/settings.ts, src/jpeg.ts) ----------
  // eslint-disable-next-line no-control-regex
  const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/;

  /** @param {string} text */
  function charLength(text) {
    return [...text].length;
  }

  /** @param {unknown} value */
  function cleanNickname(value) {
    if (typeof value !== "string") return null;
    const text = value.replace(/\s+/g, " ").trim();
    if (CONTROL_CHARS.test(text)) return null;
    const n = charLength(text);
    return n >= 2 && n <= 10 ? text : null;
  }

  /**
   * @param {unknown} value
   * @param {number} [min]
   * @param {number} [max]
   */
  function cleanContent(value, min, max) {
    if (typeof value !== "string") return null;
    const text = value.replace(/\r\n?/g, "\n").trim();
    if (CONTROL_CHARS.test(text.replace(/[\n\t]/g, ""))) return null;
    const n = charLength(text);
    return n >= (min === undefined ? 10 : min) && n <= (max === undefined ? 1000 : max) ? text : null;
  }

  /** @param {string} value */
  function normalizeMobile(value) {
    const digits = value.replace(/[\s-]/g, "");
    return /^010\d{8}$/.test(digits) ? digits : null;
  }

  /** @param {string} value */
  function validKakaoChannelId(value) {
    return /^_[A-Za-z0-9]{2,30}$/.test(value);
  }

  /**
   * src/jpeg.ts 의 checkJpeg 와 같은 규칙: JFIF 머리말과 영상 구간만 허용, 메타데이터 구간이 있으면 거부
   * @param {Uint8Array} bytes
   * @returns {"ok" | "not_jpeg" | "too_large" | "has_metadata"}
   */
  function checkJpeg(bytes) {
    if (bytes.length > SERVER.maxPhotoBytes) return "too_large";
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return "not_jpeg";
    const JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00];
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) return "not_jpeg";
      const marker = bytes[i + 1];
      if (marker === undefined) return "not_jpeg";
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd9) return i + 2 === bytes.length ? "ok" : "not_jpeg";
      if (marker >= 0xd0 && marker <= 0xd7) {
        i += 2;
        continue;
      }
      if (i + 3 >= bytes.length) return "not_jpeg";
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (length < 2) return "not_jpeg";
      if (marker === 0xe0) {
        if (length !== 16 || JFIF.some(function (b, k) {
          return bytes[i + 4 + k] !== b;
        })) return "has_metadata";
        if (bytes[i + 16] !== 0 || bytes[i + 17] !== 0) return "has_metadata";
      } else if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
        return "has_metadata";
      } else if (!((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) || marker === 0xdb || marker === 0xdd || marker === 0xdc || marker === 0xda)) {
        return "has_metadata";
      }
      let next = i + 2 + length;
      if (next > bytes.length) return "not_jpeg";
      if (marker === 0xda) {
        while (next < bytes.length - 1) {
          if (bytes[next] === 0xff) {
            const m = bytes[next + 1];
            if (m !== 0x00 && !(m >= 0xd0 && m <= 0xd7)) break;
          }
          next += 1;
        }
        if (next >= bytes.length - 1) return "ok";
      }
      i = next;
    }
    return "ok";
  }

  /** @type {Record<string, string>} */
  const TOKEN_MESSAGES = {
    used: "이미 후기를 작성한 링크입니다. 소중한 후기 감사합니다.",
    expired: "링크의 사용 기간(30일)이 지났습니다. 업체에 새 링크를 요청해 주세요.",
    invalid: "올바르지 않은 링크입니다. 받은 링크 주소를 다시 확인해 주세요.",
  };
  const INVITE_ONLY = "후기는 업체에서 보내 드린 링크로만 작성할 수 있습니다.";

  /**
   * @param {Store} store
   * @param {string} token
   * @returns {{ state: "valid" | "used" | "expired" | "invalid", row: Token | null }}
   */
  function tokenState(store, token) {
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(token)) return { state: "invalid", row: null };
    const row = store.tokens.find(function (t) {
      return t.token === token;
    });
    if (!row) return { state: "invalid", row: null };
    if (row.usedAt !== null) return { state: "used", row: row };
    if (row.expiresAt <= Date.now()) return { state: "expired", row: row };
    return { state: "valid", row: row };
  }

  // ---------- 가짜 API ----------
  /**
   * @typedef {{ status: number, body: Record<string, unknown> }} Reply
   * @typedef {{ method: string, url: URL, params: Record<string, string>, body: unknown }} Req
   */

  /**
   * @param {Record<string, unknown>} body
   * @param {number} [status]
   * @returns {Reply}
   */
  function ok(body, status) {
    return { status: status || 200, body: Object.assign({ ok: true }, body) };
  }

  /**
   * @param {number} status
   * @param {string} message
   * @param {Record<string, unknown>} [extra]
   * @returns {Reply}
   */
  function fail(status, message, extra) {
    return { status: status, body: Object.assign({ ok: false, error: message }, extra || {}) };
  }

  /** @param {unknown} body */
  function jsonBody(body) {
    if (typeof body !== "string") return null;
    try {
      const data = JSON.parse(body);
      return data && typeof data === "object" ? data : null;
    } catch (e) {
      return null;
    }
  }

  /** @param {Review} r */
  function reviewTarget(r) {
    return "후기 #" + r.id + " (" + r.nickname + ")";
  }

  /** @param {Store} store */
  function textValues(store) {
    /** @type {Record<string, string>} */
    const out = {};
    SERVER.textFields.forEach(function (f) {
      out[f.key] = store.settings[f.key] !== undefined ? store.settings[f.key] : f.default;
    });
    return out;
  }

  /**
   * @param {Store} store
   * @param {Req} req
   */
  function findReview(store, req) {
    const raw = req.params.id || "";
    if (!/^\d{1,12}$/.test(raw)) return null;
    return (
      store.reviews.find(function (r) {
        return r.id === Number(raw);
      }) || null
    );
  }

  /**
   * @param {Store} store
   * @param {Req} req
   */
  function findPhoto(store, req) {
    const id = req.params.id || "";
    for (const r of store.reviews) {
      const photo = r.photos.find(function (p) {
        return p.id === id;
      });
      if (photo) return { review: r, photo: photo };
    }
    return null;
  }

  /** @param {Review[]} list */
  function newestFirst(list) {
    return list.slice().sort(function (a, b) {
      return b.createdAt - a.createdAt || b.id - a.id;
    });
  }

  /**
   * @param {Store} store
   * @param {Req} req
   * @param {string} status
   * @param {string} action
   */
  function setStatus(store, req, status, action) {
    const review = findReview(store, req);
    if (!review) return fail(404, "후기를 찾을 수 없습니다.");
    review.status = status;
    audit(store, action, reviewTarget(review));
    save(store);
    return ok({});
  }

  /**
   * @param {Store} store
   * @param {Req} req
   * @param {boolean} hidden
   * @param {string} action
   */
  function setPhotoHidden(store, req, hidden, action) {
    const found = findPhoto(store, req);
    if (!found) return fail(404, "사진을 찾을 수 없습니다.");
    found.photo.hidden = hidden;
    audit(store, action, reviewTarget(found.review) + "의 사진");
    save(store);
    return ok({});
  }

  /**
   * @param {Store} store
   * @param {Req} req
   * @returns {Promise<Reply>}
   */
  async function submitReview(store, req) {
    const form = req.body;
    if (!(form instanceof FormData)) return fail(400, "잘못된 요청입니다.");
    const nickname = cleanNickname(form.get("nickname"));
    if (!nickname) return fail(400, "별명은 2~10자로 적어 주세요.");
    const service = form.get("service");
    if (typeof service !== "string" || SERVER.services.indexOf(service) === -1) return fail(400, "이용 서비스를 골라 주세요.");
    const content = cleanContent(form.get("content"));
    if (!content) return fail(400, "후기 내용은 10~1000자로 적어 주세요.");
    if (form.get("consent") !== "yes") return fail(400, "개인정보 수집·이용 안내에 동의해 주세요.");

    const files = form.getAll("photos").filter(function (f) {
      return typeof f !== "string" && f.size > 0;
    });
    if (files.length > SERVER.maxPhotos) return fail(400, "사진은 3장까지 올릴 수 있습니다.");
    let total = 0;
    /** @type {string[]} */
    const photos = [];
    const tooLarge = "사진 한 장은 " + SERVER.maxPhotoLabel + " 이하여야 합니다.";
    for (const file of files) {
      const blob = /** @type {Blob} */ (file);
      total += blob.size;
      if (total > SERVER.maxBodyBytes) return fail(413, "사진 용량이 너무 큽니다.");
      if (blob.size > SERVER.maxPhotoBytes) return fail(400, tooLarge);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const check = checkJpeg(bytes);
      if (check === "too_large") return fail(400, tooLarge);
      if (check === "not_jpeg") return fail(400, "JPEG 사진만 올릴 수 있습니다.");
      if (check === "has_metadata") return fail(400, "위치 정보 등 사진 정보가 남아 있는 사진은 올릴 수 없습니다.");
      photos.push("data:image/jpeg;base64," + base64(bytes));
    }

    const token = form.get("t");
    if (typeof token !== "string" || token === "") return fail(403, INVITE_ONLY);
    const check = tokenState(store, token);
    if (check.state !== "valid" || !check.row) return fail(410, TOKEN_MESSAGES[check.state], { reason: check.state });
    const now = Date.now();
    check.row.usedAt = now;
    store.reviews.push({
      id: store.nextReviewId++,
      nickname: nickname,
      service: service,
      content: content,
      status: "pending",
      reply: null,
      createdAt: now,
      photos: photos.map(function (src) {
        return { id: randomHex(), hidden: false, src: src };
      }),
    });
    save(store);
    return ok({ message: "후기가 접수되었습니다. 업체 확인 후 홈페이지에 올라갑니다. 감사합니다." }, 201);
  }

  /**
   * @typedef {{ method: string, pattern: RegExp, handler: (store: Store, req: Req) => Reply | Promise<Reply> }} Route
   * @type {Route[]}
   */
  const ROUTES = [
    {
      method: "GET",
      pattern: /^\/api\/settings$/,
      handler: function (store) {
        return ok({ texts: textValues(store), kakaoChannelId: store.settings.kakao_channel_id || "", smsNumber: store.settings.sms_number || "" });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/reviews$/,
      handler: function (store, req) {
        const beforeParam = req.url.searchParams.get("before");
        const before = beforeParam && /^\d{1,12}$/.test(beforeParam) ? Number(beforeParam) : null;
        const list = newestFirst(
          store.reviews.filter(function (r) {
            return r.status === "published" && (before === null || r.id < before);
          }),
        );
        const page = list.slice(0, 20);
        return ok({
          reviews: page.map(function (r) {
            return {
              id: r.id,
              nickname: r.nickname,
              service: r.service,
              content: r.content,
              reply: r.reply,
              createdAt: r.createdAt,
              photos: r.photos
                .filter(function (p) {
                  return !p.hidden;
                })
                .map(function (p) {
                  return { url: "/api/photos/" + p.id };
                }),
            };
          }),
          hasMore: list.length > 20,
        });
      },
    },
    { method: "POST", pattern: /^\/api\/reviews$/, handler: submitReview },
    {
      method: "GET",
      pattern: /^\/api\/review\/check$/,
      handler: function (store, req) {
        const token = req.url.searchParams.get("t");
        if (token) {
          const state = tokenState(store, token).state;
          if (state === "valid") return ok({ mode: "invite", maxPhotoBytes: SERVER.maxPhotoBytes });
          return { status: 200, body: { ok: false, reason: state, message: TOKEN_MESSAGES[state] } };
        }
        return { status: 200, body: { ok: false, reason: "closed", message: INVITE_ONLY } };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/me$/,
      handler: function () {
        return ok({ email: "미리보기 관리자" });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/reviews$/,
      handler: function (store, req) {
        const status = req.url.searchParams.get("status") || "pending";
        if (["pending", "published", "hidden"].indexOf(status) === -1) return fail(400, "잘못된 요청입니다.");
        /** @type {Record<string, number>} */
        const counts = { pending: 0, published: 0, hidden: 0 };
        store.reviews.forEach(function (r) {
          counts[r.status] = (counts[r.status] || 0) + 1;
        });
        return ok({
          counts: counts,
          reviews: newestFirst(
            store.reviews.filter(function (r) {
              return r.status === status;
            }),
          ).map(function (r) {
            return {
              id: r.id,
              nickname: r.nickname,
              service: r.service,
              content: r.content,
              status: r.status,
              reply: r.reply,
              createdAt: r.createdAt,
              photos: r.photos.map(function (p) {
                return { id: p.id, hidden: p.hidden, url: "/api/admin/photos/" + p.id };
              }),
            };
          }),
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/admin\/reviews\/(?<id>[^/]+)\/publish$/,
      handler: function (store, req) {
        return setStatus(store, req, "published", "후기 공개");
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/admin\/reviews\/(?<id>[^/]+)\/hide$/,
      handler: function (store, req) {
        return setStatus(store, req, "hidden", "후기 숨김");
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/admin\/reviews\/(?<id>[^/]+)\/reply$/,
      handler: function (store, req) {
        const review = findReview(store, req);
        if (!review) return fail(404, "후기를 찾을 수 없습니다.");
        const body = jsonBody(req.body);
        if (!body || typeof body.reply !== "string") return fail(400, "잘못된 요청입니다.");
        if (body.reply.trim() === "") {
          review.reply = null;
          audit(store, "답변 지움", reviewTarget(review));
          save(store);
          return ok({});
        }
        const reply = cleanContent(body.reply, 1, 1000);
        if (!reply) return fail(400, "답변은 1000자까지 쓸 수 있습니다.");
        const action = review.reply ? "답변 고침" : "답변 씀";
        review.reply = reply;
        audit(store, action, reviewTarget(review));
        save(store);
        return ok({});
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/reviews\/(?<id>[^/]+)$/,
      handler: function (store, req) {
        const review = findReview(store, req);
        if (!review) return fail(404, "후기를 찾을 수 없습니다.");
        store.reviews = store.reviews.filter(function (r) {
          return r !== review;
        });
        audit(store, "후기 삭제", reviewTarget(review));
        save(store);
        return ok({});
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/admin\/photos\/(?<id>[^/]+)\/hide$/,
      handler: function (store, req) {
        return setPhotoHidden(store, req, true, "사진 숨김");
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/admin\/photos\/(?<id>[^/]+)\/show$/,
      handler: function (store, req) {
        return setPhotoHidden(store, req, false, "사진 다시 보이기");
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/photos\/(?<id>[^/]+)$/,
      handler: function (store, req) {
        const found = findPhoto(store, req);
        if (!found) return fail(404, "사진을 찾을 수 없습니다.");
        found.review.photos = found.review.photos.filter(function (p) {
          return p !== found.photo;
        });
        audit(store, "사진 삭제", reviewTarget(found.review) + "의 사진");
        save(store);
        return ok({});
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/admin\/review-links$/,
      handler: function (store) {
        const token = base64(randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const now = Date.now();
        const expiresAt = now + SERVER.tokenTtlMs;
        store.tokens.push({ token: token, createdAt: now, expiresAt: expiresAt, usedAt: null });
        audit(store, "후기 요청 링크 만듦");
        save(store);
        return ok({ url: new URL("review/write.html?t=" + token, BASE).href, expiresAt: expiresAt }, 201);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/settings$/,
      handler: function (store) {
        const values = textValues(store);
        return ok({
          texts: SERVER.textFields.map(function (f) {
            return { key: f.key, label: f.label, max: f.max, default: f.default, value: values[f.key] };
          }),
          contact: { kakaoChannelId: store.settings.kakao_channel_id || "", smsNumber: store.settings.sms_number || "" },
        });
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/admin\/settings\/texts$/,
      handler: function (store, req) {
        const body = jsonBody(req.body);
        const input = body && body.texts;
        if (!input || typeof input !== "object") return fail(400, "잘못된 요청입니다.");
        const current = textValues(store);
        /** @type {Record<string, string>} */
        const changes = {};
        /** @type {string[]} */
        const labels = [];
        for (const field of SERVER.textFields) {
          const raw = input[field.key];
          if (raw === undefined) continue;
          if (typeof raw !== "string") return fail(400, "잘못된 요청입니다.");
          const value = raw.replace(/\s+/g, " ").trim();
          if (value === "") return fail(400, '"' + field.label + '" 칸이 비어 있습니다.');
          if (charLength(value) > field.max) return fail(400, '"' + field.label + '"은(는) ' + field.max + "자까지 쓸 수 있습니다.");
          if (value !== current[field.key]) {
            changes[field.key] = value;
            labels.push(field.label);
          }
        }
        for (const key of Object.keys(input)) {
          if (
            !SERVER.textFields.some(function (f) {
              return f.key === key;
            })
          )
            return fail(400, "고칠 수 없는 항목입니다.");
        }
        if (labels.length === 0) return ok({ changed: 0 });
        Object.assign(store.settings, changes);
        audit(store, "홈페이지 문구 바꿈", labels.join(", "));
        save(store);
        return ok({ changed: labels.length });
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/admin\/settings\/contact$/,
      handler: function (store, req) {
        const body = jsonBody(req.body);
        if (!body || typeof body.kakaoChannelId !== "string" || typeof body.smsNumber !== "string") return fail(400, "잘못된 요청입니다.");
        const kakao = body.kakaoChannelId.trim();
        if (kakao !== "" && !validKakaoChannelId(kakao)) return fail(400, "카카오톡 채널 ID는 _ 로 시작하는 영문·숫자입니다. (예: _abcde)");
        let sms = "";
        if (body.smsNumber.trim() !== "") {
          const normalized = normalizeMobile(body.smsNumber);
          if (!normalized) return fail(400, "휴대폰 번호는 010 으로 시작하는 11자리 숫자로 적어 주세요. (예: 010-1234-5678)");
          sms = normalized;
        }
        /** @type {string[]} */
        const changed = [];
        if ((store.settings.kakao_channel_id || "") !== kakao) changed.push(kakao ? "카카오톡 채널 ID" : "카카오톡 채널 ID 지움");
        if ((store.settings.sms_number || "") !== sms) changed.push(sms ? "문자 받을 번호" : "문자 받을 번호 지움");
        store.settings.kakao_channel_id = kakao;
        store.settings.sms_number = sms;
        if (changed.length > 0) audit(store, "연락처 설정 바꿈", changed.join(", "));
        save(store);
        return ok({});
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/admin\/audit$/,
      handler: function (store, req) {
        const beforeParam = req.url.searchParams.get("before");
        const before = beforeParam && /^\d{1,12}$/.test(beforeParam) ? Number(beforeParam) : null;
        const list = store.audit
          .filter(function (e) {
            return before === null || e.id < before;
          })
          .sort(function (a, b) {
            return b.id - a.id;
          });
        return ok({ entries: list.slice(0, 100), hasMore: list.length > 100 });
      },
    },
  ];

  /**
   * @param {string} method
   * @param {URL} url
   * @param {unknown} body
   * @returns {Promise<Reply>}
   */
  async function handle(method, url, body) {
    const candidates = ROUTES.filter(function (r) {
      return r.pattern.test(url.pathname);
    });
    if (candidates.length === 0) return fail(404, "찾을 수 없습니다.");
    const route = candidates.find(function (r) {
      return r.method === method;
    });
    if (!route) return fail(405, "허용되지 않는 요청입니다.");
    const match = url.pathname.match(route.pattern);
    const params = Object.assign({}, (match && match.groups) || {});
    try {
      return await route.handler(load(), { method: method, url: url, params: params, body: body });
    } catch (e) {
      return fail(500, "잠시 문제가 생겼습니다. 잠시 후 다시 해 주세요.");
    }
  }

  // 실제 화면 스크립트가 부르는 /api/... 요청만 가짜 API 로 돌린다. 다른 요청은 그대로 보낸다.
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname.indexOf("/api/") !== 0) return realFetch(input, init);
    const method = ((init && init.method) || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const reply = await handle(method === "HEAD" ? "GET" : method, url, init ? init.body : undefined);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  };

  // ---------- 안내 창 ----------
  /**
   * @param {string} title
   * @param {string} message
   * @param {string} [detail] 줄바꿈을 그대로 보여 줄 내용
   */
  function showDialog(title, message, detail) {
    const dialog = document.createElement("dialog");
    dialog.className = "preview-dialog";
    dialog.setAttribute("aria-labelledby", "preview-dialog-title");
    const heading = document.createElement("h2");
    heading.id = "preview-dialog-title";
    heading.textContent = title;
    dialog.appendChild(heading);
    const p = document.createElement("p");
    p.textContent = message;
    dialog.appendChild(p);
    if (detail) {
      const pre = document.createElement("pre");
      pre.className = "preview-dialog-detail";
      pre.textContent = detail;
      dialog.appendChild(pre);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "preview-dialog-close";
    close.textContent = "닫기";
    close.addEventListener("click", function () {
      dialog.close();
    });
    dialog.addEventListener("close", function () {
      dialog.remove();
    });
    dialog.appendChild(close);
    document.body.appendChild(dialog);
    dialog.showModal();
    close.focus();
  }

  /** @param {string} digits */
  function formatMobile(digits) {
    return /^010\d{8}$/.test(digits) ? digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7) : digits;
  }

  // ---------- 실제 화면 스크립트에 넘겨주는 설정 ----------
  /** @type {any} */ (window).movingCenterPreview = {
    /** 가짜 API 가 준 사진 주소(/api/photos/..., /api/admin/photos/...)를 이 브라우저에 저장한 그림으로 바꾼다. */
    photoSrc: function (/** @type {string} */ url) {
      const match = /^\/api\/(admin\/)?photos\/([0-9a-f]{32})$/.exec(url);
      if (!match) return "";
      const isAdmin = match[1] === "admin/";
      for (const r of load().reviews) {
        const photo = r.photos.find(function (p) {
          return p.id === match[2];
        });
        if (!photo) continue;
        if (!isAdmin && (photo.hidden || r.status !== "published")) return "";
        return photo.src.indexOf("data:image/jpeg;base64,") === 0 ? photo.src : new URL(photo.src, BASE).href;
      }
      return "";
    },
    openKakao: function (/** @type {string} */ url) {
      showDialog("카카오톡 문의 (미리보기)", "미리보기: 실제로는 카카오톡 채널 채팅이 열립니다.", "열릴 주소: " + url);
    },
    openSms: function (/** @type {string} */ number, /** @type {string} */ body) {
      showDialog(
        "문자 견적 문의 (미리보기)",
        "미리보기: 실제로는 아래 내용이 채워진 문자 앱이 열립니다. 미리보기에서는 문자 앱을 열지 않습니다.",
        "받는 번호: " + formatMobile(number) + "\n\n" + body,
      );
    },
  };

  // ---------- 미리보기 띠 ----------
  const bar = document.getElementById("preview-bar");
  if (bar) {
    const setHeight = function () {
      document.documentElement.style.setProperty("--preview-bar-h", bar.offsetHeight + "px");
    };
    setHeight();
    if (typeof ResizeObserver === "function") new ResizeObserver(setHeight).observe(bar);
  }
  const resetButton = document.getElementById("preview-reset");
  if (resetButton) {
    resetButton.addEventListener("click", function () {
      resetStore();
      window.location.reload();
    });
  }
  if (storageBroken) showStorageWarning();

  // 후기 카드마다 "예시" 표시
  /** @param {Element} card */
  function markExample(card) {
    if (card.querySelector(".preview-badge")) return;
    const badge = document.createElement("span");
    badge.className = "preview-badge";
    badge.textContent = "예시";
    const head = card.querySelector(".review-head, .review-meta");
    (head || card).insertBefore(badge, (head || card).firstChild);
  }
  const listSelector = PAGE === "admin" ? "#review-items" : "#review-list";
  const list = document.querySelector(listSelector);
  if (list) {
    const cardSelector = PAGE === "admin" ? ".review-item" : ".review-card";
    new MutationObserver(function () {
      list.querySelectorAll(cardSelector).forEach(markExample);
    }).observe(list, { childList: true });
  }

  if (PAGE === "public") {
    // 다른 탭(미리보기 관리자 화면)에서 바꾸면 공개 페이지를 다시 불러와 바로 보여 준다.
    window.addEventListener("storage", function (event) {
      if (event.key === STORAGE_KEY || event.key === null) window.location.reload();
    });
  }

  if (PAGE === "admin") {
    // Access 로그아웃 주소는 미리보기에서 열지 않는다.
    document.addEventListener(
      "click",
      function (event) {
        const target = event.target instanceof Element ? event.target.closest('a[href="/cdn-cgi/access/logout"]') : null;
        if (!target) return;
        event.preventDefault();
        showDialog("로그아웃 (미리보기)", "미리보기: 실제로는 Cloudflare Access 로그아웃 화면으로 이동합니다.");
      },
      true,
    );

    // 만든 링크를 바로 열어 보거나, 기간이 지난 링크로 만들어 만료 규칙을 확인하는 미리보기 전용 버튼
    const output = document.getElementById("link-output");
    const linkText = /** @type {HTMLInputElement | null} */ (document.getElementById("link-text"));
    if (output && linkText) {
      const tools = document.createElement("div");
      tools.className = "preview-link-tools";
      const note = document.createElement("p");
      note.className = "preview-note";
      note.textContent = "미리보기 전용 버튼 (실제 관리자 화면에는 없습니다)";
      const open = document.createElement("button");
      open.type = "button";
      open.id = "preview-open-link";
      open.className = "btn btn-secondary btn-block";
      open.textContent = "이 링크로 후기 작성 화면 열기";
      open.addEventListener("click", function () {
        if (linkText.value) window.open(linkText.value, "_blank", "noopener");
      });
      const expire = document.createElement("button");
      expire.type = "button";
      expire.id = "preview-expire-link";
      expire.className = "btn btn-secondary btn-block";
      expire.textContent = "이 링크를 사용 기간(30일)이 지난 링크로 만들기";
      expire.addEventListener("click", function () {
        const token = new URL(linkText.value || "about:blank").searchParams.get("t") || "";
        const store = load();
        const row = store.tokens.find(function (t) {
          return t.token === token;
        });
        if (!row) return;
        row.expiresAt = Date.now() - 1;
        save(store);
        showDialog("링크 만료 (미리보기)", "이 링크를 사용 기간이 지난 것으로 바꿨습니다. 열어 보면 기간이 지났다는 안내가 나옵니다.");
      });
      tools.appendChild(note);
      tools.appendChild(open);
      tools.appendChild(expire);
      output.appendChild(tools);
    }
  }
})();
