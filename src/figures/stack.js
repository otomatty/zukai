import { px, unknownKeys } from './svg.js';
import { renderChart, isNumber, fmt, unitError, seriesColor } from './chart.js';

const legendText = (it, total, unit) => `${it.label} ${Math.round((it.value / total) * 100)}%（${fmt(it.value)}${unit}）`;

// stack: 全体に占める内訳を、1本の横棒を区切って示す。
export default {
  name: 'stack',
  summary: '全体に占める内訳を、1本の横棒を区切って示す',
  when: '合計が100%になる内訳が、2〜5個ある',
  example: `type: stack
unit: 万円
items:
  - label: 実行環境
    value: 12
  - label: データベース
    value: 5
  - label: その他
    value: 3`,
  fields: ['unit: 値の単位（必須）', 'items: 内訳の配列。大きい順に並べ、「その他」は最後に置く', 'items[].label: 内訳の名前（必須）', 'items[].value: 0より大きい数値（必須）。割合は自動で計算する'],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'unit', 'items'], 'stack'), ...unitError(spec, 'stack')];
    if (!Array.isArray(spec.items) || spec.items.length < 2) return [...errors, 'stack には items が2つ以上必要です。'];
    if (spec.items.length > limits.stack.maxItems) errors.push(`items が${spec.items.length}個あります。上限は${limits.stack.maxItems}個です。小さい内訳を「その他」にまとめてください。`);
    spec.items.forEach((it, i) => {
      errors.push(...unknownKeys(it, ['label', 'value'], `items[${i}]`));
      if (typeof it?.label !== 'string') errors.push(`items[${i}] に label がありません。`);
      if (!isNumber(it?.value) || it.value <= 0) errors.push(`items[${i}].value は0より大きい数値にしてください。`);
    });
    return errors;
  },

  labels: (spec) => spec.items.map((it) => it.label),
  notes: () => [],

  render(spec, t) {
    const total = spec.items.reduce((sum, it) => sum + it.value, 0);
    // 凡例が何行になるかを数えて、棒の位置を決める。
    let rows = 1;
    let x = 0;
    for (const it of spec.items) {
      const w = px(legendText(it, total, spec.unit), 12) + 12 + 28;
      if (x + w > t.figure.width && x > 0) { rows++; x = 0; }
      x += w;
    }
    const top = rows * 24 + 16;
    const last = spec.items.length - 1;
    return renderChart(
      {
        grid: { left: 0, right: 0, top, bottom: 4 },
        legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 12, itemGap: 22, textStyle: { color: t.color.ink, fontSize: 12 }, formatter: (name) => legendText(spec.items.find((it) => it.label === name), total, spec.unit) },
        xAxis: { type: 'value', max: total, show: false },
        yAxis: { type: 'category', data: [''], show: false },
        series: spec.items.map((it, i) => ({
          name: it.label, type: 'bar', stack: 'total', barWidth: 24, data: [it.value],
          itemStyle: { color: seriesColor(t, i), borderColor: t.color.paper, borderWidth: 1, borderRadius: i === 0 ? [4, 0, 0, 4] : i === last ? [0, 4, 4, 0] : 0 },
        })),
      },
      t, top + 36, spec.items.map((it) => legendText(it, total, spec.unit)).join('、'),
    );
  },
};
