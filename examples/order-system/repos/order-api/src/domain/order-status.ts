export type OrderStatus = 'accepted' | 'paid' | 'shipped' | 'cancelled';

// 移ることのできる状態の一覧。ここにない移り変わりは、すべて拒否する。
const transitions: Record<OrderStatus, OrderStatus[]> = {
  accepted: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`注文の状態を ${from} から ${to} へ変更できません。`);
  }
}
