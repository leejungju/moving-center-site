// 함수 응답 공통 처리. _headers 는 정적 파일에만 적용되므로 API 응답의 보안 헤더는 여기서 붙인다.

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
};

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function fail(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error: message, ...extra }, status);
}

/**
 * 본문을 스트림으로 읽으며 바이트 수를 센다. maxBytes 를 넘는 순간 읽기를 멈추고 "too_large" 를 돌려준다.
 * Content-Length 가 없거나(chunked) 거짓이어도 같은 상한이 걸린다.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array | "too_large"> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > maxBytes) return "too_large";
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return null;
  const body = await readBodyLimited(request, maxBytes);
  if (body === "too_large") return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/** 상태를 바꾸는 요청은 Origin 헤더가 이 사이트 주소와 같아야 한다. */
export function originAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === url.origin;
}
