// 図の仕様のスキーマ。図の型ごとに1つ書き、そこから3つを作る。
//   型       Infer<スキーマ> で、検証に通った仕様の形（TypeScript の型）を作る
//   検証     checkFields で、形の誤り（無い項目、型の違い、個数、未定義のキー）を知らせる
//   書き方   describe で、zukai type が AI に渡す項目の説明を作る
// テーマの独自の型（type.json の fields）も、同じスキーマとして読む。形だけでは確かめられない検査（項目どうしの関係、配置）は、図の型の側に書く。
import fs from 'node:fs';
import path from 'node:path';
import { unknownKeys, widthOf } from './svg.ts';
import { root } from '../config.ts';
import type { Limits } from '../types.ts';

// contract/limits.json。図の型の書き方（describe）に、個数の上限を書くために読む。
export const contractLimits: Limits = JSON.parse(fs.readFileSync(path.join(root, 'contract/limits.json'), 'utf8'));

// contract/limits.json の上限の名前（flow.maxSteps など）。個数の上限を、契約の値で書くときに使う。
export type LimitKey = { [K in keyof Limits]: Limits[K] extends Record<string, number> ? `${K & string}.${keyof Limits[K] & string}` : never }[keyof Limits];

interface Base {
  required?: boolean;
  // AI に渡す説明。
  desc?: string;
  // 説明の後ろの括弧に添える注意（「図全体で1つまで」など）。
  note?: string;
}
export interface StringField extends Base {
  type: 'string';
  // 全角換算の字数の上限。
  max?: number;
  nonEmpty?: boolean;
  // 数も文字として受け付ける（日付の 2026 や、分岐の条件の 200 など）。
  orNumber?: boolean;
  // 選べる値。
  values?: readonly string[];
}
export interface NumberField extends Base {
  type: 'number';
  min?: number;
  // この値より大きいこと（0 より大きい量など）。
  above?: number;
  max?: number;
  integer?: boolean;
}
export interface BooleanField extends Base {
  type: 'boolean';
}
export interface ListField extends Base {
  type: 'list';
  of: Field;
  min?: number;
  max?: number | LimitKey;
  // 個数が上限を超えたときに添える、直し方。
  hint?: string;
  // 要素のこの項目の値が、重ならないこと。true は、要素の値そのもの（文字の配列など）。
  unique?: string | true;
  // 要素のこの項目を true にできるのは、1つまで。
  atMostOne?: string;
}
export interface ObjectField extends Base {
  type: 'object';
  fields: Fields;
}
// 決まった数の値の組（[流れの元, 流れの先, 量] など）。min を書くと、後ろの値を省ける。
export interface TupleField extends Base {
  type: 'tuple';
  items: readonly Field[];
  min?: number;
}
// いくつかの形のどれか（名前だけの文字か、名前と補足を持つまとまり、など）。
export interface OneOfField extends Base {
  type: 'oneOf';
  options: readonly Field[];
}
export type Field = StringField | NumberField | BooleanField | ListField | ObjectField | TupleField | OneOfField;
export type Fields = Readonly<Record<string, Field>>;

// ---- 型 ----------------------------------------------------------------------

type Simplify<T> = { [K in keyof T]: T[K] } & {};
// 値の組の型。min より後ろの位置は、省ける（[つなぐ元, つなぐ先, 通信の名前?] など）。
type OptionalTuple<I> = I extends readonly [infer H, ...infer R] ? [Value<H>?, ...OptionalTuple<R>] : [];
type TupleValue<I, Min extends number, Acc extends unknown[] = []> = Acc['length'] extends Min
  ? [...Acc, ...OptionalTuple<I>]
  : I extends readonly [infer H, ...infer R]
    ? TupleValue<R, Min, [...Acc, Value<H>]>
    : Acc;
export type Value<F> = F extends StringField
  ? F extends { values: readonly (infer V)[] }
    ? V
    : F extends { orNumber: true }
      ? string | number
      : string
  : F extends NumberField
    ? number
    : F extends BooleanField
      ? boolean
      : F extends ListField
        ? Value<F['of']>[]
        : F extends ObjectField
          ? Infer<F['fields']>
          : F extends TupleField
            ? TupleValue<F['items'], F extends { min: infer M extends number } ? M : F['items']['length']>
            : F extends OneOfField
              ? Value<F['options'][number]>
              : never;
type RequiredKeys<FS> = { [K in keyof FS]: FS[K] extends { required: true } ? K : never }[keyof FS];
// スキーマから、検証に通った仕様の形を作る。required: true の項目は必ずある。
export type Infer<FS extends Fields> = Simplify<{ [K in RequiredKeys<FS>]: Value<FS[K]> } & { [K in Exclude<keyof FS, RequiredKeys<FS>>]?: Value<FS[K]> }>;

// ---- 検証 --------------------------------------------------------------------

const limitOf = (max: number | LimitKey | undefined, limits: Limits | undefined): number | undefined => {
  if (typeof max !== 'string') return max;
  const [group, key] = max.split('.');
  return (limits as unknown as Record<string, Record<string, number>> | undefined)?.[group]?.[key];
};
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// 1つの値を、項目の定義と照らし合わせる。at は、誤りの文に出す項目の名前（steps[0].label など）。
export function checkField(v: unknown, def: Field, at: string, limits?: Limits): string[] {
  if (v === undefined || v === null) return def.required ? [`${at} がありません。`] : [];
  switch (def.type) {
    case 'string': {
      if (typeof v !== 'string' && !(def.orNumber && typeof v === 'number')) return [`${at} は文字で書きます。`];
      if (def.values && !def.values.includes(String(v))) return [`${at} は ${def.values.join('、')} のどれかを書きます。`];
      if (def.nonEmpty && !String(v).trim()) return [`${at} を空にしないでください。`];
      const w = Math.ceil(widthOf(String(v)));
      return def.max !== undefined && w > def.max ? [`${at}「${v}」が全角${w}字相当あります。上限は${def.max}字です。`] : [];
    }
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return [`${at} は数値で書きます。`];
      if (def.integer && !Number.isInteger(v)) return [`${at} は整数で書きます。`];
      if (def.min !== undefined && v < def.min) return [`${at} は${def.min}以上にします。`];
      if (def.above !== undefined && v <= def.above) return [`${at} は${def.above}より大きくします。`];
      return def.max !== undefined && v > def.max ? [`${at} は${def.max}以下にします。`] : [];
    case 'boolean':
      return typeof v === 'boolean' ? [] : [`${at} は true か false で書きます。`];
    case 'list': {
      if (!Array.isArray(v)) return [`${at} は配列で書きます。`];
      const errors: string[] = [];
      const max = limitOf(def.max, limits);
      if (def.min !== undefined && v.length < def.min) errors.push(`${at} は${def.min}個以上にします。`);
      if (max !== undefined && v.length > max) errors.push(`${at} が${v.length}個あります。上限は${max}個です。${def.hint ?? ''}`);
      v.forEach((item, i) => errors.push(...checkField(item, { ...def.of, required: true }, `${at}[${i}]`, limits)));
      if (def.unique) {
        const seen = new Set<unknown>();
        const key = def.unique;
        const dup = v.map((x) => (key !== true && isObject(x) ? x[key] : x)).find((x) => x !== undefined && (seen.has(x) || !seen.add(x)));
        if (dup !== undefined) errors.push(`${at} の${def.unique !== true ? ` ${def.unique}` : ''}「${dup}」が2回あります。名前を変えて、見分けられるようにしてください。`);
      }
      if (def.atMostOne && v.filter((x) => isObject(x) && x[def.atMostOne!] === true).length > 1) errors.push(`${at} で ${def.atMostOne} を付けられるのは1つまでです。`);
      return errors;
    }
    case 'object':
      if (!isObject(v)) return [`${at} は { } の形で書きます。`];
      return checkFields(v, def.fields, at, limits);
    case 'tuple': {
      const min = def.min ?? def.items.length;
      // 省ける位置（min より後ろ）の末尾の null は、書かなかったのと同じに扱う。型（[元, 先, 名前?]）の省いた形にそろえる。
      if (Array.isArray(v)) while (v.length > min && v[v.length - 1] == null) v.pop();
      if (!Array.isArray(v) || v.length < min || v.length > def.items.length) {
        return [`${at} は${min === def.items.length ? `${min}個` : `${min}〜${def.items.length}個`}の値の組で書きます${def.desc ? `（${def.desc}）` : ''}。`];
      }
      return v.flatMap((item, i) => checkField(item, { ...def.items[i], required: i < min }, `${at}[${i}]`, limits));
    }
    case 'oneOf': {
      // まとまりで書いたときは、まとまりの形の誤りを、それ以外は最初の形の誤りを知らせる。
      const results = def.options.map((o) => checkField(v, { ...o, required: true }, at, limits));
      if (results.some((r) => !r.length)) return [];
      const objectAt = def.options.findIndex((o) => o.type === 'object');
      return isObject(v) && objectAt >= 0 ? results[objectAt] : results[0];
    }
  }
}

// 任意の項目に書いた null（YAML で値を空にしたとき）は、書かなかったのと同じに扱う。
// 型（Infer）では任意の項目は undefined なので、描画のコードが null を「書いた」と取り違えないよう、ここで消す。
const dropNulls = (obj: Record<string, unknown>, fields: Fields): void => {
  for (const [k, def] of Object.entries(fields)) if (obj[k] === null && !def.required) delete obj[k];
};

// まとまりの項目をすべて確かめる。定義に無い項目は、書き間違いとして知らせる。
export const checkFields = (obj: Record<string, unknown>, fields: Fields, at: string, limits?: Limits): string[] => {
  dropNulls(obj, fields);
  return [...unknownKeys(obj, Object.keys(fields), at), ...Object.entries(fields).flatMap(([k, def]) => checkField(obj[k], def, at ? `${at}.${k}` : k, limits))];
};

// 図の仕様を確かめる。仕様の type は、どの型にもある。
export const checkSpec = (spec: object, fields: Fields, name: string, limits: Limits): string[] => {
  const all: Fields = { type: { type: 'string' }, ...fields };
  const obj = spec as Record<string, unknown>;
  dropNulls(obj, all);
  return [...unknownKeys(obj, Object.keys(all), name), ...Object.entries(all).flatMap(([k, def]) => checkField(obj[k], def, k, limits))];
};

// ---- 書き方 ------------------------------------------------------------------

// AI に渡す、項目の説明。「名前: 説明（必須、上限）」の形で、入れ子の項目も1行ずつ書く。
export function describe(fields: Fields, limits?: Limits, prefix = ''): string[] {
  return Object.entries(fields).flatMap(([k, def]) => [`${prefix + k}: ${def.desc ?? ''}（${[def.required ? '必須' : '任意', ...extra(def, limits)].join('、')}）`, ...inner(def, prefix + k, limits)]);
}

// 値の中の項目の説明。まとまりの項目、配列の要素（名前[]）、いくつかの形のうちのまとまりの形をたどる。
function inner(d: Field, path: string, limits?: Limits): string[] {
  if (d.type === 'object') return describe(d.fields, limits, `${path}.`);
  if (d.type === 'oneOf') return d.options.flatMap((o) => (o.type === 'object' ? inner(o, path, limits) : []));
  if (d.type !== 'list') return [];
  const item = `${path}[]`;
  // 配列の中の配列（compare の段など）は、要素の配列の説明と個数も1行で書く。説明も個数も無ければ書かない。
  const notes = d.of.type === 'list' ? extra(d.of, limits) : [];
  const head = d.of.type === 'list' && (d.of.desc || notes.length) ? [`${item}: ${d.of.desc ?? ''}${notes.length ? `（${notes.join('、')}）` : ''}`] : [];
  return [...head, ...inner(d.of, item, limits)];
}

function extra(def: Field, limits?: Limits): string[] {
  const out: string[] = [];
  if (def.type === 'string') {
    if (def.values) out.push(`${def.values.join('、')} のどれか`);
    if (def.max !== undefined) out.push(`全角${def.max}字まで`);
  }
  if (def.type === 'number') {
    if (def.above !== undefined) out.push(`${def.above}より大きい`);
    if (def.max !== undefined) out.push(`${def.min ?? ''}〜${def.max}`);
    else if (def.min !== undefined) out.push(`${def.min}以上`);
  }
  if (def.type === 'list') {
    const max = limitOf(def.max, limits);
    if (def.min !== undefined && max !== undefined) out.push(`${def.min}〜${max}個`);
    else if (max !== undefined) out.push(`${max}個まで`);
    else if (def.min !== undefined) out.push(`${def.min}個以上`);
    if (def.unique) out.push(`${def.unique !== true ? `${def.unique} は` : ''}重ならないように`);
  }
  if (def.note) out.push(def.note);
  return out;
}
