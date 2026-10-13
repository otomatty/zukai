import PptxGenJS from 'pptxgenjs';
import type { Nodes } from 'mdast';
import { textOf } from './document.ts';
import type { ExportDocument } from './document.ts';
import { imageOf } from './images.ts';
import { pngFont } from '../png.ts';

// パッケージの型定義は CJS と判定されるが、import 側の実体は default のクラス。
const Presentation = PptxGenJS as unknown as typeof PptxGenJS.default;

/** 日本語を幅1、ASCIIを幅0.6として折り返す。改行とUnicodeのコードポイントを維持する。 */
export function wrapText(text: string, columns = 42): string[] {
  return text.split('\n').flatMap((line) => {
    const lines: string[] = [];
    let current = '', width = 0;
    for (const char of line) {
      const n = char.codePointAt(0)! < 128 ? 0.6 : 1;
      if (width + n > columns) { lines.push(current); current = ''; width = 0; }
      current += char; width += n;
    }
    lines.push(current);
    return lines;
  });
}

/** 見出しで区切り、本文と表の続きを次のスライドへ送る。図は画像として埋め込む。 */
export async function writePptx(doc: ExportDocument): Promise<Buffer> {
  const pptx = new Presentation();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = doc.title;
  pptx.author = 'zukai';
  pptx.subject = 'zukai の原稿から生成した資料';
  const fontFace = pngFont();
  pptx.theme = { headFontFace: fontFace, bodyFontFace: fontFace };
  let heading = doc.title;
  let slide: ReturnType<InstanceType<typeof Presentation>['addSlide']>;
  let y = 1.4;
  let newSection = true;
  const color = doc.tokens.color.ink.slice(1);
  function next() {
    slide = pptx.addSlide();
    slide.background = { color: doc.tokens.color.paper.slice(1) };
    slide.addText(heading, { x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontFace, fontSize: 27, bold: true, color, margin: 0, breakLine: false, fit: 'shrink' });
    slide.addText('zukai', { x: 11.5, y: 7.1, w: 1.1, h: 0.2, fontSize: 10, color: '64748B', align: 'right', margin: 0 });
    y = 1.4;
    newSection = false;
  }
  function text(value: string, code = false) {
    const lines = wrapText(value, code ? 49 : 42);
    while (lines.length) {
      if (newSection || !slide || y > 6.35) next();
      const count = Math.max(1, Math.floor((6.8 - y) / 0.4));
      const chunk = lines.splice(0, count);
      const h = chunk.length * 0.4 + 0.06;
      slide.addText(chunk.join('\n'), { x: 0.65, y, w: 12.0, h, fontFace: code ? 'Consolas' : fontFace, fontSize: code ? 16 : 20, color, margin: 0, valign: 'top', breakLine: false, ...(code ? { fill: { color: 'F2F4F6' } } : {}) });
      y += h + 0.16;
    }
  }
  function inlineText(node: Nodes): string {
    if (node.type === 'link') return `${node.children.map(inlineText).join('')} (${node.url})`;
    if (node.type === 'footnoteReference') return `[${node.label ?? node.identifier}]`;
    if (node.type === 'break') return '\n';
    return 'children' in node ? node.children.map(inlineText).join('') : textOf(node);
  }
  function imagesIn(node: Nodes): { url: string; alt: string }[] {
    if (node.type === 'image') return [{ url: node.url, alt: node.alt ?? '' }];
    return 'children' in node ? node.children.flatMap(imagesIn) : [];
  }
  function image(url: string, alt: string) {
    const img = imageOf(doc, url);
    const h = Math.min(4.5, 12 * img.height / img.width);
    const w = h * img.width / img.height;
    if (newSection || !slide || y + h > 6.8) next();
    slide.addImage({ data: `image/${img.type};base64,${img.data.toString('base64')}`, x: (13.333 - w) / 2, y, w, h, altText: alt });
    y += h + 0.2;
  }
  function blocks(nodes: Nodes[], prefix = '') {
    for (const node of nodes) {
      if (node.type === 'definition') continue;
      if (node.type === 'heading') { heading = textOf(node); newSection = true; continue; }
      if (node.type === 'paragraph') {
        let buffer = prefix;
        function content(child: Nodes) {
          if (child.type === 'image') { if (buffer.trim()) text(buffer); buffer = ''; image(child.url, child.alt ?? ''); }
          else if ('children' in child) {
            child.children.forEach(content);
            if (child.type === 'link') buffer += ` (${child.url})`;
          }
          else buffer += inlineText(child);
        }
        node.children.forEach(content);
        if (buffer.trim()) text(buffer);
      } else if (node.type === 'table') {
        // セルの長文も分割して、1行がスライドの高さを超えないようにする。
        const cols = Math.max(...node.children.map((r) => r.children.length));
        if (cols > 8) { doc.warnings.push('PowerPointでは9列以上の表を行ごとの文章として出力します。'); node.children.forEach((r) => text(r.children.map(inlineText).join(' / '))); imagesIn(node).forEach((img) => image(img.url, img.alt)); continue; }
        const rows = node.children.flatMap((row) => {
          const cells = row.children.map((cell) => wrapText(inlineText(cell), Math.max(5, 62 / cols)));
          const parts: string[][] = [];
          while (cells.some((c) => c.length)) parts.push(cells.map((c) => c.splice(0, 5).join('\n')));
          return parts;
        });
        next();
        slide.addTable(rows.map((row) => row.map((value) => ({ text: value }))), { x: 0.65, y: 1.4, w: 12, h: 5.3, colW: Array(cols).fill(12 / cols), fontFace, fontSize: 14, color, border: { pt: 0.5, color: 'CCD5DF' }, margin: 0.08, autoPage: true, autoPageRepeatHeader: true, autoPageHeaderRows: 1, autoPageSlideStartY: 1.4, rowH: 0.35 });
        for (const continuation of slide.newAutoPagedSlides) continuation.addText(heading, { x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontFace, fontSize: 27, bold: true, color, margin: 0, fit: 'shrink' });
        y = 7;
        imagesIn(node).forEach((img) => { if (img.alt) text(img.alt); image(img.url, img.alt); });
      } else if (node.type === 'list') node.children.forEach((item, i) => blocks(item.children, `${prefix}${item.checked == null ? node.ordered ? `${(node.start ?? 1) + i}.` : '•' : item.checked ? '☑' : '☐'} `));
      else if (node.type === 'blockquote') blocks(node.children, '> ');
      else if (node.type === 'footnoteDefinition') { text(`[${node.label ?? node.identifier}]`); blocks(node.children); }
      else if (node.type === 'code') text(node.value, true);
      else if (node.type === 'thematicBreak') next();
      else text(inlineText(node));
    }
  }
  blocks(doc.tree.children);
  if (!slide!) next();
  return await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
}
