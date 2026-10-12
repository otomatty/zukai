// テーマの見本と、案の見比べ。
// 見本（theme preview）は、図の型の例と本文の部品を、テーマの値で1枚の HTML に描く。系列の色の色覚での見え方と、動画の配色も描く。
// 見比べ（theme compare）は、今のテーマと、値を変えた案を、同じ図で横に並べる。AI と利用者が、対話でテーマを決めるときに使う。
// 動画のシーンの絵柄は AI が書くので、ここでは描かない。シーンで確かめるときは zukai frames --sheet を使う。
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { typesFor } from './figures/custom.ts';
import { render } from './render.ts';
import { esc } from './figures/svg.ts';
import { videoTokens } from './video/script.ts';
import { readTheme, themeReport, VISION, simulate, distance, SERIES_GAP } from './theme.ts';
import type { Theme, ThemeFinding } from './theme.ts';
import { findingLabel, msg } from './messages.ts';
import type { AnyFigureType, FigureContext, RawSpec, Tokens } from './types.ts';

// 実物の画像が要る型は、見本に入れない。
const SKIP = ['screenshot'];
const chip = (c: string) => `<span style="display:inline-block;width:1.1em;height:1.1em;margin-right:.4em;vertical-align:-.2em;border-radius:3px;background:${c};border:1px solid #dfe4ea"></span>`;
const fence = (t: AnyFigureType) => `\`\`\`${t.fence ?? 'yaml figure'}\n${t.example}\n\`\`\``;

// 型の例を描く。案によっては描けない例（ひな形が SVG として読めないなど）もあるので、そのときは理由を書いた枠にする。
function drawExample(type: AnyFigureType, t: Tokens, ctx: FigureContext, style?: string): string {
  try {
    return isolated(type.render(exampleSpec(type), t, ctx), style);
  } catch (e) {
    return `<div style="border:1px solid #b42318;border-radius:8px;padding:10px;color:#b42318;font-size:.8rem">型 ${esc(type.name)} の例を描けません。${esc(String((e as Error).message ?? e).split('\n')[0])}</div>`;
  }
}

// 図を、画像として置く。SVG の中の style はページ全体に効くので、別の配色の図を同じページに並べると、後の図の色が前の図に移るため。
const isolated = (svg: string, style = 'display:block;width:100%;height:auto') => `<img alt="" style="${style}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`;

// 見本の原稿は HTML を通す設定で描くので、テーマから来る文字（名前、型の説明、検査の結果）は、HTML として読まれないように書く。
function source(theme: Theme, findings: ThemeFinding[]): string {
  const t = theme.tokens;
  const result = findings.length ? findings.map((f) => `- ${f.severity}：${esc(findingLabel(f.what))}。${esc(f.message)}`).join('\n') : '- 問題はありません。';
  const colors = Object.entries(t.color).map(([k, v]) => `| color.${k} | ${chip(v)}${v} |`);
  const series = [...t.chart.series.map((v, i) => `| chart.series[${i}] | ${chip(v)}${v} |`), `| chart.muted | ${chip(t.chart.muted)}${t.chart.muted} |`];
  const grad = t.gradient.stops.length ? [`| gradient | ${t.gradient.stops.map(chip).join('')}${t.gradient.angle}° |`] : [];
  const types = typesFor(theme);
  const figures = Object.values(types).filter((x) => !SKIP.includes(x.name)).map((x) => `## ${x.name}\n\n${x.name} の型の見本です。\n\n${fence(x)}\n\n${esc(x.summary)}。`);
  return `# テーマの見本：${esc(theme.name ?? '既定の見た目')}

${theme.dir ? `テーマのフォルダ ${esc(theme.dir)} の値で描いています。` : 'テーマを設定していないので、zukai の既定の値で描いています。'}

## 確かめた結果

zukai theme check と同じ結果です。

${result}

## 色

資料の文字、背景、強調の色です。強調した箱は ${t.emphasis.box}、グラフの強調は ${t.emphasis.chart}、グラフの色の付け方は ${t.chart.mode} です。

| 項目 | 色 |
|---|---|
${[...colors, ...grad, ...series].join('\n')}

## 本文

主張文は、このように太く大きく出ます。

| 部品 | 使う色 |
|---|---|
| 見出しと主張文 | color.ink |
| 説明文 | color.sub |
| リンクと小見出し | color.accent |

説明文はこの色です。[リンク](https://example.com)はこの色です。

\`\`\`ts
// コードの配色（codeTheme: ${t.codeTheme}）
export const greet = (name: string) => \`こんにちは、\${name}\`;
\`\`\`

${figures.join('\n\n')}
`;
}

// 系列の色が、色覚の違いでどう見えるか。見分けにくい組（色の差が SERIES_GAP 未満）も挙げる。
function visionBlock(series: string[]): string {
  const rows = Object.entries(VISION).map(([name, m]) => {
    const cs = series.map((c) => simulate(c, m));
    const bar = cs.map((c) => `<span style="flex:1;height:22px;background:${c}"></span>`).join('');
    return `<div style="display:grid;grid-template-columns:7.5em 1fr;gap:10px;align-items:center;margin:6px 0"><span style="font-size:.82rem;color:#4a5565">${name}</span><div style="display:flex;gap:2px;border-radius:4px;overflow:hidden">${bar}</div></div>`;
  });
  const hard: string[] = [];
  for (let i = 0; i < series.length; i++)
    for (let j = i + 1; j < series.length; j++)
      for (const [name, m] of Object.entries(VISION)) {
        const d = distance(series[i], series[j], m);
        if (d < SERIES_GAP) hard.push(`${i + 1}色目と${j + 1}色目（${name}で差 ${d.toFixed(0)}）`);
      }
  return `${rows.join('')}<p style="font-size:.85rem;color:#4a5565;margin:8px 0 0">${hard.length ? `見分けにくい組: ${hard.join('、')}。差が ${SERIES_GAP} 未満の組です。` : `どの見え方でも、すべての組の差が ${SERIES_GAP} 以上あります。`}</p>`;
}

// 動画の見本。1920×1080 の画面を縮めて描く。
function videoSection(theme: Theme): string {
  const t: Tokens = videoTokens(theme.tokens);
  const v = t.video;
  const ctx = { baseDir: process.cwd(), tokens: t };
  const types = typesFor(theme);
  const draw = (name: string) => drawExample(types[name], t, ctx, 'display:block;width:100%;height:100%;object-fit:contain');
  const frame = (inner: string) => `<div style="position:relative;aspect-ratio:16/9;background:${v.background};border-radius:8px;overflow:hidden;margin:0 0 18px;font-family:${t.font.replace(/"/g, "'")}">${inner}</div>`;
  const scene = frame(
    `<div style="position:absolute;top:7%;left:8%;right:8%;text-align:center;color:${v.ink};font-weight:800;font-size:clamp(13px,2.4vw,24px);line-height:1.4">主張文は、この色と大きさで出ます</div>` +
      `<div style="position:absolute;left:8%;right:8%;top:26%;height:48%">${draw('flow')}</div>` +
      `<div style="position:absolute;bottom:4%;left:50%;transform:translateX(-50%);max-width:70%;padding:.35em 1.1em;border-radius:10px;background:${v.subtitle.band}cc;color:${v.subtitle.ink};font-weight:700;font-size:clamp(11px,1.9vw,19px);text-align:center">字幕は、この帯に出ます</div>`,
  );
  const chart = frame(`<div style="position:absolute;left:8%;right:8%;top:12%;height:76%">${draw('line')}</div>`);
  // テーマの独自の型。動画では、motion.js があればその動きで、無ければ部品ごとに現れる。
  const custom = theme.types.map((d) => `<p>型 <code>${esc(d.name)}</code>${d.motion ? '（motion.js の動きが付く）' : ''}</p>` + frame(`<div style="position:absolute;left:8%;right:8%;top:14%;height:72%">${draw(d.name)}</div>`)).join('\n');
  const palette = Object.entries(v.palette).map(([k, c]) => `<div style="display:flex;align-items:center;gap:6px;font-size:.82rem;color:var(--ink)">${chip(c)}<code>--zk-${esc(k)}</code> ${c}</div>`).join('');
  return `<h2>動画</h2>
<p class="claim">動画の背景、文字、字幕、図は、この配色で出ます。</p>
${scene}
${chart}
${custom}
<p>シーンの絵は AI が書きます。次の配色を CSS 変数として使えます。背景は <code>--zk-bg</code>（${v.background}）です。</p>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin:0 0 18px">${palette}</div>
`;
}

// 型の例の YAML を、仕様にする。自由な図は SVG をそのまま渡す。
function exampleSpec(x: AnyFigureType): RawSpec {
  if (x.fence?.startsWith('svg')) return { type: x.name, svg: x.example };
  return { type: x.name, ...parseYaml(x.example) };
}

// dir は見本にするテーマのフォルダ。null なら既定の見た目。
export async function previewTheme(dir: string | null): Promise<{ html: string; findings: ThemeFinding[] }> {
  const theme = readTheme(dir);
  if (theme.problems.length) throw new Error(msg('theme.previewProblems', { lines: theme.problems.map((p) => `  ${p}`).join('\n') }));
  const { findings } = await themeReport(dir);
  const file = path.join(dir ?? process.cwd(), 'preview.md');
  const html = await render(source(theme, findings), file, { theme });
  const vision = `<h2>系列の色の見え方</h2>\n<p class="claim">系列の色が、色覚の違いでどう見えるかです。</p>\n${visionBlock(theme.tokens.chart.series)}\n`;
  return { html: html.replace('</main>', `${vision}${videoSection(theme)}</main>`), findings };
}

// --- 見比べ -------------------------------------------------------------------

// 案の書き方。「emphasis.box=tint」のように、項目と値を = でつなぐ。1つの案で複数の値を変えるときは + でつなぐ。
// 値は JSON として読めればその値（["#0432ff","#ff2f92"] や 3）、読めなければ文字にする。
export function parseVariant(text: string): Record<string, unknown> {
  // __proto__ のような名前も、そのまま項目の名前として readTheme に渡し、そこで誤りにする。
  const set: Record<string, unknown> = Object.create(null);
  for (const part of text.split('+')) {
    const i = part.indexOf('=');
    if (i < 1) throw new Error(`案「${text}」を読めません。emphasis.box=tint のように、項目と値を = でつなぎます。複数の値は + でつなぎます。`);
    const raw = part.slice(i + 1).trim();
    let v: unknown = raw;
    try {
      v = JSON.parse(raw);
    } catch {
      // 文字として扱う。
    }
    set[part.slice(0, i).trim()] = v;
  }
  return { ...set };
}

// 見比べに使う図。強調した箱と、グラフの色の付け方が分かる型を既定にする。
export const COMPARE_TYPES = ['flow', 'timeline', 'bar', 'line', 'stack', 'treemap'];

// 見比べの1列。theme と report は、案を読んでから入れる。report は、案に値の誤りがあれば null。
interface Column {
  label: string;
  set: Record<string, unknown>;
  theme: Theme;
  report: Awaited<ReturnType<typeof themeReport>> | null;
}

// 今のテーマ（dir）と、案（variants: 文字の配列）を、同じ図で横に並べた HTML を作る。
export async function compareThemes(dir: string | null, variants: string[], { only = null }: { only?: string[] | null } = {}): Promise<string> {
  // theme と report は、すぐ下の繰り返しで入れる。
  const columns = [{ label: '今', set: {} }, ...variants.map((v) => ({ label: v, set: parseVariant(v) }))] as Column[];
  for (const c of columns) {
    c.theme = readTheme(dir, { set: c.set });
    c.report = c.theme.problems.length ? null : await themeReport(dir, { set: c.set });
  }
  const base = columns[0].theme;
  if (base.problems.length) throw new Error(msg('theme.compareProblems', { lines: base.problems.map((p) => `  ${p}`).join('\n') }));
  const names = only ?? [...COMPARE_TYPES, ...base.types.map((d) => d.name)];
  const unknown = names.filter((n) => !Object.hasOwn(typesFor(base), n));
  if (unknown.length) throw new Error(`型 ${unknown.join('、')} はありません。`);

  const cell = (c: Column, inner: string) => `<div class="cell">${inner}</div>`;
  const result = (c: Column) => {
    if (!c.report) return `<p class="ng">この案は使えません。</p><ul>${c.theme.problems.map((p) => `<li>${esc(p.replace(/^.*?tokens\.json: /, ''))}</li>`).join('')}</ul>`;
    const errors = c.report.findings.filter((f) => f.severity === 'error');
    const warns = c.report.findings.length - errors.length;
    return `<p class="${errors.length ? 'ng' : warns ? 'warn' : 'ok'}">${errors.length ? `error ${errors.length}` : '検査を通る'}${warns ? ` / warn ${warns}` : ''}</p>${c.report.findings.length ? `<ul>${c.report.findings.map((f) => `<li>${f.severity}：${esc(f.message)}</li>`).join('')}</ul>` : ''}`;
  };
  const figure = (c: Column, name: string) => {
    if (!c.report) return '';
    const types = typesFor(c.theme);
    const ctx = { baseDir: dir ?? process.cwd(), tokens: c.theme.tokens, types };
    // 図の SVG は背景が透明なので、その案の紙の色の上に置く。暗い紙の案を白の上に置くと、明るい文字が消えて見えるため。
    return drawExample(types[name], c.theme.tokens, ctx, `display:block;width:100%;height:auto;background:${c.theme.tokens.color.paper}`);
  };
  const row = (label: string, f: (c: Column) => string) => `<div class="row"><div class="label">${label}</div>${columns.map((c) => cell(c, f(c))).join('')}</div>`;
  const n = columns.length;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>テーマの見比べ</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#1c2530;font-family:"Hiragino Sans","Yu Gothic UI","Noto Sans JP","Noto Sans CJK JP",sans-serif;line-height:1.6}
main{max-width:${Math.max(900, 360 * n + 160)}px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:1.4rem;margin:0 0 6px}.lead{color:#5b6673;margin:0 0 20px;font-size:.92rem}
.row{display:grid;grid-template-columns:120px repeat(${n},minmax(0,1fr));gap:12px;padding:14px 0;border-top:1px solid #dfe4ea;align-items:start}
.head .cell{font-weight:700}.head code{font-weight:400;font-size:.82rem;background:#f3f5f7;padding:1px 6px;border-radius:4px;word-break:break-all}
.label{font-size:.85rem;font-weight:700;color:#5b6673}
.cell{min-width:0}.cell img{border:1px solid #dfe4ea;border-radius:8px;padding:10px}
.cell ul{margin:4px 0 0;padding-left:1.1em;font-size:.78rem;color:#5b6673}
.ok,.warn,.ng{font-weight:700;margin:0;font-size:.9rem}.ok{color:#1a7f37}.warn{color:#9a6700}.ng{color:#b42318}
@media (max-width:760px){.row{grid-template-columns:1fr}.label{margin-top:4px}}
</style></head><body><main>
<h1>テーマの見比べ：${esc(base.name ?? '既定の見た目')}</h1>
<p class="lead">左が今のテーマ、右が案です。案は tokens.json を書き換えずに試しています。決めた案は、tokens.json に書いてから zukai theme check で確かめます。</p>
<div class="row head"><div class="label">案</div>${columns.map((c) => cell(c, c.label === '今' ? '今' : `<code>${esc(c.label)}</code>`)).join('')}</div>
${row('確かめた結果', result)}
${names.map((name) => row(name, (c) => figure(c, name))).join('\n')}
${row('系列の色の見え方', (c) => (c.report ? visionBlock(c.theme.tokens.chart.series) : ''))}
</main></body></html>
`;
}
