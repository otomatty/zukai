import { chromium } from 'playwright-core';
import MarkdownIt from 'markdown-it';
import { machineSetting } from '../config.ts';
import { css } from '../render.ts';
import { esc } from '../figures/svg.ts';
import { imageOf } from './images.ts';
import type { ExportDocument } from './document.ts';

export async function writePdf(doc: ExportDocument): Promise<Buffer> {
  const md = new MarkdownIt({ html: false });
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const img = imageOf(doc, String(token.attrGet('src') ?? ''));
    token.attrSet('src', `data:image/${img.type === 'jpg' ? 'jpeg' : img.type};base64,${img.data.toString('base64')}`);
    return image(tokens, index, options, env, self);
  };
  const body = md.render(doc.markdown);
  const executablePath = machineSetting('chromium') as string | null;
  const browser = await chromium.launch(executablePath ? { executablePath } : {}).catch((e: Error) => {
    throw new Error(`PDFの生成にはChromiumが必要です。npx playwright-core install chromium を実行するか、zukai config set chromium <実行ファイル> --scope=user で指定してください。\n${e.message}`);
  });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route('**/*', (route) => route.abort());
    await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'"><title>${esc(doc.title)}</title><style>${css(doc.tokens)} img{max-width:100%;max-height:230mm;object-fit:contain} pre{white-space:pre-wrap;overflow-wrap:anywhere} table{width:100%;table-layout:fixed} th,td{overflow-wrap:anywhere} tr,img{break-inside:avoid} h1,h2,h3,h4{break-after:avoid} @page{size:A4;margin:18mm}</style></head><body><main>${body}</main></body></html>`, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true });
  } finally { await browser.close(); }
}
