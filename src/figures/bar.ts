import { px } from './svg.ts';
import { renderChart, fmt, highlight, neutral, modeGuide } from './chart.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType } from '../types.ts';

const schema = {
  unit: { type: 'string', required: true, nonEmpty: true, desc: '値の単位' },
  items: {
    type: 'list', required: true, min: 2, max: 'bar.maxItems', hint: '表にするか、セクションを分けてください。', unique: 'label', atMostOne: 'emphasis', desc: '項目の配列。上から順に並べる',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, desc: '項目の名前' },
        value: { type: 'number', required: true, min: 0, desc: '数値。棒は0から始める' },
        emphasis: { type: 'boolean', desc: 'true にすると強調色で描き、ほかの棒を灰色にする', note: '図全体で1つまで' },
      },
    },
  },
} as const satisfies Fields;
export type BarSpec = { type: 'bar' } & Infer<typeof schema>;

const ROW = 40;

// bar: 項目同士の大小を、横棒の長さで比べる。棒は必ず0から始める。
export default {
  name: 'bar',
  summary: '項目同士の大小を、横棒の長さで比べる',
  when: '2〜8個の項目に、数値が1つずつある',
  example: `type: bar
unit: ミリ秒
items:
  - label: 変更前
    value: 180
  - label: 変更後
    value: 110
    emphasis: true`,
  fields: describe(schema, contractLimits),

  guide: (t) => modeGuide(t),

  validate: (spec, limits) => checkSpec(spec, schema, 'bar', limits),

  labels: (spec) => spec.items.map((it) => it.label),
  notes: () => [],

  render(spec, t) {
    const hasEmphasis = spec.items.some((it) => it.emphasis);
    const left = Math.max(...spec.items.map((it) => px(it.label, 13))) + 20;
    const right = Math.max(...spec.items.map((it) => px(fmt(it.value) + spec.unit, 13))) + 24;
    return renderChart(
      {
        grid: { left, right, top: 6, bottom: 6 },
        xAxis: { type: 'value', min: 0, show: false },
        yAxis: {
          type: 'category', inverse: true, data: spec.items.map((it) => it.label),
          axisLine: { lineStyle: { color: t.chart.axis } }, axisTick: { show: false }, axisLabel: { color: t.color.ink, fontSize: 13, margin: 12 },
        },
        series: [{
          type: 'bar', barWidth: 20,
          data: spec.items.map((it) => ({
            value: it.value,
            itemStyle: { color: it.emphasis ? highlight(t) : hasEmphasis || neutral(t) ? t.chart.muted : t.color.accent, borderRadius: [0, 4, 4, 0] },
            label: { fontWeight: it.emphasis ? 700 : 400 },
          })),
          // 値は items[].value の数なので、数として読む。
          label: { show: true, position: 'right', distance: 8, color: t.color.ink, fontSize: 13, formatter: (p) => fmt(p.value as number) + spec.unit },
        }],
      },
      t, spec.items.length * ROW + 12, spec.items.map((it) => `${it.label} ${fmt(it.value)}${spec.unit}`).join('、'),
    );
  },
} satisfies FigureType<BarSpec>;
