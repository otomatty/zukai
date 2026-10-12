import { px } from './svg.ts';
import { renderChart, axisText, fmt } from './chart.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType } from '../types.ts';

const schema = {
  unit: { type: 'string', required: true, nonEmpty: true, desc: '値の単位' },
  items: {
    type: 'list', required: true, min: 1, max: 'boxplot.maxItems', desc: '項目の配列。上から順に並べる',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, desc: '項目の名前' },
        values: { type: 'list', required: true, min: 5, desc: '計測した値の配列。中央値や四分位数は自動で計算する。値が少ない場合は bar を使う', of: { type: 'number' } },
      },
    },
  },
} as const satisfies Fields;
export type BoxplotSpec = { type: 'boxplot' } & Infer<typeof schema>;

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
  fields: describe(schema, contractLimits),

  validate: (spec, limits) => checkSpec(spec, schema, 'boxplot', limits),

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
