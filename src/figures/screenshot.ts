import fs from 'node:fs';
import path from 'node:path';
import { open, close, mid, esc, unknownKeys } from './svg.ts';
import type { FigureContext, FigureType } from '../types.ts';

export interface ScreenshotMark {
  selector?: string;
  // 枠の位置。[左, 上, 幅, 高さ]（画像のピクセル単位）。
  at?: number[];
  note: string;
}
export interface ScreenshotSpec {
  type: 'screenshot';
  image: string;
  url?: string;
  viewport?: number;
  height?: number;
  mask?: string[];
  marks: ScreenshotMark[];
}
// 撮影の記録。marks は、セレクタごとの枠の位置 [左, 上, 幅, 高さ]。
export interface Sidecar {
  url?: string;
  captured?: string;
  viewport?: number;
  marks?: Record<string, number[]>;
}

// 検証の途中でも使うので、検証の前の仕様も受け取れる形にする。
const file = (spec: { readonly image?: unknown }, ctx?: FigureContext) => path.resolve(ctx?.baseDir ?? '.', String(spec.image));

// PNG の幅と高さを、ファイルの先頭から読む。
function pngSize(p: string) {
  const buf = fs.readFileSync(p);
  if (buf.length < 24 || buf.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, data: buf };
}

// 撮影の記録（zukai capture が画像の横に書き出す）。セレクタで指定した枠の位置が入っている。
export const sidecar = (spec: { readonly image?: unknown }, ctx?: FigureContext): Sidecar => {
  const p = `${file(spec, ctx)}.json`;
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
};
// at が無ければ selector がある（検証で、どちらか1つだけと確かめる）。
const boxOf = (mark: ScreenshotMark, side: Sidecar) => mark.at ?? side.marks?.[mark.selector!];

// screenshot: 実際の画面に枠と番号を重ね、番号ごとの説明を画像の下に並べる。
export default {
  name: 'screenshot',
  summary: '実際の画面に枠と番号を重ね、番号ごとの説明を画像の下に並べる',
  when: '実際の画面の、特定の場所を指して説明する',
  example: `type: screenshot
image: shots/login.png
url: https://admin.example.com/login
marks:
  - selector: ".alert"
    note: ロック中は、解除までの残り時間を分単位で表示します。
  - at: [224, 340, 160, 24]
    note: 再設定の案内は、失敗が3回を超えた時点から表示します。`,
  fields: [
    'image: PNG 画像のパス（必須）。原稿のあるフォルダからの相対パスで書く',
    'url: 撮影する画面の URL（任意）。書くと zukai capture で撮影できる',
    'viewport: 撮影するときの画面の幅（任意、既定は 1280）',
    'height: 撮影する範囲の高さ（任意、既定は 800）',
    'mask: 撮影の前に塗りつぶす要素の CSS セレクタの配列（任意）。個人情報を隠すために使う',
    'marks[].selector: 枠を付ける要素の CSS セレクタ。位置は zukai capture が取得する',
    'marks[].at: 枠の位置を [左, 上, 幅, 高さ] で直接書く（画像のピクセル単位）。selector の代わりに使う',
    'marks[].note: その枠の説明（必須、1文）',
  ],

  validate(spec, limits, ctx) {
    const errors = [...unknownKeys(spec, ['type', 'image', 'url', 'viewport', 'height', 'mask', 'marks'], 'screenshot')];
    if (typeof spec.image !== 'string' || !spec.image.endsWith('.png')) return [...errors, 'screenshot には image（PNG 画像のパス）が必要です。'];
    if (!Array.isArray(spec.marks) || spec.marks.length === 0) return [...errors, 'screenshot には marks が1つ以上必要です。'];
    if (spec.marks.length > limits.screenshot.maxMarks) errors.push(`marks が${spec.marks.length}個あります。上限は${limits.screenshot.maxMarks}個です。画面を分けて撮影してください。`);
    spec.marks.forEach((m, i) => {
      errors.push(...unknownKeys(m, ['selector', 'at', 'note'], `marks[${i}]`));
      if (typeof m?.note !== 'string' || !m.note) errors.push(`marks[${i}] に note がありません。`);
      else if (m.note.length > limits.screenshot.noteMaxChars) errors.push(`marks[${i}].note が${m.note.length}字あります。上限は${limits.screenshot.noteMaxChars}字です。`);
      if ((m?.selector === undefined) === (m?.at === undefined)) errors.push(`marks[${i}] には selector か at のどちらか1つを書いてください。`);
      if (m?.at !== undefined && !(Array.isArray(m.at) && m.at.length === 4 && m.at.every((v: unknown) => typeof v === 'number' && v >= 0))) errors.push(`marks[${i}].at は [左, 上, 幅, 高さ] の数値にしてください。`);
    });
    if (errors.length) return errors;
    if (!fs.existsSync(file(spec, ctx))) return [`画像「${spec.image}」がありません。${spec.url ? 'zukai capture を実行して撮影してください。' : '画像を置くか、url を書いて zukai capture で撮影してください。'}`];
    const size = pngSize(file(spec, ctx));
    if (!size) return [`画像「${spec.image}」を PNG として読めません。`];
    if (size.bytes > limits.screenshot.maxBytes) errors.push(`画像が${Math.round(size.bytes / 1024)}KBあります。上限は${Math.round(limits.screenshot.maxBytes / 1024)}KBです。画面の幅を狭くして撮り直してください。`);
    const side = sidecar(spec, ctx);
    // 上の検査で、marks の形を確かめた。
    (spec as ScreenshotSpec).marks.forEach((m, i) => {
      const b = boxOf(m, side);
      if (!b) errors.push(`marks[${i}] のセレクタ「${m.selector}」の位置が記録されていません。zukai capture を実行してください。`);
      else if (b[0] + b[2] > size.width + 1 || b[1] + b[3] > size.height + 1) errors.push(`marks[${i}] の枠が画像（${size.width}×${size.height}）の外に出ています。`);
    });
    return errors;
  },

  labels: () => [],
  notes: () => [],
  // 説明は文章なので、文章のルールで検査する。
  prose: (spec) => spec.marks.map((m) => m.note),

  render(spec, t, ctx) {
    // 検証で、PNG として読めると確かめてある。
    const size = pngSize(file(spec, ctx))!;
    const side = sidecar(spec, ctx);
    const k = t.figure.width / size.width;
    const h = Math.round(size.height * k);
    const out = [open(t, h, `画面の注釈（${spec.marks.length}か所）`)];
    out.push(`<image href="data:image/png;base64,${size.data.toString('base64')}" x="0" y="0" width="${t.figure.width}" height="${h}" preserveAspectRatio="none"/>`);
    out.push(`<rect x="0.5" y="0.5" width="${t.figure.width - 1}" height="${h - 1}" fill="none" stroke="${t.screenshot.frame}" stroke-width="1"/>`);
    spec.marks.forEach((m, i) => {
      const [x, y, w, hh] = boxOf(m, side)!.map((v) => v * k);
      // 枠は要素より少し大きく描く。番号は枠の左上に置き、画像の外に出ないようにする。
      const [fx, fy] = [Math.max(1, x - 6), Math.max(1, y - 6)];
      const [bx, by] = [Math.max(12, fx), Math.max(12, fy)];
      out.push(`<rect x="${fx}" y="${fy}" width="${Math.min(t.figure.width - 1 - fx, w + 12)}" height="${Math.min(h - 1 - fy, hh + 12)}" rx="6" fill="none" stroke="${t.screenshot.note}" stroke-width="2"/>`);
      out.push(`<circle cx="${bx}" cy="${by}" r="11" fill="${t.screenshot.note}"/><text class="zk-note" x="${bx}" y="${mid(by, 12)}" text-anchor="middle" style="fill:${t.screenshot.onNote};font-weight:700">${i + 1}</text>`);
    });
    out.push(close());
    return out.join('');
  },

  // 画像の下に並べる、番号ごとの説明と撮影の情報。
  after(spec, ctx) {
    const side = sidecar(spec, ctx);
    const meta = [spec.url ? `撮影元 ${spec.url}` : '', side.captured ? `撮影日 ${side.captured}` : '', side.viewport ? `幅 ${side.viewport}px` : ''].filter(Boolean).join('　');
    return {
      html: `<ol class="marks">${spec.marks.map((m, i) => `<li><span class="num note">${i + 1}</span>${esc(m.note)}</li>`).join('')}</ol>${meta ? `<p class="meta">${esc(meta)}</p>` : ''}`,
      storage: `<ol>${spec.marks.map((m) => `<li><p>${esc(m.note)}</p></li>`).join('')}</ol>${meta ? `<p><em>${esc(meta)}</em></p>` : ''}`,
    };
  },
} satisfies FigureType<ScreenshotSpec>;
