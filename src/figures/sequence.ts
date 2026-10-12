import { open, close, box, arrow, esc, px } from './svg.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType, Tokens } from '../types.ts';

const schema = {
  actors: { type: 'list', required: true, min: 2, max: 'sequence.maxActors', of: { type: 'string' }, desc: '登場者の名前の配列。左から順に並べる' },
  messages: {
    type: 'list', required: true, min: 1, max: 'sequence.maxMessages', hint: 'セクションを分けてください。', desc: 'やり取りの配列。上から順に描く',
    of: {
      type: 'object',
      fields: {
        from: { type: 'string', required: true, desc: '送る側。actors にある名前' },
        to: { type: 'string', required: true, desc: '受け取る側。actors にある名前', note: 'from と同じ名前は不可' },
        label: { type: 'string', required: true, desc: '渡すもの' },
        reply: { type: 'boolean', desc: 'true にすると応答として破線で描く' },
      },
    },
  },
} as const satisfies Fields;
export type SequenceSpec = { type: 'sequence' } & Infer<typeof schema>;

const headWidth = (t: Tokens, n: number) => Math.min(t.figure.width / n - 24, 190);

// sequence: 登場するもの同士のやり取りを、時間の順に上から下へ並べる。
export default {
  name: 'sequence',
  summary: '複数の登場者のやり取りを、時間の順に上から下へ並べる',
  when: '2〜4者の間で、やり取りが往復する',
  example: `type: sequence
actors: [ブラウザ, 認証サービス, セッションDB]
messages:
  - from: ブラウザ
    to: 認証サービス
    label: IDとパスワード
  - from: 認証サービス
    to: セッションDB
    label: セッションID
  - from: 認証サービス
    to: ブラウザ
    label: Cookie
    reply: true`,
  fields: describe(schema, contractLimits),

  validate(spec, limits) {
    const errors = checkSpec(spec, schema, 'sequence', limits);
    if (errors.length) return errors;
    // 上の検査で、形が SequenceSpec のとおりだと確かめた。ここからは、項目どうしの関係を確かめる。
    const s = spec as SequenceSpec;
    s.messages.forEach((m, i) => {
      for (const key of ['from', 'to'] as const) {
        if (!s.actors.includes(m[key])) errors.push(`messages[${i}].${key}「${m[key]}」は actors にありません。`);
      }
      if (m.from === m.to) errors.push(`messages[${i}] の from と to が同じです。`);
    });
    return errors;
  },

  // 登場者の箱の幅と、隣り合う縦線の間隔は、登場者の数で決まる。収まらない文字を検出する。
  fit(spec, t) {
    const n = spec.actors.length;
    const out = spec.actors
      .filter((a) => px(a, t.size.label) + 16 > headWidth(t, n))
      .map((a) => `登場者「${a}」が箱に収まりません。名前を短くするか、actors を${n - 1}個以下にしてください。`);
    for (const m of spec.messages) {
      const span = (Math.abs(spec.actors.indexOf(m.from) - spec.actors.indexOf(m.to)) * t.figure.width) / n;
      if (px(m.label, t.size.note) + 16 > span) out.push(`やり取り「${m.label}」が矢印の長さに収まりません。短くしてください。`);
    }
    return out;
  },

  labels: (spec) => [...spec.actors, ...spec.messages.map((m) => m.label)],
  notes: () => [],

  render(spec, t) {
    const f = t.figure;
    const n = spec.actors.length;
    const col = f.width / n;
    const headW = headWidth(t, n);
    const headH = 44;
    const step = 46;
    const top = 4;
    const first = top + headH + 40;
    // 登場者の箱は、上と下の両方に描く。縦に長い図でも、下まで読んだときに誰の線かが分かる。Mermaid と PlantUML の標準の描き方に合わせている。
    const foot = first + (spec.messages.length - 1) * step + 30;
    const height = foot + headH + 4;
    const cx = (name: string) => col * spec.actors.indexOf(name) + col / 2;

    const out = [open(t, height, spec.actors.join(' / '))];
    spec.actors.forEach((a) => {
      out.push(`<path class="zk-dash" d="M${cx(a)} ${top + headH} L${cx(a)} ${foot}"/>`);
      out.push(box(t, cx(a) - headW / 2, top, headW, headH, a), box(t, cx(a) - headW / 2, foot, headW, headH, a));
    });
    spec.messages.forEach((m, i) => {
      const y = first + i * step;
      const x1 = cx(m.from);
      const x2 = cx(m.to);
      const dir = x2 > x1 ? 1 : -1;
      out.push(arrow(`M${x1 + dir * 4} ${y} L${x2 - dir * 5} ${y}`, Boolean(m.reply)));
      // ラベルは矢印の上に置く。途中の縦線と重なる場合に備えて、紙色で縁取る。
      out.push(
        `<text class="zk-note" x="${(x1 + x2) / 2}" y="${y - 9}" text-anchor="middle" style="fill:${t.color.ink};paint-order:stroke;stroke:${t.color.paper};stroke-width:5px;stroke-linejoin:round">${esc(m.label)}</text>`,
      );
    });
    out.push(close());
    return out.join('');
  },
} satisfies FigureType<SequenceSpec>;
