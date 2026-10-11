// Confluence Cloud への書き出しと登録。
// 登録先のページ ID は、原稿の先頭に <!-- zukai-confluence ページID --> として書き込む。
// 原稿はページに添付するので、添付の原稿を受け取った人が同じページを更新できる。
import fs from 'node:fs';
import path from 'node:path';
import { renderConfluence } from './render.js';
import { toPng } from './png.js';
import { settingsFor } from './config.js';

const MARK = /^<!--\s*zukai-confluence\s+(\d+)\s*-->\n?/m;

export const pageIdOf = (source) => source.match(MARK)?.[1] ?? null;
const withPageId = (source, id) => `<!-- zukai-confluence ${id} -->\n${source.replace(MARK, '')}`;

// 本文と添付ファイル（図の PNG、原稿）を作る。build と publish の両方が使う。
export async function bundle(source, file) {
  const page = await renderConfluence(source, file);
  const files = page.figures.map((fig) => ({ name: fig.name, type: 'image/png', data: toPng(fig.svg, page.background).data }));
  files.push({ name: path.basename(file), type: 'text/markdown', data: Buffer.from(source) });
  return { title: page.title, body: page.body, files };
}

// 接続先は設定の confluence.base、メールアドレスとトークンは zukai login confluence で保存した値か環境変数から読む。
function client(conf) {
  const base = conf.base?.replace(/\/+$/, '');
  const { email, token } = conf;
  if (!base) throw new Error('Confluence の URL がありません。zukai setup confluence を実行するか、zukai config set confluence.base https://example.atlassian.net/wiki を実行してください。');
  if (!email || !token) throw new Error('Confluence のメールアドレスか API トークンがありません。zukai login confluence を実行してください。');
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  const call = async (method, url, { json, form } = {}) => {
    const headers = { Authorization: auth, Accept: 'application/json' };
    if (json) headers['Content-Type'] = 'application/json';
    if (form) headers['X-Atlassian-Token'] = 'nocheck';
    const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : form });
    const text = await res.text();
    if (!res.ok) throw new Error(`Confluence が ${res.status} を返しました（${method} ${url}）。${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  call.base = base;
  return call;
}

async function attach(call, pageId, file) {
  const form = new FormData();
  form.append('file', new Blob([file.data], { type: file.type }), file.name);
  form.append('minorEdit', 'true');
  // PUT は、同じ名前の添付があれば新しい版として置き換え、なければ新しく作る。
  await call('PUT', `/rest/api/content/${pageId}/child/attachment`, { form });
}

// 原稿に対応するページを作るか、更新する。戻り値はページ ID と URL。
// スペース ID と親ページ ID は、引数を設定（confluence.spaceId、confluence.parentId）より優先する。
export async function publish(file, { spaceId, parentId } = {}) {
  const conf = settingsFor(path.dirname(path.resolve(file))).settings.confluence;
  spaceId ??= conf.spaceId;
  parentId ??= conf.parentId;
  const call = client(conf);
  let source = fs.readFileSync(file, 'utf8');
  let pageId = pageIdOf(source);
  const created = !pageId;

  if (created) {
    if (!spaceId) throw new Error('初回の登録には、スペース ID が必要です。--space-id=スペースID を付けるか、zukai config set confluence.spaceId スペースID を実行してください。');
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
  return { pageId, created, attachments: files.length, url: `${call.base}/pages/viewpage.action?pageId=${pageId}` };
}
