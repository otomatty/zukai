// node --test tests/video.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLine, readOptions, wrapScripts, timeline, estimateVoice, scenesOf, checkLines, numbersIn, TIMING } from '../src/video/script.ts';
import { lineTimes } from '../src/video/tts.ts';
import { synth, synthParams, thin, mix, PRESETS, checkParams } from '../src/video/sfx.ts';
import type { SceneOptions } from '../src/video/script.ts';

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
  assert.equal(scenes.at(-1)!.ending, true);
  assert.deepEqual(scenes[0].findings.map((f) => f.rule).sort(), ['V003', 'V012']);
});

test('役割を付けたナレーションごとにショットを作り、長いシーンと同じ書き出しの多用を知らせる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-shot-'));
  const file = path.join(dir, 'a.md');
  const sec = (narr: string) => `## 節\n\n主張です。\n\n\`\`\`yaml figure\ntype: flow\nsteps:\n  - label: 入口\n  - label: 出口\n\`\`\`\n\n説明です。\n\n${narr}`;
  const shots = sec('```yaml narration question\n- どうなるのでしょう？\n```\n\n```html motion question\n<div></div>\n```\n\n```yaml narration example\n- たとえば、100人で使うと遅くなります。\n```\n\n```html motion example\n<div></div>\n```\n');
  const s = scenesOf(`# 題名\n\n導入です。\n\n${shots}`, file);
  assert.deepEqual(s.slice(1, 3).map((x) => [x.role, x.kind, x.options.transition]), [['question', 'free', 'pan'], ['example', 'free', 'cut']]);
  // 例のショットの数値は、原稿と照らし合わせない。
  assert.ok(!s[2].findings.some((f) => f.rule === 'V013'));
  const long = sec(`\`\`\`yaml narration\n${['なぜでしょう？', 'たとえば、一つめ。', 'たとえば、二つめ。', 'たとえば、三つめ。', '四つめです。'].map((l) => `- ${l}`).join('\n')}\n\`\`\`\n`);
  const rules = scenesOf(`# 題名\n\n導入です。\n\n${long}`, file).flatMap((x) => x.findings.map((f) => f.rule));
  assert.ok(rules.includes('V107') && rules.includes('V016'));
  // 役割の無い yaml narration が2つあると、2つ目は動画に入らないので知らせる。
  const twice = sec('```yaml narration\n- どうでしょう？\n```\n\n```yaml narration\n- 二つ目です。\n```\n');
  assert.ok(scenesOf(`# 題名\n\n導入です。\n\n${twice}`, file).some((x) => x.findings.some((f) => f.rule === 'V018')));
});

test('用語集と違う表記を知らせ、除外する語は知らせない', async () => {
  const { lint } = await import('../src/lint/index.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-terms-'));
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ terms: [{ use: 'トークン', avoid: ['印'], except: ['矢印'] }] }));
  const file = path.join(dir, 'a.md');
  const src = '# 題名\n\n導入です。\n\n## 渡し方\n\nログインした印を、矢印の先へ渡します。\n\n```yaml figure\ntype: flow\nsteps:\n  - label: 矢印\n  - label: 出口\n```\n\n説明です。\n';
  const r = await lint(src, file, { textlint: false });
  assert.deepEqual(r.findings.filter((f) => f.rule === 'P007').map((f) => f.line), [7]);
  // 使う表記が避ける表記を含む場合（ユーザー と ユーザ）は、使う表記を知らせない。題名も調べる。
  const { findAvoided } = await import('../src/terms.ts');
  const user = [{ use: 'ユーザー', avoid: ['ユーザ'] }];
  assert.deepEqual(findAvoided('ユーザーが使う', user), []);
  assert.equal(findAvoided('ユーザが使う', user).length, 1);
  const titled = await lint(src.replace('# 題名', '# 印の渡し方'), file, { textlint: false });
  assert.ok(titled.findings.some((f) => f.rule === 'P007' && f.line === 1));
  // 具体例だけを書いた用語は、表記の検査をせず、指示の「用語の具体例」の表に入る。
  const { termsTable } = await import('../src/terms.ts');
  const withExamples = [...user, { use: '認証サービス', examples: ['Amazon Cognito', 'Auth0'], actual: 'Amazon Cognito' }];
  assert.deepEqual(findAvoided('認証サービスです', withExamples), []);
  const table = termsTable(withExamples);
  assert.match(table, /## 用語の表記[\s\S]*\| ユーザー \| ユーザ \|/);
  assert.match(table, /## 用語の具体例[\s\S]*\| 認証サービス \| Amazon Cognito \| Amazon Cognito、Auth0 \|/);
  // ナレーションの時刻の目印と演技のタグは、字幕に出ないので調べない。
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ terms: [{ use: '時計', avoid: ['clock', 'pause'] }] }));
  const marked = await lint(src.replace('説明です。\n', '説明です。\n\n```yaml narration\n- 時計が{#clock}動きます。<short pause>\n```\n'), file, { textlint: false });
  assert.ok(!marked.findings.some((f) => f.rule === 'P007'));
  // ナレーションの用語は、ブロックの先頭ではなく、その文が書かれている行で知らせる。
  const third = await lint(src.replace('説明です。\n', '説明です。\n\n```yaml narration\n- 一つ目です。\n- 二つ目です。\n- clock が動きます。\n```\n'), file, { textlint: false });
  const narrLine = third.findings.find((f) => f.rule === 'P007')?.line;
  assert.equal(narrLine, src.split('\n').indexOf('説明です。') + 1 + 5);
  // 書きかけの図（検証に通らない flow）があっても、用語の検査で止まらず、F001 を返す。
  const broken = await lint(src.replace('steps:\n  - label: 矢印\n  - label: 出口\n', ''), file, { textlint: false });
  assert.ok(broken.findings.some((f) => f.rule === 'F001'));
  // 表のセルの用語も、その行で知らせる。
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ terms: [{ use: 'トークン', avoid: ['印'], except: ['矢印'] }] }));
  const tableSrc = '# 題名\n\n導入です。\n\n## 比べる\n\n主張です。\n\n| 項目 | 値 |\n|---|---|\n| 渡す物 | 印 |\n\n説明です。\n';
  const tabled = await lint(tableSrc, file, { textlint: false });
  assert.deepEqual(tabled.findings.filter((f) => f.rule === 'P007').map((f) => f.line), [11]);
  // terms が配列でなければ、設定の誤りとして止める。
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ terms: { use: '時計' } }));
  await assert.rejects(() => lint(src, file, { textlint: false }), /terms の値が正しくありません。配列/);
});

test('コード参照は、リポジトリの外のファイルを読まない', async () => {
  const { lint } = await import('../src/lint/index.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-outside-'));
  fs.mkdirSync(path.join(dir, 'repo'));
  fs.writeFileSync(path.join(dir, 'repo', 'a.txt'), 'ok\n');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret\n');
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ repos: { r: { path: 'repo', host: 'github', org: 'o', name: 'n', pin: false } } }));
  const doc = (code: string) => `# 題名\n\n導入です。\n\n## 節\n\n主張です。\n\n\`\`\`yaml figure\ntype: flow\nsteps:\n  - label: 入口\n  - label: 出口\n\`\`\`\n\n説明です。\n\n\`\`\`yaml refs\n- code: ${code}\n  note: 説明です。\n\`\`\`\n`;
  const r = await lint(doc('r:../secret.txt#L1'), path.join(dir, 'a.md'), { textlint: false });
  assert.match(r.findings.find((f) => f.rule === 'R002')?.message ?? '', /外/);
  const ok = await lint(doc('r:a.txt#L1'), path.join(dir, 'a.md'), { textlint: false });
  assert.ok(!ok.findings.some((f) => f.rule === 'R002'));
  // 「..」で始まるだけの名前は、親ディレクトリへの移動ではないので読める。
  fs.writeFileSync(path.join(dir, 'repo', '..notes.txt'), 'ok\n');
  const dots = await lint(doc('r:..notes.txt#L1'), path.join(dir, 'a.md'), { textlint: false });
  assert.ok(!dots.findings.some((f) => f.rule === 'R002'));
});

test('BGM は繰り返して長さに合わせ、ナレーションの間は小さくする', async () => {
  const { bgmTrack, RATE } = await import('../src/video/sfx.ts');
  const song = new Float32Array(RATE / 2).fill(1);
  const t = bgmTrack(song, 6, [[2, 3]], { volume: 0.2, duck: 0.3 });
  assert.equal(t.length, 6 * RATE);
  assert.ok(Math.abs(t[Math.round(1.5 * RATE)] - 0.2) < 1e-6);
  assert.ok(Math.abs(t[Math.round(2.5 * RATE)] - 0.06) < 1e-6);
  assert.equal(t[0], 0);
});

test('図の代わりに表を置いたセクションは、表を動画用に描く', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-table-')), 'a.md');
  const s = scenesOf('# 題名\n\n導入です。\n\n## 比べる\n\n主張です。\n\n| 項目 | 値 |\n|---|---|\n| <b>速さ</b> | 速い |\n\n説明です。\n', file);
  assert.match(s[1].tableHtml!, /<table>[\s\S]*速い/);
  assert.doesNotMatch(s[1].tableHtml!, /<b>/);
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
  const opts = (o: Partial<SceneOptions> = {}) => ({ bird: 'on', scenery: 'on', subtitles: 'on', claim: 'on', transition: 'pan', hold: 0, ...o }) as const;
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
  const tone = (sec: number) => Float32Array.from({ length: rate * sec }, (_, i) => 0.3 * Math.sin(i / 5));
  const silence = (sec: number) => new Float32Array(rate * sec);
  const samples = Float32Array.from([...silence(0.2), ...tone(1), ...silence(0.4), ...tone(1.5), ...silence(0.2)]);
  const t = lineTimes(samples, rate, [{ text: 'あ' }, { text: 'い' }]);
  assert.ok(Math.abs(t[0].start - 0.2) < 0.03 && Math.abs(t[1].end - 3.1) < 0.03);
  assert.ok(Math.abs(t[0].end - 1.4) < 0.05, `切れ目 ${t[0].end}`);
});

test('名前の付いた効果音と ZzFX の数値から音を作り、鳴りすぎを間引く', async () => {
  for (const k of [...Object.keys(PRESETS), 'pop']) {
    const s = await synth(k);
    assert.ok(s.length > 100 && s.every(Number.isFinite), k);
  }
  // ばらつきのある ZzFX の音も、種が同じなら同じ音になる。
  const p = [1, 0.5, 440, 0, 0.1, 0.1];
  assert.deepEqual(await synthParams(p, 3), await synthParams(p, 3));
  assert.match(checkParams([1, 'x'])!, /x/);
  assert.equal(checkParams([1, null, 440]), null);
  const many = Array.from({ length: 10 }, (_, i) => ({ t: i * 0.1, kind: 'pop' }));
  assert.equal(thin(many).length, 4);
  assert.ok(Math.max(...mix(1, [{ at: 0, samples: new Float32Array(100).fill(0.8) }, { at: 0, samples: new Float32Array(100).fill(0.8) }]).map(Math.abs)) <= 0.991);
});

// Playwright と Chromium がある環境でだけ動かす。
// playwright は使う人だけが入れるので、名前を文字列にして、型の検査で探さないようにする。
const hasBrowser = await import('playwright' as string).then(() => true, () => false);
test('無限ループと例外のシーンは、自動の動きに差し替える', { skip: !hasBrowser && 'Playwright がありません', timeout: 120000 }, async () => {
  const { frames } = await import('../src/video/encode.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-video-'));
  const file = path.join(dir, 'bad.md');
  const section = (title: string, html: string) => `## ${title}\n\n${title}のシーンです。\n\n\`\`\`yaml figure\ntype: flow\nsteps:\n  - label: 入口\n  - label: 出口\n\`\`\`\n\n説明です。\n\n\`\`\`html motion\n${html}\n\`\`\`\n`;
  fs.writeFileSync(file, `# 確認\n\n確認の原稿です。\n\n${section('止まる', '<script>zk.scene((t) => { if (t > 1) for (;;) {} });</script>')}\n${section('例外', '<script>missing();</script>')}\n${section('正常', '<div style="position:absolute;left:100px;top:300px;font-size:60px;color:#fff;animation:a 1s both">正常</div><style>@keyframes a{from{opacity:0}}</style>')}\n${section('音とタイマー', '<script>zk.sound(() => { throw new Error("bad sound"); }); setTimeout(() => { throw new Error("bad timer"); }, 500);</script>')}\n${section('構文エラー', '<script>let = ;</script>')}
${section('非同期の例外', '<script>zk.scene((t) => { if (t > 1) queueMicrotask(() => { throw new Error("async bad"); }); });</script>')}`);
  const r = await frames(file, { project: dir });
  const rules = (i: number) => r.results[i].findings.map((f) => f.rule);
  assert.ok(rules(1).includes('V001') && rules(1).includes('V000'));
  assert.ok(rules(2).includes('V002') && rules(2).includes('V000'));
  assert.deepEqual(rules(3), []);
  // 音とタイマーの例外は、検査を止めずに warn として記録し、シーンはそのまま使う。
  const soundAndTimer = r.results[4].findings.filter((f) => f.rule === 'V002');
  assert.ok(soundAndTimer.some((f) => /bad sound/.test(f.message)) && soundAndTimer.some((f) => /bad timer/.test(f.message)));
  assert.ok(soundAndTimer.every((f) => f.severity === 'warn'));
  // 構文エラーのスクリプトは包んだ関数ごと読めないので、ページのエラーとして捕まえて差し替える。
  assert.ok(rules(5).includes('V002') && rules(5).includes('V000'));
  // コマを進めている間に、捕まえられない例外（microtask の中など）が起きたシーンも差し替える。
  assert.ok(r.results[6].findings.some((f) => f.rule === 'V002' && f.severity === 'error' && /async bad/.test(f.message)));
  assert.deepEqual(r.scenes.map((s) => s.kind), ['title', 'auto', 'auto', 'free', 'free', 'auto', 'auto']);
});
