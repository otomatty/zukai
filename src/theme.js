// デザインのテーマ。contract/tokens.json の上に、プロジェクトのテーマを重ねる。
// テーマはフォルダで、設定の theme が指す。中身は2つのファイルで、どちらも zukai-theme スキルが資料から作る。
//   tokens.json  色、フォント、寸法。contract/tokens.json と同じ形で、変える値だけを書けばよい
//   rules.md     描き方のルール。zukai prompt が AI への指示に入れる。「## 動画」の節は、動画を作るときだけ入れる
// 値の誤り（無い項目、型の違い、色でない値）は、読むときに止める。見た目の誤り（文字が背景に沈む色）は、theme check と doctor が知らせる。
// このファイルは重い依存を読まない。doctor が、依存が欠けた環境でも動く必要があるため。
import fs from 'node:fs';
import path from 'node:path';
import { root, settingsFor } from './config.js';
import { compile } from './template.js';

export const baseTokens = () => JSON.parse(fs.readFileSync(path.join(root, 'contract/tokens.json'), 'utf8'));

// テーマでは変えられない値。図の幅と動画の大きさは、Lint の上限と動画の検査が前提にしている。
export const FIXED = ['figure.width', 'video.width', 'video.height', 'video.fps'];

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export const isColor = (v) => typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
// #rgb を #rrggbb にする。透明度を後ろに足す使い方（字幕の帯の「#rrggbbcc」など）があるため、読むときにそろえる。
const long = (c) => (c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : c).toLowerCase();
// フォントの指定は、CSS と SVG の style にそのまま入る。宣言や要素の外へ出られる文字、注釈（/* */）、閉じていない引用符を通さないため、
// 「"名前"」「'名前'」「引用符の無い名前」をカンマで並べた形だけを認める。
// 図の SVG では " を ' に置き換えて書くので、名前の中には、どちらの引用符も入れられない。
const FONT_NAME = String.raw`\s*(?:"[^"'\\;{}<>/*\n\r]*"|'[^"'\\;{}<>/*\n\r]*'|[\p{L}\p{N}_-][\p{L}\p{N}_ -]*)\s*`;
const FONT = new RegExp(`^${FONT_NAME}(?:,${FONT_NAME})*$`, 'u');
const isFont = (v) => typeof v === 'string' && v.trim() !== '' && FONT.test(v);

// 長さを変えられる配列と、選べる数。ここに無い配列は、既定と同じ数の色で書く。
const LENGTHS = { 'gradient.stops': [0, 2, 3, 4, 5], 'chart.series': [3, 4, 5], 'video.figure.chart.series': [3, 4, 5] };
// 名前で選ぶ値と、その選択肢。
export const CHOICES = {
  'emphasis.box': ['flat', 'fill', 'tint', 'outline'],
  'emphasis.chart': ['flat', 'gradient'],
  'chart.mode': ['series', 'neutral'],
};
// 範囲のある数値。ここに無い数値は、0より大きければよい。
const RANGES = { 'gradient.angle': [0, 360] };

// base の形に合う値だけを重ねる。base に無い名前、型の違う値、色でない値は problems に入れ、重ねない。
function overlay(base, over, at, problems) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (!at && k.startsWith('$')) continue;
    const key = at ? `${at}.${k}` : k;
    if (!Object.hasOwn(base, k)) {
      problems.push(`${key} という項目はありません。使える項目は zukai theme init で作る tokens.json にあります。`);
      continue;
    }
    if (FIXED.includes(key)) {
      problems.push(`${key} はテーマでは変えられません。図の幅と動画の大きさは、検査の上限が前提にしています。`);
      continue;
    }
    const b = base[k];
    if (isObj(b)) {
      if (isObj(v)) out[k] = overlay(b, v, key, problems);
      else problems.push(`${key} は、{ } の中に項目を書きます。`);
    } else if (Array.isArray(b)) {
      const lengths = LENGTHS[key] ?? [b.length];
      if (Array.isArray(v) && lengths.includes(v.length) && v.every(isColor)) out[k] = v.map(long);
      else problems.push(`${key} は、${lengths.filter(Boolean).join('、')}個の色（#rrggbb）の配列で書きます。${lengths.includes(0) ? '使わないときは [] にします。' : ''}`);
    } else if (typeof b === 'number') {
      const [min, max] = RANGES[key] ?? [0, Infinity];
      const ok = typeof v === 'number' && Number.isFinite(v) && (RANGES[key] ? v >= min && v <= max : v > 0);
      if (ok) out[k] = v;
      else problems.push(RANGES[key] ? `${key} は、${min}〜${max} の数値で書きます。` : `${key} は、0より大きい数値で書きます。`);
    } else if (CHOICES[key]) {
      if (CHOICES[key].includes(v)) out[k] = v;
      else problems.push(`${key} は、${CHOICES[key].join('、')} のどれかを書きます。`);
    } else if (isColor(b)) {
      if (isColor(v)) out[k] = long(v);
      else problems.push(`${key} の「${v}」は色ではありません。#rrggbb か #rgb で書きます。`);
    } else if (k === 'font') {
      if (isFont(v)) out[k] = v;
      else problems.push(`${key} は、CSS の font-family の形（"名前", sans-serif のように、引用符で囲んだ名前か英数字の名前をカンマで並べる）で書きます。; { } < > \\ / * と改行は使えません。`);
    } else if (typeof v === 'string' && /^[\w-]+$/.test(v)) out[k] = v;
    else problems.push(`${key} は、英数字とハイフンの名前で書きます。`);
  }
  return out;
}

// テーマのフォルダを読む。dir が null なら、テーマなし（contract/tokens.json のまま）。
// name はテーマの名前で、rules.md の # 見出しか、フォルダの名前。
// over に、名前を点でつないだ値（{ 'emphasis.box': 'tint' }）を書き込む。
// __proto__ などの名前でたどると、すべてのオブジェクトの元を書き換えてしまうので、誤りにする。
const UNSAFE = ['__proto__', 'constructor', 'prototype'];
function withSet(over, set, problems) {
  for (const [key, v] of Object.entries(set)) {
    const keys = key.split('.');
    if (keys.some((k) => UNSAFE.includes(k))) {
      problems.push(`${key} という項目はありません。`);
      continue;
    }
    let o = over;
    for (const k of keys.slice(0, -1)) o = Object.hasOwn(o, k) && isObj(o[k]) ? o[k] : (o[k] = {});
    o[keys.at(-1)] = v;
  }
  return over;
}
// グラデーションを使う描き方は、グラデーションの色が無いと描けない。
function gradientProblems(t) {
  const uses = [t.emphasis.box !== 'flat' && `emphasis.box の ${t.emphasis.box}`, t.emphasis.chart !== 'flat' && `emphasis.chart の ${t.emphasis.chart}`].filter(Boolean);
  return uses.length && !t.gradient.stops.length ? [`${uses.join('と')}は、グラデーションで描きます。gradient.stops に2〜5個の色を書いてください。`] : [];
}

// set は、tokens.json の上にさらに重ねる値（{ 'emphasis.box': 'tint' } の形）。theme compare が案を試すときに使う。
// tokens.json に書いたときと同じ検査を通る。
export function readTheme(dir, { set = {} } = {}) {
  const base = baseTokens();
  if (!dir) {
    // テーマなしでも、案（set）は試せる。
    const problems = [];
    const tokens = Object.keys(set).length ? overlay(base, withSet({}, set, problems), '', problems) : base;
    problems.push(...gradientProblems(tokens));
    return { dir: null, name: null, tokens, rules: '', types: [], problems };
  }
  const problems = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { dir, name: path.basename(dir), tokens: base, rules: '', types: [], problems: [`テーマのフォルダ ${dir} がありません。zukai theme init ${dir} で作るか、設定の theme を直してください。`] };
  }
  let tokens = base;
  const file = path.join(dir, 'tokens.json');
  if (fs.existsSync(file) || Object.keys(set).length) {
    try {
      const over = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      if (isObj(over)) tokens = overlay(base, withSet(over, set, problems), '', problems);
      else problems.push('tokens.json は JSON のオブジェクトで書きます。');
      problems.push(...gradientProblems(tokens));
    } catch (e) {
      problems.push(`tokens.json を読めません。${e.message}`);
    }
  }
  const rulesFile = path.join(dir, 'rules.md');
  const rules = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, 'utf8').trim() : '';
  const name = rules.match(/^#\s+(.+)$/m)?.[1].trim() ?? path.basename(dir);
  const types = readTypes(dir);
  return { dir, name, tokens, rules, types: types.types, problems: [...problems.map((p) => `${path.join(dir, 'tokens.json')}: ${p}`), ...types.problems] };
}

// --- 独自の型 -----------------------------------------------------------------

const FIELD_TYPES = ['string', 'number', 'boolean', 'list', 'object'];
// 項目の種類ごとに、type、required、desc のほかに書ける名前。
const FIELD_KEYS = { string: ['max'], number: ['min', 'max'], boolean: [], list: ['min', 'max', 'of'], object: ['fields'] };
// type.json の fields の形を確かめる。誤りを返す。
function fieldProblems(fields, at) {
  if (!isObj(fields) || !Object.keys(fields).length) return [`${at} は、項目の名前と定義の { } で書きます。`];
  return Object.entries(fields).flatMap(([k, def]) => {
    const where = `${at}.${k}`;
    if (!/^[A-Za-z][\w]*$/.test(k) || k === 'type' || k === 'theme' || k === 'width') return [`${where}: 項目の名前は英字で始め、type、theme、width 以外にします。`];
    if (!isObj(def) || !FIELD_TYPES.includes(def.type)) return [`${where}: type は ${FIELD_TYPES.join('、')} のどれかを書きます。`];
    const out = [];
    // 書き間違えた名前（requred など）は、黙って無視すると任意の項目として AI に伝わるので、誤りにする。
    const allowed = ['type', 'required', 'desc', ...FIELD_KEYS[def.type]];
    const unknown = Object.keys(def).filter((n) => !allowed.includes(n));
    if (unknown.length) out.push(`${where}: ${unknown.join('、')} は使えません。${def.type} の項目に書けるのは ${allowed.join('、')} です。`);
    if (def.required !== undefined && typeof def.required !== 'boolean') out.push(`${where}.required は true か false で書きます。`);
    if (def.desc !== undefined && typeof def.desc !== 'string') out.push(`${where}.desc は文で書きます。`);
    for (const n of ['min', 'max']) if (def[n] !== undefined && (typeof def[n] !== 'number' || !Number.isFinite(def[n]))) out.push(`${where}.${n} は数値で書きます。`);
    if (def.type === 'string' && def.max === undefined) out.push(`${where}: 文字の項目には max（全角の字数の上限）が要ります。図からはみ出さないことを、上限で保証するため。`);
    if (def.type === 'list') {
      if (def.max === undefined) out.push(`${where}: 配列の項目には max（個数の上限）が要ります。`);
      if (!isObj(def.of)) out.push(`${where}: 配列の項目には of（要素の定義）が要ります。`);
      else out.push(...(def.of.type === 'object' ? fieldProblems(def.of.fields, `${where}.of.fields`) : fieldProblems({ item: def.of }, where).map((p) => p.replace('.item', '.of'))));
    }
    if (def.type === 'object') out.push(...fieldProblems(def.fields, `${where}.fields`));
    return out;
  });
}

// テーマのフォルダの types/<名前>/ を読む。ひな形と動きのスクリプトは、ここで書き方だけを確かめる。
// スクリプトは動かさない。動くのは、動画を作るときの Chromium の中だけ。
function readTypes(dir) {
  const base = path.join(dir, 'types');
  const types = [];
  const problems = [];
  if (!fs.existsSync(base)) return { types, problems };
  for (const name of fs.readdirSync(base).sort()) {
    const tdir = path.join(base, name);
    if (!fs.statSync(tdir).isDirectory()) continue;
    const say = (m) => problems.push(`${tdir}: ${m}`);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      say('型の名前（フォルダの名前）は、英小文字で始め、英小文字、数字、ハイフンだけにします。');
      continue;
    }
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(tdir, 'type.json'), 'utf8'));
    } catch (e) {
      say(e.code === 'ENOENT' ? 'type.json がありません。' : `type.json を読めません。${e.message}`);
      continue;
    }
    if (!isObj(json)) {
      say('type.json は JSON のオブジェクトで書きます。');
      continue;
    }
    // 組み込みの型（src/figures/<名前>.js）と同じ名前は使えない。部品のファイル（svg、chart など）の名前も避ける。
    if (fs.existsSync(path.join(root, 'src/figures', `${name}.js`))) {
      say(`型の名前 ${name} は、組み込みの型か zukai の部品と同じ名前です。別の名前にしてください。`);
      continue;
    }
    const before = problems.length;
    for (const k of ['summary', 'when']) if (typeof json[k] !== 'string' || !json[k].trim()) say(`type.json の ${k} を文で書きます。`);
    fieldProblems(json.fields, 'fields').forEach(say);
    if (!isObj(json.example)) say('type.json の example に、図の仕様の例を { } で書きます（type は書かない）。');
    // 例の type は型の名前を上書きし、zukai type が別の型の例を出してしまう。
    else if (Object.hasOwn(json.example, 'type')) say('type.json の example に type は書きません。型の名前はフォルダの名前から付きます。');
    let template = null;
    try {
      template = compile(fs.readFileSync(path.join(tdir, 'figure.svg'), 'utf8'));
    } catch (e) {
      say(e.code === 'ENOENT' ? 'figure.svg（図のひな形）がありません。' : `figure.svg: ${e.message}`);
    }
    let motion = null;
    if (fs.existsSync(path.join(tdir, 'motion.js'))) {
      motion = fs.readFileSync(path.join(tdir, 'motion.js'), 'utf8');
      try {
        // 書き方だけを確かめる。関数を作るだけで、呼ばない。
        new Function('fig', 'ctx', motion); // eslint-disable-line no-new-func
      } catch (e) {
        say(`motion.js を読めません。${e.message}`);
      }
    }
    if (problems.length === before) types.push({ name, dir: tdir, json, template, motion });
  }
  return { types, problems };
}

// 原稿やフォルダから、そのプロジェクトのテーマを読む。誤りがあれば止める。書き間違いを黙って無視しないため。
export function themeFor(start) {
  const theme = readTheme(settingsFor(start).settings.theme ?? null);
  if (theme.problems.length) throw new Error(`テーマに誤りがあります。\n${theme.problems.map((p) => `  ${p}`).join('\n')}\nzukai theme check で確かめられます。`);
  return theme;
}
export const tokensFor = (start) => themeFor(start).tokens;

// --- 見た目の検査 -------------------------------------------------------------

const rgb = (h) => {
  const s = h.slice(1).length === 3 ? [...h.slice(1)].map((c) => c + c).join('') : h.slice(1);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (h) => {
  const [r, g, b] = rgb(h).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// 半透明の色 fg を、bg の上に重ねた色。
const blend = (fg, bg, alpha) => `#${rgb(fg).map((v, i) => Math.round((v * alpha + rgb(bg)[i] * (1 - alpha)) * 255).toString(16).padStart(2, '0')).join('')}`;
// 淡いグラデーションの濃さ。figures/svg.js の TINT と同じ値にする（このファイルは図の部品を読まないため、ここにも置く）。
const TINT_ALPHA = 0.16;

// WCAG のコントラスト比。
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// 色覚の違いの見え方（Viénot ら、1999）。1型（protan）と2型（deutan）を確かめる。3型は少なく、この近似の精度も低いので見ない。
export const VISION = {
  通常: null,
  '1型色覚': [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  '2型色覚': [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};
const lab = (h, m) => {
  let v = rgb(h).map(linear);
  if (m) v = m.map((row) => Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
  const [r, g, b] = v;
  const f = (x) => (x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116);
  const [X, Y, Z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
// 色覚の違いでの見え方を、色にする。見本で、見分けにくさを目で確かめるのに使う。
export function simulate(hex, m) {
  if (!m) return hex;
  const v = rgb(hex).map(linear);
  const out = m.map((row) => Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
  const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return `#${out.map((c) => Math.round(gamma(c) * 255).toString(16).padStart(2, '0')).join('')}`;
}
// 2色の差（CIE76 の ΔE）。
export const distance = (a, b, m = null) => Math.hypot(...lab(a, m).map((x, i) => x - lab(b, m)[i]));

// 文字は 4.5:1（WCAG AA）。系列の色は、凡例とラベルが添うので、背景と見分けられる 2.5:1 までにする。
// 既定の系列の緑（#1baf7a）が白地で 2.8:1 で、図の部品の基準の 3:1 では、検証済みの組み合わせまで知らせてしまうため。
// 系列どうしの差は ΔE 23。既定の3色の最も近い組（1型色覚で 25）は通し、赤と緑の定番の組（2型色覚で 21）は知らせる。
const TEXT = 4.5;
const SERIES_BG = 2.5;
export const SERIES_GAP = 23;
// chart.mode が neutral のときの灰色（chart.muted）は、強調した1つを引き立てるため、系列の色より淡くてよい。
// 既定の灰色（#a8b0b9）が白地で 2.2:1 なので、それは通し、紙と見分けにくい色だけを知らせる。
// 2つ目からの灰色は、chart.muted を文字の色に寄せて作る（src/figures/chart.js の grey）。紙からは chart.muted より離れるので、chart.muted だけを確かめればよい。
const MUTED_BG = 2;

// 見た目の検査。severity は error（文字が読めない）か warn（見分けにくい）。
export async function checkTheme(t) {
  const out = [];
  const pair = (what, fg, bg, kf, kb, min = TEXT, severity = 'error') => {
    const r = contrast(fg, bg);
    if (r < min) out.push({ severity, what, message: `${kf}（${fg}）と ${kb}（${bg}）のコントラストが ${r.toFixed(2)}:1 です。${min}:1 以上にしてください。` });
  };
  const figure = (c, chart, at) => {
    pair('図の文字', c.ink, c.paper, `${at}.ink`, `${at}.paper`);
    pair('図の文字', c.ink, c.surface, `${at}.ink`, `${at}.surface`);
    pair('図の文字', c.ink, c.accentSurface, `${at}.ink`, `${at}.accentSurface`);
    pair('図の補足', c.sub, c.paper, `${at}.sub`, `${at}.paper`);
    pair('図の補足', c.sub, c.surface, `${at}.sub`, `${at}.surface`);
    pair('強調の文字', c.accent, c.paper, `${at}.accent`, `${at}.paper`);
    pair('強調の文字', c.accent, c.accentSurface, `${at}.accent`, `${at}.accentSurface`);
    pair('強調の上の文字', c.onAccent, c.accent, `${at}.onAccent`, `${at}.accent`);
    pair('強調の上の文字', c.onAccent, c.ink, `${at}.onAccent`, `${at}.ink`);
    // 強調した箱の上の文字は、グラデーションのどの色の上でも読めること。淡い面（tint）は、紙の色に重ねた色で確かめる。
    const stops = t.gradient.stops;
    if (t.emphasis.box === 'fill') stops.forEach((s, i) => pair('強調した箱の文字', c.onAccent, s, `${at}.onAccent`, `gradient.stops[${i}]`));
    if (t.emphasis.box === 'tint') {
      stops.forEach((s, i) => {
        const bg = blend(s, c.paper, TINT_ALPHA);
        pair('強調した箱の文字', c.accent, bg, `${at}.accent`, `gradient.stops[${i}] の淡い面`);
        pair('強調した箱の補足', c.sub, bg, `${at}.sub`, `gradient.stops[${i}] の淡い面`);
      });
    }
    if (t.emphasis.box === 'outline' || t.emphasis.chart === 'gradient') stops.forEach((s, i) => pair('グラデーションの色', s, c.paper, `gradient.stops[${i}]`, `${at}.paper`, SERIES_BG, 'warn'));
    const chartAt = at.replace(/color$/, 'chart');
    chart.series.forEach((s, i) => pair('系列の色', s, c.paper, `${chartAt}.series[${i}]`, `${at}.paper`, SERIES_BG, 'warn'));
    // neutral では、強調しない棒や線を chart.muted（と、それを文字の色に寄せた色）で描く。
    if (chart.mode === 'neutral') pair('灰色の系列', chart.muted, c.paper, `${chartAt}.muted`, `${at}.paper`, MUTED_BG, 'warn');
    for (const [vision, m] of Object.entries(VISION)) {
      for (let i = 0; i < chart.series.length; i++) {
        for (let j = i + 1; j < chart.series.length; j++) {
          const d = distance(chart.series[i], chart.series[j], m);
          if (d < SERIES_GAP) out.push({ severity: 'warn', what: '系列の見分け', message: `${chartAt}.series の ${chart.series[i]} と ${chart.series[j]} は、${vision}で見分けにくい色です（差 ${d.toFixed(0)}、${SERIES_GAP} 以上にする）。明るさか色相を離してください。` });
        }
      }
    }
  };
  figure(t.color, t.chart, 'color');
  pair('ページ', t.page.error, t.color.paper, 'page.error', 'color.paper');
  pair('画面の注釈', t.color.onAccent, t.screenshot.note, 'color.onAccent', 'screenshot.note');
  const v = t.video;
  figure({ ...t.color, ...v.figure.color }, { ...t.chart, ...v.figure.chart }, 'video.figure.color');
  pair('動画の文字', v.ink, v.background, 'video.ink', 'video.background');
  // 字幕の帯は、透明度 80%（cc）で背景に重ねて描く。重ねた色で確かめる。
  pair('字幕', v.subtitle.ink, blend(v.subtitle.band, v.background, 0.8), 'video.subtitle.ink', 'video.subtitle.band を video.background に重ねた色');
  try {
    const { bundledThemes } = await import('shiki');
    if (!(t.codeTheme in bundledThemes)) out.push({ severity: 'error', what: 'コードの配色', message: `codeTheme「${t.codeTheme}」は Shiki にありません。github-light、github-dark、one-light などの名前を書きます。` });
  } catch {
    // 依存が欠けている。doctor が別に知らせる。
  }
  return out;
}

// --- AI への指示 --------------------------------------------------------------

// rules.md を、zukai prompt の指示の節にする。見出しは1段下げ、HTML のコメントは外す。
// 「## 動画」で始まる節は、動画を作るときだけ入れる。「## 出典」と「## 決めたこと」の節は人が読むためのものなので、入れない。
export function rulesPrompt(theme, { video = false } = {}) {
  if (!theme?.rules) return '';
  const body = theme.rules.replace(/<!--[\s\S]*?-->/g, '').replace(/^#\s+.+\n?/m, '');
  const parts = body.split(/^(?=##\s)/m);
  const kept = parts
    .filter((p) => !/^##\s+(出典|決めたこと)/.test(p) && (video || !/^##\s+動画/.test(p)))
    .filter((p) => p.replace(/^##\s.*$/m, '').trim())
    .map((p) => p.trim().replace(/^(#{2,5})(?=\s)/gm, '#$1'));
  if (!kept.length) return '';
  const order = video ? '動画の書き方の「絵柄」と色の選び方は、このルールを優先します。' : '';
  return `## デザインのルール\n\nこのプロジェクトのテーマ「${theme.name}」の描き方です。自由な図の色と強調${video ? '、動画のシーンの絵柄と配色' : ''}は、このルールに従います。上の書き方（文字数、図の型の上限、検査）と食い違うときは、上の書き方を優先します。${order}テーマの色は、自由な図では zukai type free に出る色として、動画では CSS 変数として使えます。\n\n${kept.join('\n\n')}`;
}

// --- テーマのフォルダを作る、確かめる -----------------------------------------

const RULES_TEMPLATE = `# テーマの名前

<!-- zukai-theme スキルが、取り込んだ資料から書きます。資料に見られる描き方だけを、具体的に書きます。 -->

## 図

<!-- 自由な図（free）の描き方。例: 強調は1つの図に1か所だけにし、accent で塗る。箱は角丸にせず、線は細くする。 -->

## 動画

<!-- 動画のシーンの絵柄と配色。例: 背景は白地にし、主役はブランドの青で塗る。キャラクターは描かず、図形と文字だけで見せる。 -->

## 出典

<!-- 取り込んだ資料の名前と、そこから決めた値。AI への指示には入れない。資料そのものは、このフォルダにコピーしない。 -->

## 決めたこと

<!-- 利用者と対話して決めたこと。日付、決めたこと、選ばなかった案、理由を1行ずつ書く。AI への指示には入れない。例: 2026-10-11 強調した箱は tint にした（fill は白い文字がマゼンタの上で 3.5:1 しかないため）。 -->
`;

// テーマのフォルダを作る。tokens.json には、変えられる値をすべて書く。AI と人が、使える項目の一覧として読めるようにするため。
// 書いたファイルを返す。すでにあるファイルは上書きしない。
export function initTheme(dir) {
  const base = baseTokens();
  for (const key of FIXED) {
    const keys = key.split('.');
    delete keys.slice(0, -1).reduce((o, k) => o[k], base)[keys.at(-1)];
  }
  const tokens = { $comment: 'contract/tokens.json に重ねる値。変えない項目は消してもよい。図の幅と動画の大きさは変えられない。zukai theme check で確かめる', ...base };
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [name, text] of [['tokens.json', JSON.stringify(tokens, null, 2) + '\n'], ['rules.md', RULES_TEMPLATE]]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, text);
    written.push(file);
  }
  return written;
}

// テーマの値と見た目を確かめる。値の誤りがあれば、見た目は確かめない。
export async function themeReport(dir, { set = {} } = {}) {
  const theme = readTheme(dir, { set });
  const findings = theme.problems.map((message) => ({ severity: 'error', what: '値', message }));
  if (!findings.length) findings.push(...(await checkTheme(theme.tokens)));
  // 独自の型は、組み込みの型と名前が重ならず、例が検査を通ること。ひな形と上限の誤りを、原稿を書く前に見つけるため。
  if (!theme.problems.length && theme.types.length) {
    try {
      const { checkExamples } = await import('./figures/custom.js');
      const limits = JSON.parse(fs.readFileSync(path.join(root, 'contract/limits.json'), 'utf8'));
      checkExamples(theme, limits).forEach((message) => findings.push({ severity: 'error', what: '独自の型', message }));
    } catch (e) {
      if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
      // 依存が欠けている。doctor が別に知らせる。
    }
  }
  return { dir, name: theme.name, theme, findings, ok: findings.every((f) => f.severity !== 'error') };
}
