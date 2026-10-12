import { open, close, px, esc } from './svg.ts';
import { seriesColor } from './chart.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType } from '../types.ts';

const schema = {
  sets: {
    type: 'list', required: true, min: 2, max: 'venn.maxSets', unique: 'label', desc: '集合の配列',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, nonEmpty: true, desc: '集合の名前' },
        items: { type: 'list', desc: 'その集合だけに属する項目の配列', of: { type: 'string', nonEmpty: true } },
      },
    },
  },
  overlaps: {
    type: 'list', required: true, min: 1, atMostOne: 'emphasis', desc: '重なりの配列。重なりがない集合は、表で示す',
    of: {
      type: 'object',
      fields: {
        // 重なる集合の名前。sets にあるか、同じ名前が重ならないかは、validate が確かめる。
        sets: { type: 'list', required: true, min: 2, desc: '重なる集合の名前の配列。sets[].label のどれかを書く。集合が3つのときは、2つの重なりと、3つすべての重なりを書ける', of: { type: 'string', nonEmpty: true } },
        items: { type: 'list', required: true, min: 1, desc: '重なりに属する項目の配列', of: { type: 'string', nonEmpty: true } },
        emphasis: { type: 'boolean', desc: 'true にすると、その重なりの項目を強調色で描く', note: '図全体で1つまで' },
      },
    },
  },
} as const satisfies Fields;
export type VennSpec = { type: 'venn' } & Infer<typeof schema>;
type VennSet = VennSpec['sets'][number];
// 文字を置く場所。max は書ける項目の数。
interface Slot {
  x: number;
  y: number;
  width: number;
  max: number;
}
interface VennLayout {
  height: number;
  r: number;
  circles: { cx: number; cy: number }[];
  names: { x: number; y: number }[];
  only: Slot[];
  // 2つの集合の重なり。キーは集合の番号を小さい順に並べたもの（'0,1' など）。
  pair: Record<string, Slot>;
  // 3つすべての重なり。集合が3つのときだけある。
  all?: Slot;
}

const ITEM = 13; // 項目の文字サイズ
const LINE = 22; // 項目の行の高さ

// 円と、文字を置く場所。集合が2つのときと3つのときで、決まった配置を使う。
// 各場所の width は、その場所に書ける文字の幅の上限。円の重なり方から求めた値を、余白を引いて置いている。
function layout(n: number): VennLayout {
  if (n === 2) {
    return {
      height: 336, r: 145,
      circles: [{ cx: 282, cy: 180 }, { cx: 438, cy: 180 }],
      names: [{ x: 230, y: 22 }, { x: 490, y: 22 }],
      only: [{ x: 215, y: 180, width: 138, max: 4 }, { x: 505, y: 180, width: 138, max: 4 }],
      pair: { '0,1': { x: 360, y: 180, width: 112, max: 4 } },
    };
  }
  return {
    height: 514, r: 150,
    circles: [{ cx: 275, cy: 180 }, { cx: 445, cy: 180 }, { cx: 360, cy: 327 }],
    names: [{ x: 215, y: 22 }, { x: 505, y: 22 }, { x: 360, y: 502 }],
    only: [{ x: 213, y: 150, width: 116, max: 3 }, { x: 507, y: 150, width: 116, max: 3 }, { x: 360, y: 400, width: 190, max: 3 }],
    pair: { '0,1': { x: 360, y: 118, width: 92, max: 2 }, '0,2': { x: 284, y: 272, width: 84, max: 2 }, '1,2': { x: 436, y: 272, width: 84, max: 2 } },
    all: { x: 360, y: 226, width: 96, max: 2 },
  };
}
const names = (spec: { readonly sets: readonly VennSet[] }): string[] => spec.sets.map((s) => s.label);
// 重なりが指す場所を返す。
// 3つすべての重なりは、集合が3つのときにしか書けない（validate が確かめる）ので、g.all は必ずある。
function slotOf(spec: { readonly sets: readonly VennSet[] }, overlap: { readonly sets: readonly string[] }, g: VennLayout): Slot {
  const idx = overlap.sets.map((s) => names(spec).indexOf(s)).sort();
  return idx.length === 3 ? g.all! : g.pair[idx.join(',')];
}

// venn: 2つか3つの集合の、共通する部分と、それぞれだけの部分を示す。
export default {
  name: 'venn',
  summary: '2つか3つの集合の重なりを、円の重なりで示す',
  when: '2〜3個のまとまりに、共通する項目と、片方だけの項目がある',
  example: `type: venn
sets:
  - label: 開発チーム
    items: [設計, 実装]
  - label: 運用チーム
    items: [監視, 障害対応]
overlaps:
  - sets: [開発チーム, 運用チーム]
    items: [デプロイ, 性能の改善]
    emphasis: true`,
  fields: [
    ...describe(schema, contractLimits),
    '1つの場所に書ける項目は、集合が2つのときは4個まで、3つのときは集合だけの場所が3個、重なりが2個まで',
  ],

  validate(spec, limits) {
    const errors = checkSpec(spec, schema, 'venn', limits);
    if (errors.length) return errors;
    // 形は上で確かめたので、ここからは検証した後の形として読む。
    const s = spec as VennSpec;
    const g = layout(s.sets.length);
    const seen = new Set<string>();
    for (const [i, o] of s.overlaps.entries()) {
      if (new Set(o.sets).size !== o.sets.length) {
        errors.push(`overlaps[${i}].sets は、重なる集合の名前を2つ以上並べてください。`);
        continue;
      }
      const unknown = o.sets.find((x) => !names(s).includes(x));
      if (unknown) {
        errors.push(`overlaps[${i}].sets の「${unknown}」は sets にありません。`);
        continue;
      }
      const key = [...o.sets].sort().join('＋');
      if (seen.has(key)) errors.push(`「${o.sets.join('」と「')}」の重なりが2回書かれています。1つにまとめてください。`);
      seen.add(key);
      const slot = slotOf(s, o, g);
      if (o.items.length > slot.max) errors.push(`「${o.sets.join('」と「')}」の重なりに items が${o.items.length}個あります。この場所に書けるのは${slot.max}個までです。`);
    }
    s.sets.forEach((set, i) => {
      const items = set.items ?? [];
      if (items.length > g.only[i].max) errors.push(`「${set.label}」だけの項目が${items.length}個あります。この場所に書けるのは${g.only[i].max}個までです。`);
    });
    return errors;
  },

  fit(spec) {
    const g = layout(spec.sets.length);
    const out: string[] = [];
    const check = (items: string[], slot: Slot, where: string) => items.filter((it) => px(it, ITEM) > slot.width).forEach((it) => out.push(`項目「${it}」が${where}に収まりません。全角${Math.floor(slot.width / ITEM)}字以内にしてください。`));
    spec.sets.forEach((s, i) => check(s.items ?? [], g.only[i], `「${s.label}」だけの場所`));
    spec.overlaps.forEach((o) => check(o.items, slotOf(spec, o, g), '重なりの場所'));
    return out;
  },

  labels: (spec) => [...names(spec), ...spec.sets.flatMap((s) => s.items ?? []), ...spec.overlaps.flatMap((o) => o.items)],
  notes: () => [],

  render(spec, t) {
    const g = layout(spec.sets.length);
    const font = `font-family:${t.font.replace(/"/g, "'")}`;
    const out = [open(t, g.height, `${names(spec).join('、')}の重なり`)];
    // 円は、塗りを薄くして重ねる。重なった部分は色が濃くなる。
    g.circles.forEach((c, i) => out.push(`<circle cx="${c.cx}" cy="${c.cy}" r="${g.r}" fill="${seriesColor(t, i)}" fill-opacity="0.12" stroke="${seriesColor(t, i)}" stroke-width="1.6"/>`));
    g.names.forEach((p, i) => out.push(`<text class="zk-text" x="${p.x}" y="${p.y}" text-anchor="middle">${esc(spec.sets[i].label)}</text>`));
    const stack = (items: string[], slot: Slot, em: boolean) =>
      items.forEach((it, k) => {
        const y = slot.y - ((items.length - 1) * LINE) / 2 + k * LINE + ITEM * 0.36;
        out.push(`<text x="${slot.x}" y="${y}" text-anchor="middle" style="${font};font-size:${ITEM}px;fill:${em ? t.color.accent : t.color.ink};font-weight:${em ? 700 : 400}">${esc(it)}</text>`);
      });
    spec.sets.forEach((s, i) => stack(s.items ?? [], g.only[i], false));
    spec.overlaps.forEach((o) => stack(o.items, slotOf(spec, o, g), Boolean(o.emphasis)));
    out.push(close());
    return out.join('');
  },
} satisfies FigureType<VennSpec>;
