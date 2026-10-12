import { open, close, box, arrow, px, txt, rect } from './svg.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType } from '../types.ts';

// 変更前と変更後に共通する項目。
const label = { type: 'string', required: true, desc: '枠の見出し' } as const;
const rows = {
  type: 'list', required: true, min: 1, max: 'compare.maxRows', desc: '箱の名前を、上の段から順に並べた配列。上の段から下の段へ矢印を引く',
  // 段の中の箱の数は、書き方の説明に出ないので、注意として添える。
  note: `1段の箱は${contractLimits.compare.maxCols}個まで`,
  of: { type: 'list', min: 1, max: 'compare.maxCols', of: { type: 'string' } },
} as const;
const schema = {
  before: { type: 'object', required: true, desc: '変更前の構成', fields: { label, rows } },
  after: { type: 'object', required: true, desc: '変更後の構成', fields: { label, rows, emphasis: { type: 'string', desc: '変更後の構成で強調する箱の名前' } } },
} as const satisfies Fields;
export type CompareSpec = { type: 'compare' } & Infer<typeof schema>;
// 変更前の枠も、変更後の枠と同じ形で描く（emphasis は変更後にだけある）。
type CompareSide = CompareSpec['after'];

const PANEL = 320;
const INNER = PANEL - 48;
const GAP = 24;
const boxWidth = (n: number) => (INNER - (n - 1) * GAP) / n;
const sides = (spec: CompareSpec) => [spec.before, spec.after];

// compare: 同じ構成の変更前と変更後を、左右に並べて示す。
export default {
  name: 'compare',
  summary: '同じ構成の変更前と変更後を、左右に並べて示す',
  when: '同じ構成の、変更前と変更後を並べる',
  example: `type: compare
before:
  label: 変更前
  rows:
    - [サーバA, サーバB]
    - [メモリ, メモリ]
after:
  label: 変更後
  rows:
    - [サーバA, サーバB]
    - [セッションDB]
  emphasis: セッションDB`,
  fields: describe(schema, contractLimits),

  validate(spec, limits) {
    const errors = checkSpec(spec, schema, 'compare', limits);
    if (errors.length) return errors;
    // 上の検査で、形が CompareSpec のとおりだと確かめた。ここからは、段の並びと強調する箱を確かめる。
    const s = spec as CompareSpec;
    for (const key of ['before', 'after'] as const) {
      s[key].rows.forEach((r, i, rows) => {
        const below = rows[i + 1];
        // 矢印をまっすぐ引けるのは、上下の段の箱が同じ数か、どちらかが1個のときだけ。
        if (below && r.length !== below.length && r.length !== 1 && below.length !== 1) errors.push(`${key}.rows の${i + 1}段目（${r.length}個）と${i + 2}段目（${below.length}個）は、同じ数にするか、どちらかを1個にしてください。`);
      });
    }
    if (s.after.emphasis !== undefined && !s.after.rows.flat().includes(s.after.emphasis)) errors.push(`after.emphasis「${s.after.emphasis}」は after.rows にありません。`);
    return errors;
  },

  fit(spec, t) {
    return sides(spec).flatMap((side) => side.rows.flatMap((r) => r.filter((name) => px(name, t.size.label) + 16 > boxWidth(r.length)).map((name) => `「${name}」が箱に収まりません。短くするか、その段の箱を減らしてください。`)));
  },

  labels: (spec) => [...new Set(sides(spec).flatMap((side) => [side.label, ...side.rows.flat()]))],
  notes: () => [],

  render(spec, t) {
    const rows = Math.max(spec.before.rows.length, spec.after.rows.length);
    const ph = rows * 96 + 24;
    const out = [open(t, ph + 4, `${spec.before.label}と${spec.after.label}`)];
    const drawSide = (side: CompareSide, x0: number, after: boolean) => {
      out.push(rect(t, x0, 2, PANEL - 1, ph, { rx: 8 }), txt(t, x0 + 24, 28, side.label, { anchor: 'start', weight: 700, size: 13, fill: after ? t.color.accent : t.color.sub }));
      const centers = (r: string[]) => r.map((_, j) => x0 + 24 + j * (boxWidth(r.length) + GAP) + boxWidth(r.length) / 2);
      side.rows.forEach((r, i) => {
        const y = 48 + i * 96;
        const below = side.rows[i + 1];
        if (below) (below.length > r.length ? centers(below) : centers(r)).forEach((cx) => out.push(arrow(`M${cx} ${y + 50} L${cx} ${y + 93}`)));
        r.forEach((name, j) => out.push(box(t, x0 + 24 + j * (boxWidth(r.length) + GAP), y, boxWidth(r.length), 48, name, { emphasis: after && name === side.emphasis })));
      });
    };
    drawSide(spec.before, 1, false);
    drawSide(spec.after, t.figure.width - PANEL, true);
    const my = 2 + ph / 2;
    const ax = PANEL + 12;
    const bx = t.figure.width - PANEL - 12;
    out.push(`<path d="M${ax} ${my} L${bx - 6} ${my}" fill="none" stroke="${t.color.accent}" stroke-width="2.4" stroke-linecap="round"/><path d="M${bx - 10} ${my - 7} L${bx} ${my} L${bx - 10} ${my + 7} Z" fill="${t.color.accent}"/>`);
    out.push(close());
    return out.join('');
  },
} satisfies FigureType<CompareSpec>;
