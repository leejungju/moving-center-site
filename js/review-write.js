// 고객 후기 작성 화면
// - 링크(?t=토큰) 확인, 또는 공개 후기 양식(관리자가 켠 경우에만)과 Turnstile
// - 사진은 브라우저에서 긴 변 1600px 이하 JPEG 로 다시 그려 위치 정보 등 사진 정보를 없앤 뒤 올린다.
"use strict";

(function () {
  const MAX_PHOTOS = 3;
  const MAX_SIDE = 1600;
  const MAX_BYTES = 5 * 1024 * 1024;

  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("missing #" + id);
    return el;
  }

  const status = byId("status");
  const form = /** @type {HTMLFormElement} */ (byId("review-form"));
  const errorBox = byId("form-error");
  const submitButton = /** @type {HTMLButtonElement} */ (byId("submit-button"));
  const content = /** @type {HTMLTextAreaElement} */ (byId("content"));
  const counter = byId("content-count");
  const photoInput = /** @type {HTMLInputElement} */ (byId("photo-input"));
  const photoButton = /** @type {HTMLButtonElement} */ (byId("photo-button"));
  const previews = byId("photo-previews");

  const token = new URLSearchParams(window.location.search).get("t") || "";
  /** @type {{ blob: Blob, url: string }[]} */
  const photos = [];

  /**
   * @param {string} message
   * @param {string} [kind]
   */
  function showStatus(message, kind) {
    status.textContent = message;
    status.className = "notice" + (kind ? " notice-" + kind : "");
    status.hidden = false;
  }

  /** @param {string} message */
  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = message === "";
  }

  function updateCounter() {
    counter.textContent = [...content.value].length + " / 1000";
  }

  /**
   * 사진을 다시 그려 메타데이터 없는 JPEG 로 만든다.
   * @param {File} file
   * @returns {Promise<Blob>}
   */
  async function toCleanJpeg(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext("2d");
      if (!g) throw new Error("canvas");
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, width, height);
      g.drawImage(img, 0, 0, width, height);
      let quality = 0.85;
      for (;;) {
        const blob = await new Promise(function (resolve) {
          canvas.toBlob(resolve, "image/jpeg", quality);
        });
        if (!(blob instanceof Blob)) throw new Error("toBlob");
        if (blob.size <= MAX_BYTES - 64 * 1024 || quality <= 0.4) return blob;
        quality -= 0.15;
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function renderPreviews() {
    previews.replaceChildren();
    photos.forEach(function (photo, index) {
      const box = document.createElement("div");
      box.className = "photo-preview";
      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = "고른 사진 " + (index + 1);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-danger btn-small";
      remove.textContent = "빼기";
      remove.addEventListener("click", function () {
        URL.revokeObjectURL(photo.url);
        photos.splice(index, 1);
        renderPreviews();
      });
      box.appendChild(img);
      box.appendChild(remove);
      previews.appendChild(box);
    });
    photoButton.hidden = photos.length >= MAX_PHOTOS;
  }

  photoButton.addEventListener("click", function () {
    photoInput.click();
  });

  photoInput.addEventListener("change", async function () {
    const files = Array.from(photoInput.files || []);
    photoInput.value = "";
    showError("");
    if (photos.length + files.length > MAX_PHOTOS) {
      showError("사진은 3장까지 올릴 수 있습니다.");
    }
    photoButton.disabled = true;
    photoButton.textContent = "사진 준비 중…";
    try {
      for (const file of files.slice(0, MAX_PHOTOS - photos.length)) {
        try {
          const blob = await toCleanJpeg(file);
          photos.push({ blob: blob, url: URL.createObjectURL(blob) });
        } catch (e) {
          showError("이 사진은 열 수 없습니다. 다른 사진을 골라 주세요.");
        }
      }
    } finally {
      photoButton.disabled = false;
      photoButton.textContent = "사진 고르기";
      renderPreviews();
    }
  });

  content.addEventListener("input", updateCounter);

  /**
   * @param {string} siteKey
   */
  function loadTurnstile(siteKey) {
    const box = byId("turnstile-box");
    const widget = document.createElement("div");
    widget.className = "cf-turnstile";
    widget.setAttribute("data-sitekey", siteKey);
    widget.setAttribute("data-language", "ko");
    box.appendChild(widget);
    box.hidden = false;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    document.head.appendChild(script);
  }

  /**
   * @returns {string}
   */
  function validate() {
    const nickname = /** @type {HTMLInputElement} */ (byId("nickname")).value.trim();
    const length = [...nickname].length;
    if (length < 2 || length > 10) return "별명은 2~10자로 적어 주세요.";
    if (!form.querySelector('input[name="service"]:checked')) return "이용하신 서비스를 골라 주세요.";
    const text = content.value.trim();
    const textLength = [...text].length;
    if (textLength < 10 || textLength > 1000) return "후기 내용은 10~1000자로 적어 주세요.";
    if (!(/** @type {HTMLInputElement} */ (byId("consent")).checked)) return "개인정보 수집·이용 안내에 동의해 주세요.";
    return "";
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      showError(problem);
      return;
    }
    showError("");
    const data = new FormData(form);
    data.delete("photos");
    photos.forEach(function (photo, i) {
      data.append("photos", photo.blob, "photo" + (i + 1) + ".jpg");
    });
    if (token) data.set("t", token);
    submitButton.disabled = true;
    submitButton.textContent = "보내는 중…";
    try {
      const res = await fetch("/api/reviews", { method: "POST", body: data, credentials: "same-origin" });
      const body = await res.json().catch(function () {
        return null;
      });
      if (res.ok && body && body.ok) {
        form.hidden = true;
        showStatus(body.message || "후기가 접수되었습니다. 감사합니다.", "ok");
        window.scrollTo(0, 0);
        return;
      }
      const message = (body && body.error) || "보내지 못했습니다. 잠시 후 다시 해 주세요.";
      if (res.status === 410) {
        // 그사이 링크가 사용됐거나 기간이 지났다.
        form.hidden = true;
        showStatus(message, "error");
      } else {
        showError(message);
      }
    } catch (e) {
      showError("인터넷 연결을 확인한 뒤 다시 해 주세요.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "후기 보내기";
    }
  });

  async function start() {
    try {
      const url = "/api/review/check" + (token ? "?t=" + encodeURIComponent(token) : "");
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const body = await res.json();
      if (!body || body.ok !== true) {
        showStatus((body && body.message) || "지금은 후기를 작성할 수 없습니다.", "error");
        return;
      }
      if (body.mode === "open") {
        if (typeof body.turnstileSiteKey !== "string" || body.turnstileSiteKey === "") {
          showStatus("지금은 후기를 작성할 수 없습니다.", "error");
          return;
        }
        byId("privacy-open").hidden = false;
        loadTurnstile(body.turnstileSiteKey);
      }
      status.hidden = true;
      form.hidden = false;
      updateCounter();
    } catch (e) {
      showStatus("지금은 후기를 작성할 수 없습니다. 잠시 후 다시 열어 주세요.", "error");
    }
  }

  start();
})();
