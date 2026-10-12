// 図の SVG を PNG にする。Confluence の添付と、チャットの図（ターミナル、VS Code）が使う。
import { Resvg } from '@resvg/resvg-js';
import { machineSetting } from './config.ts';

// PNG に変換するときの日本語フォント。SVG のフォント指定の先頭が PC に無い場合に使われる。
// OS ごとに標準で入っているものを選ぶ。変えたいときは、この PC の設定 png.font（zukai config set png.font 名前）か環境変数 ZUKAI_PNG_FONT で指定する。
// 設定の値は、読むときに型を確かめてある（png.font は文字）。
export const pngFont = (): string => (machineSetting('png.font') as string | null) ?? ({ darwin: 'Hiragino Sans', win32: 'Yu Gothic UI' } as Partial<Record<NodeJS.Platform, string>>)[process.platform] ?? 'Noto Sans CJK JP';

// 表示幅の2倍の解像度で書き出す。フォントは実行した PC に入っているものを使う。背景は、テーマの紙の色にする。
export function toPng(svg: string, background = '#ffffff'): { data: Buffer; width: number; height: number } {
  const img = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, background, font: { loadSystemFonts: true, defaultFontFamily: pngFont() } }).render();
  return { data: img.asPng(), width: img.width, height: img.height };
}
