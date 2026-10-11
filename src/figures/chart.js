// チャートの型が共有する部品。描画は ECharts に任せ、配色と線の太さは contract/tokens.json から渡す。
import * as echarts from 'echarts';

// 生成時に SVG の文字列へ変換する。ブラウザは使わない。
export function renderChart(option, t, height, title) {
  const width = t.figure.width;
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  chart.setOption({
    animation: false,
    // フォント名に引用符が残ると、PNG への変換で SVG を読めなくなる。
    textStyle: { fontFamily: t.font.replace(/"/g, ''), color: t.color.ink },
    ...option,
  });
  const svg = chart.renderToSVGString();
  chart.dispose();
  // 幅に合わせて伸縮するよう、固定の幅と高さを外す。viewBox は ECharts が付けている。
  return svg.replace(/<svg ([^>]*?)width="[\d.]+" height="[\d.]+"/, `<svg $1width="100%" role="img" aria-label="${title.replace(/"/g, '&quot;')}"`);
}

// 描画せずに、各要素が置かれる位置と大きさだけを調べる。文字が収まるかの検査に使う。
export function layoutOf(option, t, height) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: t.figure.width, height });
  chart.setOption({ animation: false, ...option });
  const data = chart.getModel().getSeriesByIndex(0).getData();
  const out = Array.from({ length: data.count() }, (_, i) => ({ name: data.getName(i), ...data.getItemLayout(i) }));
  chart.dispose();
  return out;
}

export const axisText = (t) => ({ color: t.color.sub, fontSize: 12 });

export const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// 数値に桁区切りを付ける。
export const fmt = (v) => v.toLocaleString('ja-JP');

// チャートに共通する検証の部品。
export const unitError = (spec, name) => (typeof spec.unit !== 'string' || !spec.unit ? [`${name} には unit（値の単位）が必要です。`] : []);

// 系列を見分ける色。検証済みの3色を順に使い、4つ目からは灰色にする。
export const seriesColor = (t, i) => t.chart.series[i] ?? (i === t.chart.series.length ? t.chart.muted : t.chart.rest);
