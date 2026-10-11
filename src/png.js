// 図の SVG を PNG にする。Confluence の添付と、チャットの図（ターミナル、VS Code）が使う。
import { Resvg } from '@resvg/resvg-js';
import { machineSetting } from './config.js';

// PNG に変換するときの日本語フォント。SVG のフォント指定の先頭が PC に無い場合に使われる。
// OS ごとに標準で入っているものを選ぶ。変えたいときは、この PC の設定 png.font（zukai config set png.font 名前）か環境変数 ZUKAI_PNG_FONT で指定する。
export const pngFont = () => machineSetting('png.font') ?? { darwin: 'Hiragino Sans', win32: 'Yu Gothic UI' }[process.platform] ?? 'Noto Sans CJK JP';

// 表示幅の2倍の解像度で書き出す。フォントは実行した PC に入っているものを使う。
export function toPng(svg) {
  const img = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, background: '#ffffff', font: { loadSystemFonts: true, defaultFontFamily: pngFont() } }).render();
  return { data: img.asPng(), width: img.width, height: img.height };
}
