// free: どの型にも合わない図を、AI や人が SVG で直接書く。
// 自由に書ける代わりに、型が保証していた品質を検査で確かめる。色は決まった色だけ、文字は最小サイズ以上、
// 文字どうしが重ならない、箱からはみ出さない、図の外に出ない。使える要素と属性は一覧にあるものだけにする。
// 出力する SVG は、検査を通った要素と属性から組み立て直す。原稿に書かれた文字列をそのまま HTML に入れない。
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { open, close, esc } from './svg.ts';
import { tokensFor } from '../theme.ts';
import type { FigureContext, FigureType, Limits, Tokens } from '../types.ts';

// 自由な図の仕様。コードブロックの中身（svg）だけを持つ。
export interface FreeSpec {
  type?: 'free';
  svg: string;
}
// SVG の要素。属性の値は、実体参照を戻した文字。
interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

// 色と文字サイズの検査に使う。validate は tokens を受け取らないので、原稿のプロジェクトのテーマから読む。
// ctx.tokens があれば、それを使う。theme preview が、まだ設定していないテーマで描くときに渡す。
const tokensOf = (ctx?: FigureContext): Tokens => ctx?.tokens ?? tokensFor(ctx?.baseDir ?? process.cwd());

// 画像に変換できるかだけを確かめる。文字の形は結果に関係しないので、PC のフォントは読まない（読むと1回に数十ms以上かかる）。
// 1回の Lint で同じ図を何度も検証するので、描いた SVG ごとに結果を覚えておく。resvg は、自由な図があるときだけ読み込む。
const require = createRequire(import.meta.url);
const rasterChecked = new Map<string, string>();
function rasterError(svg: string): string {
  let failed = rasterChecked.get(svg);
  if (failed === undefined) {
    const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');
    try {
      new Resvg(svg, { font: { loadSystemFonts: false } }).render();
      failed = '';
    } catch (e) {
      failed = String((e as Error).message ?? e).split('\n')[0];
    }
    if (rasterChecked.size >= 500) rasterChecked.delete(rasterChecked.keys().next().value!);
    rasterChecked.set(svg, failed);
  }
  return failed;
}

const ELEMENTS = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'title', 'defs', 'marker', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'use']);
const ATTRS = new Set([
  'xmlns', 'viewBox', 'id', 'class', 'transform', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'dx', 'dy',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule',
  'text-anchor', 'font-size', 'font-weight', 'marker-start', 'marker-mid', 'marker-end', 'clip-path', 'href',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'refX', 'refY', 'markerWidth', 'markerHeight', 'markerUnits', 'orient', 'preserveAspectRatio',
]);
const COLOR_ATTRS: readonly string[] = ['fill', 'stroke', 'stop-color'];
const HIDDEN = new Set(['defs', 'marker', 'clipPath', 'linearGradient', 'radialGradient', 'title']);
// zk-on-em と zk-on-em-note は強調した箱（zk-box-em）の上の文字、zk-grad はテーマのグラデーションの塗り（無ければ強調の色）。
const CLASSES = ['zk-text', 'zk-note', 'zk-box', 'zk-box-em', 'zk-on-em', 'zk-on-em-note', 'zk-em', 'zk-grad', 'zk-band', 'zk-line', 'zk-dash'];

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

// SVG を、要素の木に分ける。読めない部分が残ったら、その場所を返す。
function parseXml(src: string): { svg: XmlNode; error?: undefined } | { svg?: undefined; error: string } {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let pos = 0;
  for (const m of src.matchAll(re)) {
    if (m.index !== pos) return { error: `「${src.slice(pos, pos + 30).trim()}」を読めません。` };
    pos = m.index + m[0].length;
    const top = stack.at(-1)!;
    if (m[1]) {
      if (stack.length === 1 || top.name !== m[1]) return { error: `</${m[1]}> に対応する開始タグがありません。` };
      stack.pop();
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[3] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
      const node: XmlNode = { name: m[2], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[4]) stack.push(node);
    } else if (m[5]) {
      top.text += decode(m[5]);
    }
  }
  if (pos !== src.length) return { error: `「${src.slice(pos, pos + 30).trim()}」を読めません。` };
  if (stack.length > 1) return { error: `<${stack.at(-1)!.name}> が閉じられていません。` };
  const tops = root.children;
  if (tops.length !== 1 || tops[0].name !== 'svg' || root.text.trim()) return { error: 'svg 要素を1つだけ書いてください。' };
  return { svg: tops[0] };
}

const walk = (node: XmlNode, fn: (node: XmlNode, parents: XmlNode[]) => void, parents: XmlNode[] = []): void => {
  fn(node, parents);
  node.children.forEach((c) => walk(c, fn, [...parents, node]));
};
const hex = (c: string) => {
  const v = c.trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(v) ? `#${[...v.slice(1)].map((x) => x + x).join('')}` : v;
};
export const palette = (t: Tokens): string[] => [...new Set([...Object.values(t.color), ...t.chart.series, t.chart.muted, t.chart.grid].map(hex))];
const title = (svg: XmlNode) => svg.children.find((c) => c.name === 'title')?.text.trim() ?? '';
const heightOf = (svg: XmlNode) => Number(String(svg.attrs.viewBox ?? '').trim().split(/[\s,]+/)[3]);
const textOf = (node: XmlNode) => node.text.replace(/\s+/g, ' ').trim();
const sizeOf = (node: XmlNode, t: Tokens) => {
  if (node.attrs['font-size'] !== undefined) return Number(String(node.attrs['font-size']).replace(/px$/, ''));
  const cls = String(node.attrs.class ?? '').split(/\s+/);
  return cls.includes('zk-text') ? t.size.label : cls.includes('zk-note') ? t.size.note : NaN;
};

// 祖先と自分の transform から、平行移動の量を求める。平行移動以外があれば、位置の検査はできない。
function offset(nodes: XmlNode[]): [number, number] | null {
  let [dx, dy] = [0, 0];
  for (const n of nodes) {
    if (n.attrs.transform === undefined) continue;
    const m = String(n.attrs.transform).trim().match(/^translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)$/);
    if (!m) return null;
    dx += Number(m[1]);
    dy += Number(m[2] ?? 0);
  }
  return [dx, dy];
}
const num = (v: string | undefined) => (v === undefined ? 0 : Number(v));

// 文字の幅の見積り。自由な図は箱の幅を書き手が決めるので、英大文字の広さも数える。
const wpx = (text: string, size: number, bold: boolean) => {
  let w = 0;
  for (const ch of text) w += ch.codePointAt(0)! > 0xff ? 1 : /[A-Z@%&MW]/.test(ch) ? 0.68 : ch === ' ' ? 0.3 : 0.56;
  return w * size * (bold ? 1.03 : 1);
};

// 文字と箱の位置を集める。
interface TextBox {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  w: number;
}
interface RectBox {
  left: number;
  top: number;
  w: number;
  h: number;
}
function geometry(svg: XmlNode, t: Tokens): { texts: TextBox[]; rects: RectBox[] } {
  const texts: TextBox[] = [];
  const rects: RectBox[] = [];
  walk(svg, (node, parents) => {
    if ([...parents, node].some((n) => HIDDEN.has(n.name))) return;
    const off = offset([...parents, node]);
    if (!off) return;
    if (node.name === 'text' && textOf(node)) {
      const size = sizeOf(node, t);
      const w = wpx(textOf(node), size, String(node.attrs.class ?? '').includes('zk-text') || Number(node.attrs['font-weight']) >= 600);
      const x = num(node.attrs.x) + off[0];
      const y = num(node.attrs.y) + off[1];
      const anchor = node.attrs['text-anchor'];
      const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      texts.push({ text: textOf(node), left, right: left + w, top: y - size * 0.86, bottom: y + size * 0.2, w });
    }
    if (node.name === 'rect') rects.push({ left: num(node.attrs.x) + off[0], top: num(node.attrs.y) + off[1], w: num(node.attrs.width), h: num(node.attrs.height) });
  });
  return { texts, rects };
}

const free: FigureType<FreeSpec> & { title(spec: FreeSpec): string; fit(spec: FreeSpec, t: Tokens): string[] } = {
  name: 'free',
  fence: 'svg figure',
  summary: 'どの型にも合わない図を、SVG で直接書く',
  when: 'ほかの型では伝わらない内容を、位置や重なり、独自の形で示したい',
  example: `<svg viewBox="0 0 720 300">
  <title>対応の優先度を、影響と頻度で4つに分けた図</title>
  <line class="zk-line" x1="150" y1="20" x2="150" y2="250"/>
  <line class="zk-line" x1="150" y1="250" x2="700" y2="250"/>
  <text class="zk-note" x="140" y="76" text-anchor="end">影響が大きい</text>
  <text class="zk-note" x="140" y="196" text-anchor="end">影響が小さい</text>
  <text class="zk-note" x="290" y="274" text-anchor="middle">頻度が低い</text>
  <text class="zk-note" x="560" y="274" text-anchor="middle">頻度が高い</text>
  <rect class="zk-box" x="170" y="30" width="240" height="90" rx="6"/>
  <text class="zk-text" x="290" y="80" text-anchor="middle">手順書を用意する</text>
  <rect class="zk-box-em" x="440" y="30" width="240" height="90" rx="6"/>
  <text class="zk-text zk-on-em" x="560" y="80" text-anchor="middle">今月中に直す</text>
  <rect class="zk-box" x="170" y="150" width="240" height="90" rx="6"/>
  <text class="zk-text" x="290" y="200" text-anchor="middle">記録だけ残す</text>
  <rect class="zk-box" x="440" y="150" width="240" height="90" rx="6"/>
  <text class="zk-text" x="560" y="200" text-anchor="middle">自動で復旧させる</text>
</svg>`,
  fields: [
    '`svg figure` のコードブロックに、svg 要素を1つ書く。`yaml figure` ではない。マトリクス、格子状の配置、地図のような図に向く',
    'viewBox は `0 0 幅 高さ` で、幅は図の幅に固定する。高さは内容に合わせる',
    'title: 図が何を示すかを1文で書く（必須）。読み上げと、利用実績の集計に使う',
    '文字は text 要素に1行ずつ書く。tspan は使えない。class に zk-text（見出しの文字）か zk-note（補足の文字）を書くか、font-size を数値で書く',
    '箱の中の文字は、箱の幅に収める。文字どうしを重ねない',
    '色は、決まった色だけを使う。箱と線は class で書くと色が付く',
    '矢印は、線に `marker-end="url(#zk-arrow)"` を書く',
    '平行移動（translate）以外の transform を付けた文字は、位置の検査ができない。使わない',
    '画面の見た目を描かない。画面は screenshot で実物を示す',
    'style 属性、style 要素、font-family、外部のファイルや画像の参照は使えない',
  ],
  // 契約から決まる値。指示の中で、型の書き方に続けて示す。
  guide: (t: Tokens, limits: Limits) => [
    `図の幅は ${t.figure.width}、高さは ${limits.free.maxHeight} まで、文字は ${limits.free.minFontSize}px 以上、text 要素は ${limits.free.maxTexts} 個まで`,
    `使える class: ${CLASSES.join('、')}`,
    `使える色: 文字と主な線 ${t.color.ink}、補足の文字 ${t.color.sub}、枠線 ${t.color.line}、箱の地色 ${t.color.surface}、背景 ${t.color.paper}、強調 ${t.color.accent}、強調の地色 ${t.color.accentSurface}、強調の上の文字 ${t.color.onAccent}、系列 ${t.chart.series.join(' ')}、目立たせない要素 ${t.chart.muted}、目盛り線 ${t.chart.grid}`,
    `使える要素: ${[...ELEMENTS].filter((e) => e !== 'svg').join('、')}`,
  ],

  validate(spec, limits, ctx) {
    if (typeof spec.svg !== 'string' || !spec.svg.trim()) return ['自由な図は、`svg figure` のコードブロックに svg 要素を書きます。'];
    const t = tokensOf(ctx);
    const parsed = parseXml(spec.svg.trim());
    if (parsed.error !== undefined) return [`SVG を読めません。${parsed.error}`];
    const svg = parsed.svg;
    const errors: string[] = [];
    const once = (m: string) => {
      if (!errors.includes(m)) errors.push(m);
    };
    const box = String(svg.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
    if (box.length !== 4 || box[0] !== 0 || box[1] !== 0 || box[2] !== t.figure.width || !(box[3] >= 40)) errors.push(`viewBox は「0 0 ${t.figure.width} 高さ」にしてください。`);
    else if (box[3] > limits.free.maxHeight) errors.push(`図の高さが ${box[3]} あります。上限は ${limits.free.maxHeight} です。内容を減らすか、セクションを分けてください。`);
    if (!title(svg)) errors.push('svg の直下に、図が何を示すかを書いた title 要素が必要です。');

    const colors = palette(t);
    let texts = 0;
    walk(svg, (node, parents) => {
      if (!ELEMENTS.has(node.name)) {
        once(`要素 <${node.name}> は使えません。${node.name === 'tspan' ? '文字は text 要素に1行ずつ書いてください。' : node.name === 'image' || node.name === 'foreignObject' ? '画面や画像は screenshot で示してください。' : ''}`);
        return;
      }
      if (node.name !== 'text' && node.name !== 'title' && node.text.trim()) once(`<${node.name}> の中に文字があります。文字は text 要素に書いてください。`);
      for (const [k, v] of Object.entries(node.attrs)) {
        if (!ATTRS.has(k)) { once(`属性 ${k} は使えません。${k === 'style' || k === 'font-family' ? '色と文字サイズは、class か、fill、stroke、font-size の属性で書いてください。' : ''}`); continue; }
        if (COLOR_ATTRS.includes(k) && !['none', 'currentcolor'].includes(v.trim().toLowerCase()) && !/^url\(#[\w.-]+\)$/.test(v.trim()) && !colors.includes(hex(v))) once(`色「${v}」は使えません。使える色は ${colors.join('、')} です。`);
        if (k === 'href' && !v.startsWith('#')) once('href は、同じ図の中の要素（#名前）だけを指せます。');
        if (k === 'class') v.split(/\s+/).filter((c) => c && !CLASSES.includes(c)).forEach((c) => once(`class「${c}」はありません。使える class は ${CLASSES.join('、')} です。`));
      }
      if (node.name === 'text' && !parents.some((p) => HIDDEN.has(p.name))) {
        texts++;
        const size = sizeOf(node, t);
        if (!textOf(node)) once('文字のない text 要素があります。');
        else if (Number.isNaN(size)) once(`文字「${textOf(node)}」に、class（zk-text か zk-note）か font-size を書いてください。`);
        else if (size < limits.free.minFontSize) once(`文字「${textOf(node)}」が ${size}px です。${limits.free.minFontSize}px 以上にしてください。`);
      }
    });
    if (texts > limits.free.maxTexts) errors.push(`text 要素が${texts}個あります。上限は${limits.free.maxTexts}個です。内容を減らすか、セクションを分けてください。`);
    if (errors.length) return errors;
    // Confluence 用の PNG に変換できるかを確かめる。
    const failed = rasterError(free.render({ svg: spec.svg }, t));
    return failed ? [`SVG を画像に変換できません。${failed}`] : [];
  },

  fit(spec, t) {
    const svg = parseXml(spec.svg.trim()).svg!;
    const h = heightOf(svg);
    const { texts, rects } = geometry(svg, t);
    const out: string[] = [];
    for (const [i, a] of texts.entries()) {
      if (a.left < -1 || a.right > t.figure.width + 1 || a.top < -1 || a.bottom > h + 1) out.push(`文字「${a.text}」が図の外に出ています。`);
      // 文字の中心を含む箱のうち、いちばん小さい箱に収まるかを確かめる。
      const [cx, cy] = [(a.left + a.right) / 2, (a.top + a.bottom) / 2];
      const inside = rects.filter((r) => cx >= r.left && cx <= r.left + r.w && cy >= r.top && cy <= r.top + r.h).sort((p, q) => p.w * p.h - q.w * q.h)[0];
      if (inside && (a.left < inside.left + 2 || a.right > inside.left + inside.w - 2)) out.push(`文字「${a.text}」が箱からはみ出します。箱の幅は ${Math.round(inside.w)}、文字の幅は約 ${Math.round(a.w)} です。`);
      for (const b of texts.slice(i + 1)) {
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push(`文字「${a.text}」と「${b.text}」が重なっています。`);
      }
    }
    return out;
  },

  // 見出しの文字（zk-text）はラベル、それ以外は補足として、長さの上限を確かめる。
  labels: (spec) => pick(spec, true),
  notes: (spec) => pick(spec, false),
  // 読めない SVG は題名を返さない。Lint は、検査に通らなかった自由図の題名も集計に読むため。
  title: (spec) => {
    const parsed = parseXml(spec.svg.trim());
    return parsed.svg ? title(parsed.svg) : '';
  },

  render(spec, t) {
    const svg = parseXml(spec.svg.trim()).svg!;
    // 1つのページに複数の図が入るので、図の中で付けた名前が重ならないよう、図ごとの接頭辞を付ける。
    const prefix = `f${crypto.createHash('sha1').update(spec.svg).digest('hex').slice(0, 6)}-`;
    const rename = (v: string) => String(v).replace(/url\(#(?!zk-)([\w.-]+)\)/g, `url(#${prefix}$1)`);
    const write = (node: XmlNode): string => {
      if (node.name === 'title') return '';
      const attrs = Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${esc(k === 'id' ? prefix + v : k === 'href' ? `#${prefix}${v.slice(1)}` : rename(v))}"`)
        .join('');
      return `<${node.name}${attrs}>${node.name === 'text' ? esc(textOf(node)) : node.children.map(write).join('')}</${node.name}>`;
    };
    return open(t, heightOf(svg), title(svg)) + svg.children.map(write).join('') + close();
  },
};

function pick(spec: { svg?: unknown }, label: boolean): string[] {
  const parsed = parseXml(String(spec.svg ?? '').trim());
  if (parsed.error !== undefined) return [];
  const out: string[] = [];
  walk(parsed.svg, (node, parents) => {
    if (node.name !== 'text' || parents.some((p) => HIDDEN.has(p.name)) || !textOf(node)) return;
    if (String(node.attrs.class ?? '').split(/\s+/).includes('zk-text') === label) out.push(textOf(node));
  });
  return out;
}

export default free;
