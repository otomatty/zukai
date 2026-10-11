// node --test tests/theme.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTheme, checkTheme, rulesPrompt, baseTokens, contrast } from '../src/theme.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `zukai-${name}-`));
const run = (args, { cwd, home }) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, GEMINI_API_KEY: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const themeDir = (tokens, rules) => {
  const dir = tmp('theme');
  if (tokens) fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify(tokens));
  if (rules) fs.writeFileSync(path.join(dir, 'rules.md'), rules);
  return dir;
};
// テーマを設定したプロジェクト。tokens と rules は、テーマのフォルダに書く中身。
function project(tokens, rules) {
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
  assert.match(text, /chart.series は、3個の色/);
  assert.match(text, /font は、CSS の font-family の形/);
  assert.equal(r.tokens.figure.width, baseTokens().figure.width);
  assert.equal(r.tokens.color.ink, baseTokens().color.ink);
  assert.match(readTheme(path.join(tmp('none'), 'nothing')).problems[0], /がありません/);
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
  const free = JSON.parse(lint.out)[0].findings.filter((f) => f.rule === 'F001');
  assert.ok(free.some((f) => /色「#0f5f8a」は使えません/.test(f.message)), lint.out);

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
  const skill = JSON.parse(r.out).checks.find((c) => c.label === 'スキル');
  assert.equal(skill.status, 'warn');
  assert.match(skill.detail, /zukai-theme\/SKILL.md（無い）/);
});
