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
import { parse } from './parse.js';

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

// 資料の版。原稿と、原稿が読む screenshot の画像と枠の記録（.json）のうち、最も新しい更新時刻にする。
// capture で撮り直しても原稿は変わらないので、原稿の更新時刻だけでは古い画面が残る。
function version(file, source) {
  const doc = parse(source);
  const deps = [...doc.lead, ...doc.sections.flatMap((s) => s.blocks)]
    .filter((b) => b.kind === 'figure' && b.spec?.type === 'screenshot' && typeof b.spec.image === 'string')
    .flatMap((b) => {
      const image = path.resolve(path.dirname(file), b.spec.image);
      return [image, `${image}.json`];
    });
  return Math.max(
    ...[file, ...deps].map((p) => {
      try {
        return fs.statSync(p).mtimeMs;
      } catch {
        return 0;
      }
    }),
  );
}

// 新しい順の一覧。名前は英数字、ハイフン、ドット、下線だけを受け付ける。
// シンボリックリンクは入れない。リンク先の、置き場所の外のファイルを読ませないため。
// ponytail: 読み直しのたびに全原稿を読んで解析する。資料が数百件を超えて遅くなったら、原稿の mtime でキャッシュする。
export function list(dir) {
  return fs
    .readdirSync(dir)
    .filter((n) => /^[\w.-]+\.md$/.test(n) && fs.lstatSync(path.join(dir, n)).isFile())
    .map((name) => {
      const file = path.join(dir, name);
      const source = fs.readFileSync(file, 'utf8');
      return { name, title: source.match(/^# (.+)$/m)?.[1] ?? name, mtime: version(file, source) };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// render が失敗しても、残った指摘と原稿は読めるようにする。
const fallback = (source, e) => `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"></head>
<body>
<main>
<p>この資料は HTML にできませんでした。${esc(e.message)}</p>
<pre>${esc(source)}</pre>
</main>
</body>
</html>
`;

// 原稿を HTML にし、2回直しても残った Lint の error を本文の上に出す。同じ版の資料は描き直さない。
const cache = new Map();
async function doc(dir, name) {
  const file = path.join(dir, name);
  const source = fs.readFileSync(file, 'utf8');
  const mtime = version(file, source);
  if (cache.get(name)?.mtime === mtime) return cache.get(name);
  const [html, result] = await Promise.all([render(source, file).catch((e) => fallback(source, e)), lint(source, file)]);
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
body{margin:0;display:grid;grid-template-rows:auto 1fr;grid-template-columns:auto 1fr;height:100vh;font-family:system-ui,"Yu Gothic UI","Hiragino Sans",sans-serif;color:#1c2530;background:#fff}
header{grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #dfe4ea;background:#fff}
header h1{margin:0;font-size:.9rem;font-weight:600}
#count{font-size:.8rem;color:#5b6673}
header .spacer{flex:1}
.icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:0;border-radius:6px;background:none;color:#1c2530;cursor:pointer}
.icon:hover{background:#f3f5f7}
.icon:focus-visible{outline:2px solid #0f5f8a;outline-offset:1px}
.icon svg{width:18px;height:18px}
/* たたんでいる間に新着があれば、開閉ボタンに点を付ける。 */
body.collapsed #toggle.new::before{content:"";position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:#0f5f8a}
/* ツールチップ。マウスを乗せたときと、キーボードで選んだときに出す。 */
[data-tip]:hover::after,[data-tip]:focus-visible::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);left:0;z-index:10;white-space:nowrap;padding:4px 8px;border-radius:4px;background:#1c2530;color:#fff;font-size:.75rem;font-weight:400;pointer-events:none}
.end[data-tip]:hover::after,.end[data-tip]:focus-visible::after{left:auto;right:0}
nav{width:280px;overflow:auto;border-right:1px solid #dfe4ea;background:#f3f5f7}
body.collapsed nav{display:none}
#list button{display:block;width:100%;text-align:left;padding:10px 14px;border:0;border-bottom:1px solid #e3e7ec;background:none;font:inherit;color:inherit;cursor:pointer}
#list button.on{background:#e2eff6;font-weight:600}
#list button small{display:block;font-size:.75rem;color:#5b6673;font-weight:400}
#list button.new small::after{content:" 新着";color:#0f5f8a;font-weight:600}
main{grid-column:2;display:flex;min-height:0}
body.collapsed main{grid-column:1/-1}
iframe{flex:1;border:0}
#empty{margin:0;padding:40px;color:#5b6673}
</style>
</head>
<body>
<header>
<button id="toggle" class="icon" type="button" aria-controls="list" aria-expanded="true" aria-label="一覧をたたむ" data-tip="一覧をたたむ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg></button>
<h1>zukai の資料</h1>
<span id="count"></span>
<span class="spacer"></span>
<a id="save" class="icon end" aria-label="HTML を保存" data-tip="HTML を保存" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg></a>
</header>
<nav><div id="list"></div></nav>
<main>
<iframe id="doc" title="資料" hidden></iframe>
<p id="empty">資料はまだありません。AI ツールが .zukai/answers に原稿を保存すると、ここに表示します。</p>
</main>
<script>
let shown = null, follow = true, known = new Set(), drawn = '';
const $ = (id) => document.getElementById(id);
function show(item) {
  shown = item;
  $('doc').src = '/doc/' + encodeURIComponent(item.name) + '?v=' + item.mtime;
  $('doc').hidden = false;
  $('empty').hidden = true;
  $('save').href = '/doc/' + encodeURIComponent(item.name) + '?download=1';
  $('save').hidden = false;
}
async function tick() {
  let items;
  try { items = await (await fetch('/list')).json(); } catch { return; }
  // 資料がなくなったら、最初の表示に戻す。
  if (!items.length) {
    if (drawn !== 'empty') {
      shown = null;
      follow = true;
      drawn = 'empty';
      $('doc').hidden = true;
      $('doc').removeAttribute('src');
      $('empty').hidden = false;
      $('save').hidden = true;
      $('save').removeAttribute('href');
      $('count').textContent = '';
      $('list').replaceChildren();
      $('toggle').classList.remove('new');
    }
    return;
  }
  // 読んでいた資料が消えたら、最新の資料に戻る。
  if (shown && !items.some((i) => i.name === shown.name)) {
    shown = null;
    follow = true;
  }
  // 最新の資料を見ているときは、新しい資料に切り替える。古い資料を読んでいる間は切り替えず、新着の印を付ける。
  const current = shown && items.find((i) => i.name === shown.name);
  if (follow && (!shown || items[0].name !== shown.name || items[0].mtime !== shown.mtime)) show(items[0]);
  else if (current && current.mtime !== shown.mtime) show(current);
  if (follow) known = new Set(items.map((i) => i.name));
  // たたんでいる間も新着に気づけるように、開閉ボタンに印を付ける。
  $('toggle').classList.toggle('new', items.some((i) => !known.has(i.name)));
  // 一覧は、中身が変わったときだけ作り直す。毎回作り直すと、クリックの途中でボタンが入れ替わり、選んだ資料が開かない。
  const key = JSON.stringify([items, shown && shown.name, [...known]]);
  if (key === drawn) return;
  drawn = key;
  $('count').textContent = items.length + ' 件';
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
// 一覧をたたむかどうかは、この閲覧者のブラウザにだけ覚える。保存できない環境では、毎回開いた状態で始める。
function fold(on) {
  document.body.classList.toggle('collapsed', on);
  const label = on ? '一覧を開く' : '一覧をたたむ';
  $('toggle').setAttribute('aria-label', label);
  $('toggle').dataset.tip = label;
  $('toggle').setAttribute('aria-expanded', String(!on));
  try { localStorage.setItem('zukai-collapsed', on ? '1' : ''); } catch {}
}
$('toggle').onclick = () => fold(!document.body.classList.contains('collapsed'));
try { if (localStorage.getItem('zukai-collapsed')) fold(true); } catch {}
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
        // 原稿に書かれた HTML のスクリプトを動かさない。動くと、このページの一覧や資料を読んで外へ送れてしまう。
        // iframe の sandbox 属性は使わない。sandbox の iframe を読み込まないブラウザがあるため、CSP だけで止める。
        const csp = { 'content-security-policy': "default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'" };
        if (url.searchParams.has('download')) return send(res, 200, 'text/html; charset=utf-8', d.html, { ...csp, 'content-disposition': `attachment; filename="${name.replace(/\.md$/, '.html')}"` });
        return send(res, 200, 'text/html; charset=utf-8', d.withBanner, csp);
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
