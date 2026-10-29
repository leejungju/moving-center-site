// 관리자 행동 기록

import type { Env } from "./types";

export async function audit(env: Env, now: number, action: string, target = ""): Promise<void> {
  await env.DB.prepare("INSERT INTO audit_log (created_at, action, target) VALUES (?1, ?2, ?3)").bind(now, action, target).run();
}
