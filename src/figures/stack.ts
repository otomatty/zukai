import { px } from './svg.ts';
import { renderChart, fmt, seriesColor, highlight, neutral, grey, modeGuide } from './chart.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType } from '../types.ts';

const schema = {
  unit: { type: 'string', required: true, nonEmpty: true, desc: '値の単位' },
  // 名前が重なると、読み手は見分けられない。凡例は名前で内訳を引くので、2つ目の内訳も1つ目の値で書かれてしまう。
  items: {
    type: 'list', required: true, min: 2, max: 'stack.maxItems', hint: '小さい内訳を「その他」にまとめてください。', unique: 'label', atMostOne: 'emphasis', desc: '内訳の配列。大きい順に並べ、「その他」は最後に置く',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, desc: '内訳の名前' },
        value: { type: 'number', required: true, above: 0, desc: '数値。割合は自動で計算する' },
        emphasis: { type: 'boolean', desc: 'true にすると、その内訳を強調の色で描く', note: '図全体で1つまで' },
      },
    },
  },
} as const satisfies Fields;
export type StackSpec = { type: 'stack' } & Infer<typeof schema>;
type StackItem = StackSpec['items'][number];

const legendText = (it: StackItem, total: number, unit: string): string => `${it.label} ${Math.round((it.value / total) * 100)}%（${fmt(it.value)}${unit}）`;

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
    emphasis: true
  - label: データベース
    value: 5
  - label: その他
    value: 3`,
  fields: describe(schema, contractLimits),

  guide: (t) => modeGuide(t),

  validate: (spec, limits) => checkSpec(spec, schema, 'stack', limits),

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
    // neutral では、強調した内訳だけに色を付け、ほかは灰色の濃淡で見分ける。
    let k = 0;
    const colors = spec.items.map((it, i) => (it.emphasis ? highlight(t) : neutral(t) ? grey(t, k++) : seriesColor(t, i)));
    return renderChart(
      {
        grid: { left: 0, right: 0, top, bottom: 4 },
        // 凡例の名前は items の label なので、find は必ず見つける。
        legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 12, itemGap: 22, textStyle: { color: t.color.ink, fontSize: 12 }, formatter: (name) => legendText(spec.items.find((it) => it.label === name)!, total, spec.unit) },
        xAxis: { type: 'value', max: total, show: false },
        yAxis: { type: 'category', data: [''], show: false },
        series: spec.items.map((it, i) => ({
          name: it.label, type: 'bar', stack: 'total', barWidth: 24, data: [it.value],
          itemStyle: { color: colors[i], borderColor: t.color.paper, borderWidth: 1, borderRadius: i === 0 ? [4, 0, 0, 4] : i === last ? [0, 4, 4, 0] : 0 },
        })),
      },
      t, top + 36, spec.items.map((it) => legendText(it, total, spec.unit)).join('、'),
    );
  },
} satisfies FigureType<StackSpec>;
