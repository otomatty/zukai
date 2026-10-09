// Confluence Cloud への書き出しと登録。
// 登録先のページ ID は、原稿の先頭に <!-- zukai-confluence ページID --> として書き込む。
// 原稿はページに添付するので、添付の原稿を受け取った人が同じページを更新できる。
import fs from 'node:fs';
import path from 'node:path';
import { renderConfluence } from './render.js';

// PNG に変換するときの日本語フォント。SVG のフォント指定の先頭が PC に無い場合に使われる。
// OS ごとに標準で入っているものを選ぶ。変えたいときは環境変数 ZUKAI_PNG_FONT で指定する。
const pngFont = () => process.env.ZUKAI_PNG_FONT ?? { darwin: 'Hiragino Sans', win32: 'Yu Gothic UI' }[process.platform] ?? 'Noto Sans CJK JP';

const MARK = /^<!--\s*zukai-confluence\s+(\d+)\s*-->\n?/m;

export const pageIdOf = (source) => source.match(MARK)?.[1] ?? null;
const withPageId = (source, id) => `<!-- zukai-confluence ${id} -->\n${source.replace(MARK, '')}`;

// 本文と添付ファイル（図の PNG、原稿）を作る。build と publish の両方が使う。
export async function bundle(source, file) {
  const { Resvg } = await import('@resvg/resvg-js');
  const page = await renderConfluence(source, file);
  const files = page.figures.map((fig) => ({
    name: fig.name,
    type: 'image/png',
    // 表示幅の2倍の解像度で書き出す。フォントは実行した PC に入っているものを使う。
    data: new Resvg(fig.svg, { fitTo: { mode: 'zoom', value: 2 }, background: '#ffffff', font: { loadSystemFonts: true, defaultFontFamily: pngFont() } }).render().asPng(),
  }));
  files.push({ name: path.basename(file), type: 'text/markdown', data: Buffer.from(source) });
  return { title: page.title, body: page.body, files };
}

function client() {
  const base = process.env.CONFLUENCE_BASE?.replace(/\/+$/, '');
  const email = process.env.CONFLUENCE_EMAIL;
  const token = process.env.CONFLUENCE_TOKEN;
  if (!base || !email || !token) {
    throw new Error('環境変数 CONFLUENCE_BASE（例: https://example.atlassian.net/wiki）、CONFLUENCE_EMAIL、CONFLUENCE_TOKEN を設定してください。');
  }
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  return async (method, url, { json, form } = {}) => {
    const headers = { Authorization: auth, Accept: 'application/json' };
    if (json) headers['Content-Type'] = 'application/json';
    if (form) headers['X-Atlassian-Token'] = 'nocheck';
    const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : form });
    const text = await res.text();
    if (!res.ok) throw new Error(`Confluence が ${res.status} を返しました（${method} ${url}）。${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
}

async function attach(call, pageId, file) {
  const form = new FormData();
  form.append('file', new Blob([file.data], { type: file.type }), file.name);
  form.append('minorEdit', 'true');
  // PUT は、同じ名前の添付があれば新しい版として置き換え、なければ新しく作る。
  await call('PUT', `/rest/api/content/${pageId}/child/attachment`, { form });
}

// 原稿に対応するページを作るか、更新する。戻り値はページ ID と URL。
export async function publish(file, { spaceId, parentId } = {}) {
  const call = client();
  let source = fs.readFileSync(file, 'utf8');
  let pageId = pageIdOf(source);
  const created = !pageId;

  if (created) {
    if (!spaceId) throw new Error('初回の登録には --space-id=スペースID が必要です。');
    const first = await bundle(source, file);
    const page = await call('POST', '/api/v2/pages', {
      json: { spaceId: String(spaceId), status: 'current', title: first.title, ...(parentId ? { parentId: String(parentId) } : {}), body: { representation: 'storage', value: first.body } },
    });
    pageId = page.id;
    // 次回から同じページを更新できるよう、ページ ID を原稿に書き込む。添付する原稿にも同じ ID が入る。
    source = withPageId(source, pageId);
    fs.writeFileSync(file, source);
  }

  const { title, body, files } = await bundle(source, file);
  for (const f of files) await attach(call, pageId, f);

  if (!created) {
    const current = await call('GET', `/api/v2/pages/${pageId}`);
    const number = current.version?.number;
    if (!Number.isInteger(number)) throw new Error(`ページ ${pageId} の版番号を取得できません。`);
    await call('PUT', `/api/v2/pages/${pageId}`, {
      json: { id: String(pageId), status: 'current', title, version: { number: number + 1 }, body: { representation: 'storage', value: body } },
    });
  }
  return { pageId, created, attachments: files.length, url: `${process.env.CONFLUENCE_BASE.replace(/\/+$/, '')}/pages/viewpage.action?pageId=${pageId}` };
}
