// 色の計算。図（src/figures）とテーマの検査（src/theme.ts）が、同じ式で地色と文字の色を決め、確かめるために使う。
import type { Tokens } from './types.ts';

// 文字の色と地色に要るコントラスト比（WCAG AA、本文の大きさ）。
export const TEXT_CONTRAST = 4.5;

// #rgb か #rrggbb を、0〜1 の RGB にする。
export const rgb = (h: string): number[] => {
  const s = h.slice(1).length === 3 ? [...h.slice(1)].map((c) => c + c).join('') : h.slice(1);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
export const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (h: string) => {
  const [r, g, b] = rgb(h).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// WCAG のコントラスト比。
export const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// 2つの色を混ぜる。p は b の割合。ECharts の visualMap が、値に応じた色を作るのと同じ式（sRGB の値をそのまま混ぜる）。
export function mix(a: string, b: string, p: number): string {
  const ch = (h: string) => [1, 3, 5].map((i) => parseInt((h.length === 4 ? h.replace(/\w/g, (c) => c + c) : h).slice(i, i + 2), 16));
  const [x, y] = [ch(a), ch(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * p).toString(16).padStart(2, '0')).join('')}`;
}

// 塗った地色の上に書く文字の色。候補のうち、地色とのコントラストが最も高いものを選ぶ。
// 地色の明るさはマスや系列ごとに違うので、白抜きの文字（color.onAccent）と本文の色（color.ink）のどちらかに決めると、どちらかの地色で読めなくなる。
export function textOn(bg: string, candidates: string[]): { color: string; ratio: number } {
  return candidates.map((color) => ({ color, ratio: contrast(color, bg) })).reduce((a, b) => (b.ratio > a.ratio ? b : a));
}

// 系列を見分ける色。検証済みの3色を順に使い、4つ目からは灰色にする。
export const seriesColor = (t: Tokens, i: number): string => t.chart.series[i] ?? (i === t.chart.series.length ? t.chart.muted : t.chart.rest);

// ツリーマップの上の階層の色。neutral では、塗った面に白抜きの文字を載せず、淡い灰色に塗る。
export const treemapColor = (t: Tokens, i: number): string => (t.chart.mode === 'neutral' ? mix(t.chart.muted, t.color.paper, [0.72, 0.8, 0.86][i % 3]) : seriesColor(t, i));
