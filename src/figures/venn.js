import { open, close, px, esc, unknownKeys } from './svg.js';
import { seriesColor } from './chart.js';

const ITEM = 13; // 項目の文字サイズ
const LINE = 22; // 項目の行の高さ

// 円と、文字を置く場所。集合が2つのときと3つのときで、決まった配置を使う。
// 各場所の width は、その場所に書ける文字の幅の上限。円の重なり方から求めた値を、余白を引いて置いている。
function layout(n) {
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
const names = (spec) => spec.sets.map((s) => s.label);
// 重なりが指す場所を返す。
function slotOf(spec, overlap, g) {
  const idx = overlap.sets.map((s) => names(spec).indexOf(s)).sort();
  return idx.length === 3 ? g.all : g.pair[idx.join(',')];
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
    'sets: 集合の配列（必須、2つか3つ）',
    'sets[].label: 集合の名前（必須）',
    'sets[].items: その集合だけに属する項目の配列（任意）',
    'overlaps: 重なりの配列（必須、1つ以上）',
    'overlaps[].sets: 重なる集合の名前の配列（必須）。集合が3つのときは、2つの重なりと、3つすべての重なりを書ける',
    'overlaps[].items: 重なりに属する項目の配列（必須）',
    'overlaps[].emphasis: true にすると、その重なりの項目を強調色で描く（任意、図全体で1つまで）',
    '1つの場所に書ける項目は、集合が2つのときは4個まで、3つのときは集合だけの場所が3個、重なりが2個まで',
  ],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'sets', 'overlaps'], 'venn')];
    if (!Array.isArray(spec.sets) || spec.sets.length < 2 || spec.sets.length > limits.venn.maxSets) return [...errors, `venn には sets が2つか${limits.venn.maxSets}つ必要です。`];
    const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x);
    spec.sets.forEach((s, i) => {
      errors.push(...unknownKeys(s, ['label', 'items'], `sets[${i}]`));
      if (typeof s?.label !== 'string' || !s.label) errors.push(`sets[${i}] に label がありません。`);
      if (s?.items !== undefined && !strings(s.items)) errors.push(`sets[${i}].items は、項目の名前の配列にしてください。`);
    });
    if (errors.length) return errors;
    if (new Set(names(spec)).size !== spec.sets.length) return ['sets に同じ名前があります。'];
    if (!Array.isArray(spec.overlaps) || spec.overlaps.length === 0) return ['venn には overlaps が1つ以上必要です。重なりがない集合は、表で示します。'];
    const g = layout(spec.sets.length);
    const seen = new Set();
    spec.overlaps.forEach((o, i) => {
      errors.push(...unknownKeys(o, ['sets', 'items', 'emphasis'], `overlaps[${i}]`));
      if (!strings(o?.sets) || o.sets.length < 2 || new Set(o.sets).size !== o.sets.length) return errors.push(`overlaps[${i}].sets は、重なる集合の名前を2つ以上並べてください。`);
      const unknown = o.sets.find((s) => !names(spec).includes(s));
      if (unknown) return errors.push(`overlaps[${i}].sets の「${unknown}」は sets にありません。`);
      if (!strings(o.items) || o.items.length === 0) return errors.push(`overlaps[${i}] に items がありません。`);
      const key = [...o.sets].sort().join('＋');
      if (seen.has(key)) errors.push(`「${o.sets.join('」と「')}」の重なりが2回書かれています。1つにまとめてください。`);
      seen.add(key);
      const slot = slotOf(spec, o, g);
      if (o.items.length > slot.max) errors.push(`「${o.sets.join('」と「')}」の重なりに items が${o.items.length}個あります。この場所に書けるのは${slot.max}個までです。`);
    });
    spec.sets.forEach((s, i) => {
      if ((s.items ?? []).length > g.only[i].max) errors.push(`「${s.label}」だけの項目が${s.items.length}個あります。この場所に書けるのは${g.only[i].max}個までです。`);
    });
    if (spec.overlaps.filter((o) => o?.emphasis).length > 1) errors.push('emphasis を付けられる重なりは1つまでです。');
    return errors;
  },

  fit(spec) {
    const g = layout(spec.sets.length);
    const out = [];
    const check = (items, slot, where) => items.filter((it) => px(it, ITEM) > slot.width).forEach((it) => out.push(`項目「${it}」が${where}に収まりません。全角${Math.floor(slot.width / ITEM)}字以内にしてください。`));
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
    const stack = (items, slot, em) =>
      items.forEach((it, k) => {
        const y = slot.y - ((items.length - 1) * LINE) / 2 + k * LINE + ITEM * 0.36;
        out.push(`<text x="${slot.x}" y="${y}" text-anchor="middle" style="${font};font-size:${ITEM}px;fill:${em ? t.color.accent : t.color.ink};font-weight:${em ? 700 : 400}">${esc(it)}</text>`);
      });
    spec.sets.forEach((s, i) => stack(s.items ?? [], g.only[i], false));
    spec.overlaps.forEach((o) => stack(o.items, slotOf(spec, o, g), Boolean(o.emphasis)));
    out.push(close());
    return out.join('');
  },
};
