// テーマの独自の型。テーマのフォルダの types/<名前>/ に置き、テーマを使うプロジェクトでだけ使える。
//   type.json   型の説明、項目と上限、例
//   figure.svg  図のひな形。{{項目}} を差し込む（書き方は src/template.ts）。資料と動画で同じものを使う
//   motion.js   動画で、この図を動かすスクリプト（任意）。Chromium の中だけで動き、Node では動かさない
// 埋めた後の SVG は、自由な図（free）と同じ検査を通し、free と同じ方法で組み立て直す。
// 使える要素、色、文字の大きさ、文字の収まりは free と同じで、型のある図と同じように検査できる。
import YAML from 'yaml';
import { types as builtin } from './index.ts';
import free from './free.ts';
import { checkFields, describe } from './schema.ts';
import type { Field, Fields as SchemaFields } from './schema.ts';
import { fill } from '../template.ts';
import { tokensFor } from '../theme.ts';
import type { FieldDef, Fields, Theme, TypeDef } from '../theme.ts';
import type { AnyFigureType, FigureContext, FigureType, FigureTypes, Limits, RawSpec, Tokens } from '../types.ts';

// type.json の fields を、図の型と同じスキーマ（schema.ts）にする。
// テーマの文字の項目は、数も文字として受け付ける（type.json の書き方は、数の値も文字の項目に書けるため）。
function toSchema(def: FieldDef): Field {
  switch (def.type) {
    case 'string':
      return { ...def, orNumber: true };
    case 'list':
      return { ...def, of: toSchema(def.of) };
    case 'object':
      return { ...def, fields: toFields(def.fields) };
    default:
      return def;
  }
}
const toFields = (fields: Fields): SchemaFields => Object.fromEntries(Object.entries(fields).map(([k, def]) => [k, toSchema(def)]));

// テーマが読んだ型の定義（theme.ts の readTheme の types）から、図の型を作る。
export function makeType(d: TypeDef): FigureType<RawSpec> & { fit(spec: RawSpec, t: Tokens): string[] } {
  const schema = toFields(d.json.fields);
  const toSvg = (spec: RawSpec, t: Tokens) => fill(d.template, { ...spec, theme: t, width: t.figure.width });
  const tokensOf = (ctx?: FigureContext) => ctx?.tokens ?? tokensFor(ctx?.baseDir ?? process.cwd());
  return {
    name: d.name,
    custom: true,
    summary: d.json.summary,
    when: d.json.when,
    example: YAML.stringify({ type: d.name, ...d.json.example }).trim(),
    fields: describe(schema),
    caps: Object.entries(d.json.fields).filter(([, f]) => 'max' in f && f.max !== undefined).map(([k, f]) => `${k}=${'max' in f ? f.max : ''}`).join('、') || 'なし',
    motion: d.motion,

    validate(spec, limits, ctx) {
      const errors = checkFields(spec, { type: { type: 'string' }, ...schema }, '');
      if (errors.length) return errors;
      let svg;
      try {
        svg = toSvg(spec, tokensOf(ctx));
      } catch (e) {
        return [`型 ${d.name} のひな形を埋められません。${(e as Error).message}`];
      }
      // ひな形の誤りは、原稿を書いた AI には直せない。テーマの誤りと分かるように伝える。
      return free.validate({ type: 'free', svg }, limits, ctx).map((m) => `型 ${d.name} のひな形（${d.dir}）から作った図: ${m}`);
    },
    fit: (spec, t) => free.fit({ svg: toSvg(spec, t) }, t),
    // 文字の長さは、項目の定義（max）で確かめる。
    labels: () => [],
    notes: () => [],
    // 用語の表記（P007）の検査に渡す、図に出る文字。ひな形を埋めた SVG の text 要素の文字だけを返す。
    // 属性（id や href）にだけ使う値は、読み手には見えないので調べない。
    texts: (spec, ctx) => {
      const svg = toSvg(spec, tokensOf(ctx));
      return [...free.labels({ svg }), ...free.notes({ svg })];
    },
    title: (spec, t) => free.title({ svg: toSvg(spec, t) }),
    render: (spec, t) => free.render({ svg: toSvg(spec, t) }, t),
  };
}

// 仕様の type に当たる型。type が型の名前でなければ null。
// toString や constructor のような、オブジェクトが元から持つ名前を、型と取り違えないため。
export function typeOf(types: FigureTypes, spec: RawSpec | null | undefined): AnyFigureType | null {
  const name = spec?.type;
  return typeof name === 'string' && Object.hasOwn(types, name) ? types[name] : null;
}

// 型の一覧に、テーマの独自の型を足す。自由な図（free）は最後に置く。組み込みの型と同じ名前は、黙って置き換えずに止める。
const cache = new WeakMap<Theme, FigureTypes>();
export function typesFor(theme: Theme | null | undefined): FigureTypes {
  if (!theme?.types?.length) return builtin;
  if (!cache.has(theme)) {
    const clash = theme.types.find((d) => Object.hasOwn(builtin, d.name));
    if (clash) throw new Error(`テーマの型 ${clash.name}（${clash.dir}）は、組み込みの型と同じ名前です。別の名前にしてください。`);
    const { free: last, ...rest } = builtin;
    cache.set(theme, { ...rest, ...Object.fromEntries(theme.types.map((d) => [d.name, makeType(d)])), free: last });
  }
  return cache.get(theme)!;
}

// テーマを確かめるときに、各型の例が検査を通るかを見る。通らない例は、ひな形か上限の誤り。
export function checkExamples(theme: Theme, limits: Limits): string[] {
  const out: string[] = [];
  for (const d of theme.types) {
    const type = makeType(d);
    const spec = { type: d.name, ...d.json.example };
    const ctx: FigureContext = { baseDir: theme.dir ?? undefined, tokens: theme.tokens };
    const errors = [...type.validate(spec, limits, ctx)];
    if (!errors.length) errors.push(...type.fit(spec, theme.tokens));
    errors.forEach((m) => out.push(`型 ${d.name} の例が検査を通りません。${m}`));
  }
  return out;
}
