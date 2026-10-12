import { px } from './svg.ts';
import { renderChart, axisText, fmt, neutral, labelOn, mix } from './chart.ts';
import { TEXT_CONTRAST } from '../color.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType } from '../types.ts';

const schema = {
  unit: { type: 'string', required: true, nonEmpty: true, desc: '値の単位' },
  x: { type: 'list', required: true, min: 2, max: 'heatmap.maxX', desc: '横軸の項目の配列', of: { type: 'string', orNumber: true } },
  y: { type: 'list', required: true, min: 2, max: 'heatmap.maxY', desc: '縦軸の項目の配列。上から順に並べる', of: { type: 'string', orNumber: true } },
  // y の項目ごとの行。各行は x と同じ個数（validate が確かめる）。
  values: { type: 'list', required: true, desc: 'y の項目ごとの行。各行は x と同じ個数の0以上の数値', of: { type: 'list', of: { type: 'number', min: 0 } } },
} as const satisfies Fields;
// x と y は、スキーマでは数も受け付けるが、validate が文字にそろえる。検証に通った仕様では文字の配列。
export type HeatmapSpec = { type: 'heatmap' } & Omit<Infer<typeof schema>, 'x' | 'y'> & { x: string[]; y: string[] };
// マス1つのデータ。[x の項目, y の項目, 値]
type Cell = [string, string, number];

// heatmap: 2つの軸の組み合わせごとの量を、色の濃さで示す。
export default {
  name: 'heatmap',
  summary: '2つの軸の組み合わせごとの量を、色の濃さで示す',
  when: '2つの軸（曜日と時間帯など）の組み合わせごとに数値がある',
  example: `type: heatmap
unit: 件／時
x: [9時, 12時, 15時]
y: [平日, 休日]
values:
  - [48, 30, 34]
  - [12, 9, 8]`,
  fields: describe(schema, contractLimits),

  validate(spec, limits) {
    const errors = checkSpec(spec, schema, 'heatmap', limits);
    if (errors.length) return errors;
    // 形は上で確かめたので、ここからは検証した後の形として読む（x と y を文字にそろえるのは、すぐ下で行う）。
    const s = spec as HeatmapSpec;
    // 項目は文字にそろえる。YAML では数として読まれることがある。
    s.x = s.x.map(String);
    s.y = s.y.map(String);
    if (s.values.length !== s.y.length || s.values.some((row) => row.length !== s.x.length)) errors.push(`values は${s.y.length}行で、各行を${s.x.length}個の0以上の数値にしてください。`);
    return errors;
  },

  fit(spec, t) {
    const slot = (t.figure.width - 150) / spec.x.length;
    const long = spec.x.filter((x) => px(x, 12) + 8 > slot);
    return long.length ? [`横軸の項目「${long[0]}」${long.length > 1 ? `など${long.length}個` : ''}が隣と重なります。短くしてください。`] : [];
  },

  labels: (spec) => [...spec.x, ...spec.y],
  notes: () => [],

  render(spec, t) {
    const text = axisText(t);
    const max = Math.max(...spec.values.flat());
    const top = `${fmt(max)}${spec.unit}`;
    // マスの色は、値に応じて ramp の2色を混ぜた色（visualMap）。値がすべて 0 のときは、ECharts は中間の色で塗る。
    const ramp = neutral(t) ? [t.color.surface, t.chart.muted] : [t.color.accentSurface, t.color.accent];
    // 値が大きいマスにだけ数値を書く。すべてのマスに書くと読みにくい。
    // 文字の色は、マスの色に合わせて白抜きか本文の色を選ぶ。どちらでも読めない中間の濃さのマスには書かない。
    const data = spec.values.flatMap((row, i) => row.map((v, j) => {
      const label = labelOn(t, mix(ramp[0], ramp[1], max ? v / max : 0.5));
      const show = v >= max * 0.6 && label.ratio >= TEXT_CONTRAST;
      return { value: [spec.x[j], spec.y[i], v] as Cell, label: { show, color: label.color } };
    }));
    return renderChart(
      {
        grid: { left: Math.max(...spec.y.map((y) => px(y, 12))) + 20, right: px(top, 12) + 40, top: 8, bottom: 32 },
        xAxis: { type: 'category', data: spec.x, axisLine: { show: false }, axisTick: { show: false }, axisLabel: text },
        yAxis: { type: 'category', inverse: true, data: spec.y, axisLine: { show: false }, axisTick: { show: false }, axisLabel: text },
        visualMap: { min: 0, max, calculable: false, orient: 'vertical', right: 8, top: 'middle', itemHeight: Math.min(140, spec.y.length * 24), itemWidth: 14, text: [top, '0'], textStyle: { color: t.color.sub, fontSize: 12 }, inRange: { color: ramp } },
        series: [{ type: 'heatmap', data, itemStyle: { borderColor: t.color.paper, borderWidth: 2, borderRadius: 3 }, label: { fontSize: 12, fontWeight: 600, formatter: (p) => fmt((p.value as Cell)[2]) } }],
      },
      t, spec.y.length * 34 + 44, `${spec.y.join('、')}と${spec.x.join('、')}の組み合わせごとの量`,
    );
  },
} satisfies FigureType<HeatmapSpec>;
