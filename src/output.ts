import fs from 'node:fs';
import path from 'node:path';
import { outputFormats, imageFormats } from './output-formats.ts';
import type { OutputFormat, ImageFormat } from './output-formats.ts';
import type { ExportDocument } from './export/document.ts';

interface Result { files: Map<string, Buffer | string>; warnings: string[] }
interface Context { file: string; source: string; out: string; imageFormat: ImageFormat }
const one = (file: string, content: string | Buffer, warnings: string[] = []): Result => ({ files: new Map([[file, content]]), warnings });
async function prepare(ctx: Context): Promise<ExportDocument> {
  const { prepareDocument } = await import('./export/document.ts');
  return prepareDocument(ctx.source, ctx.file, ctx.out, ctx.imageFormat);
}

// 新しい形式は一覧とここに登録する。生成が終わってからファイルを書き出す。
const exporters: Record<OutputFormat, (ctx: Context) => Promise<Result>> = {
  html: async (c) => one(c.out, await (await import('./render.ts')).render(c.source, c.file)),
  confluence: async (c) => {
    const page = await (await import('./confluence.ts')).bundle(c.source, c.file);
    const files = new Map<string, string | Buffer>(page.files.map((f) => [path.join(c.out, f.name), f.data]));
    files.set(path.join(c.out, 'body.xhtml'), page.body);
    files.set(path.join(c.out, 'meta.json'), JSON.stringify({ title: page.title, representation: 'storage', attachments: page.files.map((f) => f.name) }, null, 2) + '\n');
    return { files, warnings: [] };
  },
  markdown: async (c) => {
    const doc = await prepare(c);
    const files = new Map<string, string | Buffer>([...doc.assets].map(([name, data]) => [path.join(c.out, name), data]));
    files.set(path.join(c.out, 'README.md'), doc.markdown);
    files.set(path.join(c.out, 'source', path.basename(c.file)), c.source);
    return { files, warnings: doc.warnings };
  },
  svg: async (c) => figures(c, 'svg'),
  png: async (c) => figures(c, 'png'),
  pdf: async (c) => {
    const doc = await prepare({ ...c, out: path.dirname(c.out) });
    return one(c.out, await (await import('./export/pdf.ts')).writePdf(doc), doc.warnings);
  },
  docx: async (c) => {
    const doc = await prepare({ ...c, out: path.dirname(c.out) });
    return one(c.out, await (await import('./export/docx.ts')).writeDocx(doc), doc.warnings);
  },
  pptx: async (c) => {
    const doc = await prepare({ ...c, out: path.dirname(c.out) });
    return one(c.out, await (await import('./export/pptx.ts')).writePptx(doc), doc.warnings);
  },
};

async function figures(c: Context, ext: 'svg' | 'png'): Promise<Result> {
  const doc = await prepare({ ...c, imageFormat: 'svg' });
  if (!doc.figures.length) throw new Error('原稿に図がありません。SVG・PNG出力には figure ブロックが必要です。');
  const files = new Map<string, string | Buffer>();
  const { toPng } = await import('./png.ts');
  for (const fig of doc.figures) files.set(path.join(c.out, `${fig.name}.${ext}`), ext === 'svg' ? fig.svg : toPng(fig.svg, doc.tokens.color.paper).data);
  return { files, warnings: doc.warnings };
}

// 既存のファイルは実体のパスで比べ、シンボリックリンク経由の原稿上書きも防ぐ。
function sameFile(a: string, b: string): boolean {
  const resolve = (p: string) => fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
  const left = resolve(a), right = resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export async function buildOutput(file: string, options: { format?: string; out?: string; imageFormat?: string } = {}): Promise<{ out: string; files: string[]; warnings: string[] }> {
  const format = options.format ?? 'html';
  const definition = outputFormats.find((f) => f.name === format);
  if (!definition) throw new Error(`--format「${format}」は使えません。使える形式: ${outputFormats.map((f) => f.name).join(', ')}`);
  if (options.imageFormat !== undefined && format !== 'markdown') throw new Error('--image-format は --format=markdown のときだけ指定できます。');
  const imageFormat = options.imageFormat ?? 'png';
  if (!(imageFormats as readonly string[]).includes(imageFormat)) throw new Error(`--image-format「${imageFormat}」は使えません。使える形式: ${imageFormats.join(', ')}`);
  if (options.out === '') throw new Error('--out には保存先のパスを指定してください。');
  const out = options.out ?? `${file.replace(/\.md$/i, '')}.${format}`;
  if (sameFile(file, out)) throw new Error('出力先が原稿と同じです。別のパスを指定してください。');
  if (fs.existsSync(out) && fs.statSync(out).isDirectory() !== definition.folder) throw new Error(`${format} の出力先には${definition.folder ? 'フォルダ' : 'ファイル'}を指定してください。`);
  const source = fs.readFileSync(file, 'utf8');
  const result = await exporters[definition.name]({ file, source, out, imageFormat: imageFormat as ImageFormat });
  for (const name of result.files.keys()) if (sameFile(file, name)) throw new Error(`出力先「${name}」が原稿と重なります。別の保存先を指定してください。`);
  for (const [name, data] of result.files) { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, data); }
  return { out, files: [...result.files.keys()], warnings: [...new Set(result.warnings)] };
}
