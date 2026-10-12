// node --test tests/lint-server.test.ts
// 常駐する検査のプロセス（src/lint/server.ts）を通しても、このプロセスだけで検査したときと同じ結果と終了コードになることを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'src/cli.ts');

test('常駐するプロセスで検査しても、結果と終了コードは同じ', { skip: process.platform === 'win32' && 'ソケットのファイルで確かめるため', timeout: 120000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-server-home-'));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, GEMINI_API_KEY: '' };
  delete env.ZUKAI_LINT_SERVER;
  const server = spawn(process.execPath, [path.join(root, 'src/lint/server.ts')], { cwd: root, env, stdio: 'ignore' });
  try {
    // 待ち受けを始めると、~/.zukai/run にソケットのファイルができる。
    const run = path.join(home, '.zukai', 'run');
    for (let i = 0; i < 600 && !(fs.existsSync(run) && fs.readdirSync(run).length); i++) await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(fs.readdirSync(run).length, 1);
    // 常駐するプロセスが答えること。使えないときは null が返り、呼んだ側が自分で検査する。
    const { lintOnServer } = await import('../src/lint/server.ts');
    const saved = process.env.HOME;
    process.env.HOME = home;
    try {
      const direct = await lintOnServer(fs.readFileSync(path.join(root, 'corpus/bad/prose.md'), 'utf8'), path.join(root, 'corpus/bad/prose.md'), { textlint: false });
      assert.ok(direct?.findings.some((f) => f.rule === 'P001'));
    } finally {
      process.env.HOME = saved;
    }
    const lint = (file: string, ...flags: string[]) => spawnSync(process.execPath, [cli, 'lint', file, '--json', '--no-log', ...flags], { cwd: root, env, encoding: 'utf8' });
    for (const file of ['corpus/good/diagrams.md', 'corpus/bad/prose.md', 'corpus/bad/figure.md']) {
      const viaServer = lint(file);
      const local = lint(file, '--no-server');
      assert.equal(viaServer.status, local.status, file);
      assert.equal(viaServer.stdout, local.stdout, file);
    }
    // 設定の誤りは、呼んだ側の環境変数で判断し、同じ文で止める。
    const bad = spawnSync(process.execPath, [cli, 'lint', 'corpus/good/free.md', '--no-log'], { cwd: root, env: { ...env, CONFLUENCE_BASE: 'notaurl' }, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /環境変数 CONFLUENCE_BASE の値が正しくありません/);
  } finally {
    server.kill();
  }
});
