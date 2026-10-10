// node --test tests/view.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { serve } from '../src/view.js';

test('一覧と資料を返し、置き場所の外と別のホスト名には答えない', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-view-'));
  const server = await serve(project, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(fs.readFileSync(path.join(project, '.zukai/.gitignore'), 'utf8'), '*\n');
    fs.writeFileSync(path.join(project, '.zukai/answers/a.md'), '# 題名\n\n本文です。\n');
    fs.writeFileSync(path.join(project, 'secret.md'), '# 秘密\n');

    assert.deepEqual((await (await fetch(`${base}/list`)).json()).map((i) => [i.name, i.title]), [['a.md', '題名']]);
    const page = await fetch(`${base}/doc/a.md`);
    assert.match(await page.text(), /本文です/);
    // 原稿の中の HTML のスクリプトは動かさない。
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await fetch(`${base}/doc/..%2Fsecret.md`)).status, 404);
    // fetch は Host を書き換えられないので、http.get で送る。
    const status = await new Promise((ok, ng) => http.get(`${base}/list`, { headers: { host: 'evil.example' } }, (r) => ok(r.resume().statusCode)).on('error', ng));
    assert.equal(status, 403);

    // screenshot の画像を撮り直したら、原稿が同じでも資料の版が変わる。
    fs.writeFileSync(path.join(project, '.zukai/answers/shot.md'), '# 画面\n\n## 画面\n\n画面です。\n\n```yaml figure\ntype: screenshot\nimage: shot.png\n```\n');
    fs.writeFileSync(path.join(project, '.zukai/answers/shot.png'), '');
    const later = new Date(Date.now() + 60000);
    fs.utimesSync(path.join(project, '.zukai/answers/shot.png'), later, later);
    const shot = (await (await fetch(`${base}/list`)).json()).find((i) => i.name === 'shot.md');
    assert.equal(shot.mtime, fs.statSync(path.join(project, '.zukai/answers/shot.png')).mtimeMs);

    // シンボリックリンクは一覧に入れない。Windows で作る権限がなければ確かめない。
    try {
      fs.symlinkSync(path.join(project, 'secret.md'), path.join(project, '.zukai/answers/link.md'));
    } catch {}
    if (fs.existsSync(path.join(project, '.zukai/answers/link.md'))) {
      assert.ok(!(await (await fetch(`${base}/list`)).json()).some((i) => i.name === 'link.md'));
      assert.equal((await fetch(`${base}/doc/link.md`)).status, 404);
    }
  } finally {
    server.close();
    fs.rmSync(project, { recursive: true, force: true });
  }
});
