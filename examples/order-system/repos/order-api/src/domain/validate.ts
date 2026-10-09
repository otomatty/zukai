export interface OrderInput {
  customerId: string;
  items: { sku: string; quantity: number }[];
  total: number;
}

const MAX_ITEMS = 50;

export function validateOrder(body: unknown): OrderInput {
  const input = body as OrderInput;
  if (!input?.customerId) throw new Error('customerId がありません。');
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('商品がありません。');
  if (input.items.length > MAX_ITEMS) throw new Error(`商品は ${MAX_ITEMS} 種類までです。`);
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('数量が正しくありません。');
  }
  return input;
}
