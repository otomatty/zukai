// 根拠の表示。コードの該当行と、出典の原文を、主張の裏付けとして示す。
// コードの抜粋とリンクは機械が作り、引用は出典の本文と照合する。AI が書いた内容をそのまま信用しない。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { settingsFor, stateDir } from './config.ts';
import type { Limits, RefsBlock, Repo } from './types.ts';

// 検証して表示に使う根拠。rule と error があれば、その根拠は誤り。warn は照合できなかったこと。
export interface CodeRef {
  kind: 'code';
  file: string;
  from: number;
  to: number;
  sha: string | undefined;
  branch: string;
  note: string;
  repo: string;
  host: string | null;
  excerpt: string;
  lang: string;
  url: string | null;
  rule?: undefined;
  error?: undefined;
  warn?: undefined;
}
export interface QuoteRef {
  kind: 'quote';
  quote: string;
  ja?: string;
  source: string;
  url: string;
  license?: string;
  translator: string;
  verified?: boolean;
  fetched?: string | null;
  rule?: string;
  error?: string;
  warn?: string;
}
export interface RefError {
  kind?: undefined;
  rule: string;
  error: string;
  warn?: undefined;
}
export type RefItem = CodeRef | QuoteRef | RefError;

// 原稿の yaml refs の1項目。形は resolveRefs が確かめる。
type RawRef = Record<string, unknown>;
interface RefsConfig {
  repos: Record<string, Repo>;
  dir: string;
}
// 出典の本文。取得できなかったときは unreachable、原稿の誤りは error。
interface Source {
  text?: string;
  fetched?: string | null;
  url?: string;
  error?: string;
  unreachable?: string;
}

// リポジトリの別名と場所。原稿のフォルダからプロジェクトの根を探し、その設定（repos）を読む。repos の path は解決済み。
const reposOf = (baseDir: string): RefsConfig => {
  const cfg = settingsFor(baseDir);
  return { repos: cfg.settings.repos, dir: cfg.project };
};

// 行へのリンク。サービスごとに形式が違うので、ひな形から組み立てる。設定の link で上書きできる。
const templates: Record<string, string> = {
  github: 'https://github.com/{org}/{name}/blob/{ref}/{path}#L{from}-L{to}',
  codecommit: 'https://{region}.console.aws.amazon.com/codesuite/codecommit/repositories/{name}/browse/{ref}/--/{path}?region={region}&lines={from}-{to}',
};
export function linkOf(repo: Repo, v: Record<string, unknown>): string | null {
  const tpl = repo.link ?? (repo.host ? templates[repo.host] : undefined);
  return tpl ? tpl.replace(/\{(\w+)\}/g, (_, k: string) => encodeURI(String(v[k] ?? (repo as Record<string, unknown>)[k] ?? ''))) : null;
}

// 接続先（host、org、name、region）を、クローンのリモート origin から読み取る。
// 設定に書いた値が優先される。リポジトリを CodeCommit から GitHub へ移しても、設定を書き換えずにリンクが切り替わる。
export function fromRemote(url: string): Partial<Pick<Repo, 'host' | 'org' | 'name' | 'region'>> {
  let m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (m) return { host: 'github', org: m[1], name: m[2] };
  m = url.match(/git-codecommit\.([a-z0-9-]+)\.amazonaws\.com\/v1\/repos\/([^/]+?)\/?$/);
  if (m) return { host: 'codecommit', region: m[1], name: m[2] };
  // git-remote-codecommit の形式。codecommit::リージョン://プロファイル@名前
  m = url.match(/^codecommit(?:::([a-z0-9-]+))?:\/\/(?:[^@/]+@)?([^/]+)$/);
  if (m) return { host: 'codecommit', ...(m[1] ? { region: m[1] } : {}), name: m[2] };
  return {};
}

const hostNames: Record<string, string> = { github: 'GitHub', codecommit: 'CodeCommit' };
// 抜粋した行に共通する字下げを取り除く。
const dedent = (lines: string[]) => {
  const n = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0].length));
  return Number.isFinite(n) ? lines.map((l) => l.slice(n)) : lines;
};

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });

function resolveCode(ref: RawRef, config: RefsConfig): CodeRef | RefError {
  const m = String(ref.code).match(/^([\w-]+):(.+?)#L(\d+)(?:-L?(\d+))?$/);
  if (!m) return { rule: 'R001', error: `code「${ref.code}」は「リポジトリの別名:パス#L開始-L終了」の形にしてください。` };
  const [, alias, file, a, b = a] = m as unknown as [string, string, string, string, string?];
  const [from, to] = [Number(a), Number(b)];
  const repo = config.repos[alias];
  if (!repo) return { rule: 'R002', error: `リポジトリの別名「${alias}」が zukai.config.json にありません。` };
  if (from < 1 || to < from) return { rule: 'R001', error: `code「${ref.code}」の行の範囲が正しくありません。` };
  const dir = path.resolve(config.dir, repo.path ?? '.');
  // リポジトリの外のファイルは読まない。../ や絶対パスと、リポジトリの外を指すシンボリックリンクを断る。
  // 抜粋は資料と動画にそのまま載るので、原稿を書いた人が読めるだけのファイルを、共有する生成物に混ぜないため。
  const inside = (base: string, p: string) => {
    const r = path.relative(base, p);
    return Boolean(r) && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r);
  };
  const outside: RefError = { rule: 'R002', error: `ファイル「${file}」は「${alias}」のリポジトリの外を指しています。リポジトリの中のパスを書いてください。` };
  if (path.isAbsolute(file) || /^[a-z]:/i.test(file) || !inside(dir, path.resolve(dir, file))) return outside;
  let remote: ReturnType<typeof fromRemote> = {};
  if (!repo.host || !repo.name) {
    try {
      remote = fromRemote(git(dir, 'remote', 'get-url', 'origin').trim());
    } catch {
      // リモートが無いリポジトリは、設定に書いた値だけを使う。
    }
  }
  const target = { ...remote, ...repo };
  let text: string;
  let sha: string | null = null;
  if (repo.pin === false) {
    // コミットを固定しない設定。作業中のファイルを読み、リンクはブランチを指す。
    if (!fs.existsSync(path.join(dir, file))) return { rule: 'R002', error: `ファイル「${file}」が「${alias}」にありません。` };
    if (!inside(fs.realpathSync(dir), fs.realpathSync(path.join(dir, file)))) return outside;
    text = fs.readFileSync(path.join(dir, file), 'utf8');
  } else {
    try {
      sha = git(dir, 'rev-parse', 'HEAD').trim();
    } catch {
      return { rule: 'R002', error: `「${alias}」（${repo.path}）を Git のリポジトリとして読めません。` };
    }
    try {
      text = git(dir, 'show', `HEAD:${file}`);
    } catch {
      return { rule: 'R002', error: `ファイル「${file}」が「${alias}」の最新のコミットにありません。` };
    }
  }
  const lines = text.split('\n');
  if (to > lines.length) return { rule: 'R002', error: `「${file}」は${lines.length}行です。${to}行目はありません。` };
  const short = sha?.slice(0, 7);
  return {
    kind: 'code', file, from, to, sha: short, branch: repo.branch ?? 'main', note: String(ref.note),
    // 複数のリポジトリを参照する資料で、どのリポジトリのファイルかを示す。
    repo: target.name ?? alias, host: (target.host && hostNames[target.host]) || null,
    excerpt: dedent(lines.slice(from - 1, to)).join('\n'), lang: path.extname(file).slice(1) || 'text',
    url: linkOf(target, { ref: sha ?? repo.branch ?? 'main', path: file, from, to }),
  };
}

// HTML から本文の文字だけを取り出す。
const toText = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
// 照合の前に、空白と引用符の表記のゆれを揃える。
const norm = (s: string) => s.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const isJapanese = (s: string) => (s.match(/[぀-ヿ一-鿿]/g)?.length ?? 0) / Math.max(1, s.length) > 0.2;

async function sourceText(ref: { url: string; snapshot?: unknown }, ctx: { baseDir: string }, config: RefsConfig): Promise<Source> {
  if (ref.snapshot) {
    const p = path.resolve(ctx.baseDir, String(ref.snapshot));
    if (!fs.existsSync(p)) return { error: `snapshot「${ref.snapshot}」がありません。` };
    return { text: fs.readFileSync(p, 'utf8'), fetched: null };
  }
  // 取得した本文は保存しておく。Lint のたびに出典へアクセスしない。
  const cacheDir = path.join(config.dir, '.zukai', 'cache', 'sources');
  const cacheFile = path.join(cacheDir, `${crypto.createHash('sha1').update(ref.url).digest('hex')}.json`);
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  try {
    const res = await fetch(ref.url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'zukai' } });
    if (!res.ok) return { unreachable: `出典が ${res.status} を返しました。` };
    const d = new Date();
    const entry = { url: ref.url, fetched: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`, text: toText(await res.text()) };
    stateDir(config.dir, 'cache', 'sources');
    fs.writeFileSync(cacheFile, JSON.stringify(entry));
    return entry;
  } catch {
    return { unreachable: '出典に接続できません。' };
  }
}

async function resolveQuote(raw: RawRef, ctx: { baseDir: string }, config: RefsConfig, limits: Limits): Promise<QuoteRef | RefError> {
  for (const k of ['quote', 'source', 'url']) if (typeof raw[k] !== 'string' || !raw[k]) return { rule: 'R001', error: `引用には ${k} が必要です。` };
  // quote、source、url は、上で文字と確かめた。ほかの項目は、書かれたまま表示に使う。
  const ref = raw as { quote: string; source: string; url: string; ja?: string; license?: string; translator?: string; snapshot?: unknown };
  if (!/^https?:\/\//.test(ref.url)) return { rule: 'R001', error: `url「${ref.url}」は http か https で始めてください。` };
  const out: QuoteRef = { kind: 'quote', quote: ref.quote, ja: ref.ja, source: ref.source, url: ref.url, license: ref.license, translator: ref.translator ?? 'AIによる翻訳' };
  if (ref.quote.length > limits.refs.quoteMaxChars) return { ...out, rule: 'R006', error: `引用が${ref.quote.length}字あります。上限は${limits.refs.quoteMaxChars}字です。主張に必要な文だけに絞ってください。` };
  if (!isJapanese(ref.quote) && !ref.ja) return { ...out, rule: 'R005', error: '日本語以外の引用には、ja に日本語訳を書いてください。' };
  const src = await sourceText(ref, ctx, config);
  if (src.error) return { ...out, rule: 'R001', error: src.error };
  if (src.unreachable) return { ...out, warn: `${src.unreachable}原文を照合できていません。本文を保存したファイルを snapshot に指定すると照合できます。` };
  if (!norm(src.text ?? '').includes(norm(ref.quote))) return { ...out, rule: 'R003', error: `引用の原文が、出典「${ref.source}」の本文に見つかりません。原文を一字一句そのまま書いてください。` };
  return { ...out, verified: true, fetched: src.fetched };
}

// 根拠のブロックを検証し、表示に必要な情報を揃える。
export async function resolveRefs(block: RefsBlock, ctx: { baseDir: string }, limits: Limits): Promise<{ errors: RefError[]; items: RefItem[] }> {
  if (block.parseError || !Array.isArray(block.list)) return { errors: [{ rule: 'R001', error: block.parseError ? `YAML を読めません。${block.parseError}` : '根拠は、項目の配列で書いてください。' }], items: [] };
  const config = reposOf(ctx.baseDir);
  const items: RefItem[] = [];
  for (const ref of block.list as (RawRef | null)[]) {
    const allowed = ref?.code !== undefined ? ['code', 'note'] : ['quote', 'ja', 'source', 'url', 'license', 'snapshot', 'translator'];
    const unknown = Object.keys(ref ?? {}).filter((k) => !allowed.includes(k));
    if (!ref || (ref.code === undefined && ref.quote === undefined)) items.push({ rule: 'R001', error: '根拠の項目には code か quote を書いてください。' });
    else if (unknown.length) items.push({ rule: 'R001', error: `未定義のキー「${unknown[0]}」があります。使えるキーは ${allowed.join('、')} です。` });
    else if (ref.code !== undefined) items.push(typeof ref.note === 'string' && ref.note ? resolveCode(ref, config) : { rule: 'R001', error: 'コード参照には note（その行が何をしているか）が必要です。' });
    else items.push(await resolveQuote(ref, ctx, config, limits));
  }
  const errors: RefError[] = [];
  if (block.list.length > limits.refs.maxItems) errors.push({ rule: 'R001', error: `根拠が${block.list.length}件あります。上限は${limits.refs.maxItems}件です。` });
  return { errors, items };
}

const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lineLabel = (it: CodeRef) => (it.from === it.to ? `${it.from}行` : `${it.from}〜${it.to}行`);
const repoLabel = (it: CodeRef) => (it.host ? `${it.repo}（${it.host}）` : it.repo);
const pinLabel = (it: CodeRef) => (it.sha ? `コミット ${it.sha} 時点` : `ブランチ ${it.branch} の現在の内容`);

export function refsHtml(items: RefItem[], highlight: (code: string, lang: string) => string): string {
  const cards = items.map((it, i) => {
    const head = `<span class="num">${i + 1}</span>`;
    if (it.kind === 'code') {
      const name = it.url ? `<a class="mono" href="${esc(it.url)}">${esc(it.file)}</a>` : `<span class="mono">${esc(it.file)}</span>`;
      return `<div class="ref" id="ref-${i + 1}"><div class="ref-head">${head}<span class="tag">コード</span><span class="meta">${esc(repoLabel(it))}</span>${name}<span class="meta">${lineLabel(it)}</span><span class="meta right">${pinLabel(it)}</span></div><p>${esc(it.note)}</p>${highlight(it.excerpt, it.lang)}</div>`;
    }
    if (it.kind === 'quote') {
      const meta = [it.fetched ? `取得日 ${it.fetched}` : '', it.license ? `ライセンス ${it.license}` : '', it.verified ? '原文との一致を確認済み' : '原文との一致は未確認'].filter(Boolean).join('　');
      const ja = it.ja ? `<div class="tr-h">日本語訳（${esc(it.translator)}）</div><p>${esc(it.ja)}</p>` : '';
      return `<div class="ref" id="ref-${i + 1}"><div class="ref-head">${head}<span class="tag">引用</span><a href="${esc(it.url)}">${esc(it.source)}</a></div><blockquote>${esc(it.quote)}</blockquote>${ja}<div class="meta">${meta}</div></div>`;
    }
    return `<div class="ref"><div class="ref-head">${head}<span class="tag">確認できない根拠</span></div><p>${esc(it.error)}</p></div>`;
  });
  return `<div class="refs"><div class="refs-h">根拠</div>${cards.join('')}</div>\n`;
}

export function refsStorage(items: RefItem[]): string {
  const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  const parts = items.map((it, i) => {
    if (it.kind === 'code') {
      const name = it.url ? `<a href="${esc(it.url)}">${esc(it.file)}</a>` : esc(it.file);
      return `<p><strong>［${i + 1}］コード</strong> ${esc(repoLabel(it))} ${name} ${lineLabel(it)}（${pinLabel(it)}）</p><p>${esc(it.note)}</p><ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${esc(it.lang)}</ac:parameter><ac:parameter ac:name="firstline">${it.from}</ac:parameter><ac:parameter ac:name="linenumbers">true</ac:parameter><ac:plain-text-body>${cdata(it.excerpt)}</ac:plain-text-body></ac:structured-macro>`;
    }
    if (it.kind === 'quote') {
      const meta = [it.fetched ? `取得日 ${it.fetched}` : '', it.license ? `ライセンス ${it.license}` : '', it.verified ? '原文との一致を確認済み' : '原文との一致は未確認'].filter(Boolean).join('　');
      return `<p><strong>［${i + 1}］引用</strong> <a href="${esc(it.url)}">${esc(it.source)}</a></p><blockquote><p>${esc(it.quote)}</p></blockquote>${it.ja ? `<p>日本語訳（${esc(it.translator)}）: ${esc(it.ja)}</p>` : ''}<p><em>${meta}</em></p>`;
    }
    return '';
  });
  return `<p><strong>根拠</strong></p>${parts.join('')}\n`;
}
