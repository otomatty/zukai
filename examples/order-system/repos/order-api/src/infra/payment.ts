export interface PaymentResult {
  ok: boolean;
  reason?: 'declined' | 'timeout';
}

const endpoint = process.env.PAYMENT_ENDPOINT!;

// 決済サービスに与信を依頼する。時間内に応答がなければ、失敗として扱う。
export async function authorize(orderId: string, amount: number, opts: { timeoutMs: number }): Promise<PaymentResult> {
  try {
    const res = await fetch(`${endpoint}/authorizations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': orderId },
      body: JSON.stringify({ orderId, amount }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    return res.ok ? { ok: true } : { ok: false, reason: 'declined' };
  } catch {
    return { ok: false, reason: 'timeout' };
  }
}
