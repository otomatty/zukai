// テーマの見本。図の型の例と本文の部品を、テーマの値で1枚の HTML に描く。動画は、背景、配色、字幕、図の見え方だけを描く。
// 動画のシーンの絵柄は AI が書くので、ここでは描かない。シーンで確かめるときは zukai frames --sheet を使う。
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { types } from './figures/index.js';
import { render } from './render.js';
import { esc } from './figures/svg.js';
import { videoTokens } from './video/script.js';
import { readTheme, themeReport } from './theme.js';

// 実物の画像が要る型は、見本に入れない。
const SKIP = ['screenshot'];
const chip = (c) => `<span style="display:inline-block;width:1.1em;height:1.1em;margin-right:.4em;vertical-align:-.2em;border-radius:3px;background:${c};border:1px solid var(--border)"></span>`;
const fence = (t) => `\`\`\`${t.fence ?? 'yaml figure'}\n${t.example}\n\`\`\``;

function source(theme, findings) {
  const t = theme.tokens;
  const result = findings.length ? findings.map((f) => `- ${f.severity}：${f.what}。${f.message}`).join('\n') : '- 問題はありません。';
  const colors = Object.entries(t.color).map(([k, v]) => `| color.${k} | ${chip(v)}${v} |`);
  const series = [...t.chart.series.map((v, i) => `| chart.series[${i}] | ${chip(v)}${v} |`), `| chart.muted | ${chip(t.chart.muted)}${t.chart.muted} |`];
  const figures = Object.values(types).filter((x) => !SKIP.includes(x.name)).map((x) => `## ${x.name}\n\n${x.name} の型の見本です。\n\n${fence(x)}\n\n${x.summary}。`);
  return `# テーマの見本：${theme.name ?? '既定の見た目'}

${theme.dir ? `テーマのフォルダ ${theme.dir} の値で描いています。` : 'テーマを設定していないので、zukai の既定の値で描いています。'}

## 確かめた結果

zukai theme check と同じ結果です。

${result}

## 色

資料の文字、背景、強調の色です。

| 項目 | 色 |
|---|---|
${[...colors, ...series].join('\n')}

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

// 動画の見本。1920×1080 の画面を縮めて描く。
function videoSection(theme) {
  const t = videoTokens(theme.tokens);
  const v = t.video;
  const ctx = { baseDir: process.cwd(), tokens: t };
  const draw = (name) => types[name].render(exampleSpec(types[name]), t, ctx);
  const frame = (inner) => `<div style="position:relative;aspect-ratio:16/9;background:${v.background};border-radius:8px;overflow:hidden;margin:0 0 18px;font-family:${t.font.replace(/"/g, "'")}">${inner}</div>`;
  const scene = frame(
    `<div style="position:absolute;top:7%;left:8%;right:8%;text-align:center;color:${v.ink};font-weight:800;font-size:clamp(13px,2.4vw,24px);line-height:1.4">主張文は、この色と大きさで出ます</div>` +
      `<div style="position:absolute;left:8%;right:8%;top:26%;height:48%">${draw('flow')}</div>` +
      `<div style="position:absolute;bottom:4%;left:50%;transform:translateX(-50%);max-width:70%;padding:.35em 1.1em;border-radius:10px;background:${v.subtitle.band}cc;color:${v.subtitle.ink};font-weight:700;font-size:clamp(11px,1.9vw,19px);text-align:center">字幕は、この帯に出ます</div>`,
  );
  const chart = frame(`<div style="position:absolute;left:8%;right:8%;top:12%;height:76%">${draw('line')}</div>`);
  const palette = Object.entries(v.palette).map(([k, c]) => `<div style="display:flex;align-items:center;gap:6px;font-size:.82rem;color:var(--ink)">${chip(c)}<code>--zk-${esc(k)}</code> ${c}</div>`).join('');
  return `<h2>動画</h2>
<p class="claim">動画の背景、文字、字幕、図は、この配色で出ます。</p>
${scene}
${chart}
<p>シーンの絵は AI が書きます。次の配色を CSS 変数として使えます。背景は <code>--zk-bg</code>（${v.background}）です。</p>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin:0 0 18px">${palette}</div>
`;
}

// 型の例の YAML を、仕様にする。自由な図は SVG をそのまま渡す。
function exampleSpec(x) {
  if (x.fence?.startsWith('svg')) return { type: x.name, svg: x.example };
  return { type: x.name, ...parseYaml(x.example) };
}

// dir は見本にするテーマのフォルダ。null なら既定の見た目。
export async function previewTheme(dir) {
  const theme = readTheme(dir);
  if (theme.problems.length) throw new Error(`テーマに誤りがあるので、見本を描けません。\n${theme.problems.map((p) => `  ${p}`).join('\n')}`);
  const { findings } = await themeReport(dir);
  const file = path.join(dir ?? process.cwd(), 'preview.md');
  const html = await render(source(theme, findings), file, { tokens: theme.tokens });
  return { html: html.replace('</main>', `${videoSection(theme)}</main>`), findings };
}
