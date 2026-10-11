// 原稿の screenshot に書かれた URL を撮影し、枠を付ける要素の位置を記録する。
// 撮影には Playwright を使う。zukai の通常の依存には入れていないので、使う人だけが入れる。
import fs from 'node:fs';
import path from 'node:path';
import { machineSetting } from './config.js';
import { parse } from './parse.js';

export async function capture(docFile) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('撮影には Playwright が必要です。npm install playwright と npx playwright install chromium を実行してください。');
  }
  const baseDir = path.dirname(path.resolve(docFile));
  const doc = parse(fs.readFileSync(docFile, 'utf8'));
  const shots = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'figure' && b.spec?.type === 'screenshot' && b.spec.url);
  if (!shots.length) return [];
  const executablePath = machineSetting('chromium');
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const results = [];
  try {
    for (const { spec, line } of shots) {
      const viewport = spec.viewport ?? 1280;
      const page = await browser.newPage({ viewport: { width: viewport, height: spec.height ?? 800 } });
      await page.goto(spec.url, { waitUntil: 'networkidle' });
      // 個人情報などを、撮影の前に塗りつぶす。
      for (const sel of spec.mask ?? []) await page.addStyleTag({ content: `${sel}{background:#c5ccd3!important;color:transparent!important;border-radius:4px}${sel} *{visibility:hidden!important}` });
      const marks = {};
      const missing = [];
      for (const m of spec.marks ?? []) {
        if (!m.selector) continue;
        const box = await page.locator(m.selector).first().boundingBox().catch(() => null);
        if (box) marks[m.selector] = [box.x, box.y, box.width, box.height].map(Math.round);
        else missing.push(m.selector);
      }
      const out = path.resolve(baseDir, spec.image);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out });
      const d = new Date();
      fs.writeFileSync(`${out}.json`, JSON.stringify({ url: spec.url, captured: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`, viewport, marks }, null, 2) + '\n');
      await page.close();
      results.push({ line, image: spec.image, missing });
    }
  } finally {
    await browser.close();
  }
  return results;
}
