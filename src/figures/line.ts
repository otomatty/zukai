import { px } from './svg.ts';
import { renderChart, axisText, fmt, highlight, neutral, grey, modeGuide } from './chart.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType } from '../types.ts';

const schema = {
  unit: { type: 'string', required: true, nonEmpty: true, desc: '値の単位' },
  x: { type: 'list', required: true, min: 2, max: 'line.maxPoints', hint: '期間を絞るか、間隔を広げてください。', desc: '横軸の目盛りの配列。時間の順に並べる', of: { type: 'string', orNumber: true } },
  // 名前が重なると、読み手は見分けられない。凡例は名前で系列を引くので、2つ目の系列も1つ目の値で書かれてしまう。
  series: {
    type: 'list', required: true, min: 1, max: 'line.maxSeries', hint: '伝えたい系列に絞ってください。', unique: 'label', atMostOne: 'emphasis',
    desc: '系列の配列。値の大きさが数倍違う系列を並べると、小さいほうの変化が読めなくなる。その場合はセクションを分ける',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, desc: '系列の名前' },
        values: { type: 'list', required: true, desc: 'x と同じ個数の数値', of: { type: 'number' } },
        emphasis: { type: 'boolean', desc: 'true にすると、その系列を太い線で描く', note: '図全体で1つまで' },
      },
    },
  },
  marker: {
    type: 'object', desc: '出来事のあった目盛りと、その名前',
    fields: {
      // at は x の目盛りと文字で比べるので、数でも書ける。
      at: { type: 'string', required: true, orNumber: true, desc: '出来事のあった目盛り。x のどれかを書く' },
      label: { type: 'string', required: true, desc: '出来事の名前' },
    },
  },
} as const satisfies Fields;
// x は、スキーマでは数も受け付けるが、validate が文字にそろえる。検証に通った仕様では文字の配列。
export type LineSpec = { type: 'line' } & Omit<Infer<typeof schema>, 'x'> & { x: string[] };

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
  fields: describe(schema, contractLimits),

  guide: (t) => modeGuide(t),

  validate(spec, limits) {
    const errors = checkSpec(spec, schema, 'line', limits);
    if (errors.length) return errors;
    // 形は上で確かめたので、ここからは検証した後の形として読む（x を文字にそろえるのは、すぐ下で行う）。
    const s = spec as LineSpec;
    // 目盛りは文字にそろえる。YAML では数（2024 など）として読まれることがある。
    s.x = s.x.map(String);
    s.series.forEach((se, i) => {
      if (se.values.length !== s.x.length) errors.push(`series[${i}].values は、x と同じ${s.x.length}個の数値にしてください。`);
    });
    if (s.marker && !s.x.includes(String(s.marker.at))) errors.push(`marker.at「${s.marker.at}」は x にありません。`);
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
