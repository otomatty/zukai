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
import { readJson, root } from '../lint/index.ts';
import { themeFor } from '../theme.ts';
import { esc } from '../figures/svg.ts';
import { settingsFor, projectOf, stateDir, machineSetting } from '../config.ts';
import { scenesOf, timeline, wrapScripts, DEFAULT_OPTIONS } from './script.ts';
import { voicesFor } from './tts.ts';
import { resolveRefs } from '../refs.ts';
import type { CodeRef, QuoteRef } from '../refs.ts';
import { RATE, mix, voiceCues, wav16, presetOf, checkParams, PRESETS, bgmTrack } from './sfx.ts';
import type { Writable } from 'node:stream';
import type { Browser, BrowserType, CDPSession, Page } from 'playwright-core';
import type { Limits, Tokens } from '../types.ts';
import type { Scene, TimedScene, Timeline, VideoFinding, Voice } from './script.ts';
import type { VoiceSettings } from './tts.ts';
import type { Part } from './sfx.ts';
import type { Cue, PageError, PagePlan } from './page.d.ts';

type VideoLimits = Limits['video'];
// 動画の時間割。シーンの時間割に、画面の大きさ、上限、テーマの独自の型の動き（型の名前ごとの motion.js の中身）を足したもの。
type Plan = Timeline<Scene> & { width: number; height: number; fps: number; limits: VideoLimits; motions: Record<string, string> };
type PlanScene = TimedScene<Scene>;

// シーンを検査した結果。broken のシーンは自動の動きに差し替え、dropMotion のシーンは型の動きを外す。
export interface SceneResult {
  id: number;
  heading: string;
  kind: Scene['kind'];
  findings: VideoFinding[];
  broken: boolean;
  dropMotion: boolean;
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

const css = (t: Tokens, v: Tokens['video']) => `
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

function sceneHtml(sc: PlanScene): string {
  const vars = [
    `--narration-start:${sc.narrStart}s`,
    `--duration:${(sc.end - sc.start).toFixed(3)}s`,
    ...sc.lines.flatMap((l, i) => [`--l${i + 1}:${(sc.narrStart + l.start).toFixed(3)}s`, `--l${i + 1}-end:${(sc.narrStart + l.end).toFixed(3)}s`]),
    ...Object.entries(sc.markers).map(([k, v]) => `--${k}:${v.toFixed(3)}s`),
  ].join(';');
  // manual を付けた図は、自動の動きを付けずに置く。AI が data-label で部品を狙って動かすときに使う。
  // 図の中の名前（矢印の印やグラデーション）には、シーンの番号を付ける。1つのページに図がいくつも入ると、同じ名前は最初の図を指す。
  // 矢印の印は参照した場所ではなく定義した場所の見え方を引き継ぐので、前のシーンが隠れると、後のシーンの矢じりまで消えるため。
  // 同じ図を複数のショットで使うこともあるので、zk- で始まる名前に限らず、すべての名前と参照に付ける。
  const svg = sc.figureSvg?.replace(/(\bid="|url\((['"]?)#|href="#)/g, (m) => `${m}s${sc.id}-`);
  const fig = (manual: boolean) =>
    sc.figureSvg ? `<div class="zk-fig" data-whole="${sc.whole}"${sc.figureType ? ` data-type="${esc(sc.figureType)}"` : ''}${manual ? ' data-manual' : ''}>${svg}</div>` : sc.tableHtml ? `<div class="zk-fig zk-table" data-whole="true"${manual ? ' data-manual' : ''}>${sc.tableHtml}</div>` : '';
  let inner: string;
  if (sc.kind === 'title') inner = `<h1 class="zk-title">${esc(sc.title)}</h1>`;
  else if (sc.kind === 'auto') inner = `<h2 class="zk-claim">${esc(sc.claim)}</h2>${fig(false)}`;
  // 自由なシーンは、必ずシーンの HTML を持つ。
  else inner = wrapScripts(sc.motionHtml!, sc.id).replace(/<zk-figure(\s+manual)?>\s*<\/zk-figure>/gi, (_, m) => fig(Boolean(m)));
  return `<section class="zk-scene" data-id="${sc.id}" data-kind="${sc.kind}" style="${vars}">${inner}</section>`;
}

// ページに入れる、時刻を制御するスクリプト。シーンを1つずつ検査するたびに読み直さない。
let runtimeJs: string | undefined;

// only を渡すと、そのシーンだけを入れたページにする。シーンを1つずつ検査するときに使う。
// 型の動き（motions）は無くてもよく、中身の無い型は飛ばす。
export function pageHtml(plan: Omit<Plan, 'motions'> & { motions?: Record<string, string | null> }, tokens: Tokens, only: number | null = null): string {
  const v = tokens.video;
  // ページの中では、図とシーンの HTML は DOM に入っているので、時間割からは外す。
  const { motions = {}, ...rest } = plan;
  const lite: PagePlan = { ...rest, scenes: plan.scenes.map(({ figureSvg, tableHtml, motionHtml, findings, ...s }) => s) };
  const runtime = (runtimeJs ??= fs.readFileSync(path.join(root, 'src/video/runtime.browser.js'), 'utf8'));
  const scenes = plan.scenes.filter((s) => only == null || s.id === only);
  // ページのシーンで使う独自の型の動きだけを入れる。AI のシーンのスクリプトと同じく、Chromium の中だけで動く。
  const used = [...new Set(scenes.map((s) => s.figureType).filter((n) => n && motions[n]) as string[])];
  const typeScripts = used.map((n) => `<script>zk.__type(${JSON.stringify(n)}, function (fig, ctx) {\n${motions[n]!.replace(/<\/script/gi, '<\\/script')}\n});</script>`).join('\n');
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

// 時間の上限を超えたこと。runaway は、暴走した候補のシーンの番号。
class Runaway extends Error {
  declare runaway?: number[];
}
const within = <T>(ms: number, promise: Promise<T>, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_, ng) => (timer = setTimeout(() => ng(new Runaway(message)), ms)))]).finally(() => clearTimeout(timer));
};

async function launch(): Promise<Browser> {
  let chromium: BrowserType;
  try {
    // playwright は使う人だけが入れるので、型は同じ API を持つ playwright-core から取る。名前を文字列にして、型の検査で探さないようにする。
    ({ chromium } = (await import('playwright' as string)) as typeof import('playwright-core'));
  } catch {
    throw new Error('動画を作るには Playwright が必要です。npm install playwright と npx playwright install chromium を実行してください。');
  }
  // chromium の設定は、実行ファイルのパス。
  const executablePath = machineSetting('chromium') as string | null;
  return chromium.launch(executablePath ? { executablePath } : {});
}

// 開いたページ。cues と errors は、zkInit が返した効果音のきっかけと、読み込み中の例外。
interface OpenPage {
  page: Page;
  cdp: CDPSession;
  close: () => Promise<void>;
  pageErrors: string[];
  cues: Cue[];
  errors: PageError[];
}

async function openPage(browser: Browser, html: string, plan: Plan, L: VideoLimits): Promise<OpenPage> {
  const context = await browser.newContext({ viewport: { width: plan.width, height: plan.height }, offline: true });
  await context.route('**/*', (r) => r.abort());
  const page = await context.newPage();
  // ページで捕まえられなかった例外。構文エラーのあるスクリプトは、包んだ関数ごと読めず、zk.__run の中では記録できないため、ここで集める。
  const pageErrors: string[] = [];
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

// format を jpeg にすると、Chromium が PNG に圧縮する時間を省ける。動画のコマは、どのみち x264 で圧縮し直すので、jpeg にする。
// 書き出すコマの画像と、検査で見比べるコマは png にする。
const shot = async (cdp: CDPSession, plan: Plan, scale: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> =>
  Buffer.from((await cdp.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 92 } : {}), optimizeForSpeed: true, clip: { x: 0, y: 0, width: plan.width, height: plan.height, scale } })).data, 'base64');

function run(cmd: string, args: string[], input?: (stdin: Writable) => Promise<void>): Promise<Buffer> {
  return new Promise((ok, ng) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    // 出力は pipe にしたので、必ずある。
    p.stdout!.on('data', (d: Buffer) => out.push(d));
    p.stderr!.on('data', (d: Buffer) => err.push(d));
    p.on('error', (e: NodeJS.ErrnoException) => ng(e.code === 'ENOENT' ? new Error(`${cmd} が見つかりません。ffmpeg をインストールして、コマンドのパスに入れてください。`) : e));
    // 入力を作る側が失敗したときは、プロセスを止め、終わるのを待ってから、その失敗を返す。終わる前に撮り直すと、同じ出力のファイルを奪い合うため。
    let inputError: unknown = null;
    p.on('close', (code) => (inputError ? ng(inputError) : code ? ng(new Error(`${cmd} が失敗しました。${Buffer.concat(err).toString().slice(-500)}`)) : ok(Buffer.concat(out))));
    if (input) input(p.stdin!).catch((e) => ((inputError = e), p.kill()));
  });
}

// 原稿から時間割を作る。動画、コマの書き出し、検査で共通。
// 時間割を作る材料。scenes は、ガードレールで差し替えるたびに書き換える。
interface Prep {
  tokens: Tokens;
  limits: VideoLimits;
  settings: VoiceSettings;
  voices: Voice[];
  silentReason: string | null;
  scenes: Scene[];
  planOf(list: Scene[]): Plan;
}

async function prepare(file: string, project: string): Promise<Prep> {
  const theme = themeFor(path.dirname(path.resolve(file)));
  const tokens = theme.tokens;
  // テーマの独自の型の動き。型の名前ごとの、motion.js の中身。
  const motions = Object.fromEntries(theme.types.filter((d) => d.motion).map((d) => [d.name, d.motion])) as Record<string, string>;
  const limits: VideoLimits = readJson('contract/limits.json').video;
  const { settings: all } = settingsFor(project);
  const settings: VoiceSettings = { video: all.video, apiKey: all.gemini?.apiKey ?? null };
  const scenes = scenesOf(fs.readFileSync(file, 'utf8'), file);
  // セクションの根拠（yaml refs）を、Lint と同じ方法で確かめてからシーンに渡す。AI は zk.refs() で読み、画面に出典を示せる。
  const ctx = { baseDir: path.dirname(path.resolve(file)) };
  for (const s of scenes) {
    const items = s.refsBlock ? (await resolveRefs(s.refsBlock, ctx, readJson('contract/limits.json'))).items : [];
    s.refs = items.filter((it): it is CodeRef | QuoteRef => !it.error).map((it) =>
      it.kind === 'code'
        ? { kind: 'code', label: `${it.repo}:${it.file}#L${it.from}-L${it.to}`, note: it.note, excerpt: it.excerpt }
        : { kind: 'quote', source: it.source, quote: it.quote, ja: it.ja ?? null, verified: Boolean(it.verified) },
    );
    delete s.refsBlock;
  }
  const { voices, silentReason } = await voicesFor(scenes, settings, settings.apiKey ? stateDir(project, 'cache', 'tts') : null);
  const v = tokens.video;
  const planOf = (list: Scene[]): Plan => ({ ...timeline(list, voices), width: v.width, height: v.height, fps: v.fps, limits, motions });
  return { tokens, limits, settings, voices, silentReason, scenes, planOf };
}

// 自由なシーンを、自動の動きに差し替える。
const fallback = (s: Scene): Scene => ({ ...s, kind: s.opening || s.ending ? 'title' : 'auto', motionHtml: null, options: { ...DEFAULT_OPTIONS } });

// シーンを1つずつ別のページで開き、ガードレールで調べる。暴走と読み込みの例外は error にし、そのシーンは差し替える。
async function probe(browser: Browser, plan: Plan, tokens: Tokens, L: VideoLimits, id: number): Promise<SceneResult> {
  const sc = plan.scenes[id];
  const dur = sc.end - sc.start;
  const findings = [...sc.findings];
  let broken = false;
  let dropMotion = false;
  let p: OpenPage | undefined;
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
    const drainPageErrors = (when: string) => {
      for (const m of p!.pageErrors.splice(0)) {
        findings.push({ severity: 'error', rule: 'V002', message: `${when}${m}` });
        broken = true;
      }
    };
    drainPageErrors('スクリプトを読み込めませんでした。');
    const seek = (t: number) => within(L.frameTimeoutMs, p!.page.evaluate((T) => (window.zkSeek(T), window.zkPainted()), sc.start + t), `${t.toFixed(1)}秒のコマが${L.frameTimeoutMs / 1000}秒で描けませんでした。無限ループが無いか確かめてください。`);
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
    const sound = await within(L.loadTimeoutMs, p.page.evaluate((i) => window.zkSound(i), id), 'zk.sound の音が作り終わりませんでした。').catch((e: Error) => {
      if (e instanceof Runaway) throw e;
      findings.push({ severity: 'warn', rule: 'V002', message: `zk.sound の音を作れませんでした。${e.message.split('\n')[0]}` });
      return null;
    });
    if (sound && sound.peak > 1) findings.push({ severity: 'warn', rule: 'V301', message: `zk.sound の音の最大値が ${sound.peak.toFixed(2)} で、音が割れます。1以下にしてください。` });
    // frame の中の例外は、その時刻だけの問題のことがあるので warn にとどめる。
    for (const e of await p.page.evaluate(() => window.zkErrors())) findings.push({ severity: 'warn', rule: 'V002', message: e.message });
    // 型の動きが例外を出したシーンは、仕上げでは型の動きを使わない。途中で切り替えると、型の動きが登録した効果音が、自動の動きの音と一緒に残るため。
    dropMotion = (await p.page.evaluate(() => window.zkMotionFailed())).includes(id);
    drainPageErrors('コマを進めている間に、捕まえられない例外が起きました。');
  } catch (e) {
    if (!(e instanceof Runaway)) throw e;
    findings.push({ severity: 'error', rule: 'V001', message: e.message });
    broken = true;
  } finally {
    await p?.close();
  }
  return { id, heading: sc.heading, kind: sc.kind, findings, broken: broken && sc.kind === 'free', dropMotion };
}

// すべてのシーンを調べ、使えないシーンを自動の動きに差し替えた時間割を返す。
// ブラウザが複数あれば、シーンを順に割り振る。1つのブラウザでは、4つまで同時に調べる。
async function guarded(browsers: Browser[], prep: Prep): Promise<{ plan: Plan; results: SceneResult[] }> {
  let plan = prep.planOf(prep.scenes);
  const results: SceneResult[] = [];
  const batch = 4 * browsers.length;
  for (let i = 0; i < plan.scenes.length; i += batch) {
    results.push(...(await Promise.all(plan.scenes.slice(i, i + batch).map((s, j) => probe(browsers[j % browsers.length], plan, prep.tokens, prep.limits, s.id)))));
  }
  const L = prep.limits;
  plan.scenes.forEach((s, i) => {
    if (s.end - s.start > L.maxSceneSeconds) results[i].findings.push({ severity: 'warn', rule: 'V106', message: `シーンが${(s.end - s.start).toFixed(1)}秒あります。上限の目安は${L.maxSceneSeconds}秒です。` });
    if (s.role && s.end - s.start > L.maxShotSeconds) results[i].findings.push({ severity: 'warn', rule: 'V107', message: `ショットが${(s.end - s.start).toFixed(1)}秒あります。目安は${L.maxShotSeconds}秒までです。ショットを分けてください。` });
  });
  if (plan.duration > L.maxTotalSeconds) results[0].findings.push({ severity: 'warn', rule: 'V106', message: `動画全体が${plan.duration.toFixed(0)}秒あります。上限の目安は${L.maxTotalSeconds}秒です。` });
  if (results.some((r) => r.broken || r.dropMotion)) {
    prep.scenes = prep.scenes.map((s, i) => {
      const next = results[i].broken ? fallback(s) : s;
      return results[i].dropMotion ? { ...next, figureType: null } : next;
    });
    results.filter((r) => r.broken).forEach((r) => r.findings.push({ severity: 'error', rule: 'V000', message: 'このシーンは、ガードレールに引っかかったため自動の動きに差し替えました。' }));
    results.filter((r) => r.dropMotion && !r.broken).forEach((r) => r.findings.push({ severity: 'warn', rule: 'V002', message: 'このシーンの図は、型の動き（motion.js）が例外を出したため、自動の動きで書き出します。' }));
    plan = prep.planOf(prep.scenes);
  }
  return { plan, results };
}

// 指定した時刻のコマを PNG に書き出す。sheet にすると、シーンごとに6つの時刻を並べた1枚の画像にする。検査の結果も返す。
// project を省略したときは、原稿のフォルダからプロジェクトの根を探す。
export async function frames(file: string, { times = [], sheet = false, scene = null, project = projectOf(path.dirname(path.resolve(file))) }: { times?: number[]; sheet?: boolean; scene?: number | null; project?: string } = {}) {
  const prep = await prepare(file, project);
  const browser = await launch();
  const stem = file.replace(/\.md$/, '');
  try {
    let { plan, results } = await guarded([browser], prep);
    for (let attempt = 0; ; attempt++) {
      try {
        const files = await capture(browser, plan, prep, { times, sheet, scene, stem });
        return { files, results, duration: plan.duration, scenes: plan.scenes.map((s) => ({ id: s.id, heading: s.heading, kind: s.kind, start: s.start, end: s.end, markers: s.markers })), silentReason: prep.silentReason };
      } catch (err) {
        // 暴走したときだけ runaway がある。
        const e = err as Runaway;
        if (!(e.runaway && attempt < 2)) throw e;
        prep.scenes = prep.scenes.map((s, i) => (e.runaway!.includes(i) && s.kind === 'free' ? fallback(s) : s));
        plan = prep.planOf(prep.scenes);
        e.runaway.forEach((i) => results[i].findings.push({ severity: 'error', rule: 'V001', message: `${e.message} このシーンは自動の動きに差し替えました。` }));
      }
    }
  } finally {
    await browser.close();
  }
}

// 暴走したときに、どのシーンかを付けて投げ直す。切り替えの途中なら、前後の2つのシーンを候補にする。
async function seekGuarded(page: Page, plan: Plan, L: VideoLimits, T: number): Promise<void> {
  try {
    await within(L.frameTimeoutMs, page.evaluate((t) => (window.zkSeek(t), window.zkPainted()), T), `${T.toFixed(1)}秒のコマが${L.frameTimeoutMs / 1000}秒で描けませんでした。無限ループが無いか確かめてください。`);
  } catch (e) {
    if (e instanceof Runaway) e.runaway = plan.scenes.filter((s) => T >= s.start - 1 && T <= s.end + 1 && s.kind === 'free').map((s) => s.id);
    throw e;
  }
}

async function capture(browser: Browser, plan: Plan, prep: Prep, { times, sheet, scene, stem }: { times: number[]; sheet: boolean; scene: number | null; stem: string }): Promise<string[]> {
  const p = await openPage(browser, pageHtml(plan, prep.tokens), plan, prep.limits);
  const files: string[] = [];
  try {
    const seek = (T: number) => seekGuarded(p.page, plan, prep.limits, T);
    for (const t of [...times].sort((a, b) => a - b)) {
      await seek(t);
      const name = `${stem}.frame-${t.toFixed(2)}.png`;
      fs.writeFileSync(name, await shot(p.cdp, plan, 1));
      files.push(name);
    }
    if (sheet) {
      for (const sc of plan.scenes.filter((s) => scene == null || s.id === scene)) {
        const dur = sc.end - sc.start;
        const imgs: SheetImage[] = [];
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

// 6コマを3列2段に並べ、時刻を添える。data は PNG を base64 にしたもの。
interface SheetImage {
  t: number;
  data: string;
}
async function composeSheet(browser: Browser, sc: PlanScene, imgs: SheetImage[]): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: 1940, height: 820 }, offline: true });
  const page = await context.newPage();
  await page.setContent(`<html><body style="margin:0;background:#222;font:600 22px sans-serif;color:#fff;width:1940px">
<div style="padding:10px 14px">シーン${sc.id}「${esc(sc.heading)}」 ${sc.kind}  ${(sc.end - sc.start).toFixed(1)}秒</div>
<div style="display:grid;grid-template-columns:repeat(3,640px);gap:6px;padding:0 6px">${imgs.map((i) => `<div><img src="data:image/png;base64,${i.data}" width="640" height="360" style="display:block"><div style="padding:4px 2px">${i.t.toFixed(1)}秒</div></div>`).join('')}</div></body></html>`);
  const png = await page.screenshot({ fullPage: true });
  await context.close();
  return png;
}

export async function makeVideo(file: string, { out, project = projectOf(path.dirname(path.resolve(file))), draft = false, onProgress = () => {} }: { out?: string | null; project?: string; draft?: boolean; onProgress?: (done: number, total: number) => void } = {}) {
  const prep = await prepare(file, project);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-video-'));
  const workers = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
  // 撮影は1つのブラウザの中では直列になるので、区間ごとに別のブラウザを使う。
  // 一部の起動が失敗しても、起動できた分は必ず閉じる。すべての起動を待ってから、失敗を投げる。
  const launched = await Promise.allSettled(Array.from({ length: workers }, launch));
  const browsers = launched.filter((x): x is PromiseFulfilledResult<Browser> => x.status === 'fulfilled').map((x) => x.value);
  try {
    const failed = launched.find((x): x is PromiseRejectedResult => x.status === 'rejected');
    if (failed) throw failed.reason;
    let { plan, results } = await guarded(browsers, prep);
    // 検査した時刻の間で暴走したときは、そのシーンを差し替えて撮り直す。2回までにする。
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await render(browsers, plan, prep, { tmp, draft, onProgress });
        const target = out ?? file.replace(/\.md$/, '') + '.mp4';
        await mux(r, plan, prep, tmp, target);
        return { file: target, duration: plan.duration, frames: r.total, silentReason: prep.silentReason, cues: r.cues.length, results };
      } catch (err) {
        // 暴走したときだけ runaway がある。
        const e = err as Runaway;
        if (!(e.runaway && attempt < 2)) throw e;
        prep.scenes = prep.scenes.map((s, i) => (e.runaway!.includes(i) && s.kind === 'free' ? fallback(s) : s));
        plan = prep.planOf(prep.scenes);
        e.runaway.forEach((i) => results[i].findings.push({ severity: 'error', rule: 'V001', message: `${e.message} このシーンは自動の動きに差し替えました。` }));
      }
    }
  } finally {
    await Promise.all(browsers.map((b) => b.close()));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 撮った映像の区間（seg-N.mp4）と、音にするきっかけ。sounds は zk.sound の音（16bit の PCM）を、鳴らす秒と一緒に持つ。
interface Rendered {
  segments: string[];
  total: number;
  cues: Cue[];
  sounds: { at: number; buf: Buffer }[];
}

async function render(browsers: Browser[], plan: Plan, prep: Prep, { tmp, draft, onProgress }: { tmp: string; draft: boolean; onProgress: (done: number, total: number) => void }): Promise<Rendered> {
  const L = prep.limits;
  const fps = draft ? 15 : plan.fps;
  const scale = draft ? 0.5 : 1;
  const total = Math.ceil(plan.duration * fps);
  const per = Math.ceil(total / browsers.length);
  const html = pageHtml(plan, prep.tokens);
  let done = 0;
  let cues: Cue[] = [];
  const sounds: Rendered['sounds'] = [];
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
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', seg], async (stdin) => {
          try {
            for (let f = a; f < b && !stop; f++) {
              await seekGuarded(p.page, plan, L, f / fps);
              if (!stdin.write(await shot(p.cdp, plan, scale, 'jpeg'))) await once(stdin, 'drain');
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
  const failures = settled.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => x.reason as Runaway);
  if (failures.length) throw failures.find((e) => e.runaway) ?? failures[0];
  // 失敗が無いので、すべての区間が終わっている。
  return { segments: settled.map((x) => (x as PromiseFulfilledResult<string | null>).value).filter(Boolean) as string[], total, cues, sounds };
}

// 音声を作って、映像の区間とつなぐ。ナレーション、効果音、AI が作った音、シーンの切り替えの風切り音を足す。
async function mux(r: Rendered, plan: Plan, prep: Prep, tmp: string, target: string): Promise<void> {
  const { settings, voices } = prep;
  const parts: Part[] = [];
  voices.forEach((v, i) => v.samples && parts.push({ at: plan.scenes[i].start + plan.scenes[i].narrStart, samples: v.samples, rate: v.rate }));
  for (const s of r.sounds) {
    const pcm = new Int16Array(s.buf.buffer.slice(s.buf.byteOffset, s.buf.byteOffset + s.buf.length));
    parts.push({ at: s.at, samples: Float32Array.from(pcm, (x) => x / 32768), rate: RATE });
  }
  if (settings.video.sfx.enabled) {
    const files: Record<string, Float32Array> = {};
    for (const [k, f] of Object.entries(settings.video.sfx.files)) {
      if (!f) continue;
      const raw = await run('ffmpeg', ['-loglevel', 'error', '-i', f, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-']);
      files[k] = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    }
    const s = plan.scenes;
    const all = [
      // scene が null のきっかけは、s から引けないので外れる。
      ...r.cues.filter((c) => s[c.scene as number]).map((c) => ({ ...c, t: s[c.scene as number].start + c.t })),
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
    const talk = plan.scenes.flatMap((s) => s.lines.map((l): [number, number] => [s.start + s.narrStart + l.start, s.start + s.narrStart + l.end]));
    parts.push({ at: 0, samples: bgmTrack(song, plan.duration, talk, { volume: settings.video.bgmVolume }) });
  }
  const audio = path.join(tmp, 'audio.wav');
  fs.writeFileSync(audio, wav16(mix(plan.duration, parts)));
  const list = path.join(tmp, 'list.txt');
  // ffmpeg の concat の書式では、引用符の中の ' を '\'' と書く。一時フォルダのパスに ' が入ることがあるため。
  fs.writeFileSync(list, r.segments.map((x) => `file '${x.replace(/'/g, "'\\''")}'`).join('\n'));
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', audio, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', target]);
}
