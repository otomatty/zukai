// node --test tests/lint-server.test.ts
// 常駐する検査のプロセス（src/lint/server.ts）を通しても、このプロセスだけで検査したときと同じ結果と終了コードになることを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'src/cli.ts');

test('常駐するプロセスで検査しても、結果と終了コードは同じ', { skip: process.platform === 'win32' && 'ソケットのファイルで確かめるため', timeout: 120000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-server-home-'));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, GEMINI_API_KEY: '' };
  delete env.ZUKAI_LINT_SERVER;
  // 常駐するプロセスは、起動した側の環境変数を受け継ぐ。あとの依頼で設定されていない変数は、受け継いだ値ではなく、設定されていないものとして検査する。
  const server = spawn(process.execPath, [path.join(root, 'src/lint/server.ts')], { cwd: root, env: { ...env, CONFLUENCE_BASE: 'notaurl' }, stdio: 'ignore' });
  try {
    // 待ち受けを始めると、~/.zukai/run にソケットのファイルができる。合言葉のファイルは、本人だけが読める。
    const run = path.join(home, '.zukai', 'run');
    const socks = () => (fs.existsSync(run) ? fs.readdirSync(run).filter((f) => f.endsWith('.sock')) : []);
    for (let i = 0; i < 600 && !socks().length; i++) await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(socks().length, 1);
    assert.equal(fs.statSync(path.join(run, 'secret')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(run).mode & 0o777, 0o700);
    // 同じ接続先で2つ目が起動されても、待ち受けられずに終わる。
    const second = spawn(process.execPath, [path.join(root, 'src/lint/server.ts')], { cwd: root, env, stdio: 'ignore' });
    assert.equal(await new Promise((ok) => second.once('exit', ok)), 0);
    // 合言葉の違う依頼は、検査せずに断る。
    const reply = await new Promise<string>((ok) => {
      let buf = '';
      const conn = net.connect(path.join(run, socks()[0]), () => conn.write(`${JSON.stringify({ secret: 'x'.repeat(64), source: '# a\n', file: 'a.md', textlint: false, cwd: root, env: {} })}\n`));
      conn.setEncoding('utf8').on('data', (d: string) => (buf += d)).on('close', () => ok(buf));
    });
    assert.deepEqual(JSON.parse(reply), { denied: true });
    // 常駐するプロセスが答えること。使えないときは null が返り、呼んだ側が自分で検査する。
    const { lintOnServer } = await import('../src/lint/server.ts');
    const saved = process.env.HOME;
    process.env.HOME = home;
    try {
      const direct = await lintOnServer(fs.readFileSync(path.join(root, 'corpus/bad/prose.md'), 'utf8'), path.join(root, 'corpus/bad/prose.md'), { textlint: false });
      assert.ok(direct?.findings.some((f) => f.rule === 'P001'));
      // ほかの利用者も入れる置き場所なら、偽のソケットかもしれないので使わない。呼んだ側が自分で検査する。
      fs.chmodSync(run, 0o755);
      assert.equal(await lintOnServer('# a\n', path.join(root, 'a.md'), { textlint: false }), null);
      fs.chmodSync(run, 0o700);
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
    // 止められたときは、ソケットのファイルを消して終わる。
    server.kill('SIGTERM');
    await new Promise((ok) => server.once('exit', ok));
    assert.deepEqual(socks(), []);
  } finally {
    server.kill();
  }
});
