import { px, unknownKeys } from './svg.js';
import { renderChart, axisText, isNumber, fmt, unitError, neutral } from './chart.js';

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
  fields: ['unit: 値の単位（必須）', 'x: 横軸の項目の配列', 'y: 縦軸の項目の配列。上から順に並べる', 'values: y の項目ごとの行。各行は x と同じ個数の0以上の数値'],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'unit', 'x', 'y', 'values'], 'heatmap'), ...unitError(spec, 'heatmap')];
    if (!Array.isArray(spec.x) || spec.x.length < 2 || !Array.isArray(spec.y) || spec.y.length < 2) return [...errors, 'heatmap には x と y が2つ以上ずつ必要です。'];
    spec.x = spec.x.map(String);
    spec.y = spec.y.map(String);
    if (spec.x.length > limits.heatmap.maxX) errors.push(`x が${spec.x.length}個あります。上限は${limits.heatmap.maxX}個です。`);
    if (spec.y.length > limits.heatmap.maxY) errors.push(`y が${spec.y.length}個あります。上限は${limits.heatmap.maxY}個です。`);
    const ok = Array.isArray(spec.values) && spec.values.length === spec.y.length && spec.values.every((row) => Array.isArray(row) && row.length === spec.x.length && row.every((v) => isNumber(v) && v >= 0));
    if (!ok) errors.push(`values は${spec.y.length}行で、各行を${spec.x.length}個の0以上の数値にしてください。`);
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
    const data = spec.values.flatMap((row, i) => row.map((v, j) => [spec.x[j], spec.y[i], v]));
    return renderChart(
      {
        grid: { left: Math.max(...spec.y.map((y) => px(y, 12))) + 20, right: px(top, 12) + 40, top: 8, bottom: 32 },
        xAxis: { type: 'category', data: spec.x, axisLine: { show: false }, axisTick: { show: false }, axisLabel: text },
        yAxis: { type: 'category', inverse: true, data: spec.y, axisLine: { show: false }, axisTick: { show: false }, axisLabel: text },
        visualMap: { min: 0, max, calculable: false, orient: 'vertical', right: 8, top: 'middle', itemHeight: Math.min(140, spec.y.length * 24), itemWidth: 14, text: [top, '0'], textStyle: { color: t.color.sub, fontSize: 12 }, inRange: { color: neutral(t) ? [t.color.surface, t.chart.muted] : [t.color.accentSurface, t.color.accent] } },
        // 値が大きいマスにだけ数値を書く。すべてのマスに書くと読みにくい。
        series: [{ type: 'heatmap', data, itemStyle: { borderColor: t.color.paper, borderWidth: 2, borderRadius: 3 }, label: { show: true, color: neutral(t) ? t.color.ink : t.color.onAccent, fontSize: 12, fontWeight: 600, formatter: (p) => (p.value[2] >= max * 0.6 ? fmt(p.value[2]) : '') } }],
      },
      t, spec.y.length * 34 + 44, `${spec.y.join('、')}と${spec.x.join('、')}の組み合わせごとの量`,
    );
  },
};
