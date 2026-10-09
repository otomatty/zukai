import { open, close, box, px, txt, ln, rect, mid, columns, unknownKeys } from './svg.js';

const layout = (spec, t) => columns(t, spec.children.length, spec.children.length > 3 ? 24 : 48, 208);

// tree: 1つのものが部品に分かれる様子を、上から下への分解で示す。
export default {
  name: 'tree',
  summary: '1つのものが部品に分かれる様子を、上から下への分解で示す',
  when: '1つのものが部品に分かれ、部品がさらに分かれる',
  example: `type: tree
root: 認証サービス
children:
  - label: 受付
    items: [入力の検証, 失敗回数の記録]
  - label: 照合
    items: [ハッシュの計算, 利用者DBの参照]
  - label: 発行
    items: [Cookieの設定]`,
  fields: ['root: 分解する対象の名前（必須）', 'children: 部品の配列。左から順に並べる', 'children[].label: 部品の名前（必須）', 'children[].items: その部品をさらに分けた要素の名前の配列（任意）'],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'root', 'children'], 'tree')];
    if (typeof spec.root !== 'string' || !spec.root) errors.push('tree には root（分解する対象の名前）が必要です。');
    if (!Array.isArray(spec.children) || spec.children.length < 2) return [...errors, 'tree には children が2つ以上必要です。'];
    if (spec.children.length > limits.tree.maxChildren) errors.push(`children が${spec.children.length}個あります。上限は${limits.tree.maxChildren}個です。`);
    spec.children.forEach((c, i) => {
      errors.push(...unknownKeys(c, ['label', 'items'], `children[${i}]`));
      if (typeof c?.label !== 'string') errors.push(`children[${i}] に label がありません。`);
      if (c?.items !== undefined && (!Array.isArray(c.items) || c.items.some((x) => typeof x !== 'string'))) errors.push(`children[${i}].items は名前の配列にしてください。`);
      else if ((c?.items?.length ?? 0) > limits.tree.maxItems) errors.push(`children[${i}].items が${c.items.length}個あります。上限は${limits.tree.maxItems}個です。`);
    });
    return errors;
  },

  fit(spec, t) {
    const { w } = layout(spec, t);
    const out = [];
    for (const c of spec.children) {
      if (px(c.label, t.size.label) + 24 > w) out.push(`部品「${c.label}」が箱に収まりません。短くするか、children を減らしてください。`);
      for (const item of c.items ?? []) if (px(item, 13) + 16 > w - 32) out.push(`要素「${item}」が箱に収まりません。短くしてください。`);
    }
    return out;
  },

  labels: (spec) => [spec.root, ...spec.children.map((c) => c.label)],
  notes: () => [],

  render(spec, t) {
    const { w, xs } = layout(spec, t);
    const cx = xs.map((x) => x + w / 2);
    const center = t.figure.width / 2;
    const rw = Math.max(200, px(spec.root, t.size.label) + 48);
    const most = Math.max(...spec.children.map((c) => c.items?.length ?? 0));
    const out = [open(t, most ? 184 + most * 52 - 6 : 164, `${spec.root}の分解`)];
    out.push(ln(t, `M${center} 50 L${center} 80`), ln(t, `M${Math.min(cx[0], center)} 80 L${Math.max(cx.at(-1), center)} 80`));
    cx.forEach((x) => out.push(ln(t, `M${x} 80 L${x} 112`)));
    out.push(box(t, center - rw / 2, 2, rw, 48, spec.root, { emphasis: true }));
    spec.children.forEach((c, i) => {
      const items = c.items ?? [];
      if (items.length) out.push(ln(t, `M${xs[i] + 16} 160 L${xs[i] + 16} ${204 + (items.length - 1) * 52}`));
      items.forEach((item, j) => {
        const y = 184 + j * 52;
        out.push(ln(t, `M${xs[i] + 16} ${y + 20} L${xs[i] + 32} ${y + 20}`), rect(t, xs[i] + 32, y, w - 32, 40), txt(t, xs[i] + 32 + (w - 32) / 2, mid(y + 20, 13), item, { fill: t.color.ink, size: 13 }));
      });
      out.push(box(t, xs[i], 112, w, 48, c.label));
    });
    out.push(close());
    return out.join('');
  },
};
