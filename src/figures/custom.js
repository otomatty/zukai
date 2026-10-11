// テーマの独自の型。テーマのフォルダの types/<名前>/ に置き、テーマを使うプロジェクトでだけ使える。
//   type.json   型の説明、項目と上限、例
//   figure.svg  図のひな形。{{項目}} を差し込む（書き方は src/template.js）。資料と動画で同じものを使う
//   motion.js   動画で、この図を動かすスクリプト（任意）。Chromium の中だけで動き、Node では動かさない
// 埋めた後の SVG は、自由な図（free）と同じ検査を通し、free と同じ方法で組み立て直す。
// 使える要素、色、文字の大きさ、文字の収まりは free と同じで、型のある図と同じように検査できる。
import YAML from 'yaml';
import { types as builtin } from './index.js';
import free from './free.js';
import { widthOf, unknownKeys } from './svg.js';
import { fill } from '../template.js';
import { tokensFor } from '../theme.js';

// 項目の定義に合うかを確かめる。def は type.json の fields の1項目。
function checkField(v, def, at) {
  if (v === undefined || v === null) return def.required ? [`${at} がありません。`] : [];
  switch (def.type) {
    case 'string': {
      if (typeof v !== 'string' && typeof v !== 'number') return [`${at} は文字で書きます。`];
      const w = Math.ceil(widthOf(String(v)));
      return def.max !== undefined && w > def.max ? [`${at}「${v}」が全角${w}字相当あります。上限は${def.max}字です。`] : [];
    }
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return [`${at} は数値で書きます。`];
      if (def.min !== undefined && v < def.min) return [`${at} は${def.min}以上にします。`];
      return def.max !== undefined && v > def.max ? [`${at} は${def.max}以下にします。`] : [];
    case 'boolean':
      return typeof v === 'boolean' ? [] : [`${at} は true か false で書きます。`];
    case 'list': {
      if (!Array.isArray(v)) return [`${at} は配列で書きます。`];
      const errors = [];
      if (def.min !== undefined && v.length < def.min) errors.push(`${at} は${def.min}個以上にします。`);
      if (def.max !== undefined && v.length > def.max) errors.push(`${at} が${v.length}個あります。上限は${def.max}個です。`);
      v.forEach((item, i) => errors.push(...checkField(item, { ...def.of, required: true }, `${at}[${i}]`)));
      return errors;
    }
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return [`${at} は { } の形で書きます。`];
      return checkFields(v, def.fields, at);
    }
    default:
      return [];
  }
}
const checkFields = (obj, fields, at) => [
  ...unknownKeys(obj, Object.keys(fields), at),
  ...Object.entries(fields).flatMap(([k, def]) => checkField(obj[k], def, at ? `${at}.${k}` : k)),
];

// AI に渡す、項目の説明。
function describe(fields, prefix = '') {
  return Object.entries(fields).flatMap(([k, def]) => {
    const name = prefix + k;
    const limit = def.type === 'string' && def.max !== undefined ? `、全角${def.max}字まで` : def.type === 'list' && def.max !== undefined ? `、${def.max}個まで` : def.type === 'number' && def.max !== undefined ? `、${def.min ?? ''}〜${def.max}` : '';
    const line = `${name}: ${def.desc ?? ''}（${def.required ? '必須' : '任意'}${limit}）`;
    if (def.type === 'list' && def.of?.type === 'object') return [line, ...describe(def.of.fields, `${name}[].`)];
    if (def.type === 'object') return [line, ...describe(def.fields, `${name}.`)];
    return [line];
  });
}

// テーマが読んだ型の定義（theme.js の readTheme の types）から、図の型を作る。
export function makeType(d) {
  const toSvg = (spec, t) => fill(d.template, { ...spec, theme: t, width: t.figure.width });
  const tokensOf = (ctx) => ctx?.tokens ?? tokensFor(ctx?.baseDir ?? process.cwd());
  return {
    name: d.name,
    custom: true,
    summary: d.json.summary,
    when: d.json.when,
    example: YAML.stringify({ type: d.name, ...d.json.example }).trim(),
    fields: describe(d.json.fields),
    caps: Object.entries(d.json.fields).filter(([, f]) => f.max !== undefined).map(([k, f]) => `${k}=${f.max}`).join('、') || 'なし',
    motion: d.motion,

    validate(spec, limits, ctx) {
      const errors = checkFields(spec, { type: { type: 'string' }, ...d.json.fields }, '');
      if (errors.length) return errors;
      let svg;
      try {
        svg = toSvg(spec, tokensOf(ctx));
      } catch (e) {
        return [`型 ${d.name} のひな形を埋められません。${e.message}`];
      }
      // ひな形の誤りは、原稿を書いた AI には直せない。テーマの誤りと分かるように伝える。
      return free.validate({ type: 'free', svg }, limits, ctx).map((m) => `型 ${d.name} のひな形（${d.dir}）から作った図: ${m}`);
    },
    fit: (spec, t) => free.fit({ svg: toSvg(spec, t) }, t),
    // 文字の長さは、項目の定義（max）で確かめる。
    labels: () => [],
    notes: () => [],
    // 用語の表記（P007）の検査に渡す、図に出る文字。仕様の中の文字の値をすべて集める。
    texts: (spec) => {
      const out = [];
      const walk = (v) => (typeof v === 'string' ? out.push(v) : Array.isArray(v) ? v.forEach(walk) : v && typeof v === 'object' ? Object.values(v).forEach(walk) : null);
      Object.entries(spec).forEach(([k, v]) => k !== 'type' && walk(v));
      return out;
    },
    title: (spec, t) => free.title({ svg: toSvg(spec, t) }),
    render: (spec, t) => free.render({ svg: toSvg(spec, t) }, t),
  };
}

// 型の一覧に、テーマの独自の型を足す。自由な図（free）は最後に置く。組み込みの型と同じ名前は、黙って置き換えずに止める。
const cache = new WeakMap();
export function typesFor(theme) {
  if (!theme?.types?.length) return builtin;
  if (!cache.has(theme)) {
    const clash = theme.types.find((d) => Object.hasOwn(builtin, d.name));
    if (clash) throw new Error(`テーマの型 ${clash.name}（${clash.dir}）は、組み込みの型と同じ名前です。別の名前にしてください。`);
    const { free: last, ...rest } = builtin;
    cache.set(theme, { ...rest, ...Object.fromEntries(theme.types.map((d) => [d.name, makeType(d)])), free: last });
  }
  return cache.get(theme);
}

// テーマを確かめるときに、各型の例が検査を通るかを見る。通らない例は、ひな形か上限の誤り。
export function checkExamples(theme, limits) {
  const out = [];
  for (const d of theme.types) {
    const type = makeType(d);
    const spec = { type: d.name, ...d.json.example };
    const ctx = { baseDir: theme.dir, tokens: theme.tokens };
    const errors = [...type.validate(spec, limits, ctx)];
    if (!errors.length) errors.push(...type.fit(spec, theme.tokens));
    errors.forEach((m) => out.push(`型 ${d.name} の例が検査を通りません。${m}`));
  }
  return out;
}
