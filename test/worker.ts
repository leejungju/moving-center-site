// 시험 전용 워커 입구. 운영 입구(functions/api/[[path]].ts)와 같은 handleApi 를 부르되,
// 시각을 시험에서 정할 수 있게 X-Test-Now 헤더를 읽는다(인증과는 관계없음, 시험 묶음에만 들어간다).
import { handleApi } from "../src/router";
import type { Env } from "../src/types";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const now = Number(request.headers.get("X-Test-Now"));
    return handleApi(request, env, Number.isFinite(now) && now > 0 ? now : Date.now());
  },
};
