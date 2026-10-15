// 資料の確認と書き出し、設定、テーマ、Confluence への公開を、ブラウザで操作する画面（zukai gui）。127.0.0.1 だけで待ち受ける。
// 処理は CLI と同じ関数を呼ぶ。画面だけの処理を持たないので、CLI と画面で結果がずれない。
// 書き込みや公開をする要求（/api/）には、ページに埋め込んだ合言葉を求める。ほかのサイトのフォームやスクリプトから、設定を書き換えたり公開したりさせないため。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { root, loadConfig, listedKeys, specOf, coerce, setValue, unsetValue, scopeNames, settingsFor, stateDir } from './config.ts';
import { parse } from './parse.ts';
import { answersDir, ensureDir, list as listAnswers, fallback, openBrowser, StatCache } from './view.ts';
import { imageFormats, outputFormats } from './output-formats.ts';
import type { ImageFormat, OutputFormat } from './output-formats.ts';
import type { Scope } from './types.ts';

// ページへの要求がこの時間なければ終了する。ページを開いている間は、一覧の読み直しが続くので終わらない。
const IDLE_MS = 30 * 60 * 1000;
// 原稿を探すときの上限。files は一覧に入れる数、reads は中身を読む .md の数。大きなリポジトリでも、一覧がすぐ返るようにする。
const SCAN = { depth: 6, files: 300, reads: 2000, bytes: 1024 * 1024 };
// プロジェクト全体を探し直す間隔。.zukai/answers は毎回読む。
const RESCAN_MS = 10 * 1000;

// view（4800〜5799）と重ならない範囲で、プロジェクトごとに別のポートを使う。
export const guiPortOf = (project: string): number => 5800 + (parseInt(crypto.createHash('sha256').update(path.resolve(project)).digest('hex').slice(0, 8), 16) % 1000);

// 一覧の1件。path はプロジェクトの根からの相対パス（区切りは /）。answer は AI の返答（.zukai/answers）の資料。
export interface DocItem {
  path: string;
  title: string;
  mtime: number;
  answer: boolean;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'vendor']);
// 図のコードブロックの始まりらしい行。3つまでの字下げと ~~~ の囲みも受け付ける。
// 長い囲みの中の例にも当たるので、絞り込みにだけ使い、最後は parse.ts で図のブロックがあるかを確かめる。
const FIGURE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*(?:ya?ml|svg)[ \t]+figure\b/m;
const hasFigure = (source: string): boolean => {
  if (!FIGURE.test(source)) return false;
  const doc = parse(source);
  return [...doc.lead, ...doc.sections.flatMap((s) => s.blocks)].some((b) => b.kind === 'figure');
};

// プロジェクトの中の原稿（図のブロックを持つ .md）を探す。隠しフォルダ、node_modules、シンボリックリンクは読まない。
// 中身は、ファイルが変わったときだけ読み直す。探し直すたびに、すべての .md を読んで解析しない。
const scanned = new StatCache<{ title: string } | null>();
function scan(project: string): DocItem[] {
  const out: DocItem[] = [];
  const seen: string[] = [];
  let reads = 0;
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= SCAN.files || reads >= SCAN.reads) return;
      if (e.name.startsWith('.')) continue;
      const file = path.join(dir, e.name);
      if (e.isDirectory()) {
        // 書き出したフォルダには原稿の写しがある。写しを原稿として出さない。
        if (depth < SCAN.depth && !SKIP_DIRS.has(e.name) && !e.name.endsWith('.confluence') && !e.name.endsWith('.markdown')) walk(file, depth + 1);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        try {
          const st = fs.statSync(file);
          if (st.size > SCAN.bytes) continue;
          reads++;
          seen.push(file);
          const found = scanned.get(file, st, () => {
            const source = fs.readFileSync(file, 'utf8');
            return hasFigure(source) ? { title: source.match(/^# (.+)$/m)?.[1] ?? e.name } : null;
          });
          if (!found) continue;
          out.push({ path: path.relative(project, file).replaceAll('\\', '/'), title: found.title, mtime: st.mtimeMs, answer: false });
        } catch {
          // 読めないファイルは一覧に入れない。
        }
      }
    }
  };
  walk(project, 0);
  scanned.keep(seen);
  return out;
}

// 新しい順の一覧。AI の返答は、view と同じく screenshot の画像の更新も版に含める。
function docs(project: string, cache: { at: number; items: DocItem[] }): DocItem[] {
  if (Date.now() - cache.at > RESCAN_MS) {
    cache.items = scan(project);
    cache.at = Date.now();
  }
  const answers = listAnswers(answersDir(project)).map((i) => ({ path: `.zukai/answers/${i.name}`, title: i.title, mtime: i.mtime, answer: true }));
  return [...answers, ...cache.items].sort((a, b) => b.mtime - a.mtime);
}

// 設定の1項目。秘密の値は返さず、設定済みかどうかだけを返す。
function configItems(project: string) {
  const cfg = loadConfig(project);
  const items = listedKeys(cfg).map((key) => {
    const s = specOf(key)!;
    const origin = cfg.origins[key] ?? null;
    // 画面で直す値は、書いたままの値にする。ただしパスは、画面がプロジェクトの根から解決するので、
    // チームと手元に書いた値（プロジェクトの根から解決する）だけをそのまま出し、この PC と環境変数の値は絶対パスにして出す。
    const asWritten = origin === 'team' || origin === 'local' || s.type !== 'path';
    const value = s.secret ? null : origin && origin !== 'default' ? (asWritten ? cfg.raw[key] : cfg.values[key]) : (s.default ?? null);
    return {
      key,
      group: s.group,
      type: s.type,
      description: s.description,
      scopes: s.scopes,
      values: s.values ?? null,
      labels: s.labels ?? null,
      suggest: s.suggest ?? null,
      min: s.min ?? null,
      max: s.max ?? null,
      env: s.env ?? null,
      secret: Boolean(s.secret),
      default: s.default ?? null,
      value,
      isSet: cfg.values[key] !== null && cfg.values[key] !== undefined,
      origin,
    };
  });
  const files = Object.fromEntries(Object.entries(cfg.files).map(([k, f]) => [k, { path: f, exists: fs.existsSync(f!) }]));
  return { project, files, scopeNames, items, problems: cfg.problems };
}

// 画面から受け取った値を、項目の型の値にする。パスはプロジェクトの根から解決する。空の値は「なし」（null）にする。
function valueOf(project: string, key: string, input: unknown, scope: Scope): unknown {
  const s = specOf(key);
  if (!s) throw new Error(`項目「${key}」はありません。`);
  if (input === null || input === '') return coerce(key, null, scope, project);
  if (s.type === 'path' && typeof input === 'string') return coerce(key, path.resolve(project, input), scope, project);
  return coerce(key, input, scope, project);
}

// 書いた値より優先する置き場所にある値。画面に「こちらが優先されます」と出す。
function shadowOf(project: string, key: string, scope: Scope): string | null {
  const o = loadConfig(project).origins[key];
  if (!o || o === scope) return null;
  return o === 'env' ? `${scopeNames.env}（${specOf(key)!.env}）` : scopeNames[o];
}

// プロジェクトの中のパスにする。外を指すパスは断る。
// シンボリックリンクをたどった先も確かめる。まだ無いフォルダは、いちばん近い今あるフォルダの実体で確かめる。
function inside(project: string, rel: string): string {
  const abs = path.resolve(project, rel);
  const within = (base: string, p: string) => {
    const r = path.relative(base, p);
    return !(r.startsWith('..') || path.isAbsolute(r));
  };
  let existing = abs;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  if (!within(project, abs) || !within(fs.realpathSync(project), fs.realpathSync(existing))) throw new Error(`プロジェクトの外（${rel}）には書けません。`);
  return abs;
}

const PAGE = fs.readFileSync(path.join(root, 'src/gui.html'), 'utf8');
// ページの本体の CSP。スクリプトは、要求ごとに作る nonce の付いたものだけを動かす。ほかのサイトの枠には入れさせない。
const shellCsp = (nonce: string) => `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`;
// 資料とテーマの見本は、render の CSP でスクリプトを止める。枠に入れられるのは、この画面だけにする。
const frameCsp = async () => `${(await import('./csp.ts')).CSP}; frame-ancestors 'self'`;

const send = (res: http.ServerResponse, status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(body);
};
const json = (res: http.ServerResponse, status: number, body: unknown) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1024 * 1024) throw new Error('要求が大きすぎます。');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const v = text ? JSON.parse(text) : {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('要求の形が違います。');
  return v;
}

export function serve(project: string, port: number = guiPortOf(project)): Promise<http.Server> {
  project = path.resolve(project);
  ensureDir(project);
  // ページに埋め込む合言葉。プロセスごとに作り直す。
  const token = crypto.randomBytes(32).toString('hex');
  const cache = { at: 0, items: [] as DocItem[] };
  // 一覧にある原稿だけを読む。パスを含む名前で、置き場所の外のファイルを読ませない。
  const docFile = (rel: string | null): string => {
    const item = rel ? docs(project, cache).find((d) => d.path === rel) : null;
    if (!item) throw Object.assign(new Error('この原稿は一覧にありません。'), { status: 404 });
    return path.join(project, item.path);
  };
  let timer: NodeJS.Timeout | undefined;
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => server.close(() => process.exit(0)), IDLE_MS).unref();
  };

  const api = async (req: http.IncomingMessage, url: URL): Promise<unknown> => {
    const route = `${req.method} ${url.pathname}`;
    const q = (n: string) => url.searchParams.get(n);
    const body = req.method === 'POST' ? await readBody(req) : {};
    const str = (n: string) => (typeof body[n] === 'string' ? (body[n] as string) : null);
    switch (route) {
      case 'GET /api/docs':
        return docs(project, cache);
      case 'GET /api/source':
        return { source: fs.readFileSync(docFile(q('path')), 'utf8') };
      case 'GET /api/lint': {
        const file = docFile(q('path'));
        const { lintResident } = await import('./lint/server.ts');
        return lintResident(fs.readFileSync(file, 'utf8'), file);
      }
      case 'POST /api/build': {
        const file = docFile(str('path'));
        const { buildOutput } = await import('./output.ts');
        const result = await buildOutput(file, { format: str('format') ?? undefined, imageFormat: str('imageFormat') ?? undefined });
        return { out: path.relative(project, result.out), warnings: result.warnings };
      }
      case 'POST /api/publish': {
        // CLI の publish と同じく、Lint に合格した原稿だけを登録する。
        const file = docFile(str('path'));
        const { lintResident } = await import('./lint/server.ts');
        const result = await lintResident(fs.readFileSync(file, 'utf8'), file);
        if (!result.ok) return { ok: false, lint: result };
        const { publish } = await import('./confluence.ts');
        return { ok: true, ...(await publish(file, { spaceId: str('spaceId') || null, parentId: str('parentId') || null })) };
      }
      case 'GET /api/config':
        return configItems(project);
      case 'POST /api/config': {
        const key = str('key');
        const s = key ? specOf(key) : null;
        if (!key || !s) throw new Error(`項目「${key}」はありません。`);
        const scope = (str('scope') ?? s.scopes[0]) as Scope;
        if (!s.scopes.includes(scope)) throw new Error(`${key} は、${s.scopes.map((x) => scopeNames[x]).join('、')}の設定にだけ書けます。`);
        const r = setValue(project, key, valueOf(project, key, body.value, scope), scope);
        return { file: r.file, scope: r.scope, shadowedBy: shadowOf(project, key, r.scope) };
      }
      case 'POST /api/config/unset': {
        const key = str('key');
        if (!key || !specOf(key)) throw new Error(`項目「${key}」はありません。`);
        const scope = (str('scope') ?? undefined) as Scope | undefined;
        return { removed: unsetValue(project, key, scope) };
      }
      case 'GET /api/doctor': {
        const { doctor } = await import('./doctor.ts');
        return doctor(project);
      }
      case 'GET /api/theme': {
        const { themeReport } = await import('./theme.ts');
        const dir = settingsFor(project).settings.theme ?? null;
        const r = await themeReport(dir);
        return { dir: r.dir && path.relative(project, r.dir).replaceAll('\\', '/'), name: r.name, ok: r.ok, findings: r.findings };
      }
      case 'POST /api/theme/init': {
        const rel = str('dir') || 'zukai-theme';
        const dir = inside(project, rel);
        const { initTheme } = await import('./theme.ts');
        return { dir: path.relative(project, dir).replaceAll('\\', '/'), written: initTheme(dir).map((f) => path.relative(project, f)) };
      }
      default:
        throw Object.assign(new Error('見つかりません。'), { status: 404 });
    }
  };

  const server = http.createServer(async (req, res) => {
    idle();
    // ほかのサイトから名前解決を差し替えて読まれないように、Host が自分のときだけ答える。
    const p = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${p}`;
    if (![`127.0.0.1:${p}`, `localhost:${p}`].includes(req.headers.host as string)) return send(res, 403, 'text/plain; charset=utf-8', 'このホスト名では開けません。');
    const url = new URL(req.url!, origin);
    try {
      if (url.pathname.startsWith('/api/')) {
        // 合言葉は、このページのスクリプトだけがヘッダーに付けられる。ほかのサイトのフォームは、ヘッダーを付けられない。
        const given = String(req.headers['x-zukai-token'] ?? '');
        const ok = given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
        const from = req.headers.origin;
        if (!ok || (from && from !== origin && from !== `http://localhost:${p}`)) return json(res, 403, { error: 'この画面からの要求ではありません。ページを開き直してください。' });
        if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'JSON で送ってください。' });
        return json(res, 200, await api(req, url));
      }
      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'GET だけを受け付けます。');
      if (url.pathname === '/') {
        const nonce = crypto.randomBytes(16).toString('base64');
        const html = PAGE.replace('__ZUKAI_TOKEN__', token).replaceAll('__ZUKAI_PROJECT__', esc(project)).replace('__ZUKAI_FORMATS__', optionTags(outputFormats.map((f) => f.name), FORMAT_LABEL)).replace('__ZUKAI_IMAGE_FORMATS__', optionTags(imageFormats, IMAGE_LABEL)).replaceAll('<script>', `<script nonce="${nonce}">`);
        return send(res, 200, 'text/html; charset=utf-8', html, { 'content-security-policy': shellCsp(nonce), 'referrer-policy': 'no-referrer' });
      }
      if (url.pathname === '/health') return json(res, 200, { zukai: true, gui: true, project });
      // 枠に出す資料とテーマの見本。読むだけなので合言葉は求めず、CSP でスクリプトを止める。
      if (url.pathname === '/doc') {
        const file = docFile(url.searchParams.get('path'));
        const source = fs.readFileSync(file, 'utf8');
        const { render } = await import('./render.ts');
        const html = await render(source, file).catch((e: Error) => fallback(source, e));
        const headers: Record<string, string> = { 'content-security-policy': await frameCsp() };
        if (url.searchParams.has('download')) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file).replace(/\.md$/, '.html'))}`;
        return send(res, 200, 'text/html; charset=utf-8', html, headers);
      }
      if (url.pathname === '/theme/preview' || url.pathname === '/theme/compare') {
        const dir = settingsFor(project).settings.theme ?? null;
        const { previewTheme, compareThemes } = await import('./preview.ts');
        const variants = url.searchParams.getAll('v').filter(Boolean);
        const types = url.searchParams.get('types')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
        const html = url.pathname === '/theme/preview' ? (await previewTheme(dir)).html : await compareThemes(dir, variants, { only: types.length ? types : null });
        return send(res, 200, 'text/html; charset=utf-8', html, { 'content-security-policy': await frameCsp() });
      }
      send(res, 404, 'text/plain; charset=utf-8', '見つかりません。');
    } catch (e) {
      // API の誤りは、値の誤りや足りない設定のように、利用者が直せるものが多い。画面に文を出すため 400 で返す。
      const api = url.pathname.startsWith('/api/');
      const status = (e as { status?: number }).status ?? (api ? 400 : 500);
      if (api) return json(res, status, { error: (e as Error).message });
      send(res, status, 'text/plain; charset=utf-8', (e as Error).message);
    }
  });
  idle();
  return new Promise<http.Server>((ok, ng) => server.once('error', ng).listen(port, '127.0.0.1', () => ok(server)));
}

const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FORMAT_LABEL: Record<OutputFormat, string> = { html: 'HTML', confluence: 'Confluence', markdown: 'Markdown', pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', svg: '図（SVG）', png: '図（PNG）' };
const IMAGE_LABEL: Record<ImageFormat, string> = { png: 'PNG', svg: 'SVG', mermaid: 'Mermaid' };
const optionTags = (names: readonly string[], labels: Record<string, string>) => names.map((name) => `<option value="${esc(name)}">${esc(labels[name] ?? name)}</option>`).join('');

// 画面が動いていなければ、切り離したプロセスで起動し、初回はブラウザで開く。どちらの場合も URL を返す。
// AI ツールの多くは、終わらないコマンドを待ち続けるので、このコマンド自体はすぐに終わる。
export async function ensure(project: string, { open = true }: { open?: boolean } = {}): Promise<string> {
  project = path.resolve(project);
  stateDir(project);
  const url = `http://127.0.0.1:${guiPortOf(project)}/`;
  const health = async (): Promise<{ gui?: boolean; project: string } | null> => {
    try {
      const r = await fetch(`${url}health`);
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  let h = await health();
  if (!h) {
    const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
    spawn(process.execPath, [cli, 'gui', '--serve'], { cwd: project, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 50 && !h; i++) {
      await new Promise((r) => setTimeout(r, 100));
      h = await health();
    }
    if (!h) throw new Error('操作画面を起動できませんでした。zukai gui --serve を直接実行して、エラーを確認してください。');
  }
  if (!h.gui || h.project !== project) throw new Error(`${url} は、別のプロジェクト（${h.project}）か別のページが使っています。`);
  // view と違い、人が開くための画面なので、動いていてもブラウザで開く。
  if (open) openBrowser(url);
  return url;
}
