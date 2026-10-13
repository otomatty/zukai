// 出力形式に共通の原稿変換。Markdown の構文木を使い、コード内の記法は変更しない。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import type { Root, Nodes, RootContent, Definition, PhrasingContent } from 'mdast';
import { themeFor } from '../theme.ts';
import { typesFor, typeOf } from '../figures/custom.ts';
import { isFigure, isFreeFigure, isRefs, isVideoOnly } from '../parse.ts';
import { readJson } from '../lint/index.ts';
import { resolveRefs } from '../refs.ts';
import { toPng } from '../png.ts';
import { mermaid } from './mermaid.ts';
import { projectOf } from '../config.ts';
import type { ImageFormat } from '../output-formats.ts';
import type { RawSpec, Limits, Tokens } from '../types.ts';

export const readMarkdown = (source: string): Root => fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
export const writeMarkdown = (tree: Root): string => toMarkdown(tree, { extensions: [gfmToMarkdown()], fences: true });
export const textOf = (node: Nodes): string => 'value' in node ? node.value : node.type === 'image' ? node.alt ?? '' : 'children' in node ? node.children.map(textOf).join('') : '';
export const paragraph = (text: string): RootContent => ({ type: 'paragraph', children: [{ type: 'text', value: text }] });
const link = (text: string, url: string): PhrasingContent => ({ type: 'link', url, children: [{ type: 'text', value: text }] });
const remote = (url: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url);
const urlPath = (file: string) => file.split(path.sep).map(encodeURIComponent).join('/');

export interface ExportDocument {
  title: string;
  tree: Root;
  markdown: string;
  assets: Map<string, Buffer>;
  figures: { name: string; svg: string; alt: string }[];
  tokens: Tokens;
  warnings: string[];
}

export async function prepareDocument(source: string, file: string, outDir: string, imageFormat: ImageFormat = 'png'): Promise<ExportDocument> {
  const theme = themeFor(path.dirname(path.resolve(file)));
  const ctx = { baseDir: path.dirname(path.resolve(file)), tokens: theme.tokens, types: typesFor(theme) };
  const limits: Limits = readJson('contract/limits.json');
  const tree = readMarkdown(source);
  const assets = new Map<string, Buffer>();
  const figures: ExportDocument['figures'] = [];
  const warnings: string[] = [];
  const definitions = new Map<string, Definition>();
  const collect = (node: Nodes) => {
    if (node.type === 'definition') definitions.set(node.identifier.toUpperCase(), { ...node });
    if ('children' in node) node.children.forEach(collect);
  };
  collect(tree);
  let heading = tree.children.find((n) => n.type === 'heading' && n.depth === 1);
  const title = heading ? textOf(heading) : path.basename(file, path.extname(file));
  const asset = (url: string): string => {
    if (remote(url)) return url;
    const match = url.match(/^([^?#]*)(.*)$/)!;
    const target = match[1].startsWith('/')
      ? path.resolve(projectOf(ctx.baseDir), `.${decodeURIComponent(match[1])}`)
      : path.resolve(ctx.baseDir, decodeURIComponent(match[1]));
    const data = fs.readFileSync(target);
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
    const name = `assets/image-${hash}${path.extname(target).toLowerCase()}`;
    assets.set(name, data);
    return name + match[2];
  };
  const rebase = (url: string) => {
    if (remote(url) || url.startsWith('/')) return url;
    const match = url.match(/^([^?#]*)(.*)$/)!;
    return urlPath(path.relative(outDir, path.resolve(ctx.baseDir, decodeURIComponent(match[1])))) + match[2];
  };

  async function convert(node: Nodes): Promise<Nodes[]> {
    if (node.type === 'heading') heading = node;
    if (node.type === 'html' && /<!--\s*zukai-/.test(node.value)) {
      node.value = node.value.replace(/<!--\s*zukai-[\s\S]*?-->/g, '');
      if (!node.value.trim()) return [];
    }
    if (node.type === 'code') {
      const info = `${node.lang ?? ''} ${node.meta ?? ''}`.trim();
      const line = node.position?.start.line ?? 1;
      if (isVideoOnly(info)) return [];
      if (isRefs(info)) {
        const list: unknown = YAML.parse(node.value);
        const refs = await resolveRefs({ kind: 'refs', list, line, endLine: node.position?.end.line ?? line }, ctx, limits);
        const errors = [...refs.errors, ...refs.items.filter((r) => r.error)];
        if (errors.length) throw new Error(`L${line}: ${errors.map((r) => r.error).join('、')}`);
        return refs.items.flatMap((r, i): RootContent[] => {
          if (r.kind === 'code') return [
            { type: 'paragraph', children: [{ type: 'text', value: `［${i + 1}］` }, r.url ? link(`${r.file} L${r.from}–L${r.to}`, r.url) : { type: 'text', value: `${r.file} L${r.from}–L${r.to}` }] },
            paragraph(r.note), { type: 'code', lang: r.lang, value: r.excerpt },
          ];
          if (r.kind === 'quote') return [
            { type: 'paragraph', children: [{ type: 'text', value: `［${i + 1}］` }, link(r.source, r.url)] },
            { type: 'blockquote', children: [paragraph(r.quote) as import('mdast').Paragraph] },
            ...(r.ja ? [paragraph(`日本語訳（${r.translator}）: ${r.ja}`)] : []),
            paragraph([r.verified ? '原文との一致を確認済み' : '原文との一致は未確認', r.fetched ? `取得日 ${r.fetched}` : '', r.license ? `ライセンス ${r.license}` : ''].filter(Boolean).join(' / ')),
          ];
          return [];
        });
      }
      if (isFigure(info)) {
        const spec = (isFreeFigure(info) ? { type: 'free', svg: node.value } : YAML.parse(node.value)) as RawSpec;
        const type = typeOf(ctx.types, spec);
        if (!type) throw new Error(`L${line}: 図の型がありません。先に zukai lint を通してください。`);
        const errors = type.validate(spec, limits, ctx);
        if (errors.length) throw new Error(`L${line}: ${errors.join('、')}`);
        const svg = type.render(spec, ctx.tokens, ctx);
        const name = `fig-${String(figures.length + 1).padStart(2, '0')}`;
        const alt = [heading ? textOf(heading) : '図', ...type.labels(spec)].join(' / ');
        figures.push({ name, svg, alt });
        const mmd = imageFormat === 'mermaid' && !type.custom ? mermaid(spec) : null;
        const after: RootContent[] = [];
        if (type.after) {
          // 図に付随する文章は既存の型が提供する。Markdown の拡張点も使える。
          const extra = type.after(spec, ctx);
          if (extra.markdown) after.push(...readMarkdown(extra.markdown).children);
          else if (extra.html) {
            after.push({ type: 'html', value: extra.html });
            warnings.push(`L${line}: 図の補足はHTMLとして残しました。`);
          }
        }
        if (mmd) return [{ type: 'code', lang: 'mermaid', value: mmd }, ...after];
        if (imageFormat === 'mermaid') warnings.push(`L${line}: ${String(spec.type)} はMermaidへ変換できないためPNGで出力しました。`);
        const ext = imageFormat === 'svg' ? 'svg' : 'png';
        const url = `assets/${name}.${ext}`;
        assets.set(url, ext === 'svg' ? Buffer.from(svg) : toPng(svg, ctx.tokens.color.paper).data);
        return [{ type: 'paragraph', children: [{ type: 'image', url, alt }] }, ...after];
      }
    }
    if (node.type === 'imageReference' || node.type === 'linkReference') {
      const def = definitions.get(node.identifier.toUpperCase());
      if (def) node = node.type === 'imageReference'
        ? { type: 'image', url: def.url, alt: node.alt, title: def.title }
        : { type: 'link', url: def.url, title: def.title, children: node.children };
    }
    if (node.type === 'image') node.url = asset(node.url);
    if (node.type === 'link' || node.type === 'definition') node.url = rebase(node.url);
    if ('children' in node) {
      const children: Nodes[] = [];
      for (const child of node.children) children.push(...await convert(child));
      (node as { children: Nodes[] }).children = children;
    }
    return [node];
  }
  await convert(tree);
  return { title, tree, markdown: writeMarkdown(tree), assets, figures, tokens: ctx.tokens, warnings: [...new Set(warnings)] };
}
