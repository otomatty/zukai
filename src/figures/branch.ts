import { open, close, box, arrow, px, txt, ln, rect, mid, columns } from './svg.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType, Tokens } from '../types.ts';

const schema = {
  condition: { type: 'string', required: true, nonEmpty: true, desc: '分かれ目になる条件' },
  cases: {
    type: 'list', required: true, min: 2, max: 'branch.maxCases', hint: '条件を2段階に分けて、セクションを分けてください。', atMostOne: 'emphasis', desc: '行き先の配列。左から順に並べる',
    of: {
      type: 'object',
      fields: {
        when: { type: 'string', required: true, orNumber: true, desc: 'その行き先になる場合' },
        label: { type: 'string', required: true, desc: '行き先の名前' },
        note: { type: 'string', desc: '補足' },
        emphasis: { type: 'boolean', desc: 'true にすると強調色で描く', note: '図全体で1つまで' },
        ref: { type: 'number', desc: '根拠の番号。同じセクションの yaml refs の何番目かを書く' },
      },
    },
  },
} as const satisfies Fields;
export type BranchSpec = { type: 'branch' } & Infer<typeof schema>;

const layout = (spec: BranchSpec, t: Tokens) => columns(t, spec.cases.length, spec.cases.length > 3 ? 24 : 48, 208);
const pillWidth = (spec: BranchSpec, t: Tokens) => Math.max(200, px(spec.condition, t.size.label) + 48);

// branch: 1つの条件で行き先が分かれる様子を、上から下への枝分かれで示す。
export default {
  name: 'branch',
  summary: '1つの条件で行き先が分かれる様子を、上から下への枝分かれで示す',
  when: '1つの条件で、行き先が2〜4通りに分かれる',
  example: `type: branch
condition: 連続して失敗した回数
cases:
  - when: 1〜2回
    label: 再入力を求める
    note: エラーを表示する
  - when: 3〜4回
    label: 画像認証を追加
  - when: 5回以上
    label: 15分間ロック
    emphasis: true`,
  fields: describe(schema, contractLimits),

  validate: (spec, limits) => checkSpec(spec, schema, 'branch', limits),

  fit(spec, t) {
    const { w } = layout(spec, t);
    const out: string[] = [];
    if (pillWidth(spec, t) > t.figure.width * 0.7) out.push(`condition「${spec.condition}」が長すぎます。短くしてください。`);
    for (const c of spec.cases) {
      if (px(c.label, t.size.label) + 24 > w) out.push(`行き先「${c.label}」が箱に収まりません。短くするか、cases を減らしてください。`);
      if (c.note && px(c.note, t.size.note) + 24 > w) out.push(`補足「${c.note}」が箱に収まりません。短くしてください。`);
      if (px(String(c.when), t.size.note) + 20 > w / 2) out.push(`when「${c.when}」が長く、隣の矢印に近づきます。短くしてください。`);
    }
    return out;
  },

  labels: (spec) => spec.cases.map((c) => c.label),
  notes: (spec) => spec.cases.map((c) => c.note).filter((n): n is string => Boolean(n)),
  refs: (spec) => spec.cases.map((c) => c.ref).filter((r) => r !== undefined),

  render(spec, t) {
    const { w, xs } = layout(spec, t);
    const cx = xs.map((x) => x + w / 2);
    const h = spec.cases.some((c) => c.note) ? 72 : 52;
    const pw = pillWidth(spec, t);
    const center = t.figure.width / 2;
    const out = [open(t, 168 + h + 4, `${spec.condition}による分岐`)];
    out.push(ln(t, `M${center} 56 L${center} 112`, { color: t.color.sub }), ln(t, `M${Math.min(cx[0], center)} 112 L${Math.max(cx.at(-1)!, center)} 112`, { color: t.color.sub }));
    cx.forEach((x) => out.push(arrow(`M${x} 112 L${x} 165`)));
    out.push(rect(t, center - pw / 2, 2, pw, 54, { rx: 27, stroke: t.color.ink, sw: t.figure.stroke * 1.5 }), txt(t, center, mid(29, t.size.label), spec.condition, { cls: 'zk-text' }));
    spec.cases.forEach((c, i) => out.push(txt(t, cx[i] + 12, 144, String(c.when), { anchor: 'start' }), box(t, xs[i], 168, w, h, c.label, c)));
    out.push(close());
    return out.join('');
  },
} satisfies FigureType<BranchSpec>;
