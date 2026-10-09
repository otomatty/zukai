// 説明用の見本のコードです。実在のサービスのものではありません。
import { randomBytes } from "node:crypto";
import { sessionDb } from "./db";

const TTL_MINUTES = 30;

// 照合に成功した利用者に、セッションIDを発行する。
export async function issueSession(userId: string) {
  const sessionId = randomBytes(32).toString("hex");
  await sessionDb.set(sessionId, userId, { ttlMinutes: TTL_MINUTES });
  return sessionId;
}

// 最後の操作から TTL_MINUTES 分が過ぎたセッションを削除する。
export async function expireSessions(now: Date) {
  return sessionDb.deleteOlderThan(new Date(now.getTime() - TTL_MINUTES * 60_000));
}
