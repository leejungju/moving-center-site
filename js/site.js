// 공개 페이지 스크립트
// - 서비스 지역 검색
// - 설정값(홈페이지 문구, 카카오톡 채널, 문자 받을 번호) 적용
// - 문자 견적 문의 양식(sms: 링크, 서버로 보내지 않음)
// - 고객 후기 목록
// API 를 불러오지 못하면(예: GitHub Pages) HTML 에 적힌 문구를 그대로 두고, 후기·문자 양식·카카오 버튼은 숨긴 채로 둔다.
// 사용자 입력과 서버 값은 textContent 로만 화면에 넣는다.
"use strict";

(function () {
  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("missing #" + id);
    return el;
  }

  /**
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * @param {string} url
   * @returns {Promise<any>}
   */
  async function getJson(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const type = res.headers.get("Content-Type") || "";
    if (type.indexOf("application/json") === -1) throw new Error("not json");
    const data = await res.json();
    if (!data || data.ok !== true) throw new Error("bad response");
    return data;
  }

  // ---------- 서비스 지역 검색 ----------
  function setupRegionSearch() {
    const input = /** @type {HTMLInputElement} */ (byId("region-input"));
    const result = byId("region-result");
    const regions = /** @type {NodeListOf<HTMLDetailsElement>} */ (document.querySelectorAll("#region-list .region"));
    input.addEventListener("input", function () {
      const q = input.value.replace(/\s+/g, "");
      let count = 0;
      regions.forEach(function (region) {
        const summary = region.querySelector("summary");
        const name = summary ? summary.textContent || "" : "";
        const items = region.querySelectorAll("li");
        const provinceMatch = q !== "" && name.indexOf(q) !== -1;
        let anyMatch = false;
        items.forEach(function (li) {
          const hit = q !== "" && (provinceMatch || (li.textContent || "").indexOf(q) !== -1);
          li.classList.toggle("is-match", hit && !provinceMatch);
          if (hit) {
            anyMatch = true;
            count++;
          }
        });
        region.hidden = q !== "" && !anyMatch;
        region.open = q === "" ? region === regions[0] : anyMatch;
      });
      if (q === "") {
        result.textContent = "";
      } else if (count > 0) {
        result.textContent = "“" + input.value.trim() + "” 지역 이사 가능합니다. 견적 문의를 남겨 주세요.";
      } else {
        result.textContent = "목록에 없는 지역도 전국 어디든 상담 가능합니다. 전화로 문의해 주세요.";
      }
    });
  }

  // ---------- 설정값 ----------
  /**
   * @param {Record<string, string>} texts
   */
  function applyTexts(texts) {
    document.querySelectorAll("[data-setting]").forEach(function (node) {
      const key = node.getAttribute("data-setting") || "";
      const value = texts[key];
      if (typeof value === "string" && value.trim() !== "") node.textContent = value;
    });
  }

  /**
   * @param {string} channelId
   */
  function setupKakao(channelId) {
    if (!/^_[A-Za-z0-9]{2,30}$/.test(channelId)) return;
    const link = /** @type {HTMLAnchorElement} */ (byId("kakao-chat"));
    link.href = "https://pf.kakao.com/" + encodeURIComponent(channelId) + "/chat";
    link.hidden = false;
  }

  /**
   * @param {string} number
   */
  function setupSmsForm(number) {
    const digits = number.replace(/\D/g, "");
    if (!/^010\d{8}$/.test(digits)) return;
    const form = /** @type {HTMLFormElement} */ (byId("sms-form"));
    const error = byId("sms-error");
    form.hidden = false;

    /** @param {string} name */
    function field(name) {
      const control = /** @type {HTMLInputElement | null} */ (form.elements.namedItem(name));
      return control ? control.value.trim() : "";
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const from = field("from");
      const to = field("to");
      if (from === "" || to === "") {
        error.textContent = "출발지와 도착지를 적어 주세요.";
        return;
      }
      error.textContent = "";
      const lines = ["[홈페이지 견적 문의]"];
      const name = field("name");
      if (name) lines.push("이름: " + name);
      lines.push("출발지: " + from);
      lines.push("도착지: " + to);
      const date = field("date");
      lines.push("이사 희망일: " + (date || "미정"));
      lines.push("이사 종류: " + field("kind"));
      const memo = field("memo");
      if (memo) lines.push("메모: " + memo);
      window.location.href = "sms:" + digits + "?body=" + encodeURIComponent(lines.join("\n"));
    });
  }

  // ---------- 고객 후기 ----------
  const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

  /**
   * @typedef {{ id: number, nickname: string, service: string, content: string, reply: string | null, createdAt: number, photos: { url: string }[] }} PublicReview
   */

  /**
   * @param {PublicReview} review
   * @returns {HTMLElement}
   */
  function renderReview(review) {
    const card = el("article", "review-card");
    const head = el("div", "review-head");
    head.appendChild(el("strong", "review-name", review.nickname));
    head.appendChild(el("span", "review-service", review.service));
    const time = /** @type {HTMLTimeElement} */ (el("time", "review-date", dateFormat.format(new Date(review.createdAt))));
    time.dateTime = new Date(review.createdAt).toISOString();
    head.appendChild(time);
    card.appendChild(head);
    card.appendChild(el("p", "review-content", review.content));
    if (review.photos.length > 0) {
      const photos = el("div", "review-photos");
      review.photos.forEach(function (photo, i) {
        if (!/^\/api\/photos\/[0-9a-f]{32}$/.test(photo.url)) return;
        const img = /** @type {HTMLImageElement} */ (el("img"));
        img.src = photo.url;
        img.alt = review.nickname + " 고객님 후기 사진 " + (i + 1);
        img.loading = "lazy";
        img.decoding = "async";
        photos.appendChild(img);
      });
      card.appendChild(photos);
    }
    if (review.reply) {
      const reply = el("div", "review-reply");
      reply.appendChild(el("strong", "review-reply-title", "대한익스프레스 답변"));
      reply.appendChild(el("p", "", review.reply));
      card.appendChild(reply);
    }
    return card;
  }

  async function loadReviews() {
    const section = byId("reviews");
    const list = byId("review-list");
    const more = /** @type {HTMLButtonElement} */ (byId("review-more"));
    /** @type {number | null} */
    let lastId = null;

    /** @param {any} data */
    function append(data) {
      /** @type {PublicReview[]} */
      const reviews = data.reviews;
      reviews.forEach(function (r) {
        list.appendChild(renderReview(r));
        lastId = r.id;
      });
      more.hidden = !data.hasMore;
    }

    const first = await getJson("/api/reviews");
    if (!Array.isArray(first.reviews) || first.reviews.length === 0) return;
    append(first);
    section.hidden = false;
    byId("nav-reviews").hidden = false;

    more.addEventListener("click", async function () {
      more.disabled = true;
      try {
        append(await getJson("/api/reviews?before=" + String(lastId)));
      } catch (e) {
        more.hidden = true;
      } finally {
        more.disabled = false;
      }
    });
  }

  setupRegionSearch();

  getJson("/api/settings")
    .then(function (data) {
      if (data.texts && typeof data.texts === "object") applyTexts(data.texts);
      if (typeof data.kakaoChannelId === "string") setupKakao(data.kakaoChannelId);
      if (typeof data.smsNumber === "string") setupSmsForm(data.smsNumber);
    })
    .catch(function () {
      // API 가 없으면 HTML 문구를 그대로 쓴다.
    });

  loadReviews().catch(function () {
    // 후기를 불러오지 못하면 후기 섹션은 숨긴 채로 둔다.
  });
})();
