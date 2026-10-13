import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { chromium } from 'playwright-core';
import { buildOutput } from '../src/output.ts';
import { extract, render, renderConfluence } from '../src/render.ts';
import { prepareDocument, readMarkdown } from '../src/export/document.ts';
import { wrapText } from '../src/export/pptx.ts';
import { mermaid } from '../src/export/mermaid.ts';
import screenshot from '../src/figures/screenshot.ts';
import type { Nodes } from 'mdast';

const source = `# 注文の処理\n\n図と本文を共有します。\n\n## 注文の流れ\n\n注文を受け付けて保存します。\n\n\`\`\`yaml figure\ntype: flow\nsteps:\n  - label: 受付\n    note: 内容を確認\n  - label: 保存\n\`\`\`\n\n**説明**を残します。[リンク](../guide.md#note)\n\n|項目|値|\n|---|---|\n|状態|保存済み|\n\n- 一つ目\n- 二つ目\n\n\`\`\`js\nconst example = "![触らない](missing.png)";\n\`\`\`\n\n\`\`\`yaml narration\n- 動画だけの内容です。\n\`\`\`\n\n\`\`\`html motion\n<div>動画用のHTML</div>\n\`\`\`\n`;
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-output-'));
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), '{}');
  const file = path.join(dir, 'report.md');
  fs.writeFileSync(file, source);
  return { dir, file };
}
const walk = (node: Nodes): Nodes[] => [node, ...('children' in node ? node.children.flatMap(walk) : [])];
const zipOf = (file: string) => JSZip.loadAsync(fs.readFileSync(file));

test('Markdown は本文と図を共有し、動画用ブロックを除き、コード例を変更しない', async () => {
  const { dir, file } = fixture();
  const result = await buildOutput(file, { format: 'markdown' });
  const output = fs.readFileSync(path.join(result.out, 'README.md'), 'utf8');
  assert.match(output, /注文を受け付けて保存/);
  assert.match(output, /\*\*説明\*\*/);
  assert.match(output, /assets\/fig-01.png/);
  assert.match(output, /const example = "!\[触らない\]\(missing.png\)"/);
  assert.doesNotMatch(output, /yaml figure|yaml narration|html motion|動画だけ/);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.equal(fs.readFileSync(path.join(result.out, 'source/report.md'), 'utf8'), source);
  const png = fs.readFileSync(path.join(result.out, 'assets/fig-01.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const link = walk(readMarkdown(output)).find((n) => n.type === 'link');
  assert.ok(link?.type === 'link');
  assert.equal(path.resolve(result.out, decodeURIComponent(link.url.split('#')[0])), path.resolve(dir, '../guide.md'));
});

test('SVG はベクトル画像を保存し、Mermaid は非対応の図を PNG で残す', async () => {
  const { file } = fixture();
  const svg = await buildOutput(file, { format: 'markdown', imageFormat: 'svg' });
  assert.match(fs.readFileSync(path.join(svg.out, 'assets/fig-01.svg'), 'utf8'), /<svg/);
  fs.appendFileSync(file, '\n## 自由な図\n\n図です。\n\n```svg figure\n<svg xmlns="http://www.w3.org/2000/svg" width="720" height="200" viewBox="0 0 720 200"><title>自由な図</title><rect width="720" height="200" fill="#fff"/></svg>\n```\n\n説明です。\n');
  const result = await buildOutput(file, { format: 'markdown', imageFormat: 'mermaid' });
  const output = fs.readFileSync(path.join(result.out, 'README.md'), 'utf8');
  assert.match(output, /```mermaid\nflowchart LR/);
  assert.match(output, /受付 \/ 内容を確認/);
  assert.match(output, /assets\/fig-02.png/);
  assert.ok(result.warnings.some((w) => w.includes('free')));
});

test('参照形式の画像も同梱し、空白のあるパスを解決する', async () => {
  const { file, dir } = fixture();
  const seed = await buildOutput(file, { format: 'png' });
  fs.copyFileSync(path.join(seed.out, 'fig-01.png'), path.join(dir, 'local image.png'));
  fs.appendFileSync(file, '\n[photo]: <local image.png>\n\n![ローカル画像][photo]\n\n![ルート画像](/local%20image.png)\n\n[doc]: ../guide.md\n\n[文書][doc]\n');
  const result = await buildOutput(file, { format: 'markdown', out: path.join(dir, 'nested/export') });
  const output = fs.readFileSync(path.join(result.out, 'README.md'), 'utf8');
  const images = walk(readMarkdown(output)).filter((n) => n.type === 'image');
  assert.equal(images.length, 3);
  for (const img of images) assert.ok(fs.existsSync(path.join(result.out, img.url)));
  const links = walk(readMarkdown(output)).filter((n) => n.type === 'link');
  assert.equal(path.resolve(result.out, links.at(-1)!.url), path.resolve(dir, '../guide.md'));
});

test('コードの根拠は抜粋と行番号を残す', async () => {
  const { dir, file } = fixture();
  fs.writeFileSync(path.join(dir, 'impl.ts'), 'export const answer = 42;\n');
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ repos: { app: { path: '.', pin: false, host: 'github', org: 'example', name: 'repo', branch: 'main' } } }));
  fs.appendFileSync(file, '\n```yaml refs\n- code: app:impl.ts#L1-L1\n  note: 値を公開します。\n```\n');
  const doc = await prepareDocument(fs.readFileSync(file, 'utf8'), file, path.join(dir, 'out'));
  assert.match(doc.markdown, /export const answer = 42/);
  assert.match(doc.markdown, /値を公開します/);
  assert.match(doc.markdown, /https:\/\/github.com\/example\/repo/);
  assert.doesNotMatch(doc.markdown, /yaml refs/);
});

test('スクリーンショットの枠の説明と撮影元を本文に残す', async () => {
  const { file, dir } = fixture();
  const seed = await buildOutput(file, { format: 'png' });
  fs.copyFileSync(path.join(seed.out, 'fig-01.png'), path.join(dir, 'shot.png'));
  fs.appendFileSync(file, '\n## 画面\n\n画面を確認します。\n\n```yaml figure\ntype: screenshot\nimage: shot.png\nurl: https://example.com\nmarks:\n  - at: [10, 10, 50, 40]\n    note: この場所を確認します。\n```\n\n説明です。\n');
  const doc = await prepareDocument(fs.readFileSync(file, 'utf8'), file, path.join(dir, 'out'));
  assert.match(doc.markdown, /1\. この場所を確認します/);
  assert.ok(walk(doc.tree).some((node) => node.type === 'link' && node.url === 'https://example.com'));
  assert.doesNotMatch(doc.markdown, /<ol/);
});

test('図の補足に含まれる画像を同梱し、リンクを出力先に合わせ、Officeにも埋め込む', async () => {
  const { file, dir } = fixture();
  const seed = await buildOutput(file, { format: 'png' });
  for (const name of ['shot.png', 'detail.png']) fs.copyFileSync(path.join(seed.out, 'fig-01.png'), path.join(dir, name));
  fs.writeFileSync(file, '# 画面\n\n```yaml figure\ntype: screenshot\nimage: shot.png\nmarks:\n  - at: [10, 10, 50, 40]\n    note: "![詳細](detail.png) [説明](guide.md#note)"\n```\n');
  const out = path.join(dir, 'nested/export');
  const result = await buildOutput(file, { format: 'markdown', out });
  const nodes = walk(readMarkdown(fs.readFileSync(path.join(result.out, 'README.md'), 'utf8')));
  const images = nodes.filter((n) => n.type === 'image');
  assert.equal(images.length, 2);
  for (const img of images) assert.ok(fs.existsSync(path.join(out, img.url)), img.url);
  const link = nodes.find((n) => n.type === 'link');
  assert.ok(link?.type === 'link');
  assert.equal(path.resolve(out, link.url.split('#')[0]), path.join(dir, 'guide.md'));
  assert.ok(link.url.endsWith('#note'));
  const docx = await zipOf((await buildOutput(file, { format: 'docx' })).out);
  assert.equal((await docx.file('word/document.xml')!.async('string')).match(/<w:drawing>/g)?.length, 2);
  const pptx = await zipOf((await buildOutput(file, { format: 'pptx' })).out);
  const slides = Object.keys(pptx.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const xml = (await Promise.all(slides.map((name) => pptx.file(name)!.async('string')))).join('');
  assert.equal(xml.match(/<p:pic>/g)?.length, 2);
});

test('図の補足内の参照定義を解決し、本文の同名定義を変更しない', async (t) => {
  const { file, dir } = fixture();
  const seed = await buildOutput(file, { format: 'png' });
  fs.copyFileSync(path.join(seed.out, 'fig-01.png'), path.join(dir, 'shot.png'));
  t.mock.method(screenshot, 'after', () => ({ html: '', storage: '', markdown: '![詳細][photo]\n\n[補足][page]\n\n[photo]: shot.png\n[page]: extra.md#note\n' }));
  fs.writeFileSync(file, '# 画面\n\n[page]: original.md\n\n```yaml figure\ntype: screenshot\nimage: shot.png\nmarks:\n  - at: [10, 10, 50, 40]\n    note: 補足を確認\n```\n\n[本文][page]\n');
  const out = path.join(dir, 'nested/export');
  const doc = await prepareDocument(fs.readFileSync(file, 'utf8'), file, out);
  const images = walk(doc.tree).filter((n) => n.type === 'image');
  assert.equal(images.length, 2);
  for (const img of images) assert.ok(doc.assets.has(img.url));
  const links = walk(doc.tree).filter((n) => n.type === 'link');
  assert.deepEqual(links.map((n) => path.resolve(out, n.url.split('#')[0])), [path.join(dir, 'extra.md'), path.join(dir, 'original.md')]);
});

test('バイナリ形式は外部画像を黙って省略せず、出力前に知らせる', async () => {
  const { file } = fixture();
  fs.appendFileSync(file, '\n![外部画像](https://example.invalid/image.png)\n');
  for (const format of ['pdf', 'docx', 'pptx']) {
    await assert.rejects(buildOutput(file, { format }), /ローカルに保存/);
    assert.equal(fs.existsSync(file.replace('.md', `.${format}`)), false);
  }
});

test('既存 HTML と Confluence の生成結果を維持する', async () => {
  const { file } = fixture();
  const a = await buildOutput(file);
  const b = await buildOutput(file, { format: 'html' });
  assert.equal(fs.readFileSync(a.out, 'utf8'), await render(source, file));
  assert.equal(extract(fs.readFileSync(b.out, 'utf8')), source);
  const cf = await buildOutput(file, { format: 'confluence' });
  assert.equal(fs.readFileSync(path.join(cf.out, 'body.xhtml'), 'utf8'), (await renderConfluence(source, file)).body);
  assert.equal(fs.readFileSync(path.join(cf.out, 'report.md'), 'utf8'), source);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cf.out, 'meta.json'), 'utf8')).attachments, ['fig-01.png', 'report.md']);
});

test('形式とオプションを検査し、原稿を上書きせず、失敗時に生成物を残さない', async () => {
  const { dir, file } = fixture();
  for (const format of ['unknown', 'constructor', '']) await assert.rejects(buildOutput(file, { format }), /html, confluence, markdown, pdf, docx, pptx, svg, png/);
  await assert.rejects(buildOutput(file, { imageFormat: 'svg' }), /Markdown|markdown/);
  await assert.rejects(buildOutput(file, { format: 'markdown', imageFormat: 'jpg' }), /png, svg, mermaid/);
  await assert.rejects(buildOutput(file, { out: file }), /原稿と同じ/);
  fs.writeFileSync(file, source.replace('type: flow', 'type: missing'));
  const out = path.join(dir, 'failed');
  await assert.rejects(buildOutput(file, { format: 'markdown', out }), /図の型/);
  assert.equal(fs.existsSync(out), false);
});

test('図だけの出力は順番を保ち、本文を混ぜない', async () => {
  const { file } = fixture();
  fs.appendFileSync(file, '\n> ## 入れ子の図\n>\n> ```svg figure\n> <svg xmlns="http://www.w3.org/2000/svg" width="720" height="200" viewBox="0 0 720 200"><title>二つ目の図</title><rect width="720" height="200" fill="#fff"/></svg>\n> ```\n');
  for (const format of ['svg', 'png']) {
    const result = await buildOutput(file, { format });
    assert.deepEqual(fs.readdirSync(result.out), [`fig-01.${format}`, `fig-02.${format}`]);
    const document = await buildOutput(file, { format: 'markdown', imageFormat: format });
    for (const name of ['fig-01', 'fig-02']) assert.deepEqual(fs.readFileSync(path.join(result.out, `${name}.${format}`)), fs.readFileSync(path.join(document.out, 'assets', `${name}.${format}`)));
  }
});

for (const format of ['svg', 'png']) {
  test(`${format} は本文の画像とリンクを解決せず、図だけを書き出す`, async () => {
    const { file } = fixture();
    fs.appendFileSync(file, '\n![ない画像](missing.png)\n\n[リンク](invalid%ZZ.md)\n');
    const result = await buildOutput(file, { format });
    assert.deepEqual(fs.readdirSync(result.out), [`fig-01.${format}`]);
    const data = fs.readFileSync(path.join(result.out, `fig-01.${format}`));
    if (format === 'svg') assert.match(data.toString(), /<svg/);
    else assert.equal(data.subarray(1, 4).toString(), 'PNG');
    await assert.rejects(buildOutput(file, { format: 'markdown' }), /missing.png/);
  });

  test(`${format} は本文の refs が壊れていても図を書き出す`, async () => {
    for (const refs of ['[invalid YAML', '- code: unknown:missing.ts#L1-L1\n  note: 見つからない参照']) {
      const { file } = fixture();
      fs.appendFileSync(file, `\n\`\`\`yaml refs\n${refs}\n\`\`\`\n`);
      const result = await buildOutput(file, { format });
      assert.deepEqual(fs.readdirSync(result.out), [`fig-01.${format}`]);
      await assert.rejects(buildOutput(file, { format: 'markdown' }));
    }
  });
}

test('図だけの出力でも、不正な図と図が必要とする画像の欠落は書き込み前に知らせる', async () => {
  for (const format of ['svg', 'png']) {
    const { dir, file } = fixture();
    const out = path.join(dir, 'failed');
    fs.writeFileSync(file, source.replace('type: flow', 'type: missing'));
    await assert.rejects(buildOutput(file, { format, out }), /L\d+: 図の型/);
    fs.writeFileSync(file, '# 画面\n\n```yaml figure\ntype: screenshot\nimage: missing.png\nmarks:\n  - at: [10, 10, 50, 40]\n    note: 図に必要な画像\n```\n');
    await assert.rejects(buildOutput(file, { format, out }), /missing.png/);
    assert.equal(fs.existsSync(out), false);
  }
});

test('本文にエラーがあっても、図がなければ図がないことを知らせる', async () => {
  const { file } = fixture();
  fs.writeFileSync(file, '# 図がない原稿\n\n![ない画像](missing.png)\n');
  for (const format of ['svg', 'png']) await assert.rejects(buildOutput(file, { format }), /原稿に図がありません/);
});

test('原稿のハードリンクを保存先に指定しても原稿を上書きしない', async () => {
  const { dir, file } = fixture();
  const out = path.join(dir, 'linked.html');
  fs.linkSync(file, out);
  await assert.rejects(buildOutput(file, { out }), /原稿と同じ/);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.equal(fs.readFileSync(out, 'utf8'), source);
});

test('フォルダ内の生成先が原稿のハードリンクなら、どの生成物も書き込まない', async () => {
  const { dir, file } = fixture();
  const out = path.join(dir, 'linked-markdown');
  fs.mkdirSync(out);
  fs.linkSync(file, path.join(out, 'README.md'));
  await assert.rejects(buildOutput(file, { format: 'markdown', out }), /原稿と重なります/);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.deepEqual(fs.readdirSync(out), ['README.md']);
});

test('内容が原稿と同じでも別ファイルなら、保存先を更新できる', async () => {
  const { dir, file } = fixture();
  const out = path.join(dir, 'separate.html');
  fs.copyFileSync(file, out);
  await buildOutput(file, { out });
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.equal(extract(fs.readFileSync(out, 'utf8')), source);
});

test('Word は編集できる文章・表と画像を含む OOXML を生成する', async () => {
  const { file } = fixture();
  const result = await buildOutput(file, { format: 'docx' });
  const zip = await zipOf(result.out);
  const xml = await zip.file('word/document.xml')!.async('string');
  assert.match(xml, /注文を受け付けて保存します/);
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /<w:drawing>/);
  assert.match(xml, /<w:hyperlink/);
  assert.doesNotMatch(xml, /動画だけの内容/);
  assert.ok(Object.keys(zip.files).some((name) => name.startsWith('word/media/') && name.endsWith('.png')));
});

test('PowerPoint は本文と図を含み、長文の末尾を次のスライドに残す', async () => {
  const { file } = fixture();
  fs.appendFileSync(file, `\n${'長文の説明です。'.repeat(180)}末尾の確認です。\n`);
  fs.appendFileSync(file, '\n|項目|内容|\n|---|---|\n' + Array.from({ length: 24 }, (_, i) => `|項目${i}|${'説明文です。'.repeat(15)}${i === 23 ? '表の末尾です。' : ''}|`).join('\n') + '\n');
  const result = await buildOutput(file, { format: 'pptx' });
  const zip = await zipOf(result.out);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  const xml = (await Promise.all(slides.map((name) => zip.file(name)!.async('string')))).join('');
  assert.ok(slides.length > 3);
  assert.match(xml, /注文を受け付けて保存します/);
  assert.match(xml, /<a:tbl>/);
  assert.match(xml, /<p:pic>/);
  assert.match(xml.replace(/<[^>]+>/g, ''), /末尾の確認です/);
  assert.match(xml.replace(/<[^>]+>/g, ''), /表の末尾です/);
  assert.doesNotMatch(xml, /動画だけの内容/);
  assert.equal(wrapText('aあ😀'.repeat(100)).join(''), 'aあ😀'.repeat(100));
});

test('PowerPoint は長い表の続きにもテーマの背景・見出し・フッターを適用する', async () => {
  const { dir, file } = fixture();
  fs.mkdirSync(path.join(dir, 'dark'));
  fs.writeFileSync(path.join(dir, 'dark/tokens.json'), JSON.stringify({ color: { paper: '#101820', ink: '#F1F5F9' } }));
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ theme: 'dark' }));
  fs.writeFileSync(file, '# テーマの表\n\n|項目|内容|\n|---|---|\n' + Array.from({ length: 48 }, (_, i) => `|項目${i}|説明${i}|`).join('\n') + '\n');
  const result = await buildOutput(file, { format: 'pptx' });
  const zip = await zipOf(result.out);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.ok(slides.length > 1, '表が続きのスライドへ分かれる');
  for (const name of slides) {
    const xml = await zip.file(name)!.async('string');
    const background = xml.match(/<p:bg>[\s\S]*?<\/p:bg>/)?.[0] ?? '';
    assert.match(background, /<a:srgbClr val="101820"\s*\/>/, name);
    assert.match(xml, /<a:t>テーマの表<\/a:t>/, name);
    assert.match(xml, /<a:t>zukai<\/a:t>/, name);
    assert.match(xml, /<a:tbl>/, name);
  }
});

test('PowerPoint は見出し内の画像を、本文がない最後の見出しまで埋め込む', async () => {
  const { dir, file } = fixture();
  const seed = await buildOutput(file, { format: 'png' });
  fs.copyFileSync(path.join(seed.out, 'fig-01.png'), path.join(dir, 'header.png'));
  fs.writeFileSync(file, '# 前の節\n\n前の本文\n\n## 見出し [![ロゴ][logo]](https://example.com)\n\n見出しの本文\n\n## 最後 ![末尾](header.png)\n\n[logo]: header.png\n');
  const zip = await zipOf((await buildOutput(file, { format: 'pptx' })).out);
  const names = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const slides = await Promise.all(names.map((name) => zip.file(name)!.async('string')));
  const pictured = slides.filter((xml) => xml.includes('<p:pic>'));
  assert.equal(pictured.length, 2);
  assert.ok(pictured.some((xml) => xml.includes('見出し') && xml.includes('ロゴ')));
  assert.ok(pictured.some((xml) => xml.includes('最後') && xml.includes('末尾')));
  assert.match(slides.join(''), /見出しの本文/);
});

test('PowerPoint は見出し内でも外部画像を黙って省略せず、出力前に知らせる', async () => {
  const { file } = fixture();
  for (const depth of [1, 2]) {
    fs.writeFileSync(file, `${'#'.repeat(depth)} [![外部画像](https://example.invalid/header.png)](https://example.com)\n`);
    await assert.rejects(buildOutput(file, { format: 'pptx' }), /ローカルに保存/);
    assert.equal(fs.existsSync(file.replace('.md', '.pptx')), false);
  }
});

test('Mermaid のラベル内の構文文字をエスケープする', () => {
  const value = mermaid({ type: 'sequence', actors: ['A', 'B'], messages: [{ from: 'A', to: 'B', label: 'x;\nend: "quoted"' }] });
  assert.match(value!, /x#59; end#58; #34;quoted#34;/);
  assert.equal(value!.split('\n').length, 4);
});

const executable = process.env.ZUKAI_CHROMIUM ?? chromium.executablePath();
test('PDF はブラウザから実際の PDF ファイルを書き出す', { skip: !fs.existsSync(executable) }, async () => {
  const { file } = fixture();
  const result = await buildOutput(file, { format: 'pdf' });
  const data = fs.readFileSync(result.out);
  assert.equal(data.subarray(0, 5).toString(), '%PDF-');
  assert.match(data.toString('latin1'), /\/Type \/Page/);
  assert.ok(data.length > 5000);
});
