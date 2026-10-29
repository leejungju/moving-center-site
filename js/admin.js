// 관리자 화면
// 화면에 넣는 값은 모두 textContent 로 넣는다.
"use strict";

(function () {
  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing #" + id);
    return node;
  }

  /**
   * @param {string} tag
   * @param {{ className?: string, text?: string, type?: string }} [opts]
   * @param {Node[]} [children]
   * @returns {HTMLElement}
   */
  function el(tag, opts, children) {
    const node = document.createElement(tag);
    if (opts && opts.className) node.className = opts.className;
    if (opts && opts.text !== undefined) node.textContent = opts.text;
    if (opts && opts.type) node.setAttribute("type", opts.type);
    (children || []).forEach(function (c) {
      node.appendChild(c);
    });
    return node;
  }

  /**
   * @param {string} text
   * @param {string} className
   * @param {() => void | Promise<void>} onClick
   * @returns {HTMLButtonElement}
   */
  function button(text, className, onClick) {
    const b = /** @type {HTMLButtonElement} */ (el("button", { className: "btn " + className, text: text, type: "button" }));
    b.addEventListener("click", async function () {
      b.disabled = true;
      try {
        await onClick();
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }

  const timeFormat = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  /** @param {number} ms */
  function formatTime(ms) {
    return timeFormat.format(new Date(ms));
  }

  const toast = byId("toast");
  /** @type {number | undefined} */
  let toastTimer;
  /** @param {string} message */
  function notify(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, 3500);
  }

  class ApiError extends Error {
    /**
     * @param {number} status
     * @param {string} message
     */
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @returns {Promise<any>}
   */
  async function api(method, path, body) {
    /** @type {RequestInit} */
    const init = { method: method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (body !== undefined) {
      init.headers = { Accept: "application/json", "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      throw new ApiError(0, "인터넷 연결을 확인해 주세요.");
    }
    const data = await res.json().catch(function () {
      return null;
    });
    if (res.status === 401 && path !== "/api/admin/login") {
      showLogin("로그인 시간이 지났습니다. 다시 로그인해 주세요.");
      throw new ApiError(401, "로그인이 필요합니다.");
    }
    if (!res.ok || !data || data.ok !== true) {
      throw new ApiError(res.status, (data && data.error) || "잠시 문제가 생겼습니다. 다시 해 주세요.");
    }
    return data;
  }

  /**
   * 오류는 알림으로 보여 준다.
   * @param {() => Promise<void>} fn
   */
  async function attempt(fn) {
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      notify(e instanceof Error ? e.message : "잠시 문제가 생겼습니다.");
    }
  }

  // ---------- 로그인 ----------
  const loginView = byId("login-view");
  const appView = byId("app-view");
  const loginError = byId("login-error");
  const logoutButton = byId("logout-button");

  /** @param {string} [message] */
  function showLogin(message) {
    byId("loading").hidden = true;
    appView.hidden = true;
    logoutButton.hidden = true;
    loginView.hidden = false;
    loginError.textContent = message || "";
    loginError.hidden = !message;
  }

  function showApp() {
    byId("loading").hidden = true;
    loginView.hidden = true;
    appView.hidden = false;
    logoutButton.hidden = false;
    openView("reviews");
  }

  byId("login-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const id = /** @type {HTMLInputElement} */ (byId("login-id"));
    const password = /** @type {HTMLInputElement} */ (byId("login-password"));
    const submit = /** @type {HTMLButtonElement} */ (byId("login-button"));
    if (id.value.trim() === "" || password.value === "") {
      showLogin("아이디와 비밀번호를 모두 적어 주세요.");
      return;
    }
    submit.disabled = true;
    submit.textContent = "확인하는 중…";
    try {
      await api("POST", "/api/admin/login", { id: id.value.trim(), password: password.value });
      password.value = "";
      showApp();
    } catch (e) {
      showLogin(e instanceof Error ? e.message : "로그인하지 못했습니다.");
    } finally {
      submit.disabled = false;
      submit.textContent = "로그인";
    }
  });

  logoutButton.addEventListener("click", async function () {
    await api("POST", "/api/admin/logout").catch(function () {});
    showLogin("로그아웃했습니다.");
  });

  // ---------- 메뉴 ----------
  const views = ["reviews", "links", "texts", "contact", "audit"];
  /** @type {Record<string, () => Promise<void>>} */
  const loaders = {
    reviews: function () {
      return loadReviews();
    },
    links: async function () {},
    texts: function () {
      return loadSettings();
    },
    contact: function () {
      return loadSettings();
    },
    audit: function () {
      return loadAudit(false);
    },
  };

  /** @param {string} name */
  function openView(name) {
    views.forEach(function (v) {
      byId("view-" + v).hidden = v !== name;
    });
    document.querySelectorAll(".admin-menu [data-view]").forEach(function (b) {
      if (b.getAttribute("data-view") === name) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    const loader = loaders[name];
    if (loader) attempt(loader);
  }

  document.querySelectorAll(".admin-menu [data-view]").forEach(function (b) {
    b.addEventListener("click", function () {
      openView(b.getAttribute("data-view") || "reviews");
    });
  });

  // ---------- 후기 관리 ----------
  let currentStatus = "pending";
  const STATUS_LABELS = /** @type {Record<string, string>} */ ({ pending: "승인 대기", published: "공개 중", hidden: "숨김" });
  const reviewItems = byId("review-items");

  document.querySelectorAll(".tabs [data-status]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      currentStatus = tab.getAttribute("data-status") || "pending";
      attempt(loadReviews);
    });
  });

  /**
   * @typedef {{ id: string, hidden: boolean, url: string }} AdminPhoto
   * @typedef {{ id: number, nickname: string, service: string, content: string, status: string, reply: string | null, createdAt: number, photos: AdminPhoto[] }} AdminReview
   */

  async function loadReviews() {
    const data = await api("GET", "/api/admin/reviews?status=" + encodeURIComponent(currentStatus));
    document.querySelectorAll(".tabs [data-status]").forEach(function (tab) {
      const status = tab.getAttribute("data-status") || "";
      tab.setAttribute("aria-selected", status === currentStatus ? "true" : "false");
      tab.textContent = STATUS_LABELS[status] + " (" + String(data.counts[status] || 0) + ")";
    });
    reviewItems.replaceChildren();
    /** @type {AdminReview[]} */
    const reviews = data.reviews;
    if (reviews.length === 0) {
      reviewItems.appendChild(el("p", { className: "empty panel", text: STATUS_LABELS[currentStatus] + " 후기가 없습니다." }));
      return;
    }
    reviews.forEach(function (r) {
      reviewItems.appendChild(renderReview(r));
    });
  }

  /**
   * @param {AdminReview} r
   * @returns {HTMLElement}
   */
  function renderReview(r) {
    const item = el("article", { className: "review-item" });
    item.appendChild(
      el("div", { className: "review-meta" }, [
        el("strong", { text: r.nickname }),
        el("span", { className: "badge", text: r.service }),
        el("span", { className: "audit-time", text: formatTime(r.createdAt) }),
      ]),
    );
    item.appendChild(el("p", { className: "review-text", text: r.content }));

    if (r.photos.length > 0) {
      const grid = el("div", { className: "admin-photos" });
      r.photos.forEach(function (p, i) {
        const box = el("div", { className: "admin-photo" + (p.hidden ? " is-hidden" : "") });
        const img = /** @type {HTMLImageElement} */ (el("img"));
        img.src = p.url;
        img.alt = r.nickname + " 고객 후기 사진 " + (i + 1);
        img.loading = "lazy";
        box.appendChild(img);
        if (p.hidden) box.appendChild(el("span", { className: "badge badge-hidden", text: "숨김 (홈페이지에 안 보임)" }));
        box.appendChild(
          p.hidden
            ? button("사진 다시 보이기", "btn-secondary btn-small", function () {
                return attempt(async function () {
                  await api("POST", "/api/admin/photos/" + p.id + "/show");
                  notify("사진을 다시 보이게 했습니다.");
                  await loadReviews();
                });
              })
            : button("사진 숨기기", "btn-secondary btn-small", function () {
                return attempt(async function () {
                  await api("POST", "/api/admin/photos/" + p.id + "/hide");
                  notify("사진을 숨겼습니다. 언제든 다시 보이게 할 수 있습니다.");
                  await loadReviews();
                });
              }),
        );
        box.appendChild(
          button("사진 삭제", "btn-danger btn-small", function () {
            return attempt(async function () {
              if (!window.confirm("이 사진을 삭제할까요?\n삭제한 사진은 되돌릴 수 없습니다.")) return;
              if (!window.confirm("정말 삭제합니다. 한 번 더 확인합니다.\n이 사진을 삭제할까요?")) return;
              await api("DELETE", "/api/admin/photos/" + p.id);
              notify("사진을 삭제했습니다.");
              await loadReviews();
            });
          }),
        );
        grid.appendChild(box);
      });
      item.appendChild(grid);
    }

    // 업체 답변
    const replyArea = el("div");
    function showReply() {
      replyArea.replaceChildren();
      if (r.reply) {
        replyArea.appendChild(el("div", { className: "reply-box" }, [el("strong", { text: "업체 답변" }), el("p", { text: r.reply })]));
      }
      replyArea.appendChild(button(r.reply ? "답변 고치기" : "답변 쓰기", "btn-secondary", editReply));
    }
    function editReply() {
      replyArea.replaceChildren();
      const id = "reply-" + r.id;
      const label = el("label", { text: "업체 답변 (1000자까지, 모두 지우고 저장하면 답변이 없어집니다)" });
      label.setAttribute("for", id);
      const textarea = /** @type {HTMLTextAreaElement} */ (el("textarea"));
      textarea.id = id;
      textarea.rows = 4;
      textarea.maxLength = 1000;
      textarea.value = r.reply || "";
      replyArea.appendChild(el("div", { className: "field" }, [label, textarea]));
      replyArea.appendChild(
        el("div", { className: "btn-row" }, [
          button("답변 저장", "btn-primary", function () {
            return attempt(async function () {
              await api("PUT", "/api/admin/reviews/" + r.id + "/reply", { reply: textarea.value });
              r.reply = textarea.value.trim() === "" ? null : textarea.value.trim();
              notify("답변을 저장했습니다.");
              showReply();
            });
          }),
          button("취소", "btn-secondary", function () {
            showReply();
          }),
        ]),
      );
      textarea.focus();
    }
    showReply();
    item.appendChild(replyArea);

    const actions = el("div", { className: "btn-row review-actions" });
    if (r.status !== "published") {
      actions.appendChild(
        button(r.status === "hidden" ? "다시 공개하기" : "공개하기", "btn-green", function () {
          return attempt(async function () {
            await api("POST", "/api/admin/reviews/" + r.id + "/publish");
            notify("후기를 홈페이지에 공개했습니다.");
            await loadReviews();
          });
        }),
      );
    }
    if (r.status !== "hidden") {
      actions.appendChild(
        button("숨기기", "btn-secondary", function () {
          return attempt(async function () {
            if (!window.confirm("이 후기를 숨길까요?\n숨긴 후기는 \"숨김\" 칸에서 언제든 다시 공개할 수 있습니다.")) return;
            await api("POST", "/api/admin/reviews/" + r.id + "/hide");
            notify("후기를 숨겼습니다.");
            await loadReviews();
          });
        }),
      );
    }
    actions.appendChild(
      button("삭제", "btn-danger", function () {
        return attempt(async function () {
          if (!window.confirm("이 후기를 삭제할까요?\n삭제하면 사진까지 모두 지워지고 되돌릴 수 없습니다.\n(잠시 안 보이게만 하려면 \"숨기기\"를 누르세요.)")) return;
          if (!window.confirm("정말 삭제합니다. 한 번 더 확인합니다.\n\"" + r.nickname + "\" 님의 후기를 삭제할까요?")) return;
          await api("DELETE", "/api/admin/reviews/" + r.id);
          notify("후기를 삭제했습니다.");
          await loadReviews();
        });
      }),
    );
    item.appendChild(actions);
    return item;
  }

  // ---------- 후기 요청 링크 ----------
  const linkText = /** @type {HTMLInputElement} */ (byId("link-text"));
  byId("make-link").addEventListener("click", function () {
    attempt(async function () {
      const data = await api("POST", "/api/admin/review-links");
      linkText.value = data.url;
      byId("link-expire").textContent = formatTime(data.expiresAt) + " 까지 쓸 수 있습니다. 한 번 쓰면 다시 쓸 수 없습니다.";
      byId("link-output").hidden = false;
      byId("copy-link").textContent = "복사";
    });
  });

  byId("copy-link").addEventListener("click", async function () {
    const copyButton = byId("copy-link");
    try {
      await navigator.clipboard.writeText(linkText.value);
    } catch (e) {
      linkText.select();
      document.execCommand("copy");
    }
    copyButton.textContent = "복사했습니다 ✓";
    notify("링크를 복사했습니다. 문자나 카카오톡에 붙여 넣어 보내세요.");
  });

  // ---------- 홈페이지 문구 · 연락처 ----------
  /**
   * @typedef {{ key: string, label: string, max: number, default: string, value: string }} TextSetting
   */
  async function loadSettings() {
    const data = await api("GET", "/api/admin/settings");
    const fields = byId("text-fields");
    fields.replaceChildren();
    /** @type {TextSetting[]} */
    const texts = data.texts;
    texts.forEach(function (t) {
      const id = "text-" + t.key;
      const label = el("label", { text: t.label });
      label.setAttribute("for", id);
      const textarea = /** @type {HTMLTextAreaElement} */ (el("textarea"));
      textarea.id = id;
      textarea.name = t.key;
      textarea.rows = t.max > 60 ? 3 : 2;
      textarea.maxLength = t.max;
      textarea.value = t.value;
      const count = el("span", { className: "counter" });
      function updateCount() {
        count.textContent = [...textarea.value].length + " / " + t.max;
      }
      textarea.addEventListener("input", updateCount);
      updateCount();
      const reset = button("원래 문구로 되돌리기", "btn-secondary btn-small", function () {
        textarea.value = t.default;
        updateCount();
      });
      fields.appendChild(el("div", { className: "field" }, [label, textarea, count, reset]));
    });
    /** @type {HTMLInputElement} */ (byId("kakao-id")).value = data.contact.kakaoChannelId;
    /** @type {HTMLInputElement} */ (byId("sms-number")).value = formatMobile(data.contact.smsNumber);
  }

  /** @param {string} digits */
  function formatMobile(digits) {
    return /^010\d{8}$/.test(digits) ? digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7) : digits;
  }

  byId("texts-form").addEventListener("submit", function (event) {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (event.currentTarget);
    attempt(async function () {
      /** @type {Record<string, string>} */
      const texts = {};
      form.querySelectorAll("textarea").forEach(function (t) {
        texts[t.name] = t.value;
      });
      const data = await api("PUT", "/api/admin/settings/texts", { texts: texts });
      notify(data.changed > 0 ? "저장했습니다. 홈페이지에 바로 반영됩니다." : "바뀐 내용이 없습니다.");
    });
  });

  byId("contact-form").addEventListener("submit", function (event) {
    event.preventDefault();
    attempt(async function () {
      const kakao = /** @type {HTMLInputElement} */ (byId("kakao-id")).value.trim();
      const sms = /** @type {HTMLInputElement} */ (byId("sms-number")).value.trim();
      if (sms !== "" && !/^010-?\d{4}-?\d{4}$/.test(sms.replace(/\s/g, ""))) {
        notify("휴대폰 번호는 010 으로 시작하는 11자리로 적어 주세요. (예: 010-1234-5678)");
        return;
      }
      if (sms !== "" && !window.confirm("이 번호는 홈페이지에 공개됩니다.\n" + sms + "\n이 번호로 저장할까요?")) return;
      await api("PUT", "/api/admin/settings/contact", { kakaoChannelId: kakao, smsNumber: sms });
      notify("저장했습니다. 홈페이지에 바로 반영됩니다.");
      await loadSettings();
    });
  });

  // ---------- 최근 기록 ----------
  const auditList = byId("audit-list");
  const auditMore = /** @type {HTMLButtonElement} */ (byId("audit-more"));
  /** @type {number | null} */
  let auditLastId = null;

  /** @param {boolean} append */
  async function loadAudit(append) {
    const path = "/api/admin/audit" + (append && auditLastId !== null ? "?before=" + String(auditLastId) : "");
    const data = await api("GET", path);
    if (!append) auditList.replaceChildren();
    /** @type {{ id: number, createdAt: number, action: string, target: string }[]} */
    const entries = data.entries;
    entries.forEach(function (e) {
      const li = el("li", {}, [el("span", { className: "audit-time", text: formatTime(e.createdAt) }), el("span", { className: "audit-action", text: e.action })]);
      if (e.target) li.appendChild(el("span", { text: e.target }));
      auditList.appendChild(li);
      auditLastId = e.id;
    });
    if (!append && entries.length === 0) auditList.appendChild(el("li", { className: "empty", text: "아직 기록이 없습니다." }));
    auditMore.hidden = !data.hasMore;
  }

  auditMore.addEventListener("click", function () {
    attempt(function () {
      return loadAudit(true);
    });
  });

  // ---------- 시작 ----------
  fetch("/api/admin/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(function (res) {
      if (res.ok) showApp();
      else showLogin();
    })
    .catch(function () {
      showLogin("서버에 연결하지 못했습니다.");
    });
})();
