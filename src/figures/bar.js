import { px, unknownKeys } from './svg.js';
import { renderChart, isNumber, fmt } from './chart.js';

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
  fields: [
    'unit: 値の単位（必須）',
    'items: 項目の配列。上から順に並べる',
    'items[].label: 項目の名前（必須）',
    'items[].value: 0以上の数値（必須）',
    'items[].emphasis: true にすると強調色で描き、ほかの棒を灰色にする（任意、図全体で1つまで）',
  ],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'unit', 'items'], 'bar')];
    if (typeof spec.unit !== 'string' || !spec.unit) errors.push('bar には unit（値の単位）が必要です。');
    if (!Array.isArray(spec.items) || spec.items.length < 2) {
      errors.push('bar には items が2つ以上必要です。');
      return errors;
    }
    if (spec.items.length > limits.bar.maxItems) errors.push(`items が${spec.items.length}個あります。上限は${limits.bar.maxItems}個です。表にするか、セクションを分けてください。`);
    spec.items.forEach((it, i) => {
      errors.push(...unknownKeys(it, ['label', 'value', 'emphasis'], `items[${i}]`));
      if (typeof it?.label !== 'string') errors.push(`items[${i}] に label がありません。`);
      if (!isNumber(it?.value) || it.value < 0) errors.push(`items[${i}].value は0以上の数値にしてください。棒は0から始めます。`);
    });
    if (spec.items.filter((it) => it?.emphasis).length > 1) errors.push('emphasis を付けられる棒は1つまでです。');
    return errors;
  },

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
            itemStyle: { color: !hasEmphasis || it.emphasis ? t.color.accent : t.chart.muted, borderRadius: [0, 4, 4, 0] },
            label: { fontWeight: it.emphasis ? 700 : 400 },
          })),
          label: { show: true, position: 'right', distance: 8, color: t.color.ink, fontSize: 13, formatter: (p) => fmt(p.value) + spec.unit },
        }],
      },
      t, spec.items.length * ROW + 12, spec.items.map((it) => `${it.label} ${fmt(it.value)}${spec.unit}`).join('、'),
    );
  },
};
