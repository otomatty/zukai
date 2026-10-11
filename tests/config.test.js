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
  try {
    return fn(home);
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
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
