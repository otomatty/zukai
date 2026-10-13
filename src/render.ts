// Markdown の原稿を、共有先に合わせた形に変換する。
// - render: 図を埋め込んだ1枚の HTML。原稿も中に埋め込むので、HTML だけ受け取った人も原稿を取り出して編集できる。
// - renderConfluence: Confluence のストレージ形式の本文と、図の SVG の一覧。
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { parse, isFigure, isRefs, isVideoOnly } from './parse.ts';
import { resolveRefs, refsHtml, refsStorage } from './refs.ts';
import { esc } from './figures/svg.ts';
import { createHighlighter } from 'shiki';
import { readJson, knownLang } from './lint/index.ts';
import { themeFor } from './theme.ts';
import { typeOf, typesFor } from './figures/custom.ts';
import type { Theme } from './theme.ts';
import type { LintContext } from './lint/index.ts';
import type { RefItem } from './refs.ts';
import type { Doc, FigureBlock, Limits, Tokens } from './types.ts';

// 書き出す HTML で、原稿に書かれたスクリプトやフォームを動かさない。保存したファイルを開いたときも効くように meta で入れる。
export const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";

const plainLang = (lang: string | undefined): boolean => !(lang && knownLang(lang)) || ['text', 'txt', 'plaintext', 'plain'].includes(lang);

export const css = (t: Tokens): string => `
:root{--ink:${t.color.ink};--sub:${t.color.sub};--line:${t.color.line};--surface:${t.color.surface};--paper:${t.color.paper};--accent:${t.color.accent};--on-accent:${t.color.onAccent};--border:${t.page.border};--error:${t.page.error};--mark:${t.screenshot.note};--on-mark:${t.screenshot.onNote}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:${t.font};line-height:1.85;font-feature-settings:"palt";-webkit-text-size-adjust:100%}
main{max-width:800px;margin:0 auto;padding:56px 24px 96px}
h1{font-size:1.9rem;line-height:1.4;margin:0 0 12px;letter-spacing:.02em}
h1+p{color:var(--sub);margin:0 0 8px}
h2{font-size:1.3rem;line-height:1.5;margin:72px 0 10px;padding-top:20px;border-top:2px solid var(--ink);break-after:avoid}
h3{font-size:1.08rem;margin:48px 0 8px;color:var(--accent);break-after:avoid}
p,li{font-size:.95rem;color:var(--sub);margin:10px 0}
p.claim{font-size:1.1rem;font-weight:600;color:var(--ink);line-height:1.7;margin:0 0 18px}
figure{margin:0 0 18px;padding:22px 18px;background:var(--paper);border:1px solid var(--border);border-radius:8px;break-inside:avoid}
figure>svg{display:block;height:auto}
figure.error{border-color:var(--error);color:var(--error);font-size:.9rem}
table{width:100%;border-collapse:collapse;margin:0 0 18px;font-size:.92rem;break-inside:avoid}
th{text-align:left;font-weight:600;color:var(--ink);border-bottom:2px solid var(--ink);padding:8px 12px}
td{color:var(--ink);border-bottom:1px solid var(--border);padding:8px 12px;vertical-align:top}
code{font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;font-size:.88em;background:var(--surface);padding:.1em .35em;border-radius:4px;color:var(--ink)}
pre{background:var(--surface)!important;padding:14px 16px;border-radius:8px;overflow-x:auto;line-height:1.6;font-size:.86rem}
pre code{background:none;padding:0}
a{color:var(--accent)}
.meta{font-size:.78rem;color:var(--sub);margin:4px 0}.right{margin-left:auto}
.num{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;border-radius:11px;background:var(--accent);color:var(--on-accent);font-size:.75rem;font-weight:700}.num.note{background:var(--mark);color:var(--on-mark)}
ol.marks{list-style:none;margin:-4px 0 6px;padding:0}ol.marks li{display:flex;gap:10px;align-items:flex-start;margin:6px 0;color:var(--ink);font-size:.92rem}
.refs{margin:22px 0 18px}.refs-h{font-size:.8rem;font-weight:700;color:var(--sub);margin-bottom:8px}
.ref{padding:14px 16px;border:1px solid var(--border);border-radius:8px;margin-top:10px;break-inside:avoid}.ref p{color:var(--ink);font-size:.9rem;margin:8px 0}
.ref-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:.84rem}
.tag{font-size:.74rem;font-weight:600;color:var(--sub);background:var(--surface);padding:0 8px;border-radius:4px}.mono{font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace}
.ref pre{margin:8px 0 0}blockquote{margin:10px 0;padding:12px 14px;background:var(--surface);border-radius:6px;font-size:.9rem;color:var(--ink)}.tr-h{font-size:.76rem;font-weight:600;color:var(--sub)}
@media print{main{padding:0;max-width:none}h2{margin-top:40px}}
`;

// 根拠のブロックを先に検証しておく。Markdown の変換は同期処理なので、結果を行番号で引けるようにする。
async function resolveAllRefs(doc: Doc, ctx: LintContext, limits: Limits): Promise<Map<number, RefItem[]>> {
  const map = new Map<number, RefItem[]>();
  for (const b of doc.sections.flatMap((s) => s.blocks).filter((x) => x.kind === 'refs')) map.set(b.line, (await resolveRefs(b, ctx, limits)).items);
  return map;
}
// テーマは、原稿のプロジェクトのもの。theme preview は、まだ設定していないテーマを渡す。
const ctxOf = (file: string | undefined, given?: Theme): LintContext => {
  const baseDir = path.dirname(path.resolve(file ?? '.'));
  const theme = given ?? themeFor(baseDir);
  return { baseDir, tokens: theme.tokens, types: typesFor(theme) };
};

export async function render(source: string, file?: string, { theme: given }: { theme?: Theme } = {}): Promise<string> {
  const limits: Limits = readJson('contract/limits.json');
  const ctx = ctxOf(file, given);
  const tokens = ctx.tokens;
  const doc = parse(source);
  const refs = await resolveAllRefs(doc, ctx, limits);
  // コードの色付けは生成時に行い、HTML に色を埋め込む。閲覧時にスクリプトを読み込まない。
  const blocks = [...doc.lead, ...doc.sections.flatMap((s) => s.blocks)];
  const refLangs = [...refs.values()].flat().filter((it) => it.kind === 'code').map((it) => it.lang);
  const langs = [...new Set([...blocks.filter((b) => b.kind === 'code').map((b) => b.lang), ...refLangs].filter((l) => !plainLang(l)))];
  const escHtml = (c: string) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const highlight = (code: string, lang: string) => (plainLang(lang) ? `<pre><code>${escHtml(code)}</code></pre>` : highlighter.codeToHtml(code, { lang, theme: tokens.codeTheme }));
  const highlighter = await createHighlighter({ themes: [tokens.codeTheme], langs });
  const claimLines = new Set(
    doc.sections.filter((s) => !s.container && s.blocks[0]?.kind === 'paragraph').map((s) => s.blocks[0].line),
  );

  const md = new MarkdownIt({ html: true });
  // markdown-it は、既定の fence の描き方を必ず持つ。
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tks, i, opts, env, self) => {
    const tk = tks[i];
    if (isVideoOnly(tk.info)) return '';
    if (isRefs(tk.info)) return refsHtml(refs.get(tk.map![0] + 1) ?? [], highlight);
    if (!isFigure(tk.info)) {
      const lang = tk.info.trim().split(/\s+/)[0];
      if (plainLang(lang)) return fence(tks, i, opts, env, self);
      return highlighter.codeToHtml(tk.content.replace(/\n$/, ''), { lang, theme: tokens.codeTheme }) + '\n';
    }
    const block = doc.sections.flatMap((s) => s.blocks).find((b): b is FigureBlock => b.kind === 'figure' && b.line === tk.map![0] + 1);
    const type = typeOf(ctx.types, block?.spec);
    // 型が見つかったなら、図のブロックと仕様はある。
    if (!type || type.validate(block!.spec!, limits, ctx).length) {
      return `<figure class="error">この図は描画できません。<code>zukai lint</code> の F001 を確認してください。</figure>\n`;
    }
    return `<figure>${type.render(block!.spec!, tokens, ctx)}</figure>\n${type.after?.(block!.spec!, ctx).html ?? ''}`;
  };
  md.renderer.rules.paragraph_open = (tks, i, opts, env, self) => {
    if (tks[i].level === 0 && claimLines.has(tks[i].map![0] + 1)) tks[i].attrSet('class', 'claim');
    return self.renderToken(tks, i, opts);
  };

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title ?? '資料')}</title>
<style>${css(tokens)}</style>
</head>
<body>
<main>
${md.render(source)}</main>
<script type="application/json" id="zukai-source">${JSON.stringify(source).replace(/</g, '\\u003c')}</script>
</body>
</html>
`;
}

// HTML に埋め込んだ原稿を取り出す。
export function extract(html: string): string | null {
  const m = html.match(/<script type="application\/json" id="zukai-source">(.*?)<\/script>/s);
  return m ? JSON.parse(m[1]) : null;
}

const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const macro = (name: string, inner: string) => `<ac:structured-macro ac:name="${name}">${inner}</ac:structured-macro>`;

// Confluence のページ。figures は、添付する図の名前と SVG。background は PNG にするときの背景の色。
export interface ConfluencePage {
  title: string;
  body: string;
  figures: { name: string; svg: string }[];
  background: string;
}

// Confluence 向け。本文はストレージ形式（XHTML）、図は添付ファイルとして参照する。
// ページのタイトルは本文と別に持つので、# 見出しは本文から外す。
export async function renderConfluence(source: string, sourceName: string): Promise<ConfluencePage> {
  const limits: Limits = readJson('contract/limits.json');
  const ctx = ctxOf(sourceName);
  const tokens = ctx.tokens;
  const doc = parse(source);
  const refs = await resolveAllRefs(doc, ctx, limits);
  const claimLines = new Set(
    doc.sections.filter((s) => !s.container && s.blocks[0]?.kind === 'paragraph').map((s) => s.blocks[0].line),
  );
  const figures: ConfluencePage['figures'] = [];

  const md = new MarkdownIt({ html: false, xhtmlOut: true });
  md.renderer.rules.fence = (tks, i) => {
    const tk = tks[i];
    if (isVideoOnly(tk.info)) return '';
    if (isRefs(tk.info)) return refsStorage(refs.get(tk.map![0] + 1) ?? []);
    if (!isFigure(tk.info)) {
      const lang = tk.info.trim().split(/\s+/)[0];
      const param = lang ? `<ac:parameter ac:name="language">${esc(lang)}</ac:parameter>` : '';
      return macro('code', `${param}<ac:plain-text-body>${cdata(tk.content)}</ac:plain-text-body>`) + '\n';
    }
    const block = doc.sections.flatMap((s) => s.blocks).find((b): b is FigureBlock => b.kind === 'figure' && b.line === tk.map![0] + 1);
    const type = typeOf(ctx.types, block?.spec);
    // 型が見つかったなら、図のブロックと仕様はある。
    if (!type || type.validate(block!.spec!, limits, ctx).length) throw new Error(`L${tk.map![0] + 1} の図を描画できません。先に zukai lint を通してください。`);
    const name = `fig-${String(figures.length + 1).padStart(2, '0')}.png`;
    figures.push({ name, svg: type.render(block!.spec!, tokens, ctx) });
    return `<ac:image ac:width="${tokens.figure.width}"><ri:attachment ri:filename="${name}"/></ac:image>\n${type.after?.(block!.spec!, ctx).storage ?? ''}`;
  };
  md.renderer.rules.heading_open = (tks, i, opts, env, self) => {
    if (tks[i].tag !== 'h1') return self.renderToken(tks, i, opts);
    tks[i + 1].children = [];
    tks[i + 1].content = '';
    return '';
  };
  md.renderer.rules.heading_close = (tks, i, opts, env, self) => (tks[i].tag === 'h1' ? '' : self.renderToken(tks, i, opts));
  md.renderer.rules.paragraph_open = (tks, i) => (tks[i].level === 0 && claimLines.has(tks[i].map![0] + 1) ? '<p><strong>' : '<p>');
  md.renderer.rules.paragraph_close = (tks, i) => {
    let j = i - 1;
    while (tks[j].type !== 'paragraph_open') j--;
    return tks[j].level === 0 && claimLines.has(tks[j].map![0] + 1) ? '</strong></p>\n' : '</p>\n';
  };

  // 抑制コメントはページに出さない。行番号がずれないよう、行数は残す。
  const body = md.render(source.replace(/^<!--[\s\S]*?-->[ \t]*$/gm, (m) => m.replace(/[^\n]/g, '')));
  const notice = macro(
    'info',
    `<ac:rich-text-body><p>このページは zukai で生成しています。内容を変えるときは、添付の原稿「${esc(path.basename(sourceName))}」を編集して、生成し直してください。このページを直接編集すると、次の生成で上書きされます。</p></ac:rich-text-body>`,
  );
  return { title: doc.title ?? path.basename(sourceName, '.md'), body: `${notice}\n${body}`, figures, background: tokens.color.paper };
}
