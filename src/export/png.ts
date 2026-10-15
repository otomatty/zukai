// 図の SVG を PNG にする。Confluence の添付と、チャットの図（ターミナル、VS Code）が使う。
import { execFileSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import type { ResvgRenderOptions } from '@resvg/resvg-js';
import { machineSetting } from '../config.ts';

// PNG に変換するときの日本語フォント。SVG のフォント指定の先頭が PC に無い場合に使われる。
// OS ごとに標準で入っているものを選ぶ。変えたいときは、この PC の設定 png.font（zukai config set png.font 名前）か環境変数 ZUKAI_PNG_FONT で指定する。
// 設定の値は、読むときに型を確かめてある（png.font は文字）。
export const pngFont = (): string => (machineSetting('png.font') as string | null) ?? ({ darwin: 'Hiragino Sans', win32: 'Yu Gothic UI' } as Partial<Record<NodeJS.Platform, string>>)[process.platform] ?? 'Noto Sans CJK JP';

// resvg は、PC のフォントをすべて読むと1回に数十〜百数十ms かかる。図ごとに読み直すと、書き出しの大半がこの時間になる。
// fontconfig（fc-list）があれば、SVG が指定した書体のファイルだけを探して渡す。結果は書体の名前ごとに覚えておく。
const filesByFamily = new Map<string, string[]>();
function familyFiles(family: string): string[] {
  let files = filesByFamily.get(family);
  if (!files) {
    try {
      files = execFileSync('fc-list', [family, '-f', '%{file}\n'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
    } catch {
      files = [];
    }
    filesByFamily.set(family, files);
  }
  return files;
}
let emoji: string[] | undefined;
const emojiFiles = (): string[] => (emoji ??= familyFiles('Noto Color Emoji'));

// SVG の font-family（属性と style の両方）に書かれた書体の名前。総称（sans-serif など）は除く。
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
const familiesOf = (svg: string): string[] => [
  ...new Set(
    [...svg.matchAll(/font-family\s*[:=]\s*"?([^;"}>]+)/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s && !GENERIC.has(s.toLowerCase())),
  ),
];

// 渡すフォントの指定。既定のフォント（pngFont）が見つからないときは、これまでどおり PC のフォントをすべて読む。
// 足りない字を PC のほかのフォントで補う動きを、変えないようにするため。
function fontOptions(svg: string): ResvgRenderOptions['font'] {
  const base = pngFont();
  const main = familyFiles(base);
  if (!main.length) return { loadSystemFonts: true, defaultFontFamily: base };
  const fontFiles = [...new Set([...main, ...familiesOf(svg).flatMap(familyFiles), ...emojiFiles()])];
  return { loadSystemFonts: false, fontFiles, defaultFontFamily: base };
}

// 表示幅の2倍の解像度で書き出す。フォントは実行した PC に入っているものを使う。背景は、テーマの紙の色にする。
export function toPng(svg: string, background = '#ffffff'): { data: Buffer; width: number; height: number } {
  const img = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, background, font: fontOptions(svg) }).render();
  return { data: img.asPng(), width: img.width, height: img.height };
}
