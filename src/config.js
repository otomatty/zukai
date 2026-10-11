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

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const spec = JSON.parse(fs.readFileSync(path.join(root, 'contract/settings.json'), 'utf8')).items;

// 重ねる順。後ろほど優先する。環境変数は最後に重ねる。
const LAYERS = ['user', 'team', 'local', 'credentials'];
export const scopeNames = {
  team: 'チーム',
  local: '手元',
  user: 'この PC',
  credentials: '本人だけ',
  env: '環境変数',
  default: '既定値',
};

export const homeDir = () => path.join(os.homedir(), '.zukai');
export const filesOf = (project) => ({
  team: path.join(project, 'zukai.config.json'),
  local: path.join(project, '.zukai', 'config.json'),
  user: path.join(homeDir(), 'config.json'),
  credentials: path.join(homeDir(), 'credentials.json'),
});
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// プロジェクトの根。start から上へたどり、zukai.config.json か .zukai/ が最初に見つかったフォルダにする。
// Git のリポジトリの根に着いたらそこで止める。どれも無ければ start にする。ホームの .zukai は PC の設定なので数えない。
export function projectOf(start = process.cwd()) {
  const home = path.resolve(os.homedir());
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'zukai.config.json'))) return dir;
    if (dir !== home && isDir(path.join(dir, '.zukai'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (dir === path.dirname(dir)) return path.resolve(start);
  }
}

// 機械が作るものの置き場所（.zukai/）。中に .gitignore を置き、プロジェクトの .gitignore を書き換えずに Git の管理から外す。
export function stateDir(project, ...sub) {
  const base = path.join(project, '.zukai');
  fs.mkdirSync(path.join(base, ...sub), { recursive: true });
  const ignore = path.join(base, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  return path.join(base, ...sub);
}

// 項目の名前から仕様を引く。* は任意の名前（英数字、下線、ハイフン）に当たる。
const SEGMENT = /^[\w-]+$/;
export function specOf(key) {
  if (spec[key]) return { name: key, ...spec[key] };
  const k = key.split('.');
  for (const [name, s] of Object.entries(spec)) {
    const p = name.split('.');
    if (p.length === k.length && p.every((x, i) => (x === '*' ? SEGMENT.test(k[i]) : x === k[i]))) return { name, ...s };
  }
  return null;
}

// 書き間違いの候補。編集距離が近い名前を返す。
export function closest(word, candidates) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best = null;
  for (const c of candidates) {
    const n = dist(word, c);
    if (n <= Math.max(2, Math.floor(c.length / 3)) && (!best || n < best.n)) best = { c, n };
  }
  return best?.c ?? null;
}
const unknownKey = (key) => {
  const near = closest(key, Object.keys(spec).filter((n) => !n.includes('*')));
  return `項目「${key}」はありません。${near ? `「${near}」の書き間違いではありませんか。` : ''}項目の一覧は zukai help config で確かめられます。`;
};

// 値の検査。誤りがあれば、その理由を返す。null は「この置き場所では未設定」として、どの項目でも受け付ける。
export function invalid(s, v) {
  if (v === null) return null;
  switch (s.type) {
    case 'enum':
      return s.values.includes(v) ? null : `${s.values.join('、')} のどれかを書いてください。`;
    case 'string':
    case 'path':
      return typeof v === 'string' && v ? null : '文字列で書いてください。';
    case 'url':
      return typeof v === 'string' && /^https?:\/\//.test(v) ? null : 'http か https で始まる URL を書いてください。';
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return '数値で書いてください。';
      return (s.min !== undefined && v < s.min) || (s.max !== undefined && v > s.max) ? `${s.min}〜${s.max} の数値で書いてください。` : null;
    case 'boolean':
      return typeof v === 'boolean' ? null : 'true か false で書いてください。';
    case 'terms': {
      if (!Array.isArray(v)) return '配列で書いてください。';
      const strs = (x) => x === undefined || (Array.isArray(x) && x.every((e) => typeof e === 'string'));
      const bad = v.findIndex((t) => !t || typeof t.use !== 'string' || !t.use || !strs(t.avoid) || !strs(t.except) || !strs(t.examples) || (t.actual !== undefined && typeof t.actual !== 'string'));
      return bad < 0 ? null : `${bad + 1}番目の用語に誤りがあります。use は文字列、avoid、except、examples は文字列の配列、actual は文字列で書いてください。`;
    }
    default:
      return null;
  }
}

// key の下に、仕様の項目があるか。repos や repos.api のような入れ子の途中の名前に当たる。
const isPrefix = (key) => {
  const k = key.split('.');
  return Object.keys(spec).some((name) => {
    const p = name.split('.');
    return p.length > k.length && k.every((x, i) => (p[i] === '*' ? SEGMENT.test(x) : p[i] === x));
  });
};

// 設定ファイルの中身を、仕様の項目ごとの値に分ける。仕様に無い場所の値は、書き間違いとして知らせる。
function flatten(obj, scope, file, out, problems, prefix = '') {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (!prefix && k.startsWith('$')) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    const s = specOf(key);
    if (s) {
      if (!s.scopes.includes(scope)) {
        problems.push({ file, key, message: s.secret ? `${key} は秘密の値なので、${path.basename(file)} には書けません。zukai login で ~/.zukai/credentials.json に保存するか、環境変数 ${s.env} に置いてください。` : `${key} は、${s.scopes.map((x) => `「${scopeNames[x]}」`).join('か')}の設定にだけ書けます。` });
        continue;
      }
      const why = invalid(s, v);
      if (why) problems.push({ file, key, message: `${key} の値が正しくありません。${why}` });
      else out[key] = v;
    } else if (v && typeof v === 'object' && !Array.isArray(v) && isPrefix(key)) {
      flatten(v, scope, file, out, problems, key);
    } else problems.push({ file, key, message: unknownKey(key) });
  }
  return out;
}

export function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? { data: v } : { data: {}, error: `${file} は JSON のオブジェクトで書いてください。` };
  } catch (e) {
    if (e.code === 'ENOENT') return { data: {}, missing: true };
    return { data: {}, error: `${file} を読めません。${e.message}` };
  }
}

// パスの値は、書いた置き場所から解決する。チームと手元はプロジェクトの根から、この PC は ~/.zukai から、環境変数は今いるフォルダから。
const resolvePath = (scope, project, v) => (v === null ? null : path.resolve(scope === 'user' ? homeDir() : scope === 'env' ? process.cwd() : project, v));

// 設定を読む。values は項目ごとの値、origins はその値の出どころ、settings は入れ子にした値、problems は設定の誤り。
// project が null のときは、この PC の設定と環境変数だけを読む。
export function loadConfig(project) {
  const files = project ? filesOf(project) : { user: filesOf('.').user, credentials: filesOf('.').credentials };
  const problems = [];
  const values = {};
  const origins = {};
  const raw = {};
  for (const [name, s] of Object.entries(spec)) {
    if (!name.includes('*') && 'default' in s) {
      values[name] = s.default;
      origins[name] = 'default';
    }
  }
  for (const scope of LAYERS) {
    if (!files[scope]) continue;
    const { data, error } = readJson(files[scope]);
    if (error) problems.push({ file: files[scope], key: null, message: error });
    for (const [key, v] of Object.entries(flatten(data, scope, files[scope], {}, problems))) {
      raw[key] = v;
      values[key] = specOf(key).type === 'path' ? resolvePath(scope, project, v) : v;
      origins[key] = scope;
    }
  }
  for (const [name, s] of Object.entries(spec)) {
    const v = s.env && process.env[s.env];
    if (!v) continue;
    const why = invalid(s, v);
    if (why) problems.push({ file: null, key: name, message: `環境変数 ${s.env} の値が正しくありません。${why}` });
    else {
      raw[name] = v;
      values[name] = s.type === 'path' ? resolvePath('env', project, v) : v;
      origins[name] = 'env';
    }
  }
  const settings = {};
  for (const [key, v] of Object.entries(values)) setIn(settings, key.split('.'), v);
  settings.repos ??= {};
  settings.video.sfx.files ??= {};
  return { project, files, values, origins, raw, settings, problems };
}

// 原稿やフォルダから、そのプロジェクトの設定を読む。誤りがあれば止める。書き間違いを黙って無視しないため。
export function settingsFor(start) {
  const cfg = loadConfig(projectOf(start));
  if (cfg.problems.length) {
    throw new Error(`設定に誤りがあります。\n${cfg.problems.map((p) => `  ${p.file ? `${p.file}: ` : ''}${p.message}`).join('\n')}\nzukai config list で、効いている値と出どころを確かめられます。`);
  }
  return cfg;
}

// この PC の設定だけを読む。図の PNG のフォントや Chromium の場所のように、プロジェクトによらない値に使う。
export function machineSetting(key) {
  const cfg = loadConfig(null);
  return cfg.problems.some((p) => p.key === key) ? null : cfg.values[key] ?? null;
}

function setIn(obj, keys, v) {
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? o[k] : (o[k] = {});
  o[keys.at(-1)] = v;
}
// 値を消し、空になった入れ子も消す。
function deleteIn(obj, keys) {
  if (keys.length === 1) return delete obj[keys[0]];
  const child = obj[keys[0]];
  if (!child || typeof child !== 'object') return false;
  const done = deleteIn(child, keys.slice(1));
  if (done && !Object.keys(child).length) delete obj[keys[0]];
  return done;
}
const hasIn = (obj, keys) => keys.reduce((o, k) => (o && typeof o === 'object' && k in o ? o[k] : undefined), obj) !== undefined;

// コマンドの引数に書いた文字列を、項目の型の値にする。パスは今いるフォルダから解決し、書く場所に合わせて相対パスにする。
export function coerce(key, input, scope, project) {
  const s = specOf(key);
  if (!s) throw new Error(unknownKey(key));
  let v = input;
  if (typeof input === 'string') {
    if (s.type === 'number') v = input.trim() === '' ? NaN : Number(input);
    else if (s.type === 'boolean') v = { true: true, false: false, on: true, off: false, yes: true, no: false }[input.toLowerCase()] ?? input;
    else if (s.type === 'terms') {
      try {
        v = JSON.parse(input);
      } catch {
        throw new Error(`${key} は JSON の配列で書いてください。zukai.config.json を直接編集することもできます。`);
      }
    } else if (s.type === 'path') {
      const abs = path.resolve(process.cwd(), input);
      v = scope === 'user' ? abs : path.relative(project, abs).replaceAll('\\', '/') || '.';
    }
  }
  const why = invalid(s, v);
  if (why) throw new Error(`${key} の値が正しくありません。${why}`);
  return v;
}

function writeFile(scope, file, data, project) {
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
export function setValue(project, key, value, scope) {
  const s = specOf(key);
  if (!s) throw new Error(unknownKey(key));
  scope ??= s.scopes[0];
  if (!s.scopes.includes(scope)) throw new Error(`${key} は、${s.scopes.map((x) => `「${scopeNames[x]}」`).join('か')}の設定にだけ書けます。`);
  const file = filesOf(project)[scope];
  const cur = readJson(file);
  if (cur.error) throw new Error(cur.error);
  setIn(cur.data, key.split('.'), value);
  writeFile(scope, file, cur.data, project);
  return { file, scope };
}

// 値を消す。scope を省略したときは、今効いている置き場所から消す。消した置き場所を返す。何も無ければ null。
export function unsetValue(project, key, scope) {
  const s = specOf(key);
  if (!s) throw new Error(unknownKey(key));
  const files = filesOf(project);
  const candidates = scope ? [scope] : [...LAYERS].reverse();
  for (const sc of candidates) {
    if (!files[sc]) continue;
    const cur = readJson(files[sc]);
    if (cur.error) throw new Error(cur.error);
    if (!hasIn(cur.data, key.split('.'))) continue;
    deleteIn(cur.data, key.split('.'));
    writeFile(sc, files[sc], cur.data, project);
    return { file: files[sc], scope: sc };
  }
  return null;
}

// チームの設定ファイルが無ければ、空のまま作る。中身は、変えた値だけを config set や setup が足していく。
export function ensureTeamFile(project) {
  const file = filesOf(project).team;
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(file, '{}\n');
  return true;
}

// 端末での表示幅。全角の文字は2として数え、表の列をそろえる。
export const widthOf = (s) => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 2 : 1), 0);
export const pad = (s, n) => s + ' '.repeat(Math.max(1, n - widthOf(s)));

// 表示用の値。秘密の値は伏せる。
export function display(key, v) {
  if (v === null || v === undefined) return '（なし）';
  if (specOf(key)?.secret) return '********';
  if (Array.isArray(v)) return `${v.length}件`;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

// 一覧に出す項目。仕様の項目と、設定ファイルに書かれた * の項目（repos.api.path など）。
export function listedKeys(cfg) {
  const fixed = Object.keys(spec).filter((n) => !n.includes('*'));
  const dynamic = Object.keys(cfg.values).filter((k) => !spec[k]);
  return [...fixed, ...dynamic.sort()];
}
