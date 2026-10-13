import { Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, Table, TableRow, TableCell, HeadingLevel, WidthType, ShadingType } from 'docx';
import type { ParagraphChild, IRunOptions } from 'docx';
import type { Nodes } from 'mdast';
import { textOf } from './document.ts';
import type { ExportDocument } from './document.ts';
import { imageOf } from './images.ts';
import { pngFont } from '../png.ts';

/** 本文と表を編集可能なWord要素にし、図を画像として埋め込んだDOCXを返す。 */
export async function writeDocx(doc: ExportDocument): Promise<Buffer> {
  const font = pngFont();
  const color = doc.tokens.color.ink.slice(1);
  function inline(node: Nodes, style: IRunOptions = {}): ParagraphChild[] {
    if (node.type === 'image') {
      const img = imageOf(doc, node.url);
      const scale = Math.min(600 / img.width, 700 / img.height, 1);
      return [new ImageRun({ type: img.type, data: img.data, transformation: { width: img.width * scale, height: img.height * scale }, altText: { title: node.alt ?? '', description: node.alt ?? '', name: node.alt ?? '図' } })];
    }
    if (node.type === 'break') return [new TextRun({ break: 1 })];
    if (node.type === 'link') return [new ExternalHyperlink({ link: node.url, children: node.children.flatMap((c) => inline(c, { ...style, color: '0563C1', underline: {} })) })];
    if (node.type === 'footnoteReference') return [new TextRun({ text: `[${node.label ?? node.identifier}]`, ...style })];
    const next = { ...style, ...(node.type === 'strong' ? { bold: true } : {}), ...(node.type === 'emphasis' ? { italics: true } : {}), ...(node.type === 'delete' ? { strike: true } : {}), ...(node.type === 'inlineCode' ? { font: 'Consolas', shading: { type: ShadingType.CLEAR, fill: 'F2F4F6' } } : {}) };
    if ('children' in node) return node.children.flatMap((c) => inline(c, next));
    return [new TextRun({ text: 'value' in node ? node.value : textOf(node), ...next })];
  }
  function blocks(nodes: Nodes[], indent = 0): (Paragraph | Table)[] {
    return nodes.flatMap((node): (Paragraph | Table)[] => {
      if (node.type === 'definition') return [];
      if (node.type === 'heading') return [new Paragraph({ heading: [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5][node.depth - 1], children: inline(node), keepNext: true })];
      if (node.type === 'table') return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: node.children.map((row, i) => new TableRow({ tableHeader: i === 0, children: row.children.map((cell) => new TableCell({ children: [new Paragraph({ children: inline(cell, i === 0 ? { bold: true } : {}) })], ...(i === 0 ? { shading: { fill: 'E8EFF4' } } : {}) })) })) })];
      if (node.type === 'list') return node.children.flatMap((item, i) => {
        const result = blocks(item.children, indent + 1);
        // 番号を文字として持たせ、開始番号と入れ子の順序を維持する。
        const first = item.children[0];
        if (first?.type === 'paragraph') result[0] = new Paragraph({ indent: { left: (indent + 1) * 360, hanging: 280 }, children: [new TextRun(`${item.checked === null || item.checked === undefined ? node.ordered ? `${(node.start ?? 1) + i}.` : '•' : item.checked ? '☑' : '☐'} `), ...inline(first)] });
        return result;
      });
      if (node.type === 'blockquote') return blocks(node.children, indent + 1);
      if (node.type === 'footnoteDefinition') return [new Paragraph({ children: [new TextRun({ text: `[${node.label ?? node.identifier}]`, bold: true })] }), ...blocks(node.children, indent)];
      if (node.type === 'code') return node.value.split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })], spacing: { after: 0 }, shading: { fill: 'F2F4F6' }, wordWrap: true }));
      if (node.type === 'thematicBreak') return [new Paragraph({ text: '─────' })];
      if (node.type === 'html') doc.warnings.push('Wordでは通常のHTMLブロックを文字列として残します。');
      return [new Paragraph({ children: inline(node), spacing: { after: 160 }, indent: { left: indent * 360 } })];
    });
  }
  const children = blocks(doc.tree.children);
  return Packer.toBuffer(new Document({ title: doc.title, creator: 'zukai', styles: { default: { document: { run: { font, size: 22, color }, paragraph: { spacing: { line: 320 } } } } }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }] }));
}
