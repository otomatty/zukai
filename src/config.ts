// 設定。置き場所は、だれと共有するかで分ける。
//   team         zukai.config.json          コミットしてチームで共有する
//   local        .zukai/config.json         このPCのこのプロジェクトだけ（.zukai は Git の管理外）
//   user         ~/.zukai/config.json       このPCの全プロジェクト
//   credentials  ~/.zukai/credentials.json  キーとトークン。本人だけが読める権限で置く
// 優先順位は、既定値 < user < team < local < credentials < 環境変数。項目の仕様は contract/settings.json にある。
// 設定ファイルには、変えた値だけを書く。既定値はコードと仕様にだけ置き、あとで既定値を変えたときに全員へ届くようにする。
// このファイルは重い依存を読まない。help、setup、doctor は、依存が欠けた環境でも動く必要があるため。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Origin, Scope, SettingSpec, Settings } from './types.ts';
import { didYouMean, joinList, msg, setMessageLang } from './messages.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const spec: Record<string, SettingSpec> = JSON.parse(fs.readFileSync(path.join(root, 'contract/settings.json'), 'utf8')).items;

// 重ねる順。後ろほど優先する。環境変数は最後に重ねる。
const LAYERS: readonly Scope[] = ['user', 'team', 'local', 'credentials'];
export const scopeNames: Record<Origin, string> = {
  team: 'チーム',
  local: '手元',
  user: 'この PC',
  credentials: '本人だけ',
  env: '環境変数',
  default: '既定値',
};

export const homeDir = () => path.join(os.homedir(), '.zukai');
export const filesOf = (project: string): Record<Scope, string> => ({
  team: path.join(project, 'zukai.config.json'),
  local: path.join(project, '.zukai', 'config.json'),
  user: path.join(homeDir(), 'config.json'),
  credentials: path.join(homeDir(), 'credentials.json'),
});
const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// プロジェクトの根。start から上へたどり、zukai.config.json か .zukai/ が最初に見つかったフォルダにする。
// Git のリポジトリの根に着いたらそこで止める。どれも無ければ start にする。ホームの .zukai は PC の設定なので数えない。
export function projectOf(start: string = process.cwd()): string {
  const home = path.resolve(os.homedir());
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'zukai.config.json'))) return dir;
    if (dir !== home && isDir(path.join(dir, '.zukai'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (dir === path.dirname(dir)) return path.resolve(start);
  }
}

// 機械が作るものの置き場所（.zukai/）。中に .gitignore を置き、プロジェクトの .gitignore を書き換えずに Git の管理から外す。
export function stateDir(project: string, ...sub: string[]): string {
  const base = path.join(project, '.zukai');
  fs.mkdirSync(path.join(base, ...sub), { recursive: true });
  const ignore = path.join(base, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  return path.join(base, ...sub);
}

// 項目の名前から仕様を引く。* は任意の名前（英数字、下線、ハイフン）に当たる。
// __proto__ などは名前に使えない。入れ子の値を組み立てるときに、すべてのオブジェクトの元を書き換えないため。
const SEGMENT = /^(?!(?:__proto__|constructor|prototype)$)[\w-]+$/;
export type NamedSpec = SettingSpec & { name: string };
export function specOf(key: string): NamedSpec | null {
  // 自分の項目だけを見る。toString や __proto__ のような、オブジェクトが元から持つ名前を項目と取り違えないため。
  if (Object.hasOwn(spec, key)) return { name: key, ...spec[key] };
  const k = key.split('.');
  for (const [name, s] of Object.entries(spec)) {
    const p = name.split('.');
    if (p.length === k.length && p.every((x, i) => (x === '*' ? SEGMENT.test(k[i]) : x === k[i]))) return { name, ...s };
  }
  return null;
}

// 書き間違いの候補。編集距離が近い名前を返す。
export function closest(word: string, candidates: Iterable<string>): string | null {
  const dist = (a: string, b: string) => {
    const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best: { c: string; n: number } | null = null;
  for (const c of candidates) {
    const n = dist(word, c);
    if (n <= Math.max(2, Math.floor(c.length / 3)) && (!best || n < best.n)) best = { c, n };
  }
  return best?.c ?? null;
}
const unknownKey = (key: string) => {
  const near = closest(key, Object.keys(spec).filter((n) => !n.includes('*')));
  return msg('config.unknownKey', { key, near: didYouMean(near) });
};

// 書ける置き場所の外に書いた値。
const scopeOnly = (key: string, s: SettingSpec) => msg('config.scopeOnly', { key, scopes: joinList(s.scopes.map((x) => msg('common.quoted', { text: msg(`scope.${x}`) })), 'or') });

// 値の検査。誤りがあれば、その理由を返す。
// null は「なし」を明示する値で、既定値が「なし」の項目（BGM、Confluence の URL など）にだけ書ける。下の置き場所の値を「なし」で上書きする。
// output のように既定値がある項目には書けない。下の置き場所の値が、黙って失われないようにするため。
export function invalid(s: SettingSpec, v: unknown): string | null {
  if (v === null) return s.default === null || !('default' in s) ? null : msg('value.nullDefault', { default: JSON.stringify(s.default) });
  switch (s.type) {
    case 'enum':
      return s.values?.includes(v as string) ? null : msg('value.enum', { values: joinList(s.values ?? []) });
    case 'string':
    case 'path':
      return typeof v === 'string' && v ? null : msg('value.string');
    case 'url': {
      // 「https://」だけのような、接続先の無い値を通さない。
      let u: URL | null = null;
      try {
        u = typeof v === 'string' ? new URL(v) : null;
      } catch {
        // URL として読めない。
      }
      // ? や # を含む URL は、後ろに API のパスを足すと、そのパスが問い合わせの一部になり、別の宛先に届く。
      if (u && (u.search || u.hash)) return msg('value.urlQuery');
      return u && /^https?:$/.test(u.protocol) && u.hostname ? null : msg('value.url');
    }
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return msg('value.number');
      return (s.min !== undefined && v < s.min) || (s.max !== undefined && v > s.max) ? msg('value.range', { min: s.min, max: s.max }) : null;
    case 'boolean':
      return typeof v === 'boolean' ? null : msg('value.boolean');
    case 'terms': {
      if (!Array.isArray(v)) return msg('value.array');
      const strs = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((e) => typeof e === 'string'));
      const bad = v.findIndex((t: Partial<Record<keyof import('./types.ts').Term, unknown>> | null) => !t || typeof t.use !== 'string' || !t.use || !strs(t.avoid) || !strs(t.except) || !strs(t.examples) || (t.actual !== undefined && typeof t.actual !== 'string'));
      return bad < 0 ? null : msg('value.term', { n: bad + 1 });
    }
    default:
      return null;
  }
}

// key の下に、仕様の項目があるか。repos や repos.api のような入れ子の途中の名前に当たる。
const isPrefix = (key: string) => {
  const k = key.split('.');
  return Object.keys(spec).some((name) => {
    const p = name.split('.');
    return p.length > k.length && k.every((x, i) => (p[i] === '*' ? SEGMENT.test(x) : p[i] === x));
  });
};

// 設定ファイルの中身を、仕様の項目ごとの値に分ける。仕様に無い場所の値は、書き間違いとして知らせる。
export interface Problem {
  file: string | null;
  key: string | null;
  message: string;
}

function flatten(obj: object | null | undefined, scope: Scope, file: string, out: Record<string, unknown>, problems: Problem[], prefix = ''): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (!prefix && k.startsWith('$')) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    const s = specOf(key);
    if (s) {
      if (!s.scopes.includes(scope)) {
        problems.push({ file, key, message: s.secret ? msg('config.secretFile', { key, file: path.basename(file), env: s.env }) : scopeOnly(key, s) });
        continue;
      }
      const why = invalid(s, v);
      if (why) problems.push({ file, key, message: msg('config.invalidValue', { key, why }) });
      else out[key] = v;
    } else if (v && typeof v === 'object' && !Array.isArray(v) && isPrefix(key)) {
      flatten(v, scope, file, out, problems, key);
    } else problems.push({ file, key, message: unknownKey(key) });
  }
  return out;
}

export interface JsonFile {
  data: Record<string, unknown>;
  missing?: boolean;
  error?: string;
}
export function readJson(file: string): JsonFile {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? { data: v } : { data: {}, error: msg('config.notObject', { file }) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { data: {}, missing: true };
    return { data: {}, error: msg('config.unreadable', { file, error: (e as Error).message }) };
  }
}

// パスの値は、書いた置き場所から解決する。チームと手元はプロジェクトの根から、この PC は ~/.zukai から、環境変数は今いるフォルダから。
const resolvePath = (scope: Scope | 'env', project: string | null, v: unknown) => (v === null ? null : path.resolve(scope === 'user' ? homeDir() : scope === 'env' || !project ? process.cwd() : project, String(v)));

// 設定を読む。values は項目ごとの値、origins はその値の出どころ、settings は入れ子にした値、problems は設定の誤り。
// project が null のときは、この PC の設定と環境変数だけを読む。
// upTo を書くと、その置き場所までを重ね、それより優先する置き場所と環境変数は読まない。setup が、書く置き場所での今の値と比べるときに使う。
export interface Config {
  project: string | null;
  files: Partial<Record<Scope, string>>;
  values: Record<string, unknown>;
  origins: Record<string, Origin>;
  raw: Record<string, unknown>;
  settings: Settings;
  problems: Problem[];
}
// 設定のうち、プロジェクトの根が決まっているもの。settingsFor が返す。
export type ProjectConfig = Config & { project: string };

export function loadConfig(project: string | null, { upTo = null }: { upTo?: Scope | null } = {}): Config {
  const files: Partial<Record<Scope, string>> = project ? filesOf(project) : { user: filesOf('.').user, credentials: filesOf('.').credentials };
  const problems: Problem[] = [];
  const values: Record<string, unknown> = {};
  const origins: Record<string, Origin> = {};
  const raw: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(spec)) {
    if (!name.includes('*') && 'default' in s) {
      values[name] = s.default;
      origins[name] = 'default';
    }
  }
  const layers = upTo ? LAYERS.slice(0, LAYERS.indexOf(upTo) + 1) : LAYERS;
  for (const scope of layers) {
    const file = files[scope];
    if (!file) continue;
    const { data, error } = readJson(file);
    if (error) problems.push({ file, key: null, message: error });
    for (const [key, v] of Object.entries(flatten(data, scope, file, {}, problems))) {
      raw[key] = v;
      values[key] = specOf(key)?.type === 'path' ? resolvePath(scope, project, v) : v;
      origins[key] = scope;
    }
  }
  for (const [name, s] of Object.entries(spec)) {
    const v = !upTo && s.env && process.env[s.env];
    if (!v) continue;
    const why = invalid(s, v);
    if (why) problems.push({ file: null, key: name, message: msg('config.envInvalid', { env: s.env, why }) });
    else {
      raw[name] = v;
      values[name] = s.type === 'path' ? resolvePath('env', project, v) : v;
      origins[name] = 'env';
    }
  }
  const nested: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(values)) setIn(nested, key.split('.'), v);
  // 既定値のある項目は、上で必ず値を入れている。* の項目（repos、効果音のファイル）だけは空のことがあるので、ここで足す。
  const settings = nested as unknown as Settings;
  settings.repos ??= {};
  settings.video.sfx.files ??= {};
  return { project, files, values, origins, raw, settings, problems };
}

// 原稿やフォルダから、そのプロジェクトの設定を読む。誤りがあれば止める。書き間違いを黙って無視しないため。
export function settingsFor(start?: string): ProjectConfig {
  const cfg = loadConfig(projectOf(start)) as ProjectConfig;
  if (cfg.problems.length) {
    throw new Error(msg('config.problems', { lines: cfg.problems.map((p) => `  ${p.file ? `${p.file}: ` : ''}${p.message}`).join('\n') }));
  }
  return cfg;
}

// この PC の設定だけを読む。図の PNG のフォントや Chromium の場所のように、プロジェクトによらない値に使う。
export function machineSetting(key: string): unknown {
  const cfg = loadConfig(null);
  return cfg.problems.some((p) => p.key === key) ? null : cfg.values[key] ?? null;
}

// 設定とテーマの文の言語を、この PC の設定の lang にする。設定が読めなくてもコマンドを止めず、日本語にする。
export function applyMessageLang(): void {
  try {
    setMessageLang(machineSetting('lang'));
  } catch {
    setMessageLang('ja');
  }
}

type Tree = Record<string, unknown>;
const isTree = (v: unknown): v is Tree => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
function setIn(obj: Tree, keys: string[], v: unknown) {
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    const next = o[k];
    o = isTree(next) ? next : (o[k] = {}) as Tree;
  }
  o[keys.at(-1)!] = v;
}
// 値を消し、空になった入れ子も消す。
function deleteIn(obj: Tree, keys: string[]): boolean {
  const [head, ...rest] = keys as [string, ...string[]];
  if (!rest.length) return delete obj[head];
  const child = obj[head];
  if (!child || typeof child !== 'object') return false;
  const done = deleteIn(child as Tree, rest);
  if (done && !Object.keys(child).length) delete obj[head];
  return done;
}
const hasIn = (obj: Tree, keys: string[]) => keys.reduce<unknown>((o, k) => (o && typeof o === 'object' && k in o ? (o as Tree)[k] : undefined), obj) !== undefined;

// コマンドの引数に書いた文字列を、項目の型の値にする。パスは今いるフォルダから解決し、書く場所に合わせて相対パスにする。
export function coerce(key: string, input: unknown, scope: Scope, project: string): unknown {
  const s = specOf(key);
  if (!s) throw new Error(unknownKey(key));
  let v: unknown = input;
  if (typeof input === 'string') {
    if (s.type === 'number') v = input.trim() === '' ? NaN : Number(input);
    else if (s.type === 'boolean') v = ({ true: true, false: false, on: true, off: false, yes: true, no: false } as Record<string, boolean>)[input.toLowerCase()] ?? input;
    else if (s.type === 'terms') {
      try {
        v = JSON.parse(input);
      } catch {
        throw new Error(msg('config.jsonArray', { key }));
      }
    } else if (s.type === 'path') {
      const abs = path.resolve(process.cwd(), input);
      v = scope === 'user' ? abs : path.relative(project, abs).replaceAll('\\', '/') || '.';
    }
  }
  const why = invalid(s, v);
  if (why) throw new Error(msg('config.invalidValue', { key, why }));
  return v;
}

function writeFile(scope: Scope, file: string, data: Tree, project: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (scope === 'local') stateDir(project);
  const text = JSON.stringify(data, null, 2) + '\n';
  if (scope === 'credentials') {
    // mode は新しく作るときにしか効かない。先にできていたファイルは、書く前に本人だけが読める権限にする。
    // ponytail: Windows では chmod と mode が読み取りの権限を変えない。共有の PC で使うなら、ホームのフォルダの権限で守る。
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
    fs.writeFileSync(file, text, { mode: 0o600 });
  } else fs.writeFileSync(file, text);
}

// 1つの値を書く。scope を省略したときは、仕様の最初の置き場所に書く。書いたファイルを返す。
export function setValue(project: string, key: string, value: unknown, scope?: Scope): { file: string; scope: Scope } {
  const s = specOf(key);
  if (!s) throw new Error(unknownKey(key));
  scope ??= s.scopes[0];
  if (!s.scopes.includes(scope)) throw new Error(scopeOnly(key, s));
  // どの経路から呼ばれても、読むときに誤りになる値は書かない。
  const why = invalid(s, value);
  if (why) throw new Error(msg('config.invalidValue', { key, why }));
  const file = filesOf(project)[scope];
  const cur = readJson(file);
  if (cur.error) throw new Error(cur.error);
  setIn(cur.data, key.split('.'), value);
  writeFile(scope, file, cur.data, project);
  return { file, scope };
}

// 値を消す。scope を省略したときは、今効いている置き場所から消す。消した置き場所を返す。何も無ければ null。
export function unsetValue(project: string, key: string, scope?: Scope): { file: string; scope: Scope } | null {
  const s = specOf(key);
  if (!s) throw new Error(unknownKey(key));
  const files = filesOf(project);
  const candidates = scope ? [scope] : [...LAYERS].reverse();
  for (const sc of candidates) {
    const file = files[sc];
    const cur = readJson(file);
    if (cur.error) throw new Error(cur.error);
    if (!hasIn(cur.data, key.split('.'))) continue;
    deleteIn(cur.data, key.split('.'));
    writeFile(sc, file, cur.data, project);
    return { file, scope: sc };
  }
  return null;
}

// チームの設定ファイルが無ければ、空のまま作る。中身は、変えた値だけを config set や setup が足していく。
export function ensureTeamFile(project: string): boolean {
  const file = filesOf(project).team;
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(file, '{}\n');
  return true;
}

// 端末での表示幅。全角の文字は2として数え、表の列をそろえる。
export const widthOf = (s: unknown): number => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 2 : 1), 0);
export const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(1, n - widthOf(s)));

// 表示用の値。秘密の値は伏せる。
export function display(key: string, v: unknown): string {
  if (v === null || v === undefined) return '（なし）';
  if (specOf(key)?.secret) return '********';
  if (Array.isArray(v)) return `${v.length}件`;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

// 一覧に出す項目。仕様の項目と、設定ファイルに書かれた * の項目（repos.api.path など）。
export function listedKeys(cfg: Config): string[] {
  const fixed = Object.keys(spec).filter((n) => !n.includes('*'));
  const dynamic = Object.keys(cfg.values).filter((k) => !Object.hasOwn(spec, k));
  return [...fixed, ...dynamic.sort()];
}
