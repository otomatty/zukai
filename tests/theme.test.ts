// node --test tests/theme.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTheme, checkTheme, rulesPrompt, baseTokens, contrast } from '../src/theme.ts';
import type { Finding, Limits, Tokens } from '../src/types.ts';

const limits: Limits = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../contract/limits.json', import.meta.url)), 'utf8'));

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `zukai-${name}-`));
const run = (args: string[], { cwd, home }: { cwd: string; home: string }) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, GEMINI_API_KEY: '', ZUKAI_LINT_SERVER: 'off' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const themeDir = (tokens: unknown, rules?: string) => {
  const dir = tmp('theme');
  if (tokens) fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify(tokens));
  if (rules) fs.writeFileSync(path.join(dir, 'rules.md'), rules);
  return dir;
};
// テーマを設定したプロジェクト。tokens と rules は、テーマのフォルダに書く中身。
function project(tokens: unknown, rules?: string) {
  const home = tmp('theme-home');
  const dir = tmp('theme-project');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, 'brand'));
  fs.writeFileSync(path.join(dir, 'brand/tokens.json'), JSON.stringify(tokens));
  if (rules) fs.writeFileSync(path.join(dir, 'brand/rules.md'), rules);
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ theme: 'brand' }));
  return { home, dir };
}
const BRAND = { color: { accent: '#9c2f12', accentSurface: '#fbe3d6' }, chart: { series: ['#9c2f12', '#2f6f8f', '#8a6d00'] } };

test('テーマは、書いた値だけを contract/tokens.json に重ねる', () => {
  const t = readTheme(themeDir(BRAND, '# 暖色\n')).tokens;
  const base = baseTokens();
  assert.equal(t.color.accent, '#9c2f12');
  assert.equal(t.color.ink, base.color.ink);
  assert.deepEqual(t.chart.series, BRAND.chart.series);
  assert.equal(t.chart.muted, base.chart.muted);
  assert.equal(t.video.palette.blue, base.video.palette.blue);
  assert.equal(readTheme(themeDir(BRAND, '# 暖色\n')).name, '暖色');
});

test('無い項目、変えられない値、色でない値、外へ出られるフォントは、誤りにして重ねない', () => {
  const r = readTheme(themeDir({ colour: {}, figure: { width: 800 }, color: { ink: 'red' }, chart: { series: ['#000000'] }, font: 'x}body{color:red' }));
  const text = r.problems.join('\n');
  assert.match(text, /colour という項目はありません/);
  assert.match(text, /figure.width はテーマでは変えられません/);
  assert.match(text, /color.ink の「red」は色ではありません/);
  assert.match(text, /chart.series は、3、4、5個の色/);
  assert.match(text, /font は、CSS の font-family の形/);
  assert.equal(r.tokens.figure.width, baseTokens().figure.width);
  assert.equal(r.tokens.color.ink, baseTokens().color.ink);
  assert.match(readTheme(path.join(tmp('none'), 'nothing')).problems[0], /がありません/);
  // 注釈（/* */）と、閉じていない引用符は、後ろの規則を壊すので通さない。
  for (const font of ['foo/*', '"Noto Sans JP', "'a', b'", 'a, , b', '"Bob\'s Font", sans-serif', "'Say \"hi\"'"]) assert.match(readTheme(themeDir({ font })).problems.join('\n'), /font は、CSS の font-family の形/, font);
  // 角丸は 0（使わない）にできる。負の数は止める。
  assert.equal(readTheme(themeDir({ figure: { radius: 0 } })).tokens.figure.radius, 0);
  assert.match(readTheme(themeDir({ figure: { radius: -1 } })).problems.join('\n'), /figure\.radius は、0以上の数値/);
  for (const font of [baseTokens().font, 'ヒラギノ角ゴ ProN, sans-serif', "'BIZ UDPGothic', system-ui"]) assert.deepEqual(readTheme(themeDir({ font })).problems, [], font);
});

test('既定の値は見た目の検査を通り、読めない文字は error、見分けにくい系列は warn にする', async () => {
  assert.deepEqual(await checkTheme(baseTokens()), []);
  assert.ok(contrast('#000000', '#ffffff') > 20);

  const pale = await checkTheme(readTheme(themeDir({ color: { sub: '#c0c0c0' } })).tokens);
  assert.ok(pale.some((f) => f.severity === 'error' && /color.sub（#c0c0c0）と color.paper/.test(f.message)));

  const redGreen = await checkTheme(readTheme(themeDir({ chart: { series: ['#e41a1c', '#4daf4a', '#377eb8'] } })).tokens);
  assert.ok(redGreen.some((f) => f.severity === 'warn' && /2型色覚で見分けにくい/.test(f.message)));
  assert.ok(redGreen.every((f) => f.severity === 'warn'));

  const code = await checkTheme(readTheme(themeDir({ codeTheme: 'no-such-theme' })).tokens);
  assert.ok(code.some((f) => /codeTheme「no-such-theme」/.test(f.message)));
});

test('rules.md は、動画の節を動画のときだけ、出典とコメントを除いて、見出しを下げて指示に入れる', () => {
  const rules = '# 暖色\n\n<!-- 書き方の説明 -->\n\n## 図\n\n- 角丸は使わない\n\n## 動画\n\n- キャラクターは描かない\n\n## 出典\n\n- brand.pdf\n';
  const theme = readTheme(themeDir(null, rules));
  const doc = rulesPrompt(theme);
  assert.match(doc, /^## デザインのルール/);
  assert.match(doc, /テーマ「暖色」/);
  assert.match(doc, /### 図\n\n- 角丸は使わない/);
  assert.doesNotMatch(doc, /キャラクター|brand\.pdf|書き方の説明/);
  assert.match(rulesPrompt(theme, { video: true }), /### 動画\n\n- キャラクターは描かない/);
  // theme init の雛形のように、コメントしかない節は入れない。
  assert.equal(rulesPrompt(readTheme(themeDir(null, '# 名前\n\n## 図\n\n<!-- 例 -->\n\n## 動画\n\n<!-- 例 -->\n'))), '');
});

test('テーマを設定すると、HTML、自由な図の色の検査、指示が、テーマの値になる', () => {
  const { home, dir } = project(BRAND, '# 暖色\n\n## 図\n\n- 強調は1つの図に1か所だけにする\n');
  const doc = `# 題名

## 経路

要求は、ゲートウェイから認証サービスへ進みます。

\`\`\`yaml figure
type: flow
steps:
  - label: ゲートウェイ
  - label: 認証サービス
    emphasis: true
\`\`\`

認証サービスが照合します。

## 優先度

優先度は、影響の大きさで決めます。

\`\`\`svg figure
<svg viewBox="0 0 720 100">
  <title>優先度の図</title>
  <rect x="20" y="20" width="200" height="60" rx="6" fill="#0f5f8a"/>
</svg>
\`\`\`

影響が大きいものから直します。
`;
  fs.writeFileSync(path.join(dir, 'a.md'), doc);
  const build = run(['build', 'a.md'], { cwd: dir, home });
  assert.equal(build.code, 0, build.err);
  const html = fs.readFileSync(path.join(dir, 'a.html'), 'utf8');
  assert.match(html, /--accent:#9c2f12/);
  assert.match(html, /stroke:#9c2f12/);

  // 前の既定の強調の色（#0f5f8a）は、テーマに無いので使えない。
  const lint = run(['lint', 'a.md', '--no-log', '--no-textlint', '--json'], { cwd: dir, home });
  const free = JSON.parse(lint.out)[0].findings.filter((f: Finding) => f.rule === 'F001');
  assert.ok(free.some((f: Finding) => /色「#0f5f8a」は使えません/.test(f.message)), lint.out);

  assert.match(run(['type', 'free'], { cwd: dir, home }).out, /強調 #9c2f12/);
  const prompt = run(['prompt'], { cwd: dir, home }).out;
  assert.match(prompt, /## デザインのルール/);
  assert.match(prompt, /強調は1つの図に1か所だけにする/);
});

test('テーマに誤りがあれば、build と lint は黙って既定の値で描かずに止める', () => {
  const { home, dir } = project({ color: { ink: 'black' } });
  fs.writeFileSync(path.join(dir, 'a.md'), '# 題名\n');
  const r = run(['build', 'a.md'], { cwd: dir, home });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /テーマに誤りがあります/);
  assert.match(r.err, /color.ink の「black」は色ではありません/);
});

test('theme init、check、preview', () => {
  const home = tmp('theme-cli-home');
  const dir = tmp('theme-cli');
  fs.mkdirSync(path.join(dir, '.git'));
  const init = run(['theme', 'init'], { cwd: dir, home });
  assert.equal(init.code, 0, init.err);
  const tokens = JSON.parse(fs.readFileSync(path.join(dir, 'zukai-theme/tokens.json'), 'utf8'));
  assert.equal(tokens.figure.width, undefined);
  assert.equal(tokens.video.fps, undefined);
  assert.match(run(['theme', 'init'], { cwd: dir, home }).out, /すでにあります/);

  const ok = run(['theme', 'check', 'zukai-theme'], { cwd: dir, home });
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /PASS/);
  tokens.color.sub = '#d0d0d0';
  fs.writeFileSync(path.join(dir, 'zukai-theme/tokens.json'), JSON.stringify(tokens));
  const ng = run(['theme', 'check', 'zukai-theme', '--json'], { cwd: dir, home });
  assert.equal(ng.code, 1);
  assert.equal(JSON.parse(ng.out).ok, false);

  const preview = run(['theme', 'preview', 'zukai-theme'], { cwd: dir, home });
  assert.equal(preview.code, 0, preview.err);
  const html = fs.readFileSync(path.join(dir, '.zukai/theme-preview.html'), 'utf8');
  assert.match(html, /--sub:#d0d0d0/);
  assert.match(html, /<h2>動画<\/h2>/);
  assert.doesNotMatch(html, /この図は描画できません/);
  assert.match(run(['theme', 'chek'], { cwd: dir, home }).err, /「check」の書き間違い/);
});

test('返答のスキルだけがある場所には、テーマのスキルを足すよう doctor が知らせる', () => {
  const home = tmp('theme-skill-home');
  const dir = tmp('theme-skill');
  fs.mkdirSync(path.join(dir, '.git'));
  run(['setup', 'skills', '--skills=project', '--tools=claude', '--yes'], { cwd: dir, home });
  assert.ok(fs.existsSync(path.join(dir, '.claude/skills/zukai-theme/SKILL.md')));
  fs.rmSync(path.join(dir, '.claude/skills/zukai-theme'), { recursive: true });
  const r = run(['doctor', '--json'], { cwd: dir, home });
  const skill = JSON.parse(r.out).checks.find((c: { label: string }) => c.label === 'スキル');
  assert.equal(skill.status, 'warn');
  assert.match(skill.detail, /zukai-theme\/SKILL.md（無い）/);
});

// --- グラデーション、強調の描き方、グラフの色の付け方 ---

const GRAD = { gradient: { stops: ['#0432ff', '#ff2f92', '#ff2600'], angle: 90 } };

test('グラデーションと強調の描き方は、選択肢と色の数を確かめ、グラデーションが無ければ止める', () => {
  const bad = readTheme(themeDir({ emphasis: { box: 'shiny' }, chart: { mode: 'gray', series: ['#000000', '#111111'] }, gradient: { stops: ['#000000'], angle: 400 } })).problems.join('\n');
  assert.match(bad, /emphasis.box は、flat、fill、tint、outline のどれか/);
  assert.match(bad, /chart.mode は、series、neutral のどれか/);
  assert.match(bad, /chart.series は、3、4、5個の色/);
  assert.match(bad, /gradient.stops は、2、3、4、5個の色/);
  assert.match(bad, /gradient.angle は、0〜360 の数値/);
  assert.match(readTheme(themeDir({ emphasis: { box: 'fill' } })).problems.join('\n'), /gradient.stops に2〜5個の色を書いてください/);
  const ok = readTheme(themeDir({ ...GRAD, emphasis: { box: 'tint', chart: 'gradient' }, chart: { mode: 'neutral', series: ['#0432ff', '#ff2f92', '#ff2600', '#7c3aed', '#00838f'] } }));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.tokens.chart.series.length, 5);
});

test('グラデーションの面に載せる文字は、どの色の上でも読めるかを確かめる', async () => {
  const fill = await checkTheme(readTheme(themeDir({ ...GRAD, emphasis: { box: 'fill' } })).tokens);
  assert.ok(fill.some((f) => f.severity === 'error' && /onAccent（#ffffff）と gradient.stops\[1\]（#ff2f92）/.test(f.message)));
  const dark = await checkTheme(readTheme(themeDir({ gradient: { stops: ['#0b2a99', '#7a1048'], angle: 90 }, emphasis: { box: 'fill' }, video: { figure: { color: { onAccent: '#ffffff' } } } })).tokens);
  assert.deepEqual(dark.filter((f) => f.what === '強調した箱の文字'), []);
});

test('淡いグラデーションの面は、透明にせず、図の紙の色に重ねた色で塗る', async () => {
  // 動画では、図の下が動画の背景になる。透明にすると、theme check が確かめた色と違う色になる。
  const { open } = await import('../src/figures/svg.ts');
  const { videoTokens } = await import('../src/video/script.ts');
  const t = readTheme(themeDir({ ...GRAD, emphasis: { box: 'tint', chart: 'flat' } })).tokens;
  for (const [tokens, paper] of [[t, t.color.paper], [videoTokens(t), t.video.figure.color.paper]] as [Tokens, string][]) {
    const svg = open(tokens, 100, '図');
    const tint = svg.match(/<linearGradient id="zk-grad-tint"[^>]*>(.*?)<\/linearGradient>/)![1];
    assert.doesNotMatch(tint, /stop-opacity/);
    const want = tokens.gradient.stops.map((s) => {
      const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
      return `#${[1, 3, 5].map((i) => Math.round(ch(s, i) * 0.16 + ch(paper, i) * 0.84).toString(16).padStart(2, '0')).join('')}`;
    });
    assert.deepEqual([...tint.matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map((m) => m[1]), want);
  }
});

test('強調した箱はテーマの描き方で塗り、グラフは neutral で強調だけに色を付ける', () => {
  const { home, dir } = project({ ...GRAD, emphasis: { box: 'fill', chart: 'gradient' }, chart: { mode: 'neutral' } });
  const doc = `# 題名

## 経路

要求は、ゲートウェイから認証サービスへ進みます。

\`\`\`yaml figure
type: flow
steps:
  - label: ゲートウェイ
  - label: 認証サービス
    emphasis: true
\`\`\`

認証サービスが照合します。

## 内訳

費用の多くは、実行環境です。

\`\`\`yaml figure
type: stack
unit: 万円
items:
  - label: 実行環境
    value: 12
    emphasis: true
  - label: その他
    value: 3
\`\`\`

その他は、ログの保存です。
`;
  fs.writeFileSync(path.join(dir, 'a.md'), doc);
  const r = run(['build', 'a.md'], { cwd: dir, home });
  assert.equal(r.code, 0, r.err);
  const html = fs.readFileSync(path.join(dir, 'a.html'), 'utf8');
  assert.match(html, /<linearGradient id="zk-grad" x1="0" y1="0.5" x2="1" y2="0.5">/);
  assert.match(html, /\.zk-box-em\{fill:url\(#zk-grad\);stroke:none\}/);
  assert.match(html, /\.zk-on-em\{fill:#ffffff\}/);
  // ECharts の強調も、グラデーションで塗る。重ねたときの色を作れずに壊れた CSS を出さない。
  assert.ok((html.match(/<linearGradient/g) ?? []).length >= 3);
  assert.doesNotMatch(html, /object Object/);
  // neutral では、強調しない内訳を灰色にする。
  assert.match(html, /fill="#a8b0b9"|fill="rgb\(168,176,185\)"/);
});

// --- 独自の型 ---

const STAT = {
  'type.json': {
    summary: '主役の数字を大きく見せる',
    when: '1つの数字が結論のとき',
    fields: {
      value: { type: 'string', max: 5, required: true, desc: '数字' },
      label: { type: 'string', max: 12, required: true, desc: '数字が何を表すか' },
      tags: { type: 'list', max: 3, of: { type: 'string', max: 6 }, desc: '添える語' },
    },
    example: { value: '300', label: '導入企業数', tags: ['累計'] },
  },
  'figure.svg': `<svg viewBox="0 0 720 200">
  <title>{{label}} {{value}}</title>
  <g><text class="zk-grad" x="360" y="110" text-anchor="middle" font-size="96" font-weight="900">{{value}}</text></g>
  <text class="zk-text" x="360" y="150" text-anchor="middle">{{label}}</text>
  {{#tags}}<text class="zk-note" x="{{= 300 + @index * 120}}" y="185">{{.}}</text>{{/tags}}
</svg>`,
  'motion.js': 'ctx.parts.forEach((p, k) => p.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: (ctx.start + k * 0.2) * 1000, fill: "both" }));',
};
// 独自の型を持つテーマのプロジェクト。files で、型のファイルを差し替える。
function typedProject(files: Record<string, unknown> = {}, tokens: unknown = GRAD) {
  const p = project(tokens);
  const tdir = path.join(p.dir, 'brand/types/stat');
  fs.mkdirSync(tdir, { recursive: true });
  for (const [name, body] of Object.entries({ ...STAT, ...files })) if (body !== null) fs.writeFileSync(path.join(tdir, name), typeof body === 'string' ? body : JSON.stringify(body));
  return p;
}
const statDoc = (spec: string) => `# 題名

## 実績

導入企業は、300社を超えています。

\`\`\`yaml figure
${spec}
\`\`\`

導入先は、スタートアップから大企業まで広がっています。
`;

test('テーマの独自の型は、指示に出て、検査を通り、資料に描ける', () => {
  const { home, dir } = typedProject();
  const prompt = run(['prompt'], { cwd: dir, home }).out;
  assert.match(prompt, /\| stat（このテーマの型） \| 1つの数字が結論のとき \|/);
  const type = run(['type', 'stat'], { cwd: dir, home }).out;
  assert.match(type, /value: 数字（必須、全角5字まで）/);
  assert.match(type, /type: stat\nvalue: "300"/);

  fs.writeFileSync(path.join(dir, 'a.md'), statDoc('type: stat\nvalue: "300"\nlabel: 導入企業数\ntags: [累計, 国内]'));
  const lint = run(['lint', 'a.md', '--no-log', '--no-textlint'], { cwd: dir, home });
  assert.equal(lint.code, 0, lint.out);
  assert.equal(run(['build', 'a.md'], { cwd: dir, home }).code, 0);
  const html = fs.readFileSync(path.join(dir, 'a.html'), 'utf8');
  assert.match(html, /class="zk-grad"[^>]*>300<\/text>/);
  assert.match(html, /x="420"[^>]*>国内<\/text>/);

  // 項目の上限と、無い項目は、型のある図と同じく F001 にする。
  // 上限は全角の字数で数えるので、半角の数字は2つで1字になる。
  fs.writeFileSync(path.join(dir, 'b.md'), statDoc('type: stat\nvalue: "12345678901"\nlabel: 導入企業数\ncolor: red'));
  const bad = JSON.parse(run(['lint', 'b.md', '--no-log', '--no-textlint', '--json'], { cwd: dir, home }).out)[0];
  assert.ok(bad.findings.some((f: Finding) => f.rule === 'F001' && /value「12345678901」が全角7字相当あります。上限は5字/.test(f.message)), JSON.stringify(bad.findings));
  assert.ok(bad.findings.some((f: Finding) => f.rule === 'F001' && /未定義のキー「color」/.test(f.message)));
});

test('独自の型の誤りは、テーマを確かめるときに知らせる', async () => {
  const tpl = typedProject({ 'figure.svg': '<svg viewBox="0 0 720 100">{{#value}}</svg>' });
  assert.match(run(['theme', 'check'], { cwd: tpl.dir, home: tpl.home }).out, /figure.svg: \{\{#value\}\} が閉じていません/);
  const field = typedProject({ 'type.json': { ...STAT['type.json'], fields: { value: { type: 'string' } } } });
  assert.match(run(['theme', 'check'], { cwd: field.dir, home: field.home }).out, /max（全角の字数の上限）が要ります/);
  // 例が、自由な図と同じ検査（色）を通らない。
  const color = typedProject({ 'figure.svg': STAT['figure.svg'].replace('class="zk-text"', 'fill="#123456" font-size="15"') });
  const c = run(['theme', 'check'], { cwd: color.dir, home: color.home });
  assert.equal(c.code, 1);
  assert.match(c.out, /型 stat の例が検査を通りません。.*色「#123456」は使えません/);
  const typed = typedProject({ 'type.json': { ...STAT['type.json'], example: { ...STAT['type.json'].example, type: 'flow' } } });
  assert.match(run(['theme', 'check'], { cwd: typed.dir, home: typed.home }).out, /example に type は書きません/);
  // ひな形の名前の書き間違いは、図から黙って消えるので止める。繰り返しの中の要素の名前、@index、テーマの値は通す。
  const names = typedProject({ 'figure.svg': STAT['figure.svg'].replace('{{#tags}}', '{{#tgas}}').replace('{{/tags}}', '{{/tgas}}').replace('{{label}}</text>', '{{label}} {{= width(lable, 15)}} {{theme.color.acent}}</text>') });
  const nm = run(['theme', 'check'], { cwd: names.dir, home: names.home }).out;
  assert.match(nm, /figure\.svg: \{\{lable\}\}、\{\{theme\.color\.acent\}\}、\{\{tgas\}\} は、type\.json の fields にも/);
  const { compile, unknownNames } = await import('../src/template.ts');
  const shape = { fields: { rows: { of: { fields: { name: {} } } }, theme: { fields: { color: { fields: { accent: {} } } } } } };
  assert.deepEqual(unknownNames(compile('{{#rows}}{{name}}{{@n}}{{theme.color.accent}}{{/rows}}'), shape), []);
  assert.deepEqual(unknownNames(compile('{{name}}{{@n}}{{.}}'), shape), ['name', '@n', '.']);
  // 定義の名前の書き間違いは、任意の項目として黙って通さない。
  // 範囲が逆の項目と、字数や個数に負の数や小数を書いた項目は、どの値も通らなくなるので止める。
  const bounds = typedProject({ 'type.json': { ...STAT['type.json'], fields: { ...STAT['type.json'].fields, n: { type: 'number', min: 10, max: 1 }, tags: { type: 'list', max: 2.5, of: { type: 'string', max: -1 } } } } });
  const b = run(['theme', 'check'], { cwd: bounds.dir, home: bounds.home }).out;
  assert.match(b, /fields\.n: min（10）が max（1）より大きくなっています/);
  assert.match(b, /fields\.tags\.max は0以上の整数/);
  assert.match(b, /fields\.tags\.of\.max は0以上の整数/);
  const typo = typedProject({ 'type.json': { ...STAT['type.json'], fields: { ...STAT['type.json'].fields, label: { type: 'string', max: 12, requred: true } } } });
  assert.match(run(['theme', 'check'], { cwd: typo.dir, home: typo.home }).out, /fields\.label: requred は使えません/);
  const flag = typedProject({ 'type.json': { ...STAT['type.json'], fields: { ...STAT['type.json'].fields, label: { type: 'string', max: 12, required: 'yes' } } } });
  assert.match(run(['theme', 'check'], { cwd: flag.dir, home: flag.home }).out, /fields\.label\.required は true か false/);
  const motion = typedProject({ 'motion.js': 'ctx.parts.forEach((p) => {' });
  assert.match(run(['theme', 'check'], { cwd: motion.dir, home: motion.home }).out, /motion.js を読めません/);
});

test('動画では、独自の型の図に型の動きを付け、図の中の名前をシーンごとに分ける', async () => {
  const { dir } = typedProject();
  const { scenesOf, timeline, estimateVoice } = await import('../src/video/script.ts');
  const { pageHtml } = await import('../src/video/encode.ts');
  const { tokensFor, themeFor } = await import('../src/theme.ts');
  const file = path.join(dir, 'a.md');
  const flow = '\n## 経路\n\n要求は、認証サービスへ進みます。\n\n```yaml figure\ntype: flow\nsteps:\n  - label: ゲートウェイ\n  - label: 認証サービス\n```\n\n認証サービスが照合します。\n';
  fs.writeFileSync(file, statDoc('type: stat\nvalue: "300"\nlabel: 導入企業数') + flow);
  const scenes = scenesOf(fs.readFileSync(file, 'utf8'), file);
  assert.equal(scenes[1].figureType, 'stat');
  assert.equal(scenes[2].figureType, null);
  const plan = { ...timeline(scenes, scenes.map((s) => estimateVoice(s.lines))), width: 1920, height: 1080, fps: 30, limits: limits.video, motions: Object.fromEntries(themeFor(dir).types.map((d) => [d.name, d.motion])) };
  const html = pageHtml(plan, tokensFor(dir));
  assert.match(html, /<script>zk\.__type\("stat", function \(fig, ctx\) \{\nctx\.parts\.forEach/);
  assert.match(html, /data-type="stat"/);
  // 2つ目の図の矢印は、2つ目の図の印を指す。zk- で始まらない名前（自由な図、独自の型、ECharts）にも付ける。
  assert.match(html, /<marker id="s2-zk-arrow"/);
  assert.match(html, /marker-end="url\(#s2-zk-arrow\)"/);
  assert.doesNotMatch(html, /id="zk-arrow"/);
  assert.doesNotMatch(html, /"motions"/);
});

// --- 対話で決める ---

test('案は、項目=値 を + でつなぎ、値は JSON として読めればその値にする', async () => {
  const { parseVariant } = await import('../src/preview.ts');
  assert.deepEqual(parseVariant('emphasis.box=tint'), { 'emphasis.box': 'tint' });
  assert.deepEqual(parseVariant('chart.mode=series+gradient.angle=180'), { 'chart.mode': 'series', 'gradient.angle': 180 });
  assert.deepEqual(parseVariant('chart.series=["#000000","#111111","#222222"]'), { 'chart.series': ['#000000', '#111111', '#222222'] });
  assert.throws(() => parseVariant('tint'), /項目と値を = でつなぎます/);
  // 案も、tokens.json に書いたときと同じ検査を通る。
  assert.match(readTheme(themeDir(GRAD), { set: { 'emphasis.box': 'shiny' } }).problems.join('\n'), /emphasis.box は、flat、fill、tint、outline のどれか/);
  assert.equal(readTheme(themeDir(GRAD), { set: { 'emphasis.box': 'tint' } }).tokens.emphasis.box, 'tint');
  assert.equal(readTheme(null, { set: { 'chart.mode': 'neutral' } }).tokens.chart.mode, 'neutral');
  // __proto__ などでたどる案は誤りにし、すべてのオブジェクトの元を書き換えない。
  for (const v of ['__proto__.emphasis={"box":"tint"}', '__proto__={"emphasis":{"box":"tint"}}', 'constructor.prototype.x=1']) {
    assert.match(readTheme(themeDir(GRAD), { set: parseVariant(v) }).problems.join('\n'), /という項目はありません/, v);
  }
  assert.equal(({} as Record<string, unknown>).emphasis, undefined);
  assert.equal(readTheme(themeDir(GRAD), { set: parseVariant('emphasis.box=tint') }).tokens.emphasis.box, 'tint');
});

test('theme compare は、今のテーマと案を、検査の結果と図と色覚の見え方で並べる', () => {
  const { home, dir } = typedProject();
  const r = run(['theme', 'compare', 'emphasis.box=fill', 'emphasis.box=tint', 'emphasis.box=shiny', '--types=flow,stat'], { cwd: dir, home });
  assert.equal(r.code, 0, r.err);
  const html = fs.readFileSync(path.join(dir, '.zukai/theme-compare.html'), 'utf8');
  assert.match(html, /<code>emphasis.box=fill<\/code>/);
  assert.match(html, /<p class="ng">error 4<\/p>/);
  assert.match(html, /この案は使えません/);
  assert.match(html, /<div class="label">stat<\/div>/);
  assert.doesNotMatch(html, /<div class="label">bar<\/div>/);
  assert.match(html, /1型色覚/);
  // 図は画像として置く。SVG の style が、ほかの案の図に移らないようにするため。
  assert.match(html, /src="data:image\/svg\+xml;base64,/);
  assert.match(run(['theme', 'check', 'emphasis.box=fill'], { cwd: dir, home }).err, /案（emphasis.box=fill）を書けるのは compare だけ/);
  assert.match(run(['theme', 'compare'], { cwd: dir, home }).err, /見比べる案を書いてください/);
});

test('見比べの図は、それぞれの案の紙の色の上に置く', async () => {
  const { compareThemes } = await import('../src/preview.ts');
  // オブジェクトが元から持つ名前（constructor など）は、型として通さない。
  await assert.rejects(compareThemes(themeDir(GRAD), [], { only: ['constructor'] }), /型 constructor はありません/);
  const html = await compareThemes(themeDir(GRAD), ['color.paper="#111111"+color.ink="#f5f5f5"+color.sub="#cccccc"'], { only: ['flow'] });
  assert.match(html, /background:#ffffff" src="data:image\/svg\+xml/);
  assert.match(html, /background:#111111" src="data:image\/svg\+xml/);
});

test('見本の動画の図は画像にし、資料の図の色を変えない', () => {
  const home = tmp('preview-home');
  const dir = tmp('preview');
  fs.mkdirSync(path.join(dir, '.git'));
  assert.equal(run(['theme', 'preview'], { cwd: dir, home }).code, 0);
  const html = fs.readFileSync(path.join(dir, '.zukai/theme-preview.html'), 'utf8');
  const video = html.slice(html.indexOf('<h2>動画</h2>'));
  assert.doesNotMatch(video, /<svg/);
  assert.match(video, /data:image\/svg\+xml;base64,/);
  assert.match(html, /<h2>系列の色の見え方<\/h2>/);
});

test('rules.md の「決めたこと」は、出典と同じく AI への指示に入れない', () => {
  const theme = readTheme(themeDir(null, '# 名前\n\n## 図\n\n- 角丸は使わない\n\n## 決めたこと\n\n- 2026-10-11 tint にした\n'));
  const p = rulesPrompt(theme);
  assert.match(p, /角丸は使わない/);
  assert.doesNotMatch(p, /tint にした/);
});

// --- レビューで直したこと ---

test('独自の型の文字も、用語の表記（P007）の検査を受ける', () => {
  const { home, dir } = typedProject();
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'zukai.config.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ ...cfg, terms: [{ use: 'トークン', avoid: ['印'], except: ['矢印'] }] }));
  fs.writeFileSync(path.join(dir, 'a.md'), statDoc('type: stat\nvalue: "300"\nlabel: 印の数\ntags: [矢印]'));
  const r = JSON.parse(run(['lint', 'a.md', '--no-log', '--no-textlint', '--json'], { cwd: dir, home }).out)[0];
  const p7 = r.findings.filter((f: Finding) => f.rule === 'P007');
  assert.equal(p7.length, 1, JSON.stringify(r.findings));
  assert.match(p7[0].message, /印/);

  // 属性にだけ使う値は、読み手に見えないので調べない。
  const attr = typedProject({
    'type.json': { ...STAT['type.json'], fields: { ...STAT['type.json'].fields, key: { type: 'string', max: 10, desc: '図の名前' } } },
    'figure.svg': STAT['figure.svg'].replace('<g>', '<g id="{{key}}">'),
  });
  fs.writeFileSync(path.join(attr.dir, 'zukai.config.json'), JSON.stringify({ theme: 'brand', terms: [{ use: 'トークン', avoid: ['印'] }] }));
  fs.writeFileSync(path.join(attr.dir, 'a.md'), statDoc('type: stat\nvalue: "300"\nlabel: 導入企業数\nkey: 印'));
  const hidden = JSON.parse(run(['lint', 'a.md', '--no-log', '--no-textlint', '--json'], { cwd: attr.dir, home: attr.home }).out)[0];
  assert.deepEqual(hidden.findings.filter((f: Finding) => f.rule === 'P007'), []);
});

test('#rgb の色は #rrggbb にそろえる。透明度を後ろに足す使い方があるため', () => {
  const t = readTheme(themeDir({ video: { subtitle: { band: '#000' } }, chart: { series: ['#F00', '#0a0', '#00f'] } })).tokens;
  assert.equal(t.video.subtitle.band, '#000000');
  assert.deepEqual(t.chart.series, ['#ff0000', '#00aa00', '#0000ff']);
});

test('独自の型の type.json がオブジェクトでないときと、組み込みの型と同じ名前のときは、テーマの誤りにする', () => {
  const nul = typedProject({ 'type.json': 'null' });
  const a = run(['theme', 'check'], { cwd: nul.dir, home: nul.home });
  assert.equal(a.code, 1);
  assert.match(a.out, /type.json は JSON のオブジェクトで書きます/);
  const clash = typedProject();
  fs.renameSync(path.join(clash.dir, 'brand/types/stat'), path.join(clash.dir, 'brand/types/flow'));
  assert.match(run(['theme', 'check'], { cwd: clash.dir, home: clash.home }).out, /型の名前 flow は、組み込みの型か zukai の部品と同じ名前/);
  // 見本は、生の例外ではなく、テーマの誤りとして止まる。
  assert.match(run(['theme', 'preview'], { cwd: clash.dir, home: clash.home }).err, /テーマに誤りがあるので、見本を描けません/);
});

test('見本と見比べは、テーマから来る文字を HTML として出さず、描けない例は枠にして続ける', () => {
  const { home, dir } = typedProject({ 'type.json': { ...STAT['type.json'], summary: '<img src=x onerror=alert(1)>数字' } });
  assert.equal(run(['theme', 'preview'], { cwd: dir, home }).code, 0);
  const html = fs.readFileSync(path.join(dir, '.zukai/theme-preview.html'), 'utf8');
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
  // 案でラベルを大きくしても、見比べのページは書き出せる。
  const r = run(['theme', 'compare', 'size.label=100', '--types=flow,stat'], { cwd: dir, home });
  assert.equal(r.code, 0, r.err);
});

test('ひな形の閉じていない {{ と、対応の無い }} は止める', async () => {
  const { compile } = await import('../src/template.ts');
  assert.throws(() => compile('<text>{{value</text>'), /閉じていない \{\{/);
  assert.throws(() => compile('<text>value}}</text>'), /閉じていない \{\{/);
  assert.throws(() => compile('{{#items}}<text>{{label</text>{{/items}}'));
  assert.doesNotThrow(() => compile('<text>{{value}}</text>'));
});

test('neutral の灰色は、紙と見分けられるかを確かめる', async () => {
  const grey = (muted: string, mode = 'neutral') => checkTheme(readTheme(themeDir({ chart: { mode, muted } })).tokens).then((f) => f.filter((x) => x.what === '灰色の系列'));
  // 動画の図は、暗い紙に自分の灰色を持つので、資料の図だけを知らせる。
  const white = await grey('#ffffff');
  assert.deepEqual(white.map((x) => [x.severity, /chart\.muted（#ffffff）と color\.paper/.test(x.message)]), [['warn', true]]);
  assert.deepEqual(await grey('#a8b0b9'), []);
  // neutral のヒートマップの数値は、濃いマス（chart.muted）の上の color.ink で確かめる。
  const heat = (await checkTheme(readTheme(themeDir({ chart: { mode: 'neutral', muted: '#1c2530' } })).tokens)).filter((x) => x.what === 'ヒートマップの数値');
  assert.ok(heat.some((x) => x.severity === 'error' && /color\.ink.*chart\.muted/.test(x.message)), JSON.stringify(heat));
  // series でも、系列の色が3つなら、4つ目を chart.muted、5つ目を chart.rest で描くので確かめる。5つあれば使わない。
  assert.deepEqual((await grey('#ffffff', 'series')).map((x) => x.severity), ['warn']);
  const five = ['#0432ff', '#ff2f92', '#ff2600', '#a77bff', '#00695c'];
  assert.deepEqual((await checkTheme(readTheme(themeDir({ chart: { mode: 'series', muted: '#ffffff', series: five } })).tokens)).filter((x) => x.what === '灰色の系列'), []);
  const rest = (await checkTheme(readTheme(themeDir({ chart: { rest: '#ffffff' } })).tokens)).filter((x) => x.what === '残りの系列');
  assert.equal(rest.length, 1, JSON.stringify(rest));
  assert.deepEqual((await checkTheme(baseTokens())).filter((x) => x.what === '残りの系列' || x.what === '灰色の系列'), []);
  // 2つ目からの灰色は、紙から chart.muted より離れる。明るいテーマでも、暗いテーマ（動画の図）でも。
  const { grey: shade } = await import('../src/figures/chart.ts');
  const base = readTheme(null).tokens;
  for (const t of [base, { ...base, color: { ...base.color, ...base.video.figure.color }, chart: { ...base.chart, ...base.video.figure.chart } }]) {
    const r = [0, 1, 2, 3, 4].map((k) => contrast(shade(t, k), t.color.paper));
    r.slice(1).forEach((x, k) => assert.ok(x > r[k], `${k + 1}: ${r}`));
  }
});

test('画面の注釈の番号は、資料でも動画でも screenshot.onNote で書き、印の色と確かめる', async () => {
  // 動画の図は color を差し替えるので、onAccent で書くと、動画でだけ番号の色が変わる。
  const { videoTokens } = await import('../src/video/script.ts');
  const { types } = await import('../src/figures/index.ts');
  const t = readTheme(themeDir({ screenshot: { onNote: '#000000' } })).tokens;
  // 撮影済みの画面（corpus/good/shots）を使う。
  const spec = { type: 'screenshot', image: 'shots/login.png', marks: [{ selector: '.alert', note: '残り時間を表示します。' }] };
  const ctx = { baseDir: fileURLToPath(new URL('../corpus/good/', import.meta.url)) };
  for (const tokens of [t, videoTokens(t)]) {
    const svg = types.screenshot.render(spec, tokens, ctx);
    assert.match(svg, /style="fill:#000000;font-weight:700">1</);
  }
  const f = await checkTheme(readTheme(themeDir({ screenshot: { note: '#141f4f', onNote: '#141f4f' } })).tokens);
  assert.ok(f.some((x) => x.what === '画面の注釈' && /screenshot\.onNote/.test(x.message)), JSON.stringify(f));
  assert.deepEqual((await checkTheme(baseTokens())).filter((x) => x.what === '画面の注釈'), []);
});

test('gitgraph の色は、ブランチの名前を紙とブランチの色の上で、線を紙の上で確かめる', async () => {
  const white = Array(8).fill('#ffffff');
  const f = await checkTheme(readTheme(themeDir({ gitgraph: { ink: '#ffffff', branch: white, lane: '#ffffff' } })).tokens);
  assert.ok(f.some((x) => x.what === 'ブランチの名前' && x.severity === 'error' && /gitgraph\.ink（#ffffff）と color\.paper/.test(x.message)), JSON.stringify(f));
  assert.ok(f.some((x) => x.what === 'ブランチの色' && x.severity === 'warn' && /gitgraph\.lane/.test(x.message)));
  assert.equal(f.filter((x) => x.what === 'ブランチの色').length, 9);
  assert.deepEqual((await checkTheme(baseTokens())).filter((x) => x.what.startsWith('ブランチ')), []);
});

test('字幕の文字は、背景に重ねた半透明の帯の色で確かめる', async () => {
  // 帯は不透明なら 4.69:1 だが、白い背景に 80% で重ねると #333333 になり、2.8:1 しかない。
  const t = readTheme(themeDir({ video: { background: '#ffffff', subtitle: { band: '#000000', ink: '#777777' } } })).tokens;
  const f = await checkTheme(t);
  assert.ok(f.some((x) => x.what === '字幕' && x.severity === 'error'), JSON.stringify(f));
});

// Playwright と Chromium がある環境でだけ動かす。
// playwright は入れていない環境もあるので、名前を変数にして型の検査で探させない。型は、同じ API を持つ playwright-core から取る。
const PLAYWRIGHT: string = 'playwright';
type Playwright = typeof import('playwright-core');
// ページの中で、動画のエンジン（runtime.browser.js）が window に置く関数と、型の動きが書く値。
type Engine = { zkInit(): { errors: Error[] }; zkSeek(t: number): void; zkErrors(): Error[]; calls?: number };
const hasBrowser = await import(PLAYWRIGHT).then(() => true, () => false);
test('毎コマの処理で壊れた型の動きは、仕上げの書き出しで使わない', { skip: !hasBrowser && 'Playwright がありません', timeout: 120000 }, async () => {
  // 途中で切り替えると、型の動きが登録した効果音が、自動の動きの音と一緒に残るため。
  const { dir } = typedProject({ 'motion.js': "ctx.sfx('chime', 0.2); ctx.frame(() => { throw new Error('bad frame'); });" });
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, statDoc('type: stat\nvalue: "300"\nlabel: 導入企業数'));
  const { frames } = await import('../src/video/encode.ts');
  const r = await frames(file, { project: dir });
  const i = r.scenes.findIndex((s: { heading: string }) => s.heading === '実績');
  assert.ok(i > 0, JSON.stringify(r.scenes.map((s: { heading: string }) => s.heading)));
  assert.ok(r.results[i].findings.some((f: { message: string }) => /型の動き（motion\.js）が例外を出したため、自動の動きで書き出します/.test(f.message)), JSON.stringify(r.results[i].findings));
});

test('型の動きが例外を出したら、図を元に戻して自動の動きにする', { skip: !hasBrowser && 'Playwright がありません', timeout: 120000 }, async () => {
  const { scenesOf, timeline, estimateVoice } = await import('../src/video/script.ts');
  const { pageHtml } = await import('../src/video/encode.ts');
  const { tokensFor, themeFor } = await import('../src/theme.ts');
  const { chromium } = (await import(PLAYWRIGHT)) as Playwright;
  const browser = await chromium.launch();
  // motion.js を差し替えたテーマで、型の図の入ったページを開き、check(page) で確かめる。
  const open = async (motion: string) => {
    const { dir } = typedProject({ 'motion.js': motion });
    const file = path.join(dir, 'a.md');
    fs.writeFileSync(file, statDoc('type: stat\nvalue: "300"\nlabel: 導入企業数'));
    const scenes = scenesOf(fs.readFileSync(file, 'utf8'), file);
    const plan = { ...timeline(scenes, scenes.map((s) => estimateVoice(s.lines))), width: 1920, height: 1080, fps: 30, limits: limits.video, motions: Object.fromEntries(themeFor(dir).types.map((d) => [d.name, d.motion])) };
    const page = await browser.newPage();
    await page.setContent(pageHtml(plan, tokensFor(dir)));
    return { page, plan };
  };
  const state = () => {
    const svg = document.querySelector<SVGSVGElement>('[data-type="stat"] svg')!;
    return { hidden: svg.style.visibility, animated: svg.getAnimations({ subtree: true }).length };
  };
  try {
    // 動きの準備の途中で例外を出す。
    const a = await open("fig.querySelector('svg').style.visibility = 'hidden'; ctx.frame(() => {}); throw new Error('bad motion');");
    const r = await a.page.evaluate((s) => ({ errors: (window as unknown as Engine).zkInit().errors.map((e) => e.message), ...eval(s)() }), `(${state})`);
    assert.ok(r.errors.some((m: string) => /bad motion/.test(m)), JSON.stringify(r.errors));
    assert.equal(r.hidden, '');
    assert.ok(r.animated > 0);

    // 準備は通り、毎コマの処理で図を隠してから例外を出す。それ以降の処理は呼ばない。
    const b = await open("let n = 0; ctx.frame(() => { n++; window.calls = n; fig.querySelector('svg').style.visibility = 'hidden'; throw new Error('bad frame'); });");
    const at = b.plan.scenes.find((x: { figureType?: unknown; start: number }) => x.figureType === 'stat')!;
    const f = await b.page.evaluate(
      ([s, t0, t1]) => {
        const init = (window as unknown as Engine).zkInit();
        (window as unknown as Engine).zkSeek(t0);
        (window as unknown as Engine).zkSeek(t1);
        return { init: init.errors.length, errors: (window as unknown as Engine).zkErrors().map((e) => e.message), calls: (window as unknown as Engine).calls, ...eval(s)() };
      },
      [`(${state})`, at.start + 0.5, at.start + 1] as [string, number, number],
    );
    assert.equal(f.init, 0);
    assert.equal(f.errors.length, 1, JSON.stringify(f.errors));
    assert.match(f.errors[0], /bad frame/);
    assert.equal(f.calls, 1);
    assert.equal(f.hidden, '');
    assert.ok(f.animated > 0);
  } finally {
    await browser.close();
  }
});
