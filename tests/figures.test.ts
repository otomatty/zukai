// node --test tests/figures.test.ts
// 原稿の値が、オブジェクトが元から持つ名前（toString、constructor など）や想定外の形でも、例外で止まらずに検査の結果として知らせることを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lint } from '../src/lint/index.ts';
import { render } from '../src/render.ts';
import { iconExists, searchIcons } from '../src/figures/icons.ts';
import { readOptions, scenesOf } from '../src/video/script.ts';

const project = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-figures-'));
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), '{}\n');
  return dir;
};
const doc = (figure: string) => `# 題名\n\n導入です。\n\n## 節\n\n主張です。\n\n\`\`\`yaml figure\n${figure}\n\`\`\`\n\n説明です。\n`;

test('type が toString のような名前でも、使えない型として知らせ、資料には描けない図の枠を出す', async () => {
  const file = path.join(project(), 'a.md');
  for (const name of ['toString', 'constructor', '__proto__']) {
    const source = doc(`type: ${name}`);
    const r = await lint(source, file, { textlint: false });
    assert.ok(r.findings.some((f) => f.rule === 'F001' && f.message.includes(`type「${name}」は使えません`)), name);
    assert.match(await render(source, file), /この図は描画できません/);
  }
});

test('zones の groups が配列でないときは、例外ではなく F001 で知らせる', async () => {
  const file = path.join(project(), 'a.md');
  const zones = 'type: zones\nzones:\n  - label: 公開\n    nodes: [ロードバランサー]\n  - label: 非公開\n    nodes: [アプリ]\nlinks:\n  - [ロードバランサー, アプリ]';
  assert.deepEqual((await lint(doc(zones), file, { textlint: false })).findings.filter((f) => f.rule.startsWith('F')), []);
  for (const groups of ['5', 'x', '{}']) {
    const r = await lint(doc(`${zones}\ngroups: ${groups}`), file, { textlint: false });
    assert.ok(r.findings.some((f) => f.rule === 'F001' && f.message.includes('groups は、{label, from, to} の配列にしてください')), groups);
  }
});

test('アイコンの名前に、オブジェクトが元から持つ名前は当たらない', () => {
  assert.equal(iconExists('toString'), false);
  assert.equal(iconExists('constructor'), false);
  assert.ok(searchIcons('constructor').every((n) => typeof n === 'string'));
  assert.ok(searchIcons('sqs').length > 0);
});

test('動画の <zk-options> と役割の名前に、オブジェクトが元から持つ名前を書いても、警告で知らせる', () => {
  const r = readOptions('<zk-options constructor="x" toString="y" transition="cut"></zk-options><div></div>');
  assert.equal(r.options.transition, 'cut');
  assert.deepEqual(r.findings.map((f) => f.rule), ['V010', 'V010']);
  const file = path.join(project(), 'a.md');
  const source = doc('type: flow\nsteps:\n  - label: 入口\n  - label: 出口').replace('説明です。\n', '説明です。\n\n```yaml narration constructor\n- どうなるのでしょう？\n```\n');
  const scene = scenesOf(source, file).find((s) => s.role === 'constructor');
  assert.ok(scene?.findings.some((f) => f.rule === 'V017'));
  assert.equal(scene?.heading, '節（constructor）');
});
