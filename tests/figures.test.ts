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
    assert.ok(r.findings.some((f) => f.rule === 'F001' && f.message.includes('groups は配列で書きます')), groups);
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

test('treemap は、別のグループにある同じ名前の項目も、それぞれの枠で収まりを確かめる', async () => {
  const { default: treemap } = await import('../src/figures/treemap.ts');
  const { baseTokens } = await import('../src/theme.ts');
  const groups = (small: number) => [
    { label: '認証サービス', items: [{ label: '実行環境', value: 60 }, { label: 'データベース', value: 30 }] },
    { label: '管理画面', items: [{ label: '配信', value: 30 }, { label: '実行環境', value: small }] },
  ];
  // 2つ目のグループの「実行環境」だけが小さい。1つ目の大きな枠と取り違えると、見逃す。
  assert.equal(treemap.fit({ type: 'treemap', unit: '万円', groups: groups(0.5) }, baseTokens()).length, 1);
  assert.deepEqual(treemap.fit({ type: 'treemap', unit: '万円', groups: groups(20) }, baseTokens()), []);
});

test('bar、stack、line は、同じ名前の項目や系列を F001 で知らせる', async () => {
  const file = path.join(project(), 'a.md');
  const cases = [
    ['bar', 'type: bar\nunit: 件\nitems:\n  - label: 東京\n    value: 3\n  - label: 東京\n    value: 5', 'items'],
    ['stack', 'type: stack\nunit: 件\nitems:\n  - label: 東京\n    value: 3\n  - label: 東京\n    value: 5', 'items'],
    ['line', 'type: line\nunit: 件\nx: [1月, 2月]\nseries:\n  - label: 東京\n    values: [1, 2]\n  - label: 東京\n    values: [3, 4]', 'series'],
  ];
  for (const [name, figure, where] of cases) {
    const r = await lint(doc(figure), file, { textlint: false });
    assert.ok(r.findings.some((f) => f.rule === 'F001' && f.message.includes(`${where} の label「東京」が2回あります`)), name);
    // 名前を変えれば通る。
    const ok = await lint(doc(figure.replace(/東京([^]*)東京/, '東京$1大阪')), file, { textlint: false });
    assert.deepEqual(ok.findings.filter((f) => f.rule.startsWith('F')), [], name);
  }
});

test('capture は、screenshot に image が無いと、撮る前に行の番号を添えて知らせる', async () => {
  const { capture } = await import('../src/capture.ts');
  const dir = project();
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, doc('type: screenshot\nurl: https://example.com/'));
  await assert.rejects(capture(file), /L\d+ の screenshot には image（PNG 画像のパス）が必要です/);
  fs.writeFileSync(file, doc('type: screenshot\nurl: 5\nimage: shots/a.png'));
  await assert.rejects(capture(file), /L\d+ の screenshot の url は、文字で書いてください/);
});

test('読めない SVG の自由図は、例外ではなく F001 で知らせる', async () => {
  const file = path.join(project(), 'a.md');
  const source = '# 題名\n\n導入です。\n\n## 節\n\n主張です。\n\n```svg figure\n<svg><title>例</title>\n```\n\n説明です。\n';
  const r = await lint(source, file, { textlint: false });
  assert.ok(r.findings.some((f) => f.rule === 'F001' && f.message.startsWith('SVG を読めません。')));
  assert.deepEqual(r.free, []);
});

test('任意の項目に null を書くと、書かなかったのと同じに検査し、同じ図を描く', async () => {
  const file = path.join(project(), 'a.md');
  const cases: [string, string][] = [
    ['type: flow\nsteps:\n  - label: 受付\n    ref: null\n  - label: 発送', 'type: flow\nsteps:\n  - label: 受付\n  - label: 発送'],
    ['type: progress\nunit: "%"\nmax: 100\ntarget: null\nitems:\n  - label: 受付\n    value: 91', 'type: progress\nunit: "%"\nmax: 100\nitems:\n  - label: 受付\n    value: 91'],
    ['type: zones\nzones:\n  - nodes: [ブラウザ]\n  - nodes: [サーバー]\nlinks:\n  - [ブラウザ, サーバー, null]', 'type: zones\nzones:\n  - nodes: [ブラウザ]\n  - nodes: [サーバー]\nlinks:\n  - [ブラウザ, サーバー]'],
  ];
  for (const [withNull, without] of cases) {
    const findings = (await lint(doc(withNull), file, { textlint: false })).findings.filter((f) => f.rule.startsWith('F'));
    assert.deepEqual(findings, [], withNull);
    // 資料には原稿も埋め込まれるので、図の部分だけを比べる。ECharts が描くたびに変わる番号（zr0-cls-1 など）は、出てきた順に振り直す。
    const figures = async (source: string) => {
      const ids = new Map<string, number>();
      const html = (await render(doc(source), file)).replace(/zr\d+-cls-\d+/g, (id) => `cls-${ids.get(id) ?? ids.set(id, ids.size).get(id)}`);
      return html.match(/<figure[\s\S]*?<\/figure>/g);
    };
    assert.deepEqual(await figures(withNull), await figures(without), withNull);
  }
});

test('項目の説明は、いくつかの形のうちのまとまりと、配列の中の配列の中身もたどる', async () => {
  const { describe } = await import('../src/figures/schema.ts');
  const lines = describe({
    nodes: { type: 'list', required: true, desc: '要素', of: { type: 'oneOf', options: [{ type: 'string' }, { type: 'object', fields: { label: { type: 'string', required: true, desc: '名前' } } }] } },
    rows: { type: 'list', desc: '段', of: { type: 'list', min: 1, max: 3, desc: '1段の箱', of: { type: 'string' } } },
    cells: { type: 'list', desc: '行', of: { type: 'list', of: { type: 'number' } } },
  });
  assert.deepEqual(lines, ['nodes: 要素（必須）', 'nodes[].label: 名前（必須）', 'rows: 段（任意）', 'rows[]: 1段の箱（1〜3個）', 'cells: 行（任意）']);
});
