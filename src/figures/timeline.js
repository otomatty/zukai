import { open, close, box, px, txt, ln, unknownKeys } from './svg.js';

const slotOf = (spec, t) => t.figure.width / spec.events.length;
const cardWidth = (spec, t) => Math.min(200, slotOf(spec, t) - 16);

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
  fields: ['events: 出来事の配列。時間の順に並べる', 'events[].date: 日付や時期（必須）', 'events[].label: 出来事の名前（必須）', 'events[].note: 補足（任意）', 'events[].emphasis: true にすると強調色で描く（任意、図全体で1つまで）', 'events[].ref: 根拠の番号（任意）'],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'events'], 'timeline')];
    if (!Array.isArray(spec.events) || spec.events.length < 2) return [...errors, 'timeline には events が2つ以上必要です。'];
    if (spec.events.length > limits.timeline.maxEvents) errors.push(`events が${spec.events.length}個あります。上限は${limits.timeline.maxEvents}個です。期間を分けて、セクションを分けてください。`);
    spec.events.forEach((e, i) => {
      errors.push(...unknownKeys(e, ['date', 'label', 'note', 'emphasis', 'ref'], `events[${i}]`));
      if (typeof e?.date !== 'string' && typeof e?.date !== 'number') errors.push(`events[${i}] に date がありません。`);
      if (typeof e?.label !== 'string') errors.push(`events[${i}] に label がありません。`);
    });
    if (spec.events.filter((e) => e?.emphasis).length > 1) errors.push('emphasis を付けられる出来事は1つまでです。');
    return errors;
  },

  fit(spec, t) {
    const w = cardWidth(spec, t);
    const out = [];
    for (const e of spec.events) {
      if (px(e.label, t.size.label) + 16 > w) out.push(`出来事「${e.label}」が箱に収まりません。短くするか、events を減らしてください。`);
      if (e.note && px(e.note, t.size.note) + 16 > w) out.push(`補足「${e.note}」が箱に収まりません。短くしてください。`);
      if (px(String(e.date), 13) + 8 > slotOf(spec, t)) out.push(`日付「${e.date}」が隣と重なります。短くしてください。`);
    }
    return out;
  },

  labels: (spec) => spec.events.map((e) => e.label),
  notes: (spec) => spec.events.map((e) => e.note).filter(Boolean),
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
};
