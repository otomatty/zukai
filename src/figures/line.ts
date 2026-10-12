import { px, unknownKeys } from './svg.ts';
import { renderChart, axisText, isNumber, fmt, highlight, neutral, grey, modeGuide, duplicateLabel } from './chart.ts';
import type { FigureType } from '../types.ts';

export interface LineSeries {
  label: string;
  values: number[];
  emphasis?: boolean;
}
export interface LineSpec {
  type: 'line';
  unit: string;
  // validate が文字にそろえる。
  x: string[];
  series: LineSeries[];
  // at は x の目盛りと文字で比べるので、数でも書ける。
  marker?: { at: string | number; label: string };
}

const PLOT_LEFT = 56;
const PLOT_RIGHT = 72;

// line: 時間による変化を、折れ線で示す。
export default {
  name: 'line',
  summary: '時間による変化を、折れ線で示す',
  when: '時間の順に並んだ数値が、1〜3系列ある',
  example: `type: line
unit: 件／月
x: [5月, 6月, 7月, 8月, 9月, 10月]
series:
  - label: パスワード誤り
    values: [320, 340, 330, 210, 150, 120]
    emphasis: true
  - label: 期限切れ
    values: [60, 55, 70, 65, 58, 62]
marker:
  at: 8月
  label: ロックを導入`,
  fields: [
    'unit: 値の単位（必須）',
    'x: 横軸の目盛りの配列。時間の順に並べる',
    'series: 系列の配列。値の大きさが数倍違う系列を並べると、小さいほうの変化が読めなくなる。その場合はセクションを分ける',
    'series[].label: 系列の名前（必須）',
    'series[].values: x と同じ個数の数値（必須）',
    'series[].emphasis: true にすると、その系列を太い線で描く（任意、図全体で1つまで）',
    'marker.at / marker.label: 出来事のあった目盛りと、その名前（任意）',
  ],

  guide: (t) => modeGuide(t),

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'unit', 'x', 'series', 'marker'], 'line')];
    if (typeof spec.unit !== 'string' || !spec.unit) errors.push('line には unit（値の単位）が必要です。');
    if (!Array.isArray(spec.x) || spec.x.length < 2) {
      errors.push('line には x（横軸の目盛り）が2つ以上必要です。');
      return errors;
    }
    // 目盛りは文字にそろえる。YAML では数（2024 など）として読まれることがある。
    const x = spec.x.map(String);
    (spec as { x: string[] }).x = x;
    if (!Array.isArray(spec.series) || spec.series.length === 0) {
      errors.push('line には series が1つ以上必要です。');
      return errors;
    }
    if (x.length > limits.line.maxPoints) errors.push(`x が${x.length}個あります。上限は${limits.line.maxPoints}個です。期間を絞るか、間隔を広げてください。`);
    if (spec.series.length > limits.line.maxSeries) errors.push(`series が${spec.series.length}本あります。上限は${limits.line.maxSeries}本です。伝えたい系列に絞ってください。`);
    spec.series.forEach((s, i) => {
      errors.push(...unknownKeys(s, ['label', 'values', 'emphasis'], `series[${i}]`));
      if (typeof s?.label !== 'string') errors.push(`series[${i}] に label がありません。`);
      if (!Array.isArray(s?.values) || s.values.length !== x.length || !s.values.every(isNumber)) {
        errors.push(`series[${i}].values は、x と同じ${x.length}個の数値にしてください。`);
      }
    });
    errors.push(...duplicateLabel(spec.series, 'series'));
    if (spec.series.filter((s) => s?.emphasis).length > 1) errors.push('emphasis を付けられる系列は1つまでです。');
    if (spec.marker !== undefined) {
      errors.push(...unknownKeys(spec.marker, ['at', 'label'], 'marker'));
      if (!x.includes(String(spec.marker?.at))) errors.push(`marker.at「${spec.marker?.at}」は x にありません。`);
      if (typeof spec.marker?.label !== 'string') errors.push('marker に label がありません。');
    }
    return errors;
  },

  // 横軸の目盛りが、隣と重ならずに並ぶかを確かめる。
  fit(spec, t) {
    const slot = (t.figure.width - PLOT_LEFT - PLOT_RIGHT) / spec.x.length;
    const long = spec.x.filter((x) => px(x, 12) + 8 > slot);
    return long.length ? [`横軸の目盛り「${long[0]}」${long.length > 1 ? `など${long.length}個` : ''}が隣と重なります。短くするか、x の個数を減らしてください。`] : [];
  },

  labels: (spec) => [...spec.series.map((s) => s.label), ...(spec.marker ? [spec.marker.label] : [])],
  notes: () => [],

  render(spec, t) {
    const many = spec.series.length > 1;
    // neutral では、強調した系列だけに色を付け、ほかは灰色の濃淡にする。
    let k = 0;
    const colors = neutral(t) ? spec.series.map((s) => (s.emphasis ? highlight(t) : grey(t, k++))) : many ? spec.series.map((s, i) => (s.emphasis ? highlight(t) : t.chart.series[i])) : [spec.series[0].emphasis ? highlight(t) : t.color.accent];
    const text = axisText(t);
    return renderChart(
      {
        color: colors,
        grid: { left: PLOT_LEFT, right: PLOT_RIGHT, top: many ? 64 : 36, bottom: 32 },
        legend: many ? { top: 0, left: PLOT_LEFT - 8, icon: 'roundRect', itemWidth: 14, itemHeight: 4, itemGap: 20, textStyle: { color: t.color.ink, fontSize: 12 } } : undefined,
        xAxis: { type: 'category', data: spec.x, boundaryGap: false, axisLine: { lineStyle: { color: t.chart.axis } }, axisTick: { show: false }, axisLabel: { ...text, margin: 12 } },
        yAxis: {
          type: 'value', min: 0, name: spec.unit, nameGap: 14, nameTextStyle: { ...text, align: 'right', padding: [0, 8, 0, 0] },
          axisLabel: { ...text, formatter: fmt }, splitLine: { lineStyle: { color: t.chart.grid } },
        },
        series: spec.series.map((s, i) => ({
          name: s.label, type: 'line', data: s.values, symbol: 'circle', symbolSize: 8, lineStyle: { width: s.emphasis ? 3 : 2 }, itemStyle: { borderColor: t.color.paper, borderWidth: 2 },
          // 線の右端に最後の値を書く。重なる場合は上下にずらす。
          endLabel: { show: true, distance: 8, color: t.color.ink, fontSize: 12, fontWeight: 600, formatter: (p) => fmt(p.value as number) },
          labelLayout: { moveOverlap: 'shiftY' },
          ...(i === 0 && spec.marker
            ? { markLine: { silent: true, symbol: 'none', lineStyle: { color: t.color.sub, type: 'solid', width: 1 }, label: { formatter: spec.marker.label, color: t.color.sub, fontSize: 12, position: 'end', rotate: 0 }, data: [{ xAxis: String(spec.marker.at) }] } }
            : {}),
        })),
      },
      t, 300, spec.series.map((s) => s.label).join('、') + 'の推移',
    );
  },
} satisfies FigureType<LineSpec>;
