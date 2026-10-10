// 返答の資料（.zukai/answers の原稿）を、ブラウザのタブ1つで読むページ。127.0.0.1 だけで待ち受ける。
// AI ツールに依存しない。原稿のファイルが増えたり変わったりしたら、ページが一覧を読み直して描き直す。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { render } from './render.js';
import { lint } from './lint/index.js';

// ページへの要求がこの時間なければ終了する。ページを開いている間は、一覧の読み直しが続くので終わらない。
const IDLE_MS = 30 * 60 * 1000;

export const answersDir = (project) => path.join(project, '.zukai', 'answers');

// プロジェクトごとに別のポートを使う。複数のプロジェクトのページを同時に開ける。
export const portOf = (project) => 4800 + (parseInt(crypto.createHash('sha256').update(path.resolve(project)).digest('hex').slice(0, 8), 16) % 1000);

// 資料の置き場所を作る。.zukai の中に .gitignore を置き、プロジェクトの .gitignore を書き換えずに Git の管理から外す。
export function ensureDir(project) {
  const dir = answersDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(project, '.zukai', '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  return dir;
}

// 新しい順の一覧。名前は英数字、ハイフン、ドット、下線だけを受け付ける。
// ponytail: 読み直しのたびに全原稿の先頭を読む。資料が数百件を超えて遅くなったら mtime でキャッシュする。
export function list(dir) {
  return fs
    .readdirSync(dir)
    .filter((n) => /^[\w.-]+\.md$/.test(n))
    .map((name) => {
      const file = path.join(dir, name);
      return { name, title: fs.readFileSync(file, 'utf8').match(/^# (.+)$/m)?.[1] ?? name, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 原稿を HTML にし、2回直しても残った Lint の error を本文の上に出す。同じ版の原稿は描き直さない。
const cache = new Map();
async function doc(dir, name) {
  const file = path.join(dir, name);
  const mtime = fs.statSync(file).mtimeMs;
  if (cache.get(name)?.mtime === mtime) return cache.get(name);
  const source = fs.readFileSync(file, 'utf8');
  const [html, result] = await Promise.all([render(source, file), lint(source, file)]);
  const errors = result.findings.filter((f) => f.severity === 'error');
  const banner = errors.length
    ? `<aside style="border:1px solid #eb6834;border-radius:8px;padding:12px 16px;margin-bottom:24px"><strong>Lint の指摘が ${errors.length} 件残っています</strong><ul>${errors.map((f) => `<li>L${f.line} ${f.rule} ${esc(f.message)}</li>`).join('')}</ul></aside>`
    : '';
  const entry = { mtime, html, withBanner: html.replace('<main>\n', `<main>\n${banner}`) };
  cache.set(name, entry);
  return entry;
}

const SHELL = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>zukai の資料</title>
<style>
body{margin:0;display:flex;height:100vh;font-family:system-ui,"Yu Gothic UI","Hiragino Sans",sans-serif;color:#1c2530;background:#fff}
nav{width:280px;flex:none;overflow:auto;border-right:1px solid #dfe4ea;background:#f3f5f7}
nav header{padding:12px 14px;font-size:.8rem;color:#5b6673;border-bottom:1px solid #dfe4ea}
nav header a{color:#0f5f8a}
nav button{display:block;width:100%;text-align:left;padding:10px 14px;border:0;border-bottom:1px solid #e3e7ec;background:none;font:inherit;color:inherit;cursor:pointer}
nav button.on{background:#e2eff6;font-weight:600}
nav button small{display:block;font-size:.75rem;color:#5b6673;font-weight:400}
nav button.new small::after{content:" 新着";color:#0f5f8a;font-weight:600}
iframe{flex:1;border:0;height:100%}
#empty{flex:1;padding:40px;color:#5b6673}
</style>
</head>
<body>
<nav><header id="head">資料はまだありません</header><div id="list"></div></nav>
<iframe id="doc" title="資料" hidden></iframe>
<p id="empty">資料はまだありません。AI ツールが .zukai/answers に原稿を保存すると、ここに表示します。</p>
<script>
let shown = null, follow = true, known = new Set(), drawn = '';
const $ = (id) => document.getElementById(id);
function show(item) {
  shown = item;
  $('doc').src = '/doc/' + encodeURIComponent(item.name) + '?v=' + item.mtime;
  $('doc').hidden = false;
  $('empty').hidden = true;
}
async function tick() {
  let items;
  try { items = await (await fetch('/list')).json(); } catch { return; }
  if (!items.length) return;
  // 最新の資料を見ているときは、新しい資料に切り替える。古い資料を読んでいる間は切り替えず、新着の印を付ける。
  const current = shown && items.find((i) => i.name === shown.name);
  if (follow && (!shown || items[0].name !== shown.name || items[0].mtime !== shown.mtime)) show(items[0]);
  else if (current && current.mtime !== shown.mtime) show(current);
  if (follow) known = new Set(items.map((i) => i.name));
  // 一覧は、中身が変わったときだけ作り直す。毎回作り直すと、クリックの途中でボタンが入れ替わり、選んだ資料が開かない。
  const key = JSON.stringify([items, shown && shown.name, [...known]]);
  if (key === drawn) return;
  drawn = key;
  $('head').innerHTML = '資料 ' + items.length + ' 件' + (shown ? '　<a href="/doc/' + encodeURIComponent(shown.name) + '?download=1">HTML を保存</a>' : '');
  $('list').replaceChildren(...items.map((item, n) => {
    const b = document.createElement('button');
    b.className = (shown && item.name === shown.name ? 'on' : '') + (known.has(item.name) ? '' : ' new');
    b.textContent = item.title;
    const t = document.createElement('small');
    t.textContent = new Date(item.mtime).toLocaleString('ja-JP');
    b.append(t);
    b.onclick = () => { follow = n === 0; known.add(item.name); show(item); tick(); };
    return b;
  }));
}
tick();
setInterval(tick, 1000);
</script>
</body>
</html>
`;

const send = (res, status, type, body, headers = {}) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(body);
};

export function serve(project, port = portOf(project)) {
  const dir = ensureDir(project);
  let timer;
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => server.close(() => process.exit(0)), IDLE_MS).unref();
  };
  const server = http.createServer(async (req, res) => {
    idle();
    // ほかのサイトから名前解決を差し替えて読まれないように、Host が自分のときだけ答える。
    const p = server.address().port;
    if (![`127.0.0.1:${p}`, `localhost:${p}`].includes(req.headers.host)) return send(res, 403, 'text/plain; charset=utf-8', 'このホスト名では開けません。');
    const url = new URL(req.url, `http://127.0.0.1:${p}`);
    try {
      if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', SHELL);
      if (url.pathname === '/health') return send(res, 200, 'application/json', JSON.stringify({ zukai: true, project: path.resolve(project) }));
      if (url.pathname === '/list') return send(res, 200, 'application/json', JSON.stringify(list(dir)));
      const name = decodeURIComponent(url.pathname.match(/^\/doc\/([^/]+)$/)?.[1] ?? '');
      // 一覧にある名前だけを読む。パスを含む名前で、置き場所の外のファイルを読ませない。
      if (name && list(dir).some((i) => i.name === name)) {
        const d = await doc(dir, name);
        if (url.searchParams.has('download')) return send(res, 200, 'text/html; charset=utf-8', d.html, { 'content-disposition': `attachment; filename="${name.replace(/\.md$/, '.html')}"` });
        return send(res, 200, 'text/html; charset=utf-8', d.withBanner);
      }
      send(res, 404, 'text/plain; charset=utf-8', '見つかりません。');
    } catch (e) {
      send(res, 500, 'text/plain; charset=utf-8', e.message);
    }
  });
  idle();
  return new Promise((ok, ng) => server.once('error', ng).listen(port, '127.0.0.1', () => ok(server)));
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
}

// ページが動いていなければ、切り離したプロセスで起動し、初回はブラウザで開く。どちらの場合も URL を返す。
// AI ツールの多くは、終わらないコマンドを待ち続けるので、このコマンド自体はすぐに終わる。
export async function ensure(project, { open = true } = {}) {
  ensureDir(project);
  const url = `http://127.0.0.1:${portOf(project)}/`;
  const health = async () => {
    try {
      const r = await fetch(`${url}health`);
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  let h = await health();
  if (!h) {
    const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
    spawn(process.execPath, [cli, 'view', '--serve'], { cwd: project, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 50 && !h; i++) {
      await new Promise((r) => setTimeout(r, 100));
      h = await health();
    }
    if (!h) throw new Error(`表示用のページを起動できませんでした。zukai view --serve を直接実行して、エラーを確認してください。`);
    if (open) openBrowser(url);
  }
  if (h.project !== path.resolve(project)) throw new Error(`${url} は、別のプロジェクト（${h.project}）の表示用のページが使っています。`);
  return url;
}
