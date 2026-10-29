// 시험 전용 워커 입구. 운영 입구(functions/api/[[path]].ts)와 같은 handleApi 를 부르되,
// 시각을 시험에서 정할 수 있게 X-Test-Now 헤더를 읽는다(인증과는 관계없음, 시험 묶음에만 들어간다).
import { limitedBodyStream } from "../src/http";
import { handleApi } from "../src/router";
import type { Env } from "../src/types";

/** 선언한 Content-Length 와 실제 본문 길이가 다른 요청을 워커 안에서 만들어 limitedBodyStream 을 시험한다. */
async function bodyLimitProbe(url: URL): Promise<Response> {
  const declared = url.searchParams.get("declared");
  const actual = Number(url.searchParams.get("actual"));
  const max = Number(url.searchParams.get("max"));
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled >= actual) return c.close();
      const n = Math.min(64 * 1024, actual - pulled);
      pulled += n;
      c.enqueue(new Uint8Array(n).fill(0x41));
    },
  });
  const headers: Record<string, string> = declared === null ? {} : { "Content-Length": declared };
  const request = new Request("https://site.test/", { method: "POST", body, headers });
  const limited = limitedBodyStream(request, max);
  if (limited === "too_large") return Response.json({ result: "too_large", pulled });
  try {
    const read = await new Response(limited.body).arrayBuffer();
    return Response.json({ result: `read ${read.byteLength}`, pulled });
  } catch {
    return Response.json({ result: limited.tooLarge() ? "error too_large" : "error", pulled });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__test/body-limit") return bodyLimitProbe(url);
    const now = Number(request.headers.get("X-Test-Now"));
    return handleApi(request, env, Number.isFinite(now) && now > 0 ? now : Date.now());
  },
};
