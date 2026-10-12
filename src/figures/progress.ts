import { px } from './svg.ts';
import { renderChart, fmt, highlight, neutral, modeGuide } from './chart.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType } from '../types.ts';

const schema = {
  unit: { type: 'string', required: true, nonEmpty: true, desc: '値の単位' },
  max: { type: 'number', required: true, above: 0, desc: '棒の右端にあたる上限の値' },
  target: { type: 'number', min: 0, desc: '目標値。縦線で示す。max 以下にする' },
  items: {
    type: 'list', required: true, min: 1, max: 'progress.maxItems', atMostOne: 'emphasis', desc: '項目の配列。上から順に並べる',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, desc: '項目の名前' },
        value: { type: 'number', required: true, min: 0, desc: '数値。max 以下にする' },
        emphasis: { type: 'boolean', desc: 'true にすると名前と値を太字にする', note: '図全体で1つまで' },
      },
    },
  },
} as const satisfies Fields;
export type ProgressSpec = { type: 'progress' } & Infer<typeof schema>;

// progress: 目標に対する達成度を、項目ごとの横棒で示す。
export default {
  name: 'progress',
  summary: '目標に対する達成度を、項目ごとの横棒で示す',
  when: '上限と目標値があり、達成度を項目ごとに示す',
  example: `type: progress
unit: "%"
max: 100
target: 80
items:
  - label: 受付
    value: 91
  - label: 照合
    value: 72
    emphasis: true`,
  fields: describe(schema, contractLimits),

  guide: (t) => modeGuide(t),

  validate(spec, limits) {
    const errors = checkSpec(spec, schema, 'progress', limits);
    if (errors.length) return errors;
    // 形は上で確かめたので、ここからは検証した後の形として読む。
    const s = spec as ProgressSpec;
    if (s.target !== undefined && s.target > s.max) errors.push('target は0以上 max 以下の数値にしてください。');
    s.items.forEach((it, i) => {
      if (it.value > s.max) errors.push(`items[${i}].value は0以上${s.max}以下の数値にしてください。`);
    });
    return errors;
  },

  labels: (spec) => spec.items.map((it) => it.label),
  notes: () => [],

  render(spec, t) {
    const left = Math.max(...spec.items.map((it) => px(it.label, 13))) + 24;
    const top = spec.target === undefined ? 6 : 30;
    return renderChart(
      {
        grid: { left, right: Math.max(...spec.items.map((it) => px(fmt(it.value) + spec.unit, 13))) + 24, top, bottom: 8 },
        xAxis: { type: 'value', min: 0, max: spec.max, show: false },
        yAxis: {
          type: 'category', inverse: true, axisLine: { show: false }, axisTick: { show: false },
          data: spec.items.map((it) => ({ value: it.label, textStyle: { fontWeight: it.emphasis ? 700 : 400 } })), axisLabel: { color: t.color.ink, fontSize: 13, margin: 14 },
        },
        series: [{
          type: 'bar', barWidth: 16, showBackground: true, backgroundStyle: { color: t.chart.track, borderRadius: [0, 4, 4, 0] },
          data: spec.items.map((it) => ({ value: it.value, label: { fontWeight: it.emphasis ? 700 : 400 }, itemStyle: { color: it.emphasis ? highlight(t) : neutral(t) ? t.chart.muted : t.color.accent, borderRadius: [0, 4, 4, 0] } })),
          ...(spec.target === undefined ? {} : { markLine: { silent: true, symbol: 'none', lineStyle: { color: t.color.ink, type: 'solid', width: 2 }, label: { formatter: `目標 ${fmt(spec.target)}${spec.unit}`, color: t.color.ink, fontSize: 12, fontWeight: 700, position: 'start', rotate: 0 }, data: [{ xAxis: spec.target }] } }),
        }, {
          // 値は右端に揃えて書く。棒の先に書くと、目標の線の近くで線と重なる。
          type: 'bar', barWidth: 16, barGap: '-100%', silent: true, itemStyle: { color: 'transparent' },
          data: spec.items.map((it) => ({ value: spec.max, label: { fontWeight: it.emphasis ? 700 : 400, formatter: fmt(it.value) + spec.unit } })),
          label: { show: true, position: 'right', distance: 10, color: t.color.ink, fontSize: 13 },
        }],
      },
      t, spec.items.length * 38 + top + 14, spec.items.map((it) => `${it.label} ${fmt(it.value)}${spec.unit}`).join('、'),
    );
  },
} satisfies FigureType<ProgressSpec>;
