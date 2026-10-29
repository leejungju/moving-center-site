// Cloudflare Pages Functions: /api/* 요청을 src/router.ts 로 넘긴다.
import { handleApi } from "../../src/router";
import type { Env } from "../../src/types";

export const onRequest: PagesFunction<Env> = (context) => handleApi(context.request, context.env);
