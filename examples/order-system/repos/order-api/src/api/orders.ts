import { Router } from 'express';
import { withTransaction } from '../infra/db';
import { authorize } from '../infra/payment';
import { enqueueNotification } from '../infra/queue';
import { assertTransition } from '../domain/order-status';
import { validateOrder } from '../domain/validate';

export const orders = Router();

// 注文を受け付ける。在庫の引き当てと注文の保存は、1つのトランザクションで行う。
orders.post('/orders', async (req, res) => {
  const input = validateOrder(req.body);

  const order = await withTransaction(async (tx) => {
    await tx.reserveStock(input.items);
    return tx.insertOrder({ ...input, status: 'accepted' });
  });

  // 決済はトランザクションの外で行う。決済サービスの応答待ちで、DB の接続を占有しないため。
  const payment = await authorize(order.id, order.total, { timeoutMs: 3000 });
  if (!payment.ok) {
    await withTransaction(async (tx) => {
      assertTransition(order.status, 'cancelled');
      await tx.releaseStock(order.items);
      await tx.updateStatus(order.id, 'cancelled');
    });
    return res.status(402).json({ orderId: order.id, reason: payment.reason });
  }

  await withTransaction(async (tx) => {
    assertTransition(order.status, 'paid');
    await tx.updateStatus(order.id, 'paid');
  });

  // ここでは通知の依頼をキューに入れるだけ。メールは別の処理が送る。
  await enqueueNotification({ type: 'order-confirmed', orderId: order.id });
  return res.status(201).json({ orderId: order.id, status: 'paid' });
});
