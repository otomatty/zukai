// 図の座標を保ち、HTML と PNG の四辺に紙の色の余白が付くことを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yaml } from 'yaml';
import { Resvg } from '@resvg/resvg-js';
import type { RenderedImage } from '@resvg/resvg-js';
import { types } from '../src/figures/index.ts';
import { baseTokens, readTheme } from '../src/theme.ts';
import { typesFor } from '../src/figures/custom.ts';
import { render, renderConfluence } from '../src/render.ts';
import { pngFont, toPng } from '../src/png.ts';
import { lint } from '../src/lint/index.ts';
import type { Tokens } from '../src/types.ts';

const raster = (svg: string) => new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, font: { loadSystemFonts: true, defaultFontFamily: pngFont() } }).render();
// ECharts の図・CSS・クリップ領域の通し番号を、出現順にそろえる。参照する名前の対応は保つ。
const stable = (svg: string) => {
  const ids = new Map<string, number>();
  return svg.replace(/\bzr\d+-[\w-]+/g, (id) => `chart-${ids.get(id) ?? ids.set(id, ids.size).get(id)}`);
};

function checkMargin(image: RenderedImage, t: Tokens) {
  const rgba = Buffer.from([...t.color.paper.slice(1).match(/../g)!.map((n) => parseInt(n, 16)), 255]);
  const row = Buffer.alloc(image.width * 4);
  for (let x = 0; x < image.width; x++) rgba.copy(row, x * 4);
  const pixels = image.pixels;
  // 枠線が座標の端を少し越えるので、その分を除いた余白が四辺で空いているかを見る。
  const border = Math.floor(t.figure.margin * 2) - 4;
  for (let y = 0; y < image.height; y++) {
    const actual = pixels.subarray(y * row.length, (y + 1) * row.length);
    if (y < border || y >= image.height - border) assert.deepEqual(actual, row, `y=${y}`);
    else {
      assert.deepEqual(actual.subarray(0, border * 4), row.subarray(0, border * 4), `left y=${y}`);
      assert.deepEqual(actual.subarray(-border * 4), row.subarray(-border * 4), `right y=${y}`);
    }
  }
}

test('組み込みの全24型は、図の座標を変えずに紙の色の余白を付ける', () => {
  const t = baseTokens();
  // PNG の既定の白で隠れないよう、紙の色を変え、透明な余白も検出する。
  t.color.paper = '#e9f1f7';
  const ctx = { baseDir: fileURLToPath(new URL('../corpus/good/', import.meta.url)) };
  for (const type of Object.values(types)) {
    const spec = type.name === 'screenshot'
      ? { type: 'screenshot', image: 'shots/login.png', marks: [{ selector: '.alert', note: '残り時間を表示します。' }] }
      : type.fence === 'svg figure' ? { type: 'free', svg: type.example } : yaml(type.example);
    const svg = type.render(spec, t, ctx);
    const padded = raster(svg);
    const originalSvg = type.render(spec, { ...t, figure: { ...t.figure, margin: 0 } }, ctx);
    // 表示範囲と背景を除き、座標・文字・線・箱は同じ。ECharts の図の通し番号だけは描くたびに変わる。
    const content = (s: string) => stable(s.replace(/^<svg\b[^>]*>/, '').replace(/^<rect class="zk-background"[^>]*\/>/, ''));
    assert.equal(content(svg), content(originalSvg), type.name);
    const original = raster(originalSvg);
    const offset = t.figure.margin * 2;
    assert.equal(padded.width, original.width + offset * 2, type.name);
    assert.equal(padded.height, original.height + offset * 2, type.name);
    checkMargin(padded, t);
    const a = padded.pixels;
    const b = original.pixels;
    let difference = 0;
    let channels = 0;
    // 以前の表示範囲の端では切れていた枠線が見えるようになるので、端の2pxは比較から外す。
    for (let y = 2; y < original.height - 2; y++) {
      const start = ((y + offset) * padded.width + offset) * 4;
      // 表示範囲の原点が変わると、回転した文字や曲線のアンチエイリアスに端数の差が出る。
      for (let x = 8; x < (original.width - 2) * 4; x++) {
        difference += Math.abs(a[start + x] - b[y * original.width * 4 + x]);
        channels++;
      }
    }
    assert.ok(difference / channels < 0.05, `${type.name}: 平均の色の差 ${difference / channels}`);
    // PNG への変換でも SVG の背景色を使い、別の背景指定で余白の色が変わらない。
    assert.deepEqual(toPng(svg, '#ff00ff').data, padded.asPng(), type.name);
  }
});

const playwright: typeof import('playwright-core') | null = await import('playwright' as string).catch(() => null);
test('動画では背景を部品に数えず、箱と矢印だけを動かす', { skip: !playwright && 'Playwright がありません' }, async (ctx) => {
  const { scenesOf, timeline, estimateVoice } = await import('../src/video/script.ts');
  const { pageHtml } = await import('../src/video/encode.ts');
  const { readJson } = await import('../src/lint/index.ts');
  const browser = await playwright!.chromium.launch();
  ctx.after(() => browser.close());
  const file = fileURLToPath(new URL('../corpus/good/login.md', import.meta.url));
  const source = '# 題名\n\n導入です。\n\n## 節\n\n主張です。\n\n```yaml figure\ntype: flow\nsteps:\n  - label: 入口\n  - label: 出口\n```\n\n説明です。\n';
  const scenes = scenesOf(source, file);
  const plan = { ...timeline(scenes, scenes.map((s) => estimateVoice(s.lines))), width: 1920, height: 1080, fps: 30, limits: readJson('contract/limits.json').video };
  const page = await browser.newPage();
  await page.setContent(pageHtml(plan, baseTokens()));
  const result = await page.evaluate(() => {
    (window as unknown as { zkInit(): unknown }).zkInit();
    const svg = document.querySelector('.zk-fig svg')!;
    const background = svg.querySelector('.zk-background')!;
    return { backgroundPart: background.hasAttribute('data-part'), animations: background.getAnimations().length, parts: svg.querySelectorAll('[data-part]').length };
  });
  assert.deepEqual(result, { backgroundPart: false, animations: 0, parts: 3 });
});

test('HTML と Confluence は、自由図・チャート・テーマ独自の型に同じ余白を付ける', async (ctx) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-margin-'));
  ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const themeDir = path.join(dir, 'theme');
  const typeDir = path.join(themeDir, 'types', 'sample');
  fs.mkdirSync(typeDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'zukai.config.json'), JSON.stringify({ theme: 'theme' }));
  fs.writeFileSync(path.join(themeDir, 'tokens.json'), JSON.stringify({ color: { paper: '#141f4f' }, figure: { margin: 32 } }));
  const free = '<svg viewBox="0 0 720 100"><title>例</title><rect x="0" y="0" width="720" height="100" fill="#0f5f8a"/><text class="zk-text" x="360" y="55" text-anchor="middle">例</text></svg>';
  fs.writeFileSync(path.join(typeDir, 'type.json'), JSON.stringify({ summary: '例を描く', when: '例を示す', fields: { label: { type: 'string', required: true, max: 8 } }, example: { label: '例' } }));
  fs.writeFileSync(path.join(typeDir, 'figure.svg'), free.replace('>例</text>', '>{{label}}</text>'));
  const theme = readTheme(themeDir);
  const custom = typesFor(theme).sample;
  checkMargin(raster(custom.render({ type: 'sample', label: '例' }, theme.tokens)), theme.tokens);
  const figures = [`svg figure\n${free}`, `yaml figure\n${types.bar.example}`, 'yaml figure\ntype: sample\nlabel: 例'];
  const source = '# 題名\n\n導入です。\n\n' + figures.map((f, i) => `## 節${i + 1}\n\n主張です。\n\n\`\`\`${f}\n\`\`\`\n\n説明です。\n`).join('\n');
  const file = path.join(dir, 'a.md');
  assert.ok((await lint(source, file, { textlint: false })).ok);
  const html = await render(source, file);
  const page = await renderConfluence(source, file);
  const svgs = [...html.matchAll(/<figure>([\s\S]*?)<\/figure>/g)].map((m) => m[1]);
  assert.equal(svgs.length, 3);
  // ECharts は描くたびに図の番号が変わるので、番号を外して比べる。
  assert.deepEqual(svgs.map(stable), page.figures.map((f) => stable(f.svg)));
  for (const svg of svgs) checkMargin(raster(svg), theme.tokens);
  assert.equal(page.background, '#141f4f');
});
