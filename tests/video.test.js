// node --test tests/video.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLine, readOptions, wrapScripts, timeline, estimateVoice, scenesOf, checkLines, numbersIn, TIMING } from '../src/video/script.js';
import { lineTimes } from '../src/video/tts.js';
import { synth, thin, mix } from '../src/video/sfx.js';

test('ナレーションの行から、目印とタグを外して字幕と読み上げの文を作る', () => {
  const l = parseLine({ text: 'そのまま<short pause>30分たつと、{#expire}消えます。', style: '残念そうに' });
  assert.equal(l.text, 'そのまま30分たつと、消えます。');
  assert.equal(l.speech, 'そのまま<short pause>30分たつと、消えます。');
  assert.equal(l.style, '残念そうに');
  assert.deepEqual(l.marks, { expire: 'そのまま30分たつと、'.length });
});

test('例ではない行の数値が原稿に無ければ知らせ、疑問から始まらないシーンを知らせる', () => {
  const lines = [parseLine('なぜ30分なのでしょう？'), parseLine('目安は15分から45分です。'), parseLine({ text: 'たとえば、100人が使うと…', example: true })];
  const f = checkLines(lines, '最後の操作から30分で削除します。15〜30分が目安です。', { needQuestion: 'first' });
  assert.deepEqual(f.map((x) => x.rule), ['V013']);
  assert.match(f[0].message, /45/);
  assert.deepEqual(numbersIn('１８０ミリ秒、1,200件、3つ、0.5秒'), ['180', '1200', '0.5']);
  assert.deepEqual(checkLines([parseLine('答えから始めます。')], '', { needQuestion: 'first' }).map((x) => x.rule), ['V014']);
});

test('オープニングとエンディングが無ければ知らせ、あればエンディングを最後のシーンにする', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-script-'));
  const file = path.join(dir, 'a.md');
  const body = '# 題名\n\n導入です。\n\n## 節\n\n主張です。\n\n```yaml figure\ntype: flow\nsteps:\n  - label: 入口\n  - label: 出口\n```\n\n説明です。\n';
  assert.deepEqual(scenesOf(body, file)[0].findings.map((f) => f.rule).sort(), ['V003', 'V004', 'V005']);
  const full = body.replace('導入です。\n', '導入です。\n\n```yaml narration\n- 何が起きるのでしょう？\n```\n') + '\n```yaml narration ending\n- まとめです。\n```\n\n```yaml narration\n- {#a}読めない行\n```\n';
  const scenes = scenesOf(full, file);
  assert.equal(scenes.at(-1).ending, true);
  assert.deepEqual(scenes[0].findings.map((f) => f.rule).sort(), ['V003', 'V012']);
});

test('シーンの設定を読み、使えない値を知らせ、スクリプトをシーンごとに包む', () => {
  const r = readOptions('<zk-options subtitles="off" transition="spin" hold="2"></zk-options><div>本体</div>');
  assert.equal(r.html, '<div>本体</div>');
  assert.equal(r.options.subtitles, 'off');
  assert.equal(r.options.transition, 'pan');
  assert.equal(r.options.hold, 2);
  assert.equal(r.findings[0].rule, 'V010');
  assert.match(wrapScripts('<script>let a = 1;</script>', 3), /^<script>zk\.__run\(3, function \(\) \{\nlet a = 1;\n\}\);<\/script>$/);
});

test('cut の切り替えは0秒、hold はシーンを延ばす', () => {
  const opts = (o) => ({ bird: 'on', scenery: 'on', subtitles: 'on', claim: 'on', transition: 'pan', hold: 0, ...o });
  const lines = [parseLine('一つめの文です。')];
  const scenes = [{ lines, options: opts() }, { lines, options: opts({ transition: 'cut', hold: 2 }) }];
  const v = estimateVoice(lines);
  const plan = timeline(scenes, [v, v]);
  assert.equal(plan.scenes[1].start, plan.scenes[0].end);
  const base = Math.max(TIMING.minScene, TIMING.narrStart + v.duration + TIMING.tail);
  assert.equal(plan.scenes[1].end - plan.scenes[1].start, base + 2);
});

test('音声の無音の区間から、文の切れ目を見つける', () => {
  const rate = 24000;
  const tone = (sec) => Float32Array.from({ length: rate * sec }, (_, i) => 0.3 * Math.sin(i / 5));
  const silence = (sec) => new Float32Array(rate * sec);
  const samples = Float32Array.from([...silence(0.2), ...tone(1), ...silence(0.4), ...tone(1.5), ...silence(0.2)]);
  const t = lineTimes(samples, rate, [{ text: 'あ' }, { text: 'い' }]);
  assert.ok(Math.abs(t[0].start - 0.2) < 0.03 && Math.abs(t[1].end - 3.1) < 0.03);
  assert.ok(Math.abs(t[0].end - 1.4) < 0.05, `切れ目 ${t[0].end}`);
});

test('効果音は割れず、鳴りすぎを間引く', () => {
  for (const k of ['pop', 'whoosh', 'draw', 'chime']) assert.ok(Math.max(...synth(k).map(Math.abs)) <= 1);
  const many = Array.from({ length: 10 }, (_, i) => ({ t: i * 0.1, kind: 'pop' }));
  assert.equal(thin(many).length, 4);
  assert.ok(Math.max(...mix(1, [{ at: 0, samples: new Float32Array(100).fill(0.8) }, { at: 0, samples: new Float32Array(100).fill(0.8) }]).map(Math.abs)) <= 0.991);
});

test('API キーは、プロジェクトの設定からは読まない', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-proj-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  Object.assign(process.env, { HOME: home, USERPROFILE: home });
  delete process.env.GEMINI_API_KEY;
  try {
    const { loadSettings, writeProjectSettings, writeApiKey } = await import('../src/settings.js');
    assert.equal(writeProjectSettings(project, 'video').written, true);
    assert.equal(writeProjectSettings(project, 'document').written, false);
    const file = path.join(project, '.zukai', 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), gemini: { apiKey: 'project-key' } }));
    let r = loadSettings(project);
    assert.equal(r.settings.output, 'video');
    assert.equal(r.settings.apiKey, null);
    assert.match(r.warnings[0], /読みません/);
    writeApiKey('home-key');
    assert.equal(loadSettings(project).settings.apiKey, 'home-key');
    process.env.GEMINI_API_KEY = 'env-key';
    assert.equal(loadSettings(project).settings.apiKey, 'env-key');
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

// Playwright と Chromium がある環境でだけ動かす。
const hasBrowser = await import('playwright').then(() => true, () => false);
test('無限ループと例外のシーンは、自動の動きに差し替える', { skip: !hasBrowser && 'Playwright がありません', timeout: 120000 }, async () => {
  const { frames } = await import('../src/video/encode.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-video-'));
  const file = path.join(dir, 'bad.md');
  const section = (title, html) => `## ${title}\n\n${title}のシーンです。\n\n\`\`\`yaml figure\ntype: flow\nsteps:\n  - label: 入口\n  - label: 出口\n\`\`\`\n\n説明です。\n\n\`\`\`html motion\n${html}\n\`\`\`\n`;
  fs.writeFileSync(file, `# 確認\n\n確認の原稿です。\n\n${section('止まる', '<script>zk.scene((t) => { if (t > 1) for (;;) {} });</script>')}\n${section('例外', '<script>missing();</script>')}\n${section('正常', '<div style="position:absolute;left:100px;top:300px;font-size:60px;color:#fff;animation:a 1s both">正常</div><style>@keyframes a{from{opacity:0}}</style>')}`);
  const r = await frames(file, { project: dir });
  const rules = (i) => r.results[i].findings.map((f) => f.rule);
  assert.ok(rules(1).includes('V001') && rules(1).includes('V000'));
  assert.ok(rules(2).includes('V002') && rules(2).includes('V000'));
  assert.deepEqual(rules(3), []);
  assert.deepEqual(r.scenes.map((s) => s.kind), ['title', 'auto', 'auto', 'free']);
});
