// 動画のページの中で動くスクリプト。Node では動かさない。
// 時刻はエンジンが zkSeek(T) で決める。AI が書いたシーンの CSS、SMIL、JS も、この時刻に合わせて止めた状態で撮る。
// 演出は AI がシーンごとに書く。ここは時刻の制御、字幕、切り替え、検査と、AI が書かなかったシーンの代わりの自動の動きだけを持つ。
// エンジンとの取り決め（window の zk* の関数と、渡す値の形）は page.d.ts にある。このファイルは変換せずにページへ渡すので、型は JSDoc で書く。

/** @typedef {import('./page.d.ts').PagePlan} PagePlan */
/** @typedef {import('./page.d.ts').PageScene} PageScene */
/** @typedef {import('./page.d.ts').Cue} Cue */
/** @typedef {import('./page.d.ts').PageError} PageError */
/** @typedef {import('./page.d.ts').LineInfo} LineInfo */
/** @typedef {import('./page.d.ts').Frame} Frame */
/** @typedef {import('./page.d.ts').FigurePart} FigurePart */
/** @typedef {import('./page.d.ts').TypeMotion} TypeMotion */
/** @typedef {import('./script.ts').VideoFinding} VideoFinding */
// シーンの要素。data-id にシーンの番号を持つ。
/** @typedef {HTMLElement & { dataset: { id: string } }} SceneElement */
// data-* の印を持てる要素。
/** @typedef {HTMLElement | SVGElement} Tagged */
// 投げられた値。Error とは限らない。
/** @typedef {{ message?: unknown } | null | undefined} Thrown */
/** @typedef {{ at: number, cb: unknown, args: unknown[], every: number, scene: number | null }} Timer */
/** @typedef {(cb: unknown, ms?: number, ...args: unknown[]) => number} SetTimer */
/** @typedef {{ id: number | null, frame: Frame }} Hook */
/** @typedef {{ cur: number, next: number | null, p: number, cam: number, type?: string }} Camera */

(() => {
  /** @type {PagePlan} */
  const plan = JSON.parse(/** @type {HTMLElement} */ (document.getElementById('zk-plan')).textContent);
  const W = plan.width;
  const H = plan.height;

  // ---- 時刻と乱数の固定 ----
  // 同じ原稿から毎回同じコマを作るため、時計、タイマー、乱数をエンジンの時刻に差し替える。
  let now = 0;
  const EPOCH = Date.UTC(2026, 0, 1);
  const seeded = (/** @type {number} */ seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = seeded(1);
  const RealDate = Date;
  // 差し替えるのは new Date() と Date.now()。クラスは Date() と関数としては呼べないが、型は DateConstructor として扱う。
  window.Date = /** @type {DateConstructor} */ (class extends RealDate {
    /** @param {ConstructorParameters<DateConstructor>} a */
    constructor(...a) {
      if (a.length) super(...a);
      else super(EPOCH + now);
    }
    /** @override */
    static now() {
      return EPOCH + now;
    }
  });
  performance.now = () => now;
  crypto.getRandomValues = /** @type {Crypto['getRandomValues']} */ (
    (/** @type {Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array} */ arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 2 ** (8 * (arr.BYTES_PER_ELEMENT ?? 1)));
      return arr;
    }
  );
  // c は '0'、'1'、'8' の1文字。数として計算する。
  crypto.randomUUID = /** @type {Crypto['randomUUID']} */ (() => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (/** @type {number} */ (/** @type {unknown} */ (c)) ^ (Math.floor(Math.random() * 16) >> (/** @type {number} */ (/** @type {unknown} */ (c)) / 4))).toString(16)));
  // 描画が画面に反映されるのを待つために、本物の requestAnimationFrame を取っておく。
  const realRaf = window.requestAnimationFrame.bind(window);
  window.zkPainted = () => new Promise((ok) => realRaf(() => realRaf(ok)));
  /** @type {FrameRequestCallback[]} */
  let rafs = [];
  window.requestAnimationFrame = (cb) => rafs.push(cb);
  window.cancelAnimationFrame = () => {};
  /** @type {Map<number, Timer>} */
  const timers = new Map();
  let timerId = 1;
  // タイマーは、作ったシーンを覚えておく。コールバックの例外を、そのシーンのものとして記録するため。
  // 読み込みの間（zkInit の前）にシーンのスクリプトが作ったタイマーは、そのシーンの始まりを0として数える。
  // 時計は読み込みの間は0なので、そのままだと後のシーンのタイマーが動画の最初に動いてしまうため。
  let loading = true;
  const base = () => (loading && running != null ? plan.scenes[running].start * 1000 : now);
  window.setTimeout = /** @type {typeof window.setTimeout} */ (/** @type {SetTimer} */ ((cb, ms = 0, ...args) => (timers.set(timerId, { at: base() + Math.max(0, +ms || 0), cb, args, every: 0, scene: running }), timerId++)));
  window.setInterval = /** @type {typeof window.setInterval} */ (/** @type {SetTimer} */ ((cb, ms = 0, ...args) => (timers.set(timerId, { at: base() + Math.max(1, +ms || 0), cb, args, every: Math.max(1, +ms || 0), scene: running }), timerId++)));
  window.clearTimeout = window.clearInterval = /** @type {typeof window.clearTimeout} */ ((/** @type {number} */ id) => timers.delete(id));
  function runTimers() {
    for (let n = 0; ; n++) {
      /** @type {[number, Timer] | null} */
      let next = null;
      for (const [id, t] of timers) if (t.at <= now && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) return;
      const [id, t] = next;
      if (n > 10000) {
        errors.push({ scene: t.scene, message: '1コマの間に、タイマーが1万回を超えて動きました。' });
        timers.clear();
        return;
      }
      if (t.every) t.at += t.every;
      else timers.delete(id);
      if (typeof t.cb === 'function') guard(t.scene, 'タイマーのコールバック', () => /** @type {(...args: unknown[]) => unknown} */ (t.cb)(...t.args));
    }
  }

  /** @type {PageError[]} */
  const errors = [];
  // 型の名前は利用者が決めるので、constructor のような、オブジェクトが元から持つ名前を拾わないようにする。
  /** @type {Record<string, TypeMotion>} */
  const typeMotions = Object.create(null);
  // 型の動きが例外を出して、自動の動きに切り替えたシーン。エンジンは、仕上げの書き出しでこのシーンの型の動きを使わない。
  /** @type {Set<number>} */
  const motionFailed = new Set();
  /** @type {Cue[]} */
  const cues = [];
  /** @type {Hook[]} */
  const hooks = [];
  /** @type {{ id: number | null, fn: (ctx: OfflineAudioContext) => unknown }[]} */
  const sounds = [];
  const sceneOf = (/** @type {Element | null | undefined} */ el) => /** @type {SceneElement | null | undefined} */ (el?.closest?.('.zk-scene'));
  const ease = (/** @type {number} */ p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  const clamp = (/** @type {number} */ v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  /**
   * @template T
   * @param {number | null} scene
   * @param {string} what
   * @param {() => T} fn
   * @returns {T | void} 例外のときは何も返さない。
   */
  const guard = (scene, what, fn) => {
    try {
      return fn();
    } catch (e) {
      errors.push({ scene, message: `${what}で例外が起きました。${/** @type {Thrown} */ (e)?.message ?? e}` });
    }
  };
  /** @type {number | null} */
  let running = null;

  // AI が書くシーンから使う部品。
  window.zk = {
    plan,
    // シーンのスクリプトはエンジンがこの関数で包む。例外は、どのシーンのものかを記録して続ける。
    __run(id, fn) {
      running = id;
      guard(id, 'スクリプトの読み込み', fn);
      running = null;
    },
    // 毎コマ frame(t, root, info) を呼ぶ。t はシーンが始まってからの秒数。状態を持たず、t から計算する。
    // info は { index, text, example, talking, level }。話している行と声の大きさで、絵を動かせる。
    scene(frame) {
      hooks.push({ id: running, frame });
    },
    // 名前の付いた効果音（appear、whoosh、chime など。一覧は prompts/video.md）を、シーンの at 秒に鳴らす。
    // ZzFX の数値で作った音を、シーンの at 秒に鳴らす。
    zzfx(at, ...params) {
      cues.push({ scene: running, t: at, kind: 'zzfx', params: params.map((v) => (v === undefined ? null : v)) });
    },
    cue(kind, at, opts = {}) {
      cues.push({ scene: running, t: at, kind, ...opts });
    },
    // 自分で作る音。fn(ctx) に OfflineAudioContext を渡す。ctx の時刻0がシーンの始まり。
    sound(fn) {
      sounds.push({ id: running, fn });
    },
    // テーマの独自の型の動き（types/<名前>/motion.js）。エンジンが型ごとに包んで登録する。
    __type(name, fn) {
      typeMotions[name] = fn;
    },
    // 図の部品。<zk-figure> で置いた図の中から、ラベルで探す。
    part: (root, label) => root.querySelector(`[data-label="${CSS.escape(label)}"]`),
    // このシーンの根拠。原稿の yaml refs を、Lint と同じ方法で確かめたもの。スクリプトの読み込み中に呼ぶ。
    // コードは { kind: 'code', label, note, excerpt }、引用は { kind: 'quote', source, quote, ja, verified }。
    // 読み込みの外（running が null）では、シーンを引けずに空の配列を返す。
    refs: () => plan.scenes[/** @type {number} */ (running)]?.refs ?? [],
  };

  // ---- 図の部品 ----
  // 図の SVG の直下の要素を部品にし、data-part、data-kind、data-label の印を付ける。AI は印で部品を狙って動かせる。
  // 箱は g、線は path。線の直後の文字は、その線のラベルとして一緒に扱う。
  /**
   * @param {SVGSVGElement} svg
   * @returns {FigurePart[]}
   */
  function tagParts(svg) {
    /** @type {FigurePart[]} */
    const parts = [];
    for (const ch of /** @type {SVGElement[]} */ ([...svg.children])) {
      const tag = ch.tagName.toLowerCase();
      if (['style', 'defs', 'title'].includes(tag)) continue;
      if (tag === 'text' && parts.length && /** @type {FigurePart} */ (parts.at(-1)).kind === 'draw') {
        /** @type {FigurePart} */ (parts.at(-1)).extra.push(ch);
        /** @type {FigurePart} */ (parts.at(-1)).label ??= ch.textContent;
        continue;
      }
      const line = ['path', 'line', 'polyline'].includes(tag) && (getComputedStyle(ch).fill === 'none' || ch.hasAttribute('marker-end'));
      const dashed = line && getComputedStyle(ch).strokeDasharray !== 'none';
      parts.push({
        el: ch,
        extra: [],
        kind: line ? (dashed ? 'fade' : 'draw') : 'pop',
        label: tag === 'g' ? ch.querySelector('text')?.textContent ?? null : tag === 'text' ? ch.textContent : null,
        em: Boolean(ch.querySelector?.('.zk-box-em')) || ch.classList.contains('zk-box-em'),
      });
    }
    parts.forEach((p, k) => {
      // dataset は文字列にして持つ。
      p.el.dataset.part = /** @type {string} */ (/** @type {unknown} */ (k));
      p.el.dataset.kind = p.kind;
      if (p.label) p.el.dataset.label = p.label;
      if (p.em) p.el.dataset.emphasis = '';
    });
    return parts;
  }

  // ---- 自動の動き（AI が html motion を書かなかったシーンと、ガードレールで差し替えたシーン） ----
  // 部品が現れる時刻。ラベルを読み上げた瞬間に出す。ラベルの無い部品（矢印）は、次に出る部品の少し前に出す。
  /**
   * @param {PageScene} sc
   * @param {FigurePart[]} parts
   * @returns {number[]}
   */
  function partTimes(sc, parts) {
    const ns = sc.narrStart;
    const sync = parts.map((p) => {
      if (!p.label) return null;
      for (const l of sc.lines) {
        const i = l.text.indexOf(p.label);
        if (i >= 0) return ns + l.start + (i / Math.max(1, l.text.length)) * (l.end - l.start);
      }
      return null;
    });
    const last = sc.end - sc.start - 0.8;
    if (sync.every((v) => v == null)) return parts.map((_, k) => Math.min(last, ns + 0.2 + k * Math.min(0.5, ((sc.end - sc.start - ns) * 0.5) / Math.max(1, parts.length))));
    /** @type {number[]} */
    const out = [];
    let prev = ns - 0.3;
    parts.forEach((_, k) => {
      let t = sync[k];
      if (t == null) {
        const next = sync.slice(k + 1).find((v) => v != null);
        t = next != null ? Math.max(prev + 0.15, next - 0.45) : prev + 0.3;
      }
      t = Math.min(last, Math.max(t, prev + 0.12));
      out.push(t);
      prev = t;
    });
    return out;
  }

  /** @type {{ el: Element, marker: string, scene: number, at: number }[]} */
  const markerHolds = [];
  /**
   * @param {PageScene} sc
   * @param {HTMLElement} wrap
   * @param {FigurePart[]} parts
   */
  function animateFigure(sc, wrap, parts) {
    if (wrap.dataset.whole === 'true') parts = [{ el: wrap, extra: [], kind: 'pop', label: null, em: false }];
    const times = partTimes(sc, parts);
    parts.forEach((p, k) => {
      const at = times[k] * 1000;
      const el = p.el;
      if (p.kind === 'draw') {
        el.setAttribute('pathLength', '1');
        el.style.strokeDasharray = '1';
        el.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 500, delay: at, fill: 'both', easing: 'ease-in-out' });
        // 矢じりは線の終点に描かれるので、線が伸びきるまで外しておく。
        const marker = el.getAttribute('marker-end');
        if (marker) markerHolds.push({ el, marker, scene: sc.id, at: times[k] + 0.5 });
        cues.push({ scene: sc.id, t: times[k], kind: 'draw', dur: 0.5 });
      } else if (p.kind === 'fade') {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: at, fill: 'both' });
      } else {
        el.style.transformBox = 'fill-box';
        el.style.transformOrigin = 'center';
        el.animate(
          [
            { transform: 'scale(.3)', opacity: 0 },
            { transform: 'scale(1.1)', opacity: 1, offset: 0.6 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 480, delay: at, fill: 'both', easing: 'cubic-bezier(.2,.8,.3,1)' },
        );
        if (p.em) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 1600, delay: at + 500, iterations: Infinity, easing: 'ease-in-out' });
        cues.push({ scene: sc.id, t: times[k], kind: p.em ? 'chime' : 'pop' });
      }
      p.extra.forEach((x) => x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: at + 350, fill: 'both' }));
    });
  }

  /** @type {SceneElement[]} */
  let sceneEls = [];
  // ページを読み終えた後に、エンジンが1回だけ呼ぶ。効果音のきっかけと、読み込み中の例外を返す。
  window.zkInit = () => {
    loading = false;
    sceneEls = [.../** @type {NodeListOf<SceneElement>} */ (document.querySelectorAll('.zk-scene'))];
    for (const el of sceneEls) {
      const sc = plan.scenes[+el.dataset.id];
      guard(sc.id, '準備', () => {
        // 代わりの手段の自動の動きでだけ、題名と主張文を出す。
        const claim = el.querySelector(':scope > .zk-claim, :scope > .zk-title');
        if (claim) claim.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: sc.kind === 'title' ? 300 : 150, fill: 'both', easing: 'cubic-bezier(.2,.8,.3,1)' });
        if (sc.kind === 'title') cues.push({ scene: sc.id, t: 0.3, kind: 'chime' });
        /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('.zk-fig')).forEach((w) => {
          const svg = w.querySelector('svg');
          const parts = svg ? tagParts(svg) : [];
          // 自由なシーンでも、manual を付けなかった図には自動の動きを付ける。
          // テーマの独自の型に動き（motion.js）があれば、自動の動きの代わりにそれを使う。
          // fig は図を包む要素、ctx.parts は部品、ctx.times は各部品が現れる秒、ctx.frame(f) は毎コマ f(t, info) を呼ぶ。
          const motion = typeMotions[/** @type {string} */ (w.dataset.type)];
          if (w.hasAttribute('data-manual')) return;
          if (motion) {
            const times = partTimes(sc, parts);
            // 動きが途中で例外を出したら、図を動かす前の形に戻して、自動の動きに切り替える。
            // 途中まで書き換えた図（隠した部品や、付けた動き）を、そのまま書き出さないため。
            const before = w.innerHTML;
            /** @type {{ hooks: Hook[], cues: Cue[] }} */
            const mine = { hooks: [], cues: [] };
            let done = false;
            let broken = false;
            // 図を元に戻して、自動の動きにする。t を渡すと、作り直した動きをその時刻に合わせる（毎コマの処理の途中で壊れたとき）。
            /** @param {number} [t] */
            const fallback = (t) => {
              broken = true;
              motionFailed.add(sc.id);
              w.getAnimations({ subtree: true }).forEach((a) => a.cancel());
              w.innerHTML = before;
              const fresh = w.querySelector('svg');
              animateFigure(sc, w, fresh ? tagParts(fresh) : []);
              if (t === undefined) return;
              w.getAnimations({ subtree: true }).forEach((a) => {
                a.pause();
                a.currentTime = t * 1000;
              });
            };
            guard(sc.id, `型 ${w.dataset.type} の動き（motion.js）`, () => {
              motion(w, {
                svg, parts, times, start: times[0] ?? sc.narrStart, scene: sc,
                // 毎コマの処理が例外を出したら、それ以降は呼ばずに、図を元に戻して自動の動きにする。
                frame: (f) => mine.hooks.push({ id: sc.id, frame: (t, root, info) => {
                  if (broken) return;
                  try {
                    f(t, info);
                  } catch (e) {
                    fallback(t);
                    throw new Error(`型 ${w.dataset.type} の動き（motion.js）の毎コマの処理で例外が起きたので、自動の動きにしました。${/** @type {Thrown} */ (e)?.message ?? e}`);
                  }
                } }),
                sfx: (kind, at) => mine.cues.push({ scene: sc.id, t: at, kind }),
              });
              done = true;
            });
            if (done) {
              hooks.push(...mine.hooks);
              cues.push(...mine.cues);
            } else fallback();
          } else animateFigure(sc, w, parts);
        });
        // data-sfx を付けた要素は、最初のアニメーションが始まる時刻に音を鳴らす。2つ目からは、浮く動きのような続きの動きとみなす。
        // data-zzfx には ZzFX の数値を、カンマ区切りで書く。空の値は既定値になる。
        // 印で選んだ要素なので、data-zzfx と data-sfx の値がある。要素に付けたアニメーションなので、effect もある。
        /** @type {NodeListOf<Tagged>} */ (el.querySelectorAll('[data-zzfx]')).forEach((x) => {
          const a = x.getAnimations()[0];
          if (a) cues.push({ scene: sc.id, t: (/** @type {AnimationEffect} */ (a.effect).getTiming().delay ?? 0) / 1000, kind: 'zzfx', params: /** @type {string} */ (x.dataset.zzfx).split(',').map((v) => (v.trim() === '' ? null : Number(v))) });
        });
        /** @type {NodeListOf<Tagged>} */ (el.querySelectorAll('[data-sfx]')).forEach((x) => {
          const a = x.getAnimations()[0];
          if (a) cues.push({ scene: sc.id, t: (/** @type {AnimationEffect} */ (a.effect).getTiming().delay ?? 0) / 1000, kind: /** @type {string} */ (x.dataset.sfx) });
        });
      });
    }
    return { cues, errors: errors.splice(0) };
  };

  // AI が zk.sound で作った音を、シーンごとに書き出す。16bit の PCM を base64 で返す。
  window.zkSound = async (id) => {
    const list = sounds.filter((s) => s.id === id);
    if (!list.length) return null;
    const sc = plan.scenes[id];
    const ctx = new OfflineAudioContext(1, Math.ceil((sc.end - sc.start) * 48000), 48000);
    // AI の音の関数が例外を出しても、検査と書き出しは止めない。そのシーンの例外として記録し、音は付けない。
    try {
      for (const s of list) await s.fn(ctx);
    } catch (e) {
      errors.push({ scene: id, message: `zk.sound で例外が起きました。${/** @type {Thrown} */ (e)?.message ?? e}` });
      return null;
    }
    let rendered;
    try {
      rendered = await ctx.startRendering();
    } catch (e) {
      errors.push({ scene: id, message: `zk.sound の音を作れませんでした。${/** @type {Thrown} */ (e)?.message ?? e}` });
      return null;
    }
    const buf = rendered.getChannelData(0);
    const pcm = new Int16Array(buf.length);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      peak = Math.max(peak, Math.abs(buf[i]));
      pcm[i] = Math.max(-1, Math.min(1, buf[i])) * 32767;
    }
    let bin = '';
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { data: btoa(bin), peak };
  };

  // シーンの t 秒の、ナレーションの状態。index は話している行の番号（話していなければ -1）、level は声の大きさ（0〜1）。
  // 音声が無いときの level は、話している間だけ揺れる値で代わりにする。
  /**
   * @param {number} id
   * @param {number} t
   * @returns {LineInfo}
   */
  function lineInfo(id, t) {
    const sc = plan.scenes[id];
    const n = t - sc.narrStart;
    const index = sc.lines.findIndex((l) => n >= l.start && n <= l.end);
    const l = sc.lines[index];
    const level = index < 0 ? 0 : sc.levels ? sc.levels[Math.floor(n * 30)] ?? 0 : 0.5 + 0.5 * Math.sin(n * 23) * Math.sin(n * 7);
    return { index, text: l?.text ?? null, example: Boolean(l?.example), talking: index >= 0, level: Math.max(0, level) };
  }

  // ---- 時刻 T（秒）のコマ ----
  // ページに必ずある要素だけを引く。
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const opt = (/** @type {number} */ i, /** @type {'subtitles' | 'transition'} */ k) => plan.scenes[i]?.options?.[k] ?? 'on';

  // 今のシーンと、切り替えの途中なら次のシーン。p は切り替えの進み具合。
  /**
   * @param {number} T
   * @returns {Camera}
   */
  function camera(T) {
    const s = plan.scenes;
    for (let i = 0; i < s.length; i++) {
      if (T < s[i].end) return { cur: i, next: null, p: 0, cam: i };
      if (i + 1 < s.length && T < s[i + 1].start) {
        const p = ease((T - s[i].end) / (s[i + 1].start - s[i].end));
        return { cur: i, next: i + 1, p, cam: i + p, type: s[i + 1].options.transition };
      }
    }
    return { cur: s.length - 1, next: null, p: 0, cam: s.length - 1 };
  }

  // 切り替えの種類ごとの、出ていくシーンと入ってくるシーンの見え方。
  /**
   * @param {HTMLElement} el
   * @param {number} i
   * @param {Camera} c
   */
  function place(el, i, c) {
    const shown = i === c.cur || i === c.next;
    el.style.visibility = shown ? 'visible' : 'hidden';
    if (!shown) return;
    const out = i === c.cur;
    const p = c.p;
    let tf = 'none';
    let op = 1;
    if (c.next != null) {
      if (c.type === 'pan') tf = `translateX(${((out ? -p : 1 - p) * W).toFixed(1)}px) scale(${(1 - 0.06 * Math.sin(Math.PI * p)).toFixed(4)})`;
      if (c.type === 'fade') op = out ? 1 - p : p;
      if (c.type === 'zoom') {
        tf = out ? `scale(${(1 + 0.6 * p).toFixed(4)})` : `scale(${(0.7 + 0.3 * p).toFixed(4)})`;
        op = out ? 1 - p : p;
      }
    }
    el.style.transform = tf;
    el.style.opacity = String(op);
  }

  window.zkSeek = (T) => {
    now = T * 1000;
    runTimers();
    const cbs = rafs;
    rafs = [];
    cbs.forEach((cb) => guard(null, 'requestAnimationFrame', () => cb(now)));
    const c = camera(T);

    sceneEls.forEach((el) => place(el, +el.dataset.id, c));
    // 止めたアニメーションを、シーンの中の時刻に合わせる。
    for (const a of document.getAnimations()) {
      const el = sceneOf(/** @type {KeyframeEffect | null} */ (a.effect)?.target);
      if (!el) continue;
      a.pause();
      a.currentTime = Math.max(0, T - plan.scenes[+el.dataset.id].start) * 1000;
    }
    // シーンの中の svg なので、親の要素とシーンの要素がある。
    /** @type {NodeListOf<SVGSVGElement>} */ (document.querySelectorAll('.zk-scene svg')).forEach((svg) => {
      if (/** @type {HTMLElement} */ (svg.parentElement).closest('svg') || !svg.pauseAnimations) return;
      svg.pauseAnimations();
      svg.setCurrentTime(Math.max(0, T - plan.scenes[+(/** @type {SceneElement} */ (sceneOf(svg))).dataset.id].start));
    });
    markerHolds.forEach((m) => {
      if (T - plan.scenes[m.scene].start >= m.at) m.el.setAttribute('marker-end', m.marker);
      else m.el.removeAttribute('marker-end');
    });
    // 話している間は、シーンの data-talking を true にする。CSS の属性セレクタでも、話している間だけ絵を変えられる。
    for (const el of sceneEls) {
      const id = +el.dataset.id;
      if (id === c.cur || id === c.next) el.dataset.talking = String(lineInfo(id, T - plan.scenes[id].start).talking);
    }
    for (const h of hooks) {
      if (h.id !== c.cur && h.id !== c.next) continue;
      const el = sceneEls.find((e) => +e.dataset.id === h.id);
      const t = Math.max(0, T - plan.scenes[/** @type {number} */ (h.id)].start);
      running = h.id;
      guard(h.id, 'zk.scene の frame', () => h.frame(t, el, lineInfo(/** @type {number} */ (h.id), t)));
      running = null;
    }

    const sc = plan.scenes[c.cur];
    const local = T - sc.start;

    // 字幕。次の文が始まるまで、前の文を出しておく。
    let line = null;
    if (c.p === 0 && opt(c.cur, 'subtitles') === 'on') {
      sc.lines.forEach((l, k) => {
        const next = sc.lines[k + 1];
        if (local >= sc.narrStart + l.start && local < sc.narrStart + (next ? next.start : l.end + 0.5)) line = l.text;
      });
    }
    const sub = $('zk-sub');
    sub.textContent = line ?? '';
    sub.style.visibility = line ? 'visible' : 'hidden';

    $('zk-fade').style.opacity = String(T < 0.4 ? 1 - T / 0.4 : clamp((T - (plan.duration - plan.fadeOut)) / plan.fadeOut));
  };

  // ---- 見た目の検査 ----
  // シーンの時刻 T のコマで、文字のはみ出し、字幕の帯との重なり、小さすぎる文字、要素の数、シーンより長いアニメーションを調べる。
  window.zkCheck = (id, T) => {
    /** @type {VideoFinding[]} */
    const out = [];
    // エンジンは、ページにあるシーンの番号だけを渡す。
    const el = /** @type {SceneElement} */ (sceneEls.find((e) => +e.dataset.id === id));
    const sc = plan.scenes[id];
    const L = plan.limits;
    const count = el.querySelectorAll('*').length;
    if (count > L.maxElements) out.push({ severity: 'error', rule: 'V105', message: `要素が${count}個あります。上限は${L.maxElements}個です。` });
    const visible = (/** @type {Element | null} */ x) => {
      let o = 1;
      for (let n = x; n && n !== el.parentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        o *= +cs.opacity;
      }
      return o > 0.05;
    };
    // SVG の要素も入る。SVG の要素の offsetHeight は undefined なので、下の scale では 1 になる。文字のノード（nodeType 3）の textContent は null にならない。
    const texts = [.../** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('*'))].filter((x) => [...x.childNodes].some((n) => n.nodeType === 3 && /** @type {string} */ (n.textContent).trim()) && visible(x));
    const band = sc.lines.length && sc.options.subtitles === 'on' ? { left: W / 2 - 640, right: W / 2 + 640, top: H - 190, bottom: H } : null;
    /** @type {Set<string>} */
    const seen = new Set();
    for (const x of texts) {
      const r = x.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const label = x.textContent.trim().slice(0, 20);
      const key = (/** @type {string} */ rule) => `${rule}:${label}`;
      if ((r.left < -2 || r.right > W + 2 || r.top < -2 || r.bottom > H + 2) && !seen.has(key('V101'))) {
        seen.add(key('V101'));
        out.push({ severity: 'warn', rule: 'V101', message: `${T.toFixed(1)}秒の文字「${label}」が画面の外にはみ出しています。` });
      }
      if (band && r.right > band.left && r.left < band.right && r.bottom > band.top && !seen.has(key('V102'))) {
        seen.add(key('V102'));
        out.push({ severity: 'warn', rule: 'V102', message: `${T.toFixed(1)}秒の文字「${label}」が字幕の帯（下から190px）に重なっています。` });
      }
      const fs = parseFloat(getComputedStyle(x).fontSize);
      const scale = x instanceof SVGGraphicsElement ? Math.abs(x.getScreenCTM()?.d ?? 1) : x.offsetHeight ? r.height / x.offsetHeight : 1;
      if (fs * scale < L.minFontPx && !seen.has(key('V103'))) {
        seen.add(key('V103'));
        out.push({ severity: 'warn', rule: 'V103', message: `${T.toFixed(1)}秒の文字「${label}」が${(fs * scale).toFixed(0)}px です。${L.minFontPx}px 以上にしてください。` });
      }
    }
    const dur = (sc.end - sc.start) * 1000;
    for (const a of el.getAnimations({ subtree: true })) {
      // CSS のアニメーションの endTime は数。無いときは、下の Number.isFinite で外す。
      const end = /** @type {number} */ (a.effect?.getComputedTiming().endTime);
      if (Number.isFinite(end) && end > dur + 50) {
        out.push({ severity: 'warn', rule: 'V104', message: `アニメーションが ${(end / 1000).toFixed(1)}秒まで続き、シーンの長さ ${(dur / 1000).toFixed(1)}秒を超えます。目印の時刻か <zk-options hold> で合わせてください。` });
        break;
      }
    }
    return out;
  };
  window.zkErrors = () => errors.splice(0);
  window.zkMotionFailed = () => [...motionFailed];
})();
