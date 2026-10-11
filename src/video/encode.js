// 原稿から MP4 を作る。ページをヘッドレスの Chromium で開き、時刻を進めながら1コマずつ撮って ffmpeg に渡す。
// AI が書いたシーンのコードは Chromium のサンドボックスの中だけで動かす。ネットワークの要求はすべて拒否し、Node では動かさない。
// 動画の品質は AI に任せ、ここではガードレールだけを持つ。
// - 暴走: 読み込みと1コマの時間に上限を設け、超えたシーンは自動の動きに差し替える
// - 例外: シーンごとに記録し、読み込みで例外が出たシーンは自動の動きに差し替える
// - 見た目: 文字のはみ出し、字幕との重なり、文字の大きさ、要素の数、シーンより長いアニメーションを調べて返す
// - 再現性: 同じ時刻のコマを2回撮り、一致するかを調べる
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readJson, root } from '../lint/index.js';
import { themeFor } from '../theme.js';
import { esc } from '../figures/svg.js';
import { settingsFor, projectOf, stateDir, machineSetting } from '../config.js';
import { scenesOf, timeline, wrapScripts, DEFAULT_OPTIONS } from './script.js';
import { voicesFor } from './tts.js';
import { resolveRefs } from '../refs.js';
import { RATE, mix, voiceCues, wav16, presetOf, checkParams, PRESETS, bgmTrack } from './sfx.js';

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

const css = (t, v) => `
:root{--zk-bg:${v.background};${Object.entries(v.palette).map(([k, c]) => `--zk-${k}:${c}`).join(';')};--zk-ink:${v.figure.color.ink};--zk-sub:${v.figure.color.sub};--zk-line:${v.figure.color.line};--zk-surface:${v.figure.color.surface};--zk-accent:${v.figure.color.accent};--zk-gradient:${t.gradient.stops.length ? `linear-gradient(${t.gradient.angle}deg,${t.gradient.stops.join(',')})` : v.figure.color.accent};--zk-font:${t.font}}
*{box-sizing:border-box}
html,body{margin:0;width:${v.width}px;height:${v.height}px;overflow:hidden;background:${v.background};font-family:${t.font}}
.zk-scene{position:absolute;inset:0;width:${v.width}px;height:${v.height}px;transform-origin:50% 50%;overflow:hidden;background:${v.background}}
.zk-title{position:absolute;left:160px;right:160px;top:420px;margin:0;color:${v.ink};font-size:80px;line-height:1.3;font-weight:800;text-align:center}
.zk-claim{position:absolute;left:160px;right:160px;top:96px;margin:0;color:${v.ink};font-size:50px;line-height:1.38;font-weight:800;text-align:center}
.zk-scene[data-kind=auto] .zk-fig{position:absolute;left:160px;top:270px;width:1600px;height:560px}
.zk-fig>svg{width:100%;height:100%;overflow:visible}
.zk-table{display:flex;align-items:center;justify-content:center}
.zk-table table{border-collapse:collapse;color:${v.ink};font-size:34px;line-height:1.4}
.zk-table th{text-align:left;padding:14px 26px;border-bottom:4px solid var(--zk-yellow)}
.zk-table td{padding:14px 26px;border-bottom:2px solid rgba(255,255,255,.25)}
#zk-sub{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);max-width:1240px;padding:12px 30px;border-radius:16px;background:${v.subtitle.band}cc;color:${v.subtitle.ink};font-size:40px;line-height:1.45;font-weight:700;text-align:center;visibility:hidden}
#zk-fade{position:absolute;inset:0;background:#000;opacity:1}
`;

function sceneHtml(sc) {
  const vars = [
    `--narration-start:${sc.narrStart}s`,
    `--duration:${(sc.end - sc.start).toFixed(3)}s`,
    ...sc.lines.flatMap((l, i) => [`--l${i + 1}:${(sc.narrStart + l.start).toFixed(3)}s`, `--l${i + 1}-end:${(sc.narrStart + l.end).toFixed(3)}s`]),
    ...Object.entries(sc.markers).map(([k, v]) => `--${k}:${v.toFixed(3)}s`),
  ].join(';');
  // manual を付けた図は、自動の動きを付けずに置く。AI が data-label で部品を狙って動かすときに使う。
  // 図の中の名前（矢印の印やグラデーション）には、シーンの番号を付ける。1つのページに図がいくつも入ると、同じ名前は最初の図を指す。
  // 矢印の印は参照した場所ではなく定義した場所の見え方を引き継ぐので、前のシーンが隠れると、後のシーンの矢じりまで消えるため。
  const svg = sc.figureSvg?.replace(/(id="|url\(#|href="#)zk-/g, `$1zk${sc.id}-`);
  const fig = (manual) =>
    sc.figureSvg ? `<div class="zk-fig" data-whole="${sc.whole}"${sc.figureType ? ` data-type="${esc(sc.figureType)}"` : ''}${manual ? ' data-manual' : ''}>${svg}</div>` : sc.tableHtml ? `<div class="zk-fig zk-table" data-whole="true"${manual ? ' data-manual' : ''}>${sc.tableHtml}</div>` : '';
  let inner;
  if (sc.kind === 'title') inner = `<h1 class="zk-title">${esc(sc.title)}</h1>`;
  else if (sc.kind === 'auto') inner = `<h2 class="zk-claim">${esc(sc.claim)}</h2>${fig(false)}`;
  else inner = wrapScripts(sc.motionHtml, sc.id).replace(/<zk-figure(\s+manual)?>\s*<\/zk-figure>/gi, (_, m) => fig(Boolean(m)));
  return `<section class="zk-scene" data-id="${sc.id}" data-kind="${sc.kind}" style="${vars}">${inner}</section>`;
}

// only を渡すと、そのシーンだけを入れたページにする。シーンを1つずつ検査するときに使う。
export function pageHtml(plan, tokens, only = null) {
  const v = tokens.video;
  // ページの中では、図とシーンの HTML は DOM に入っているので、時間割からは外す。
  const { motions = {}, ...rest } = plan;
  const lite = { ...rest, scenes: plan.scenes.map(({ figureSvg, tableHtml, motionHtml, findings, ...s }) => s) };
  const runtime = fs.readFileSync(path.join(root, 'src/video/runtime.browser.js'), 'utf8');
  const scenes = plan.scenes.filter((s) => only == null || s.id === only);
  // ページのシーンで使う独自の型の動きだけを入れる。AI のシーンのスクリプトと同じく、Chromium の中だけで動く。
  const used = [...new Set(scenes.map((s) => s.figureType).filter((n) => n && motions[n]))];
  const typeScripts = used.map((n) => `<script>zk.__type(${JSON.stringify(n)}, function (fig, ctx) {\n${motions[n].replace(/<\/script/gi, '<\\/script')}\n});</script>`).join('\n');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>${css(tokens, v)}</style>
<script type="application/json" id="zk-plan">${JSON.stringify(lite).replace(/</g, '\\u003c')}</script>
</head><body>
<script>${runtime}</script>
${typeScripts}
${scenes.map(sceneHtml).join('\n')}
<div id="zk-sub"></div><div id="zk-fade"></div>
</body></html>`;
}

class Runaway extends Error {}
const within = (ms, promise, message) => {
  let timer;
  return Promise.race([promise, new Promise((_, ng) => (timer = setTimeout(() => ng(new Runaway(message)), ms)))]).finally(() => clearTimeout(timer));
};

async function launch() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('動画を作るには Playwright が必要です。npm install playwright と npx playwright install chromium を実行してください。');
  }
  const executablePath = machineSetting('chromium');
  return chromium.launch(executablePath ? { executablePath } : {});
}

async function openPage(browser, html, plan, L) {
  const context = await browser.newContext({ viewport: { width: plan.width, height: plan.height }, offline: true });
  await context.route('**/*', (r) => r.abort());
  const page = await context.newPage();
  // ページで捕まえられなかった例外。構文エラーのあるスクリプトは、包んだ関数ごと読めず、zk.__run の中では記録できないため、ここで集める。
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));
  const close = () => within(3000, context.close(), '').catch(() => {});
  try {
    await within(L.loadTimeoutMs, page.setContent(html, { waitUntil: 'load', timeout: 0 }), `読み込みが${L.loadTimeoutMs / 1000}秒で終わりませんでした。無限ループが無いか確かめてください。`);
    await within(L.loadTimeoutMs, page.evaluate(() => document.fonts.ready), 'フォントの読み込みが終わりませんでした。');
    const init = await within(L.loadTimeoutMs, page.evaluate(() => window.zkInit()), '準備が終わりませんでした。');
    const cdp = await context.newCDPSession(page);
    return { page, cdp, close, pageErrors, ...init };
  } catch (e) {
    await close();
    throw e;
  }
}

const shot = async (cdp, plan, scale) => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: plan.width, height: plan.height, scale } })).data, 'base64');

function run(cmd, args, input) {
  return new Promise((ok, ng) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => ng(e.code === 'ENOENT' ? new Error(`${cmd} が見つかりません。ffmpeg をインストールして、コマンドのパスに入れてください。`) : e));
    // 入力を作る側が失敗したときは、プロセスを止め、終わるのを待ってから、その失敗を返す。終わる前に撮り直すと、同じ出力のファイルを奪い合うため。
    let inputError = null;
    p.on('close', (code) => (inputError ? ng(inputError) : code ? ng(new Error(`${cmd} が失敗しました。${Buffer.concat(err).toString().slice(-500)}`)) : ok(Buffer.concat(out))));
    if (input) input(p.stdin).catch((e) => ((inputError = e), p.kill()));
  });
}

// 原稿から時間割を作る。動画、コマの書き出し、検査で共通。
async function prepare(file, project) {
  const theme = themeFor(path.dirname(path.resolve(file)));
  const tokens = theme.tokens;
  // テーマの独自の型の動き。型の名前ごとの、motion.js の中身。
  const motions = Object.fromEntries(theme.types.filter((d) => d.motion).map((d) => [d.name, d.motion]));
  const limits = readJson('contract/limits.json').video;
  const { settings: all } = settingsFor(project);
  const settings = { video: all.video, apiKey: all.gemini?.apiKey ?? null };
  const scenes = scenesOf(fs.readFileSync(file, 'utf8'), file);
  // セクションの根拠（yaml refs）を、Lint と同じ方法で確かめてからシーンに渡す。AI は zk.refs() で読み、画面に出典を示せる。
  const ctx = { baseDir: path.dirname(path.resolve(file)) };
  for (const s of scenes) {
    const items = s.refsBlock ? (await resolveRefs(s.refsBlock, ctx, readJson('contract/limits.json'))).items : [];
    s.refs = items.filter((it) => !it.error).map((it) =>
      it.kind === 'code'
        ? { kind: 'code', label: `${it.repo}:${it.file}#L${it.from}-L${it.to}`, note: it.note, excerpt: it.excerpt }
        : { kind: 'quote', source: it.source, quote: it.quote, ja: it.ja ?? null, verified: Boolean(it.verified) },
    );
    delete s.refsBlock;
  }
  const { voices, silentReason } = await voicesFor(scenes, settings, settings.apiKey ? stateDir(project, 'cache', 'tts') : null);
  const v = tokens.video;
  const planOf = (list) => ({ ...timeline(list, voices), width: v.width, height: v.height, fps: v.fps, limits, motions });
  return { tokens, limits, settings, voices, silentReason, scenes, planOf };
}

// 自由なシーンを、自動の動きに差し替える。
const fallback = (s) => ({ ...s, kind: s.opening || s.ending ? 'title' : 'auto', motionHtml: null, options: { ...DEFAULT_OPTIONS } });

// シーンを1つずつ別のページで開き、ガードレールで調べる。暴走と読み込みの例外は error にし、そのシーンは差し替える。
async function probe(browser, plan, tokens, L, id) {
  const sc = plan.scenes[id];
  const dur = sc.end - sc.start;
  const findings = [...sc.findings];
  let broken = false;
  let p;
  try {
    p = await openPage(browser, pageHtml(plan, tokens, id), plan, L);
    // 効果音の名前と ZzFX の数値を確かめる。間違っていても動画は作れるので warn にする。
    for (const c of p.cues) {
      const bad = c.kind === 'zzfx' ? checkParams(c.params) : presetOf(c.kind) ? null : `効果音「${c.kind}」はありません。${Object.keys(PRESETS).join('、')} から選ぶか、data-zzfx に ZzFX の数値を書いてください。`;
      if (bad) findings.push({ severity: 'warn', rule: 'V302', message: bad });
    }
    for (const e of p.errors) {
      findings.push({ severity: 'error', rule: 'V002', message: e.message });
      broken = true;
    }
    // 1つのシーンだけを入れたページなので、捕まえられなかった例外は、このシーンのものとして扱う。
    // 読み込みのとき（構文エラーなど）と、コマを進めている間（Promise の中の例外など）の両方で集める。
    const drainPageErrors = (when) => {
      for (const m of p.pageErrors.splice(0)) {
        findings.push({ severity: 'error', rule: 'V002', message: `${when}${m}` });
        broken = true;
      }
    };
    drainPageErrors('スクリプトを読み込めませんでした。');
    const seek = (t) => within(L.frameTimeoutMs, p.page.evaluate((T) => (window.zkSeek(T), window.zkPainted()), sc.start + t), `${t.toFixed(1)}秒のコマが${L.frameTimeoutMs / 1000}秒で描けませんでした。無限ループが無いか確かめてください。`);
    const settled = Math.max(0, dur - 0.25);
    // 0.2秒ごとに進める。暴走と例外を、撮る前に見つけるため。
    for (let t = 0; t < dur; t += 0.2) await seek(t);
    await seek(settled);
    const checks = await p.page.evaluate(([i, T]) => window.zkCheck(i, T), [id, settled]);
    findings.push(...checks);
    if (checks.some((f) => f.severity === 'error')) broken = true;
    // 同じ時刻のコマを2回撮って比べる。前の時刻へ戻ってから撮り直す。
    const a = await shot(p.cdp, plan, 0.25);
    await seek(dur * 0.5);
    await seek(settled);
    const b = await shot(p.cdp, plan, 0.25);
    if (!a.equals(b)) findings.push({ severity: 'warn', rule: 'V201', message: '同じ時刻のコマが、撮るたびに変わります。状態を持つ動き（タイマーや requestAnimationFrame で値を積み上げる書き方）を、zk.scene の frame(t) で t から計算する書き方に変えてください。' });
    // zk.sound の例外はページの中で記録するが、ページの外で失敗したときも、検査全体は止めずにこのシーンの指摘にする。
    const sound = await within(L.loadTimeoutMs, p.page.evaluate((i) => window.zkSound(i), id), 'zk.sound の音が作り終わりませんでした。').catch((e) => {
      if (e instanceof Runaway) throw e;
      findings.push({ severity: 'warn', rule: 'V002', message: `zk.sound の音を作れませんでした。${e.message.split('\n')[0]}` });
      return null;
    });
    if (sound && sound.peak > 1) findings.push({ severity: 'warn', rule: 'V301', message: `zk.sound の音の最大値が ${sound.peak.toFixed(2)} で、音が割れます。1以下にしてください。` });
    // frame の中の例外は、その時刻だけの問題のことがあるので warn にとどめる。
    for (const e of await p.page.evaluate(() => window.zkErrors())) findings.push({ severity: 'warn', rule: 'V002', message: e.message });
    drainPageErrors('コマを進めている間に、捕まえられない例外が起きました。');
  } catch (e) {
    if (!(e instanceof Runaway)) throw e;
    findings.push({ severity: 'error', rule: 'V001', message: e.message });
    broken = true;
  } finally {
    await p?.close();
  }
  return { id, heading: sc.heading, kind: sc.kind, findings, broken: broken && sc.kind === 'free' };
}

// すべてのシーンを調べ、使えないシーンを自動の動きに差し替えた時間割を返す。
async function guarded(browser, prep) {
  let plan = prep.planOf(prep.scenes);
  const results = [];
  for (let i = 0; i < plan.scenes.length; i += 4) {
    results.push(...(await Promise.all(plan.scenes.slice(i, i + 4).map((s) => probe(browser, plan, prep.tokens, prep.limits, s.id)))));
  }
  const L = prep.limits;
  plan.scenes.forEach((s, i) => {
    if (s.end - s.start > L.maxSceneSeconds) results[i].findings.push({ severity: 'warn', rule: 'V106', message: `シーンが${(s.end - s.start).toFixed(1)}秒あります。上限の目安は${L.maxSceneSeconds}秒です。` });
    if (s.role && s.end - s.start > L.maxShotSeconds) results[i].findings.push({ severity: 'warn', rule: 'V107', message: `ショットが${(s.end - s.start).toFixed(1)}秒あります。目安は${L.maxShotSeconds}秒までです。ショットを分けてください。` });
  });
  if (plan.duration > L.maxTotalSeconds) results[0].findings.push({ severity: 'warn', rule: 'V106', message: `動画全体が${plan.duration.toFixed(0)}秒あります。上限の目安は${L.maxTotalSeconds}秒です。` });
  if (results.some((r) => r.broken)) {
    prep.scenes = prep.scenes.map((s, i) => (results[i].broken ? fallback(s) : s));
    results.filter((r) => r.broken).forEach((r) => r.findings.push({ severity: 'error', rule: 'V000', message: 'このシーンは、ガードレールに引っかかったため自動の動きに差し替えました。' }));
    plan = prep.planOf(prep.scenes);
  }
  return { plan, results };
}

// 指定した時刻のコマを PNG に書き出す。sheet にすると、シーンごとに6つの時刻を並べた1枚の画像にする。検査の結果も返す。
// project を省略したときは、原稿のフォルダからプロジェクトの根を探す。
export async function frames(file, { times = [], sheet = false, scene = null, project = projectOf(path.dirname(path.resolve(file))) } = {}) {
  const prep = await prepare(file, project);
  const browser = await launch();
  const stem = file.replace(/\.md$/, '');
  try {
    let { plan, results } = await guarded(browser, prep);
    for (let attempt = 0; ; attempt++) {
      try {
        const files = await capture(browser, plan, prep, { times, sheet, scene, stem });
        return { files, results, duration: plan.duration, scenes: plan.scenes.map((s) => ({ id: s.id, heading: s.heading, kind: s.kind, start: s.start, end: s.end, markers: s.markers })), silentReason: prep.silentReason };
      } catch (e) {
        if (!(e.runaway && attempt < 2)) throw e;
        prep.scenes = prep.scenes.map((s, i) => (e.runaway.includes(i) && s.kind === 'free' ? fallback(s) : s));
        plan = prep.planOf(prep.scenes);
        e.runaway.forEach((i) => results[i].findings.push({ severity: 'error', rule: 'V001', message: `${e.message} このシーンは自動の動きに差し替えました。` }));
      }
    }
  } finally {
    await browser.close();
  }
}

// 暴走したときに、どのシーンかを付けて投げ直す。切り替えの途中なら、前後の2つのシーンを候補にする。
async function seekGuarded(page, plan, L, T) {
  try {
    await within(L.frameTimeoutMs, page.evaluate((t) => (window.zkSeek(t), window.zkPainted()), T), `${T.toFixed(1)}秒のコマが${L.frameTimeoutMs / 1000}秒で描けませんでした。無限ループが無いか確かめてください。`);
  } catch (e) {
    if (e instanceof Runaway) e.runaway = plan.scenes.filter((s) => T >= s.start - 1 && T <= s.end + 1 && s.kind === 'free').map((s) => s.id);
    throw e;
  }
}

async function capture(browser, plan, prep, { times, sheet, scene, stem }) {
  const p = await openPage(browser, pageHtml(plan, prep.tokens), plan, prep.limits);
  const files = [];
  try {
    const seek = (T) => seekGuarded(p.page, plan, prep.limits, T);
    for (const t of [...times].sort((a, b) => a - b)) {
      await seek(t);
      const name = `${stem}.frame-${t.toFixed(2)}.png`;
      fs.writeFileSync(name, await shot(p.cdp, plan, 1));
      files.push(name);
    }
    if (sheet) {
      for (const sc of plan.scenes.filter((s) => scene == null || s.id === scene)) {
        const dur = sc.end - sc.start;
        const imgs = [];
        for (const t of [0.08, 0.25, 0.42, 0.59, 0.76, 0.97].map((r) => r * dur)) {
          await seek(sc.start + t);
          imgs.push({ t, data: (await shot(p.cdp, plan, 1 / 3)).toString('base64') });
        }
        const name = `${stem}.sheet-${sc.id}.png`;
        fs.writeFileSync(name, await composeSheet(browser, sc, imgs));
        files.push(name);
      }
    }
  } finally {
    await p.close();
  }
  return files;
}

// 6コマを3列2段に並べ、時刻を添える。
async function composeSheet(browser, sc, imgs) {
  const context = await browser.newContext({ viewport: { width: 1940, height: 820 }, offline: true });
  const page = await context.newPage();
  await page.setContent(`<html><body style="margin:0;background:#222;font:600 22px sans-serif;color:#fff;width:1940px">
<div style="padding:10px 14px">シーン${sc.id}「${esc(sc.heading)}」 ${sc.kind}  ${(sc.end - sc.start).toFixed(1)}秒</div>
<div style="display:grid;grid-template-columns:repeat(3,640px);gap:6px;padding:0 6px">${imgs.map((i) => `<div><img src="data:image/png;base64,${i.data}" width="640" height="360" style="display:block"><div style="padding:4px 2px">${i.t.toFixed(1)}秒</div></div>`).join('')}</div></body></html>`);
  const png = await page.screenshot({ fullPage: true });
  await context.close();
  return png;
}

export async function makeVideo(file, { out, project = projectOf(path.dirname(path.resolve(file))), draft = false, onProgress = () => {} } = {}) {
  const prep = await prepare(file, project);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-video-'));
  const workers = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
  // 撮影は1つのブラウザの中では直列になるので、区間ごとに別のブラウザを使う。
  // 一部の起動が失敗しても、起動できた分は必ず閉じる。すべての起動を待ってから、失敗を投げる。
  const launched = await Promise.allSettled(Array.from({ length: workers }, launch));
  const browsers = launched.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  try {
    const failed = launched.find((x) => x.status === 'rejected');
    if (failed) throw failed.reason;
    let { plan, results } = await guarded(browsers[0], prep);
    // 検査した時刻の間で暴走したときは、そのシーンを差し替えて撮り直す。2回までにする。
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await render(browsers, plan, prep, { tmp, draft, onProgress });
        const target = out ?? file.replace(/\.md$/, '') + '.mp4';
        await mux(r, plan, prep, tmp, target);
        return { file: target, duration: plan.duration, frames: r.total, silentReason: prep.silentReason, cues: r.cues.length, results };
      } catch (e) {
        if (!(e.runaway && attempt < 2)) throw e;
        prep.scenes = prep.scenes.map((s, i) => (e.runaway.includes(i) && s.kind === 'free' ? fallback(s) : s));
        plan = prep.planOf(prep.scenes);
        e.runaway.forEach((i) => results[i].findings.push({ severity: 'error', rule: 'V001', message: `${e.message} このシーンは自動の動きに差し替えました。` }));
      }
    }
  } finally {
    await Promise.all(browsers.map((b) => b.close()));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function render(browsers, plan, prep, { tmp, draft, onProgress }) {
  const L = prep.limits;
  const fps = draft ? 15 : plan.fps;
  const scale = draft ? 0.5 : 1;
  const total = Math.ceil(plan.duration * fps);
  const per = Math.ceil(total / browsers.length);
  const html = pageHtml(plan, prep.tokens);
  let done = 0;
  let cues = [];
  const sounds = [];
  // 1つの区間が失敗したら、ほかの区間も止める。撮り直しは、すべての区間が止まって ffmpeg も終わってから始める。
  // 動いたままの区間が、撮り直しと同じブラウザと seg-N.mp4 を同時に使わないようにするため。
  let stop = false;
  const settled = await Promise.allSettled(
    browsers.map(async (browser, w) => {
      const a = w * per;
      const b = Math.min(total, a + per);
      if (a >= b) return null;
      const seg = path.join(tmp, `seg-${w}.mp4`).replaceAll('\\', '/');
      const p = await openPage(browser, html, plan, L);
      try {
        if (w === 0) {
          cues = p.cues;
          for (const sc of plan.scenes) {
            const s = await within(L.loadTimeoutMs, p.page.evaluate((i) => window.zkSound(i), sc.id), '').catch(() => null);
            if (s) sounds.push({ at: sc.start, buf: Buffer.from(s.data, 'base64') });
          }
        }
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', seg], async (stdin) => {
          try {
            for (let f = a; f < b && !stop; f++) {
              await seekGuarded(p.page, plan, L, f / fps);
              if (!stdin.write(await shot(p.cdp, plan, scale))) await once(stdin, 'drain');
              if (++done % 30 === 0) onProgress(done, total);
            }
          } catch (e) {
            stop = true;
            throw e;
          } finally {
            stdin.end();
          }
        });
      } finally {
        await p.close();
      }
      if (stop) throw new Error('ほかの区間が失敗したため、撮影を止めました。');
      return seg;
    }),
  );
  // 暴走による失敗を優先して投げる。makeVideo がそのシーンを差し替えて撮り直すため。
  const failures = settled.filter((x) => x.status === 'rejected').map((x) => x.reason);
  if (failures.length) throw failures.find((e) => e.runaway) ?? failures[0];
  return { segments: settled.map((x) => x.value).filter(Boolean), total, cues, sounds };
}

// 音声を作って、映像の区間とつなぐ。ナレーション、効果音、AI が作った音、シーンの切り替えの風切り音を足す。
async function mux(r, plan, prep, tmp, target) {
  const { settings, voices } = prep;
  const parts = [];
  voices.forEach((v, i) => v.samples && parts.push({ at: plan.scenes[i].start + plan.scenes[i].narrStart, samples: v.samples, rate: v.rate }));
  for (const s of r.sounds) {
    const pcm = new Int16Array(s.buf.buffer.slice(s.buf.byteOffset, s.buf.byteOffset + s.buf.length));
    parts.push({ at: s.at, samples: Float32Array.from(pcm, (x) => x / 32768), rate: RATE });
  }
  if (settings.video.sfx.enabled) {
    const files = {};
    for (const [k, f] of Object.entries(settings.video.sfx.files)) {
      if (!f) continue;
      const raw = await run('ffmpeg', ['-loglevel', 'error', '-i', f, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-']);
      files[k] = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    }
    const s = plan.scenes;
    const all = [
      ...r.cues.filter((c) => s[c.scene]).map((c) => ({ ...c, t: s[c.scene].start + c.t })),
      // cut の切り替えには風切り音を付けない。
      ...s.slice(1).map((x, i) => ({ scene: x.id, t: s[i].end, kind: 'whoosh', dur: x.start - s[i].end })).filter((c) => c.dur > 0),
    ];
    const gain = settings.video.sfx.volume * 0.25;
    for (const p of await voiceCues(all, files)) parts.push({ ...p, gain });
  }
  // BGM。設定の video.bgm に書いた曲を、ナレーションの間だけ小さくして流す。
  if (settings.video.bgm) {
    const raw = await run('ffmpeg', ['-loglevel', 'error', '-i', settings.video.bgm, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-']);
    const song = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    const talk = plan.scenes.flatMap((s) => s.lines.map((l) => [s.start + s.narrStart + l.start, s.start + s.narrStart + l.end]));
    parts.push({ at: 0, samples: bgmTrack(song, plan.duration, talk, { volume: settings.video.bgmVolume }) });
  }
  const audio = path.join(tmp, 'audio.wav');
  fs.writeFileSync(audio, wav16(mix(plan.duration, parts)));
  const list = path.join(tmp, 'list.txt');
  // ffmpeg の concat の書式では、引用符の中の ' を '\'' と書く。一時フォルダのパスに ' が入ることがあるため。
  fs.writeFileSync(list, r.segments.map((x) => `file '${x.replace(/'/g, "'\\''")}'`).join('\n'));
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', audio, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', target]);
}
