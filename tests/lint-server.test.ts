// node --test tests/lint-server.test.ts
// 常駐する検査のプロセス（src/lint/server.ts）を通しても、このプロセスだけで検査したときと同じ結果と終了コードになることを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    const { lintOnServer, socketPath } = await import('../src/lint/server.ts');
    // Node が起動するときにだけ読む環境変数が違えば、別の接続先（別のプロセス）にする。
    const plain = socketPath();
    const ca = process.env.NODE_EXTRA_CA_CERTS;
    process.env.NODE_EXTRA_CA_CERTS = path.join(home, 'ca.pem');
    assert.notEqual(socketPath(), plain);
    if (ca === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = ca;
    assert.equal(socketPath(), plain);
    // 常駐するプロセスが答えることは、Node のフラグを付けない子のプロセスで確かめる（node --test の中では、テストのためのフラグが付き、接続先が変わるため）。
    // Node のフラグが違えば、別の接続先にする。
    const probe = path.join(home, 'probe.mjs');
    fs.writeFileSync(probe, `const m = await import(${JSON.stringify(pathToFileURL(path.join(root, 'src/lint/server.ts')).href)});\nconst file = process.argv[2];\nconsole.log(JSON.stringify({ sock: m.socketPath(), result: file ? await m.lintOnServer((await import('node:fs')).readFileSync(file, 'utf8'), file, { textlint: false }) : null }));\n`);
    const runProbe = (...args: string[]) => JSON.parse(spawnSync(process.execPath, [...args], { cwd: root, env, encoding: 'utf8' }).stdout);
    const direct = runProbe(probe, path.join(root, 'corpus/bad/prose.md'));
    assert.ok(direct.result?.findings.some((f: { rule: string }) => f.rule === 'P001'));
    assert.notEqual(runProbe('--stack-trace-limit=50', probe).sock, direct.sock);
    const saved = process.env.HOME;
    process.env.HOME = home;
    try {
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
    // 検査が起動する git も、呼んだ側の環境変数で動かす。GIT_DIR が読めない場所を指すと、どちらもコードの根拠を R002 にする。
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-server-refs-'));
    const gitIn = (...args: string[]) => spawnSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' });
    fs.writeFileSync(path.join(project, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(project, 'zukai.config.json'), JSON.stringify({ repos: { app: { path: '.', host: 'github', org: 'o', name: 'n' } } }));
    fs.writeFileSync(path.join(project, 'doc.md'), '# 題名\n\n導入です。\n\n## 節\n\n主張です。\n\n```yaml refs\n- code: app:a.ts#L1-L1\n  note: 値を決める処理です。\n```\n');
    gitIn('init', '-q');
    gitIn('add', 'a.ts');
    gitIn('commit', '-q', '-m', 'a');
    const refs = (...flags: string[]) => spawnSync(process.execPath, [cli, 'lint', 'doc.md', '--json', '--no-log', '--no-textlint', ...flags], { cwd: project, env: { ...env, GIT_DIR: path.join(project, 'missing') }, encoding: 'utf8' });
    const refsLocal = refs('--no-server');
    assert.match(refsLocal.stdout, /R002/);
    assert.equal(refs().stdout, refsLocal.stdout);
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
