// node --test tests/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, projectOf, setValue, unsetValue, coerce, settingsFor, filesOf } from '../src/config.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `zukai-${name}-`));

// HOME を一時的なフォルダに替えて動かす。~/.zukai の設定とキーを、本物から切り離すため。
function withHome(fn) {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  const home = tmp('home');
  Object.assign(process.env, { HOME: home, USERPROFILE: home });
  delete process.env.GEMINI_API_KEY;
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  };
  let r;
  try {
    r = fn(home);
  } catch (e) {
    restore();
    throw e;
  }
  // 非同期の関数は、終わってから戻す。
  if (r?.then) return r.finally(restore);
  restore();
  return r;
}
const run = (args, { cwd, home, input } = {}) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, GEMINI_API_KEY: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('プロジェクトの根は、zukai.config.json か .zukai/ のあるフォルダ、なければ Git の根', () => {
  const repo = tmp('root');
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, 'a', 'b'), { recursive: true });
  assert.equal(projectOf(path.join(repo, 'a', 'b')), repo);
  fs.writeFileSync(path.join(repo, 'a', 'zukai.config.json'), '{}');
  assert.equal(projectOf(path.join(repo, 'a', 'b')), path.join(repo, 'a'));
});

test('既定値、この PC、チーム、手元、本人だけ、環境変数の順に重ね、出どころを記録する', () =>
  withHome((home) => {
    const project = tmp('layers');
    fs.mkdirSync(path.join(home, '.zukai'));
    fs.writeFileSync(path.join(home, '.zukai', 'config.json'), JSON.stringify({ output: 'video', video: { voice: 'Leda', style: 'PC の語り口' } }));
    fs.writeFileSync(path.join(project, 'zukai.config.json'), JSON.stringify({ video: { voice: 'Puck' }, repos: { api: { path: 'repos/api', host: 'github' } } }));
    fs.mkdirSync(path.join(project, '.zukai'));
    fs.writeFileSync(path.join(project, '.zukai', 'config.json'), JSON.stringify({ output: 'document', repos: { api: { path: '../clone' } } }));
    let cfg = loadConfig(project);
    assert.deepEqual(cfg.problems, []);
    assert.deepEqual([cfg.values.output, cfg.origins.output], ['document', 'local']);
    assert.deepEqual([cfg.values['video.voice'], cfg.origins['video.voice']], ['Puck', 'team']);
    assert.deepEqual([cfg.values['video.style'], cfg.origins['video.style']], ['PC の語り口', 'user']);
    assert.deepEqual([cfg.values['video.model'], cfg.origins['video.model']], ['gemini-3.8-flash-tts', 'default']);
    // 手元の設定は、チームの repos の path だけを上書きする。パスはプロジェクトの根から解決する。
    assert.deepEqual(cfg.settings.repos.api, { path: path.resolve(project, '../clone'), host: 'github' });
    process.env.GEMINI_API_KEY = 'env-key';
    cfg = loadConfig(project);
    assert.deepEqual([cfg.settings.gemini.apiKey, cfg.origins['gemini.apiKey']], ['env-key', 'env']);
  }));

test('秘密の値、知らない項目、型の誤りは、設定の誤りとして止める', () =>
  withHome(() => {
    const project = tmp('problems');
    fs.writeFileSync(path.join(project, 'zukai.config.json'), JSON.stringify({ gemini: { apiKey: 'leak' }, outptu: 'video', video: { bgmVolume: 3 }, png: { font: 'X' } }));
    const msgs = loadConfig(project).problems.map((p) => p.message);
    assert.equal(msgs.length, 4);
    assert.match(msgs.find((m) => m.includes('gemini.apiKey')), /秘密の値/);
    assert.match(msgs.find((m) => m.includes('outptu')), /「output」の書き間違い/);
    assert.match(msgs.find((m) => m.includes('bgmVolume')), /0〜1/);
    assert.match(msgs.find((m) => m.includes('png.font')), /「この PC」の設定にだけ/);
    assert.equal(loadConfig(project).values['gemini.apiKey'], null);
    assert.throws(() => settingsFor(project), /設定に誤りがあります/);
  }));

test('config set は変えた値だけを書き、unset は今効いている場所から消す', () =>
  withHome(() => {
    const project = tmp('set');
    const files = filesOf(project);
    setValue(project, 'output', coerce('output', 'video', 'team', project));
    assert.deepEqual(JSON.parse(fs.readFileSync(files.team, 'utf8')), { output: 'video' });
    setValue(project, 'output', 'document', 'local');
    assert.equal(fs.readFileSync(path.join(project, '.zukai', '.gitignore'), 'utf8'), '*\n');
    assert.equal(loadConfig(project).values.output, 'document');
    assert.equal(unsetValue(project, 'output').scope, 'local');
    assert.equal(loadConfig(project).values.output, 'video');
    assert.equal(unsetValue(project, 'video.voice'), null);
    assert.throws(() => coerce('video.bgmVolume', '2', 'team', project), /0〜1/);
    assert.throws(() => setValue(project, 'gemini.apiKey', 'x', 'team'), /本人だけ/);
    // 秘密の値は、本人だけが読める権限で書く。
    setValue(project, 'gemini.apiKey', 'k', 'credentials');
    if (process.platform !== 'win32') assert.equal(fs.statSync(files.credentials).mode & 0o777, 0o600);
  }));

test('help はコマンドごとの使い方を出し、書き間違いには候補を示す', () => {
  const home = tmp('help');
  assert.equal(run(['--help'], { home }).code, 0);
  const lint = run(['lint', '--help'], { home });
  assert.equal(lint.code, 0);
  assert.match(lint.out, /--no-textlint/);
  assert.match(run(['lnt'], { home }).err, /「lint」の書き間違い/);
  assert.match(run(['lint', '--jsn', 'a.md'], { home }).err, /--json の書き間違い/);
  assert.match(run(['build', '--out', 'a.md'], { home }).err, /--out=パス の形/);
  assert.match(run(['help', 'config', 'video.voise'], { home }).err, /「video.voice」の書き間違い/);
});

test('setup --yes は質問せずに、チームの設定とスキルを書き、もう一度実行しても変えない', () => {
  const home = tmp('setup-home');
  const project = tmp('setup');
  fs.mkdirSync(path.join(project, '.git'));
  const first = run(['setup', '--output=video', '--voice=Puck', '--yes'], { cwd: project, home });
  assert.equal(first.code, 0, first.err);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'zukai.config.json'), 'utf8')), { output: 'video', video: { voice: 'Puck' } });
  for (const d of ['.claude/skills', '.agents/skills']) assert.match(fs.readFileSync(path.join(project, d, 'zukai-answer/SKILL.md'), 'utf8'), /prompt --type-command/);
  const again = run(['setup', '--yes'], { cwd: project, home });
  assert.match(again.out, /変更はありません/);
  // 端末でないときにキーを流し込むと、本人だけの設定に保存する。
  assert.equal(run(['login', 'gemini'], { cwd: project, home, input: 'k1\n' }).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.zukai', 'credentials.json'), 'utf8')).gemini.apiKey, 'k1');
  const list = run(['config', 'list', '--json'], { cwd: project, home });
  assert.equal(JSON.parse(list.out).values['gemini.apiKey'].value, '********');
});

test('null は既定値が「なし」の項目にだけ書け、__proto__ などの名前は受け付けない', () =>
  withHome((home) => {
    const project = tmp('null');
    fs.mkdirSync(path.join(home, '.zukai'));
    fs.writeFileSync(path.join(home, '.zukai', 'config.json'), JSON.stringify({ output: 'video', video: { bgm: '/music/a.mp3' } }));
    fs.writeFileSync(path.join(project, 'zukai.config.json'), JSON.stringify({ output: null, video: { bgm: null } }));
    const cfg = loadConfig(project);
    assert.match(cfg.problems.find((p) => p.key === 'output')?.message ?? '', /null は書けません/);
    assert.equal(cfg.values.output, 'video');
    // BGM は既定値が「なし」なので、チームの null で PC の曲を消せる。
    assert.deepEqual([cfg.values['video.bgm'], cfg.origins['video.bgm']], [null, 'team']);
    fs.writeFileSync(path.join(project, 'zukai.config.json'), '{"repos":{"__proto__":{"link":"https://evil/{path}"}}}');
    assert.match(loadConfig(project).problems[0].message, /はありません/);
    assert.equal({}.link, undefined);
    assert.throws(() => setValue(project, 'repos.__proto__.link', 'x'), /はありません/);
    // オブジェクトが元から持つ名前を一番上に書いても、落ちずに「項目はありません」と知らせる。
    fs.writeFileSync(path.join(project, 'zukai.config.json'), '{"toString":{},"__proto__":{},"constructor":1}');
    assert.equal(loadConfig(project).problems.filter((p) => /はありません/.test(p.message)).length, 3);
    assert.equal({}.link, undefined);
  }));

test('setup は、手元の設定で同じ値になっていても、--scope=team ならチームの値を変える', () => {
  const home = tmp('scope-home');
  const project = tmp('scope');
  fs.writeFileSync(path.join(project, 'zukai.config.json'), JSON.stringify({ output: 'document' }));
  fs.mkdirSync(path.join(project, '.zukai'));
  fs.writeFileSync(path.join(project, '.zukai', 'config.json'), JSON.stringify({ output: 'video' }));
  const r = run(['setup', 'output', '--output=video', '--scope=team', '--yes'], { cwd: project, home });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'zukai.config.json'), 'utf8')).output, 'video');
  // 既定値がある項目を空にすると、書かずに止める。
  const empty = run(['setup', 'output', '--output=', '--yes'], { cwd: project, home });
  assert.equal(empty.code, 1);
  assert.match(empty.err, /--output を空にはできません/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'zukai.config.json'), 'utf8')).output, 'video');
  assert.throws(() => setValue(project, 'output', null), /null は書けません/);
});

test('publish は、設定の URL からページの URL を組み立てる', () =>
  withHome(async () => {
    const project = tmp('publish');
    fs.writeFileSync(path.join(project, 'zukai.config.json'), JSON.stringify({ confluence: { base: 'https://ex.atlassian.net/wiki/', spaceId: '1' } }));
    setValue(project, 'confluence.email', 'a@b.c', 'credentials');
    setValue(project, 'confluence.token', 't', 'credentials');
    const file = path.join(project, 'a.md');
    fs.writeFileSync(file, '# 題名\n\n導入です。\n');
    const saved = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ id: '42' }), { status: 200 });
    try {
      const { publish } = await import('../src/confluence.js');
      const r = await publish(file);
      assert.equal(r.url, 'https://ex.atlassian.net/wiki/pages/viewpage.action?pageId=42');
    } finally {
      globalThis.fetch = saved;
    }
  }));

test('doctor は、依存パッケージが求める Node の版を確かめる', async () => {
  const { satisfies } = await import('../src/doctor.js');
  const range = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines.node;
  assert.deepEqual(['20.18.0', '20.19.0', '21.0.0', '22.12.0', '22.13.0', '23.4.0', '24.1.0'].map((v) => satisfies(v, range)), [false, true, false, false, true, false, true]);
});

test('URL は接続先のホスト名まで検査し、setup の同じ設定のコマンドは選んだセクションを残す', async () => {
  const { invalid, specOf } = await import('../src/config.js');
  const url = specOf('confluence.base');
  assert.ok(invalid(url, 'https://'));
  assert.ok(invalid(url, 'ftp://example.com'));
  assert.equal(invalid(url, 'https://ex.atlassian.net/wiki'), null);
  const { equivalent } = await import('../src/setup.js');
  const answers = { skills: null, values: {}, credentials: {} };
  const project = process.cwd();
  assert.match(equivalent(project, answers, [], 'team', new Set(['output', 'video', 'confluence'])), /^zukai setup output video confluence /);
  assert.doesNotMatch(equivalent(project, answers, [], 'team', new Set(['skills', 'output', 'confluence'])), /setup (skills|output)/);
});
