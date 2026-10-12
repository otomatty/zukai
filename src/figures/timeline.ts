import { open, close, box, px, txt, ln } from './svg.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType, Tokens } from '../types.ts';

const schema = {
  events: {
    type: 'list', required: true, min: 2, max: 'timeline.maxEvents', hint: '期間を分けて、セクションを分けてください。', atMostOne: 'emphasis', desc: '出来事の配列。時間の順に並べる',
    of: {
      type: 'object',
      fields: {
        date: { type: 'string', required: true, orNumber: true, desc: '日付や時期' },
        label: { type: 'string', required: true, desc: '出来事の名前' },
        note: { type: 'string', desc: '補足' },
        emphasis: { type: 'boolean', desc: 'true にすると強調色で描く', note: '図全体で1つまで' },
        ref: { type: 'number', desc: '根拠の番号。同じセクションの yaml refs の何番目かを書く' },
      },
    },
  },
} as const satisfies Fields;
export type TimelineSpec = { type: 'timeline' } & Infer<typeof schema>;

const slotOf = (spec: TimelineSpec, t: Tokens) => t.figure.width / spec.events.length;
const cardWidth = (spec: TimelineSpec, t: Tokens) => Math.min(200, slotOf(spec, t) - 16);

// timeline: 日付の決まった出来事を、時間の順に左から右へ並べる。
export default {
  name: 'timeline',
  summary: '日付の決まった出来事を、時間の順に左から右へ並べる。間隔は等間隔で、日数には比例しない',
  when: '日付の決まった出来事が、時間の順に2〜5個並ぶ',
  example: `type: timeline
events:
  - date: 10月12日
    label: セッションDB構築
    note: 検証環境で確認する
  - date: 10月26日
    label: 読み取りの切替
    emphasis: true
  - date: 11月2日
    label: メモリ保存の停止`,
  fields: describe(schema, contractLimits),

  validate: (spec, limits) => checkSpec(spec, schema, 'timeline', limits),

  fit(spec, t) {
    const w = cardWidth(spec, t);
    const out: string[] = [];
    for (const e of spec.events) {
      if (px(e.label, t.size.label) + 16 > w) out.push(`出来事「${e.label}」が箱に収まりません。短くするか、events を減らしてください。`);
      if (e.note && px(e.note, t.size.note) + 16 > w) out.push(`補足「${e.note}」が箱に収まりません。短くしてください。`);
      if (px(String(e.date), 13) + 8 > slotOf(spec, t)) out.push(`日付「${e.date}」が隣と重なります。短くしてください。`);
    }
    return out;
  },

  labels: (spec) => spec.events.map((e) => e.label),
  notes: (spec) => spec.events.map((e) => e.note).filter((n): n is string => Boolean(n)),
  refs: (spec) => spec.events.map((e) => e.ref).filter((r) => r !== undefined),

  render(spec, t) {
    const slot = slotOf(spec, t);
    const w = cardWidth(spec, t);
    const h = spec.events.some((e) => e.note) ? 64 : 48;
    const out = [open(t, 82 + h + 4, spec.events.map((e) => `${e.date} ${e.label}`).join('、'))];
    out.push(ln(t, `M0 48 L${t.figure.width} 48`, { w: 2 }));
    spec.events.forEach((e, i) => {
      const x = slot * (i + 0.5);
      out.push(
        ln(t, `M${x} 56 L${x} 82`),
        `<circle cx="${x}" cy="48" r="7" fill="${e.emphasis ? t.color.accent : t.color.paper}" stroke="${e.emphasis ? t.color.accent : t.color.sub}" stroke-width="2"/>`,
        txt(t, x, 24, String(e.date), { size: 13, fill: e.emphasis ? t.color.accent : t.color.sub, weight: e.emphasis ? 700 : 400 }),
        box(t, x - w / 2, 82, w, h, e.label, e),
      );
    });
    out.push(close());
    return out.join('');
  },
} satisfies FigureType<TimelineSpec>;
