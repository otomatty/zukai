// 動画のページ（runtime.browser.js）とエンジン（encode.ts）の取り決め。
// runtime.browser.js が window に置く zk* の関数を、encode.ts が page.evaluate で呼ぶ。どちらもこの型で検査する。
// ページには JSON で渡すので、関数や Float32Array のような値は入れない。
import type { Limits } from '../types.ts';
import type { Scene, SceneOptions, SceneRef, TimedScene, VideoFinding } from './script.ts';

// ページに渡すシーン。図とシーンの HTML は DOM に入れるので、時間割からは外す。
export type PageScene = Omit<TimedScene<Scene>, 'figureSvg' | 'tableHtml' | 'motionHtml' | 'findings'>;

// ページに渡す時間割。<script id="zk-plan"> に JSON で入れる。
export interface PagePlan {
  scenes: PageScene[];
  duration: number;
  fadeOut: number;
  width: number;
  height: number;
  fps: number;
  limits: Limits['video'];
}

// 効果音のきっかけ。scene はシーンの番号、t はシーンが始まってからの秒数。
// kind が zzfx なら params に ZzFX の数値（空は null）。zk.cue の3つ目の引数の項目（dur など）も、そのまま入る。
export interface Cue {
  scene: number | null;
  t: number;
  kind: string;
  params?: (number | null)[];
  dur?: number;
}

// ページの中で起きた例外。どのシーンのものか分からないときは scene が null。
export interface PageError {
  scene: number | null;
  message: string;
}

// シーンの t 秒の、ナレーションの状態。index は話している行の番号（話していなければ -1）、level は声の大きさ（0〜1）。
export interface LineInfo {
  index: number;
  text: string | null;
  example: boolean;
  talking: boolean;
  level: number;
}

// zk.scene に渡す、毎コマの処理。t はシーンが始まってからの秒数、root はシーンの要素。
export type Frame = (t: number, root: HTMLElement | undefined, info: LineInfo) => void;

// 図の部品。runtime.browser.js が図の SVG の直下の要素に印を付けて作る。
export interface FigurePart {
  el: HTMLElement | SVGElement;
  extra: Element[];
  kind: 'draw' | 'fade' | 'pop';
  label: string | null;
  em: boolean;
}

// テーマの独自の型の動き（types/<名前>/motion.js）。fig は図を包む要素。
export type TypeMotion = (
  fig: HTMLElement,
  ctx: {
    svg: SVGSVGElement | null;
    parts: FigurePart[];
    // 各部品が現れる秒。
    times: number[];
    start: number;
    scene: PageScene;
    frame(f: (t: number, info: LineInfo) => void): void;
    sfx(kind: string, at: number): void;
  },
) => void;

// AI が書くシーンから使う部品。
export interface Zk {
  plan: PagePlan;
  __run(id: number, fn: () => void): void;
  scene(frame: Frame): void;
  zzfx(at: number, ...params: (number | null | undefined)[]): void;
  cue(kind: string, at: number, opts?: Partial<Cue>): void;
  sound(fn: (ctx: OfflineAudioContext) => unknown): void;
  __type(name: string, fn: TypeMotion): void;
  part(root: ParentNode, label: string): Element | null;
  refs(): SceneRef[];
}

// zk.sound の音。data は 16bit の PCM を base64 にしたもの、peak は音の最大値。
export interface SoundData {
  data: string;
  peak: number;
}

declare global {
  interface Window {
    zk: Zk;
    // ページを読み終えた後に、1回だけ呼ぶ。効果音のきっかけと、読み込み中の例外を返す。
    zkInit(): { cues: Cue[]; errors: PageError[] };
    // 動画の T 秒のコマにする。
    zkSeek(T: number): void;
    // 描いたものが画面に出るのを待つ。
    zkPainted(): Promise<unknown>;
    zkSound(id: number): Promise<SoundData | null>;
    // シーンの T 秒のコマの見た目を調べる。
    zkCheck(id: number, T: number): VideoFinding[];
    // 前に呼んでから記録した例外。
    zkErrors(): PageError[];
    // 型の動きが例外を出して、自動の動きに切り替えたシーンの番号。
    zkMotionFailed(): number[];
  }
}
