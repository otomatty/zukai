// チャートの型が共有する部品。描画は ECharts に任せ、配色と線の太さは contract/tokens.json から渡す。
import { createRequire } from 'node:module';
import type * as Echarts from 'echarts';
import { frame, gradientVector } from './svg.ts';
import { mix, seriesColor, textOn } from '../color.ts';
import type { Tokens } from '../types.ts';

export type ChartOption = Echarts.EChartsOption;
// 強調するものの色。単色か、ECharts のグラデーション。
export type ChartColor = string | Echarts.LinearGradientObject;

// ECharts は、チャートを描くときに初めて読む。読み込みに時間がかかり、チャートの無い原稿の Lint と描画を遅くするため。
// 1つのファイルにまとめた版（CommonJS）を require で読む。ES モジュールの版は、ファイルが多く、読み込みがさらに遅い。
const require = createRequire(import.meta.url);
let loaded: typeof Echarts | null = null;
const echarts = (): typeof Echarts => (loaded ??= require('echarts') as typeof Echarts);

// 生成時に SVG の文字列へ変換する。ブラウザは使わない。
export function renderChart(option: ChartOption, t: Tokens, height: number, title: string): string {
  const width = t.figure.width;
  const chart = echarts().init(null, null, { renderer: 'svg', ssr: true, width, height });
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
  // ECharts の座標を保ち、他の図と同じ余白と背景を付ける。
  return svg.replace(/<svg\b[^>]*>/, () => frame(t, height, title));
}

// 描画せずに、各要素が置かれる位置と大きさだけを調べる。文字が収まるかの検査に使う。
// 要素の位置と大きさ。型によって持つ値が違い（矩形は x、y、width、height、扇形は cx、cy、r など）、位置を持たない要素もある。
export interface ItemLayout {
  name: string;
  // データに書いた id。書かなければ ECharts が付ける。
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
// ECharts の公開の型には、系列のデータを読む口（getModel）が無い。使う部分だけの形を書いておく。
interface WithModel {
  getModel(): { getSeriesByIndex(i: number): { getData(): { count(): number; getName(i: number): string; getId(i: number): string; getItemLayout(i: number): Omit<ItemLayout, 'name' | 'id'> | null } } };
}
export function layoutOf(option: ChartOption, t: Tokens, height: number): ItemLayout[] {
  const chart = echarts().init(null, null, { renderer: 'svg', ssr: true, width: t.figure.width, height });
  chart.setOption({ animation: false, ...option });
  const data = (chart as unknown as WithModel).getModel().getSeriesByIndex(0).getData();
  const out = Array.from({ length: data.count() }, (_, i) => ({ name: data.getName(i), id: data.getId(i), ...data.getItemLayout(i) }));
  chart.dispose();
  return out;
}

export const axisText = (t: Tokens) => ({ color: t.color.sub, fontSize: 12 });

// 数値に桁区切りを付ける。
export const fmt = (v: number): string => v.toLocaleString('ja-JP');

// グラフの色の付け方。series は系列ごとに色を変え、neutral は灰色を基本にして強調するものだけに色を付ける。
export const neutral = (t: Tokens): boolean => t.chart.mode === 'neutral';

// 強調するものの色。emphasis.chart が gradient なら、テーマのグラデーション（ECharts の形）にする。
export function highlight(t: Tokens): ChartColor {
  const stops = t.gradient.stops;
  if (t.emphasis.chart !== 'gradient' || !stops.length) return t.color.accent;
  const v = gradientVector(t.gradient.angle);
  return { type: 'linear', x: v.x1, y: v.y1, x2: v.x2, y2: v.y2, colorStops: stops.map((color, i) => ({ offset: i / (stops.length - 1), color })) };
}

// 2つの色を混ぜる。p は b の割合。計算は src/color.ts にある（テーマの検査も同じ式で地色を作るため）。
export { mix };

// テーマが neutral のときに、型の書き方に添える指示。
export const modeGuide = (t: Tokens): string[] => (neutral(t) ? ['このテーマは灰色を基本にするので、emphasis: true を付けたものだけに色が付く。注目させたいもの1つに付ける'] : []);

// 灰色の濃淡。k が大きいほど文字の色に近づける。neutral で、強調しないものを見分けるのに使う。
// 紙の色には寄せない。どの濃淡も、紙からは chart.muted より離れ、theme check の chart.muted の検査がすべてに効くようにするため。
export const grey = (t: Tokens, k: number): string => mix(t.chart.muted, t.color.ink, [0, 0.2, 0.35, 0.5, 0.62][Math.min(k, 4)]);

// 塗った面の上に書く文字の色。白抜きの文字（color.onAccent）と本文の色（color.ink）のうち、地色とのコントラストが高いほう。
export const labelOn = (t: Tokens, bg: string): { color: string; ratio: number } => textOn(bg, [t.color.onAccent, t.color.ink]);

// 系列を見分ける色。計算は src/color.ts にある（テーマの検査も同じ色を確かめるため）。
export { seriesColor };
