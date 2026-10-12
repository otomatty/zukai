// チャートの型が共有する部品。描画は ECharts に任せ、配色と線の太さは contract/tokens.json から渡す。
import * as echarts from 'echarts';
import { gradientVector } from './svg.ts';
import type { Tokens } from '../types.ts';

export type ChartOption = echarts.EChartsOption;
// 強調するものの色。単色か、ECharts のグラデーション。
export type ChartColor = string | echarts.LinearGradientObject;

// 生成時に SVG の文字列へ変換する。ブラウザは使わない。
export function renderChart(option: ChartOption, t: Tokens, height: number, title: string): string {
  const width = t.figure.width;
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  chart.setOption({
    animation: false,
    // フォント名に引用符が残ると、PNG への変換で SVG を読めなくなる。
    textStyle: { fontFamily: t.font.replace(/"/g, ''), color: t.color.ink },
    ...option,
  });
  // マウスを重ねたときの見た目（:hover の規則）は、静止した図には要らないので外す。
  // グラデーションの色からは、ECharts が重ねたときの色を作れず、壊れた CSS（fill:[object Object]）を出すため。
  const svg = chart.renderToSVGString().replace(/\.[\w-]+:hover \{[^}]*\}\n?/g, '');
  chart.dispose();
  // 幅に合わせて伸縮するよう、固定の幅と高さを外す。viewBox は ECharts が付けている。
  return svg.replace(/<svg ([^>]*?)width="[\d.]+" height="[\d.]+"/, `<svg $1width="100%" role="img" aria-label="${title.replace(/"/g, '&quot;')}"`);
}

// 描画せずに、各要素が置かれる位置と大きさだけを調べる。文字が収まるかの検査に使う。
// 要素の位置と大きさ。型によって持つ値が違い（矩形は x、y、width、height、扇形は cx、cy、r など）、位置を持たない要素もある。
export interface ItemLayout {
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
// ECharts の公開の型には、系列のデータを読む口（getModel）が無い。使う部分だけの形を書いておく。
interface WithModel {
  getModel(): { getSeriesByIndex(i: number): { getData(): { count(): number; getName(i: number): string; getItemLayout(i: number): Omit<ItemLayout, 'name'> | null } } };
}
export function layoutOf(option: ChartOption, t: Tokens, height: number): ItemLayout[] {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: t.figure.width, height });
  chart.setOption({ animation: false, ...option });
  const data = (chart as unknown as WithModel).getModel().getSeriesByIndex(0).getData();
  const out = Array.from({ length: data.count() }, (_, i) => ({ name: data.getName(i), ...data.getItemLayout(i) }));
  chart.dispose();
  return out;
}

export const axisText = (t: Tokens) => ({ color: t.color.sub, fontSize: 12 });

export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 数値に桁区切りを付ける。
export const fmt = (v: number): string => v.toLocaleString('ja-JP');

// チャートに共通する検証の部品。
export const unitError = (spec: { readonly unit?: unknown }, name: string): string[] => (typeof spec.unit !== 'string' || !spec.unit ? [`${name} には unit（値の単位）が必要です。`] : []);

// グラフの色の付け方。series は系列ごとに色を変え、neutral は灰色を基本にして強調するものだけに色を付ける。
export const neutral = (t: Tokens): boolean => t.chart.mode === 'neutral';

// 強調するものの色。emphasis.chart が gradient なら、テーマのグラデーション（ECharts の形）にする。
export function highlight(t: Tokens): ChartColor {
  const stops = t.gradient.stops;
  if (t.emphasis.chart !== 'gradient' || !stops.length) return t.color.accent;
  const v = gradientVector(t.gradient.angle);
  return { type: 'linear', x: v.x1, y: v.y1, x2: v.x2, y2: v.y2, colorStops: stops.map((color, i) => ({ offset: i / (stops.length - 1), color })) };
}

// 2つの色を混ぜる。p は b の割合。
export function mix(a: string, b: string, p: number): string {
  const ch = (h: string) => [1, 3, 5].map((i) => parseInt((h.length === 4 ? h.replace(/\w/g, (c) => c + c) : h).slice(i, i + 2), 16));
  const [x, y] = [ch(a), ch(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * p).toString(16).padStart(2, '0')).join('')}`;
}
// テーマが neutral のときに、型の書き方に添える指示。
export const modeGuide = (t: Tokens): string[] => (neutral(t) ? ['このテーマは灰色を基本にするので、emphasis: true を付けたものだけに色が付く。注目させたいもの1つに付ける'] : []);

// 灰色の濃淡。k が大きいほど文字の色に近づける。neutral で、強調しないものを見分けるのに使う。
// 紙の色には寄せない。どの濃淡も、紙からは chart.muted より離れ、theme check の chart.muted の検査がすべてに効くようにするため。
export const grey = (t: Tokens, k: number): string => mix(t.chart.muted, t.color.ink, [0, 0.2, 0.35, 0.5, 0.62][Math.min(k, 4)]);

// 系列を見分ける色。検証済みの3色を順に使い、4つ目からは灰色にする。
export const seriesColor = (t: Tokens, i: number): string => t.chart.series[i] ?? (i === t.chart.series.length ? t.chart.muted : t.chart.rest);
