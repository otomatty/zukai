// zukai 全体で共有する型。契約（contract/）の JSON から作れる型は JSON から作り、上限や色を足したときに型が追いつくようにする。
// このファイルは型だけを持ち、実行時には何も読まない（Node は型を取り除いて実行する）。

// ---- 契約 --------------------------------------------------------------------

type TokensFile = typeof import('../contract/tokens.json', { with: { type: 'json' } });
type ChartTokens = Omit<TokensFile['chart'], 'mode'> & { mode: 'series' | 'neutral' };

// 色、フォント、寸法。contract/tokens.json にテーマ（theme.ts）を重ねたもの。
// JSON から作ると選択肢が string になり、空の配列が never[] になるので、その項目だけ書き直す。
export type Tokens = Omit<TokensFile, 'gradient' | 'emphasis' | 'chart'> & {
  gradient: { stops: string[]; angle: number };
  emphasis: { box: 'flat' | 'fill' | 'tint' | 'outline'; chart: 'flat' | 'gradient' };
  chart: ChartTokens;
};

// 文字数や図の要素数の上限。contract/limits.json そのもの。
export type Limits = typeof import('../contract/limits.json', { with: { type: 'json' } });

export type Severity = 'error' | 'warn';

// ---- 設定 --------------------------------------------------------------------

// 設定の置き場所。env と default は、値の出どころとしてだけ現れる。
export type Scope = 'team' | 'local' | 'user' | 'credentials';
export type Origin = Scope | 'env' | 'default';

// contract/settings.json の1項目。
export interface SettingSpec {
  group: string;
  type: 'enum' | 'string' | 'path' | 'url' | 'number' | 'boolean' | 'terms';
  description: string;
  scopes: Scope[];
  values?: string[];
  labels?: Record<string, string>;
  suggest?: string[];
  default?: unknown;
  env?: string;
  secret?: boolean;
  min?: number;
  max?: number;
}

// 用語集の1語。
export interface Term {
  use: string;
  avoid?: string[];
  except?: string[];
  examples?: string[];
  actual?: string;
}

// コード参照に使うリポジトリ。
export interface Repo {
  path?: string;
  host?: 'github' | 'codecommit';
  org?: string;
  name?: string;
  region?: string;
  branch?: string;
  link?: string;
  pin?: boolean;
}

// 入れ子にした設定の値。既定値のある項目は、必ず値がある。
export interface Settings {
  output: 'document' | 'video';
  theme: string | null;
  video: {
    model: string;
    voice: string;
    style: string;
    bgm: string | null;
    bgmVolume: number;
    sfx: { enabled: boolean; volume: number; files: Record<string, string> };
  };
  confluence: { base: string | null; spaceId: string | null; parentId: string | null; email: string | null; token: string | null };
  gemini: { apiKey: string | null };
  terms: Term[];
  repos: Record<string, Repo>;
  png: { font: string | null };
  chromium: string | null;
  // setup と doctor の表示言語。設定とテーマの誤りと検査の文も、この言語で出す。
  lang: 'ja' | 'en';
}

// ---- 原稿 --------------------------------------------------------------------

interface At {
  line: number;
  endLine: number;
}
export interface ParagraphBlock extends At {
  kind: 'paragraph';
  text: string;
}
export interface ListBlock extends At {
  kind: 'list';
  text: string;
}
// 図の仕様は YAML から読んだまま。形は図の型の validate が確かめる。空のブロックは null になる。
export interface FigureBlock extends At {
  kind: 'figure';
  raw: string;
  spec?: RawSpec | null;
  parseError?: string;
}
export interface NarrationBlock extends At {
  kind: 'narration';
  role: string | null;
  ending: boolean;
  lines?: unknown;
  parseError?: string;
}
export interface MotionBlock extends At {
  kind: 'motion';
  html: string;
  role: string | null;
  ending: boolean;
}
export interface RefsBlock extends At {
  kind: 'refs';
  list?: unknown;
  parseError?: string;
}
export interface CodeBlock extends At {
  kind: 'code';
  lang: string;
}
export interface OtherBlock extends At {
  kind: 'table' | 'other';
}
export type Block = ParagraphBlock | ListBlock | FigureBlock | NarrationBlock | MotionBlock | RefsBlock | CodeBlock | OtherBlock;

// <!-- zukai-ignore ルールID 理由 -->
export interface Ignore {
  rule: string;
  reason: string;
  line: number;
}

export interface Section {
  level: number;
  title: string;
  line: number;
  endLine: number;
  blocks: Block[];
  ignores: Ignore[];
  // 本文を持たず、直後に下位の見出しが続く見出し。検査から外す。
  container: boolean;
}

export interface Doc {
  title: string | null;
  titleLine?: number;
  lead: Block[];
  sections: Section[];
  ignores?: Ignore[];
}

// ---- 図の型 ------------------------------------------------------------------

// YAML から読んだ図の仕様。どの値も、検証するまでは形が分からない。
export type RawSpec = { type?: unknown; [key: string]: unknown };

// 検証する前の値。どの項目も無いかもしれず、配列の要素は null かもしれない。
// 値の型は宣言どおりとは限らないので、validate は typeof や Array.isArray で確かめてから使う。
// 配列は readonly にしない。readonly の配列を Array.isArray で絞ると、要素が any になり、要素の検査が型で確かめられなくなるため。
export type Unchecked<T> = T extends readonly (infer U)[]
  ? Unchecked<U>[] | null | undefined
  : T extends object
    ? { readonly [K in keyof T]?: Unchecked<T[K]> } | null | undefined
    : T | null | undefined;
export type UncheckedSpec<S> = { readonly [K in keyof S]?: Unchecked<S[K]> };

// 図を検査し、描くときの文脈。baseDir は原稿のフォルダ。tokens が無ければ、baseDir のプロジェクトのテーマから読む。
export interface FigureContext {
  baseDir?: string;
  tokens?: Tokens;
  types?: FigureTypes;
}

// 図の型。型ごとに1ファイルで、仕様の検証と SVG の描画を持つ。S は検証に通った仕様の形。
export interface FigureType<S = RawSpec> {
  name: string;
  summary: string;
  when: string;
  example: string;
  // AI に渡す、項目の説明。
  fields: string[];
  // コードブロックの情報文字列。既定は yaml figure。
  fence?: string;
  // テーマの独自の型（figures/custom.ts）だけが持つ。
  custom?: boolean;
  caps?: string;
  motion?: string | null;
  // 契約とテーマから決まる、書き方の補足。
  guide?(t: Tokens, limits: Limits): string[];
  validate(spec: UncheckedSpec<S>, limits: Limits, ctx?: FigureContext): string[];
  // 長さの上限を確かめる文字。labels は箱の名前、notes は補足。
  labels(spec: S): string[];
  notes(spec: S): string[];
  // 根拠の番号。検証では形を確かめないので、数とは限らない。
  refs?(spec: S): unknown[];
  // 描いた結果で確かめる、文字の収まり。
  fit?(spec: S, t: Tokens, ctx?: FigureContext): string[];
  // 文章のルールでも検査する、図の中の説明文。
  prose?(spec: S): string[];
  // 用語の表記の検査に渡す、図に出る文字。無ければ labels と notes を使う。
  texts?(spec: S, ctx?: FigureContext): string[];
  title?(spec: S, t: Tokens): string;
  render(spec: S, t: Tokens, ctx?: FigureContext): string;
  // 図の後ろに続ける HTML と Confluence の本文（画面の注釈の一覧など）。
  after?(spec: S, ctx?: FigureContext): { html: string; storage: string };
}

// 型の一覧。型ごとに仕様の形が違うので、一覧では仕様の形を問わない。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFigureType = FigureType<any>;
export type FigureTypes = Record<string, AnyFigureType>;

// ---- Lint --------------------------------------------------------------------

export interface Finding {
  rule: string;
  severity: Severity;
  line: number;
  message: string;
}
