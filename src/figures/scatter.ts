import { unknownKeys } from './svg.ts';
import { renderChart, axisText, isNumber, fmt } from './chart.ts';
import type { FigureType } from '../types.ts';
import type { MarkLineComponentOption } from 'echarts';

export interface ScatterAxis {
  label: string;
  unit: string;
}
export interface ScatterSpec {
  type: 'scatter';
  x: ScatterAxis;
  y: ScatterAxis;
  // [横の値, 縦の値]
  points: [number, number][];
  trend?: boolean;
}

const axisName = (a: ScatterAxis): string => `${a.label}（${a.unit}）`;

// scatter: 2つの量の関係を、点の並びで示す。
export default {
  name: 'scatter',
  summary: '2つの量の関係を、点の並びで示す',
  when: '1件ごとに2つの数値があり、その関係を見たい',
  example: `type: scatter
x:
  label: データ量
  unit: 万件
y:
  label: 処理時間
  unit: 秒
points: [[10, 6], [25, 13], [40, 21], [60, 31], [83, 41]]
trend: true`,
  fields: ['x.label / x.unit: 横軸の名前と単位（必須）', 'y.label / y.unit: 縦軸の名前と単位（必須）', 'points: [横の値, 縦の値] の配列（必須）', 'trend: true にすると、点の傾向を表す直線を計算して描く（任意）'],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'x', 'y', 'points', 'trend'], 'scatter')];
    for (const k of ['x', 'y'] as const) {
      errors.push(...unknownKeys(spec[k], ['label', 'unit'], k));
      if (typeof spec[k]?.label !== 'string' || typeof spec[k]?.unit !== 'string' || !spec[k].unit) errors.push(`scatter には ${k}.label と ${k}.unit が必要です。`);
    }
    if (!Array.isArray(spec.points) || spec.points.length < 3) return [...errors, 'scatter には points が3つ以上必要です。'];
    if (spec.points.length > limits.scatter.maxPoints) errors.push(`points が${spec.points.length}個あります。上限は${limits.scatter.maxPoints}個です。`);
    if (!spec.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNumber))) errors.push('points は [横の値, 縦の値] の数値の組にしてください。');
    return errors;
  },

  labels: (spec) => [spec.x.label, spec.y.label],
  notes: () => [],

  render(spec, t) {
    const text = axisText(t);
    // 傾向の直線は、最小二乗法で計算する。AI には書かせない。
    let markLine: MarkLineComponentOption | undefined;
    if (spec.trend) {
      const n = spec.points.length;
      const mx = spec.points.reduce((s, p) => s + p[0], 0) / n;
      const my = spec.points.reduce((s, p) => s + p[1], 0) / n;
      const sxx = spec.points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
      const slope = sxx ? spec.points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx : 0;
      const xs = spec.points.map((p) => p[0]);
      const at = (x: number): number[] => [x, my + slope * (x - mx)];
      markLine = { silent: true, symbol: 'none', lineStyle: { color: t.chart.axis, type: 'solid', width: 1.5 }, label: { show: false }, data: [[{ coord: at(Math.min(...xs)) }, { coord: at(Math.max(...xs)) }]] };
    }
    const allPositive = (i: number): boolean => spec.points.every((p) => p[i] >= 0);
    return renderChart(
      {
        grid: { left: 56, right: 24, top: 36, bottom: 56 },
        xAxis: { type: 'value', min: allPositive(0) ? 0 : undefined, name: axisName(spec.x), nameLocation: 'middle', nameGap: 34, nameTextStyle: text, axisLine: { lineStyle: { color: t.chart.axis } }, axisTick: { show: false }, axisLabel: { ...text, formatter: fmt }, splitLine: { show: false } },
        yAxis: { type: 'value', min: allPositive(1) ? 0 : undefined, name: axisName(spec.y), nameGap: 14, nameTextStyle: { ...text, align: 'left', padding: [0, 0, 0, -40] }, axisLabel: { ...text, formatter: fmt }, splitLine: { lineStyle: { color: t.chart.grid } } },
        series: [{ type: 'scatter', data: spec.points, symbolSize: 10, itemStyle: { color: t.color.accent, borderColor: t.color.paper, borderWidth: 2 }, markLine }],
      },
      t, 320, `${axisName(spec.x)}と${axisName(spec.y)}の関係`,
    );
  },
} satisfies FigureType<ScatterSpec>;
