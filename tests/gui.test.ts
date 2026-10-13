// node --test tests/gui.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// 本人だけの設定（~/.zukai）を、テストの中のフォルダに向ける。
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-gui-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { serve } = await import('../src/gui.ts');

const MANUSCRIPT = '# 手順\n\n## 流れ\n\n流れを示します。\n\n```yaml figure\ntype: flow\nsteps:\n  - label: 受付\n  - label: 処理\n```\n';

async function start() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-gui-'));
  fs.mkdirSync(path.join(project, '.git'));
  const server = await serve(project, 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await (await fetch(`${base}/`)).text();
  const token = page.match(/name="zukai-token" content="([0-9a-f]+)"/)![1];
  const api = async (method: string, url: string, body?: object) => {
    const res = await fetch(base + url, { method, headers: { 'x-zukai-token': token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  return { project, server, base, page, token, api };
}

test('画面の API は合言葉のある要求だけに答え、ほかのホスト名とサイトからの要求を断る', async () => {
  const { project, server, base, page, api } = await start();
  try {
    // ページのスクリプトは nonce の付いたものだけを動かし、ほかのサイトの枠に入れさせない。
    const res = await fetch(`${base}/`);
    const csp = res.headers.get('content-security-policy')!;
    assert.match(csp, /script-src 'nonce-[^']+'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(page, /<script nonce="/);
    assert.equal((await fetch(`${base}/api/docs`)).status, 403);
    assert.equal((await fetch(`${base}/api/docs`, { headers: { 'x-zukai-token': 'x' } })).status, 403);
    assert.equal((await api('GET', '/api/docs')).status, 200);
    // 合言葉があっても、別のサイトの Origin からは断る。
    const cross = await fetch(`${base}/api/docs`, { headers: { 'x-zukai-token': page.match(/content="([0-9a-f]{64})"/)![1], origin: 'https://evil.example' } });
    assert.equal(cross.status, 403);
    const status = await new Promise((ok, ng) => http.get(`${base}/`, { headers: { host: 'evil.example' } }, (r) => ok(r.resume().statusCode)).on('error', ng));
    assert.equal(status, 403);
  } finally {
    server.close();
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('AI の返答とプロジェクトの原稿を一覧にし、一覧にない原稿は読ませない', async () => {
  const { project, server, base, api } = await start();
  try {
    fs.writeFileSync(path.join(project, '.zukai/answers/a.md'), '# 返答\n\n本文です。\n');
    fs.mkdirSync(path.join(project, 'docs'));
    fs.writeFileSync(path.join(project, 'docs/design.md'), MANUSCRIPT);
    // ~~~ の囲みの図も、原稿として見つける。
    fs.writeFileSync(path.join(project, 'docs/tilde.md'), MANUSCRIPT.replaceAll('```', '~~~'));
    // 図の無い Markdown と、node_modules の中は一覧に入れない。
    fs.writeFileSync(path.join(project, 'README.md'), '# 説明\n');
    fs.mkdirSync(path.join(project, 'node_modules/x'), { recursive: true });
    fs.writeFileSync(path.join(project, 'node_modules/x/doc.md'), MANUSCRIPT);

    const { data: docs } = await api('GET', '/api/docs');
    assert.deepEqual(docs.map((d: { path: string; answer: boolean }) => [d.path, d.answer]).sort(), [['.zukai/answers/a.md', true], ['docs/design.md', false], ['docs/tilde.md', false]]);

    const doc = await fetch(`${base}/doc?path=docs%2Fdesign.md`);
    assert.match(doc.headers.get('content-security-policy')!, /default-src 'none'.*frame-ancestors 'self'/);
    assert.match(await doc.text(), /<svg/);
    assert.equal((await fetch(`${base}/doc?path=README.md`)).status, 404);
    assert.equal((await fetch(`${base}/doc?path=..%2F..%2Fetc%2Fpasswd`)).status, 404);
    assert.equal((await api('GET', '/api/source?path=README.md')).status, 404);
    assert.match((await api('GET', '/api/source?path=docs%2Fdesign.md')).data.source, /type: flow/);

    // HTML と Confluence 用のフォルダを、原稿の隣に書き出す。
    assert.equal((await api('POST', '/api/build', { path: 'docs/design.md' })).data.out, path.join('docs', 'design.html'));
    assert.ok(fs.readFileSync(path.join(project, 'docs/design.html'), 'utf8').includes('zukai-source'));
    const c = await api('POST', '/api/build', { path: 'docs/design.md', format: 'confluence' });
    assert.equal(c.data.figures, 1);
    assert.ok(fs.existsSync(path.join(project, 'docs/design.confluence/body.xhtml')));
  } finally {
    server.close();
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('設定を書き、消す。秘密の値は画面に返さない', async () => {
  const { project, server, api } = await start();
  try {
    let r = await api('POST', '/api/config', { key: 'output', value: 'video', scope: 'local' });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, '.zukai/config.json'), 'utf8')).output, 'video');
    // 値の誤りと、書けない置き場所は断る。
    assert.equal((await api('POST', '/api/config', { key: 'output', value: 'movie' })).status, 400);
    assert.equal((await api('POST', '/api/config', { key: 'lang', value: 'en', scope: 'team' })).status, 400);
    assert.equal((await api('POST', '/api/config', { key: 'nope', value: 'x' })).status, 400);
    // パスは、プロジェクトの根からの相対パスで書く。
    await api('POST', '/api/config', { key: 'theme', value: 'zukai-theme', scope: 'team' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'zukai.config.json'), 'utf8')).theme, 'zukai-theme');

    await api('POST', '/api/config', { key: 'confluence.token', value: 'secret-token', scope: 'credentials' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.zukai/credentials.json'), 'utf8')).confluence.token, 'secret-token');
    const cfg = (await api('GET', '/api/config')).data;
    const token = cfg.items.find((i: { key: string }) => i.key === 'confluence.token');
    assert.deepEqual([token.value, token.isSet, token.origin], [null, true, 'credentials']);
    assert.ok(!JSON.stringify(cfg).includes('secret-token'));
    assert.equal(cfg.items.find((i: { key: string }) => i.key === 'output').value, 'video');
    // この PC の設定のパスは ~/.zukai から解決するので、画面には絶対パスで出す。そのまま保存しても場所が変わらない。
    fs.writeFileSync(path.join(home, '.zukai/config.json'), JSON.stringify({ chromium: 'bin/chrome' }));
    const chromium = (await api('GET', '/api/config')).data.items.find((i: { key: string }) => i.key === 'chromium');
    assert.equal(chromium.value, path.join(home, '.zukai/bin/chrome'));
    await api('POST', '/api/config', { key: 'chromium', value: chromium.value, scope: 'user' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.zukai/config.json'), 'utf8')).chromium, path.join(home, '.zukai/bin/chrome'));

    r = await api('POST', '/api/config/unset', { key: 'output', scope: 'local' });
    assert.equal(r.data.removed.scope, 'local');
    assert.equal((await api('GET', '/api/config')).data.items.find((i: { key: string }) => i.key === 'output').origin, 'default');
  } finally {
    server.close();
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(path.join(home, '.zukai'), { recursive: true, force: true });
  }
});

test('テーマのフォルダはプロジェクトの中にだけ作る', async () => {
  const { project, server, base, api } = await start();
  try {
    assert.equal((await api('POST', '/api/theme/init', { dir: '../outside' })).status, 400);
    // プロジェクトの中のシンボリックリンクから、外に作らせない。Windows で作る権限がなければ確かめない。
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-gui-out-'));
    try {
      fs.symlinkSync(outside, path.join(project, 'linked'));
    } catch {}
    if (fs.existsSync(path.join(project, 'linked'))) {
      assert.equal((await api('POST', '/api/theme/init', { dir: 'linked/theme' })).status, 400);
      assert.deepEqual(fs.readdirSync(outside), []);
    }
    fs.rmSync(outside, { recursive: true, force: true });
    assert.ok(!fs.existsSync(path.join(project, '../outside')));
    const r = await api('POST', '/api/theme/init', { dir: 'my-theme' });
    assert.equal(r.data.written.length, 2);
    await api('POST', '/api/config', { key: 'theme', value: 'my-theme', scope: 'team' });
    const t = (await api('GET', '/api/theme')).data;
    assert.equal(t.dir, 'my-theme');
    assert.equal(t.ok, true);
    assert.equal((await fetch(`${base}/theme/compare?v=emphasis.box%3Dtint&types=flow`)).status, 200);
  } finally {
    server.close();
    fs.rmSync(project, { recursive: true, force: true });
  }
});
