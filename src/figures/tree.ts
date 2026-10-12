import { open, close, box, px, txt, ln, rect, mid, columns } from './svg.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType, Tokens } from '../types.ts';

const schema = {
  root: { type: 'string', required: true, nonEmpty: true, desc: '分解する対象の名前' },
  children: {
    type: 'list', required: true, min: 2, max: 'tree.maxChildren', desc: '部品の配列。左から順に並べる',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, desc: '部品の名前' },
        items: { type: 'list', max: 'tree.maxItems', of: { type: 'string' }, desc: 'その部品をさらに分けた要素の名前の配列' },
      },
    },
  },
} as const satisfies Fields;
export type TreeSpec = { type: 'tree' } & Infer<typeof schema>;

const layout = (spec: TreeSpec, t: Tokens) => columns(t, spec.children.length, spec.children.length > 3 ? 24 : 48, 208);

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
  fields: describe(schema, contractLimits),

  validate: (spec, limits) => checkSpec(spec, schema, 'tree', limits),

  fit(spec, t) {
    const { w } = layout(spec, t);
    const out: string[] = [];
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
    out.push(ln(t, `M${center} 50 L${center} 80`), ln(t, `M${Math.min(cx[0], center)} 80 L${Math.max(cx.at(-1)!, center)} 80`));
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
} satisfies FigureType<TreeSpec>;
