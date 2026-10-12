import { px, unknownKeys } from './svg.ts';
import { renderChart, axisText, isNumber, fmt, unitError } from './chart.ts';
import type { FigureType } from '../types.ts';

export interface BoxplotItem {
  label: string;
  values: number[];
}
export interface BoxplotSpec {
  type: 'boxplot';
  unit: string;
  items: BoxplotItem[];
}

// boxplot: 値のばらつきを、項目ごとの箱ひげ図で示す。
export default {
  name: 'boxplot',
  summary: '値のばらつきを、項目ごとの箱ひげ図で示す',
  when: '同じ項目に数値が数十件以上あり、ばらつきを見たい',
  example: `type: boxplot
unit: ミリ秒
items:
  - label: 受付
    values: [31, 35, 38, 40, 41, 43, 46, 52, 88]
  - label: 照合
    values: [70, 86, 95, 104, 112, 125, 148, 190, 246]`,
  fields: ['unit: 値の単位（必須）', 'items[].label: 項目の名前（必須）', 'items[].values: 計測した値の配列（必須、5個以上）。中央値や四分位数は自動で計算する'],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'unit', 'items'], 'boxplot'), ...unitError(spec, 'boxplot')];
    if (!Array.isArray(spec.items) || spec.items.length === 0) return [...errors, 'boxplot には items が1つ以上必要です。'];
    if (spec.items.length > limits.boxplot.maxItems) errors.push(`items が${spec.items.length}個あります。上限は${limits.boxplot.maxItems}個です。`);
    spec.items.forEach((it, i) => {
      errors.push(...unknownKeys(it, ['label', 'values'], `items[${i}]`));
      if (typeof it?.label !== 'string') errors.push(`items[${i}] に label がありません。`);
      if (!Array.isArray(it?.values) || it.values.length < 5 || !it.values.every(isNumber)) errors.push(`items[${i}].values は5個以上の数値にしてください。値が少ない場合は bar を使います。`);
    });
    return errors;
  },

  labels: (spec) => spec.items.map((it) => it.label),
  notes: () => [],

  render(spec, t) {
    const text = axisText(t);
    return renderChart(
      {
        dataset: [
          { source: spec.items.map((it) => it.values) },
          { transform: { type: 'boxplot', config: { itemNameFormatter: (p: { value: number }) => spec.items[p.value].label } } },
          { fromDatasetIndex: 1, fromTransformResult: 1 },
        ],
        grid: { left: Math.max(...spec.items.map((it) => px(it.label, 13))) + 24, right: 24, top: 8, bottom: 52 },
        yAxis: { type: 'category', inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.color.ink, fontSize: 13, margin: 14 } },
        xAxis: { type: 'value', scale: false, name: `${spec.unit}`, nameLocation: 'middle', nameGap: 32, nameTextStyle: text, axisLabel: { ...text, formatter: fmt }, splitLine: { lineStyle: { color: t.chart.grid } } },
        series: [
          { type: 'boxplot', datasetIndex: 1, boxWidth: [18, 22], itemStyle: { color: t.color.accentSurface, borderColor: t.color.accent, borderWidth: 1.6 } },
          { type: 'scatter', datasetIndex: 2, symbolSize: 7, itemStyle: { color: t.color.paper, borderColor: t.color.accent, borderWidth: 1.6 } },
        ],
      },
      t, spec.items.length * 54 + 64, `${spec.items.map((it) => it.label).join('、')}の値のばらつき`,
    );
  },
} satisfies FigureType<BoxplotSpec>;
