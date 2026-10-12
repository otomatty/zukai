// 原稿の screenshot に書かれた URL を撮影し、枠を付ける要素の位置を記録する。
// 撮影には Playwright を使う。zukai の通常の依存には入れていないので、使う人だけが入れる。
import fs from 'node:fs';
import path from 'node:path';
import { machineSetting } from './config.ts';
import { parse } from './parse.ts';
import type { FigureBlock } from './types.ts';

// Playwright の型。playwright は入れていない環境もあるので、型は同じ API を持つ playwright-core から取る。
type Playwright = typeof import('playwright-core');
// 撮影に読む、screenshot の仕様の項目。形は lint が確かめる。撮影は lint の前にも行うので、url と image だけは、撮る前にここで確かめる。
type Shot = { url: string; image: string; viewport?: number; height?: number; mask?: string[]; marks?: { selector?: string }[] };
// 撮った画面ごとの結果。missing は、画面に見つからなかった枠のセレクター。
export interface Captured {
  line: number;
  image: string;
  missing: string[];
}
// 名前を変数にして、型の検査で playwright を探させない。読み込む名前は変わらない。
const PLAYWRIGHT: string = 'playwright';

export async function capture(docFile: string): Promise<Captured[]> {
  const baseDir = path.dirname(path.resolve(docFile));
  const doc = parse(fs.readFileSync(docFile, 'utf8'));
  const shots = doc.sections.flatMap((s) => s.blocks).filter((b): b is FigureBlock & { spec: Shot } => b.kind === 'figure' && b.spec?.type === 'screenshot' && !!b.spec.url);
  if (!shots.length) return [];
  // 保存先と URL が無いと、撮った後に例外で止まり、それまでに撮った画面も記録されない。撮り始める前に知らせる。
  for (const { spec, line } of shots) {
    const raw: Record<string, unknown> = spec;
    if (typeof raw.url !== 'string') throw new Error(`L${line} の screenshot の url は、文字で書いてください。`);
    if (typeof raw.image !== 'string' || !raw.image.endsWith('.png')) throw new Error(`L${line} の screenshot には image（PNG 画像のパス）が必要です。撮った画面を、このパスに保存します。`);
  }
  let chromium: Playwright['chromium'];
  try {
    ({ chromium } = (await import(PLAYWRIGHT)) as Playwright);
  } catch {
    throw new Error('撮影には Playwright が必要です。npm install playwright と npx playwright install chromium を実行してください。');
  }
  // 設定の値は、読むときに型を確かめてある（chromium はパスの文字）。
  const executablePath = machineSetting('chromium') as string | null;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const results: Captured[] = [];
  try {
    for (const { spec, line } of shots) {
      const viewport = spec.viewport ?? 1280;
      const page = await browser.newPage({ viewport: { width: viewport, height: spec.height ?? 800 } });
      await page.goto(spec.url, { waitUntil: 'networkidle' });
      // 個人情報などを、撮影の前に塗りつぶす。
      for (const sel of spec.mask ?? []) await page.addStyleTag({ content: `${sel}{background:#c5ccd3!important;color:transparent!important;border-radius:4px}${sel} *{visibility:hidden!important}` });
      const marks: Record<string, number[]> = {};
      const missing: string[] = [];
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
