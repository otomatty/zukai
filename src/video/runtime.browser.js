// 動画のページの中で動くスクリプト。Node では動かさない。
// 時刻はエンジンが zkSeek(T) で決める。AI が書いたシーンの CSS、SMIL、JS も、この時刻に合わせて止めた状態で撮る。
// 演出は AI がシーンごとに書く。ここは時刻の制御、字幕、切り替え、検査と、AI が書かなかったシーンの代わりの自動の動きだけを持つ。
(() => {
  const plan = JSON.parse(document.getElementById('zk-plan').textContent);
  const W = plan.width;
  const H = plan.height;

  // ---- 時刻と乱数の固定 ----
  // 同じ原稿から毎回同じコマを作るため、時計、タイマー、乱数をエンジンの時刻に差し替える。
  let now = 0;
  const EPOCH = Date.UTC(2026, 0, 1);
  const seeded = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = seeded(1);
  const RealDate = Date;
  window.Date = class extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(EPOCH + now);
    }
    static now() {
      return EPOCH + now;
    }
  };
  performance.now = () => now;
  crypto.getRandomValues = (arr) => {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 2 ** (8 * (arr.BYTES_PER_ELEMENT ?? 1)));
    return arr;
  };
  crypto.randomUUID = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (Math.floor(Math.random() * 16) >> (c / 4))).toString(16));
  // 描画が画面に反映されるのを待つために、本物の requestAnimationFrame を取っておく。
  const realRaf = window.requestAnimationFrame.bind(window);
  window.zkPainted = () => new Promise((ok) => realRaf(() => realRaf(ok)));
  let rafs = [];
  window.requestAnimationFrame = (cb) => rafs.push(cb);
  window.cancelAnimationFrame = () => {};
  const timers = new Map();
  let timerId = 1;
  window.setTimeout = (cb, ms = 0, ...args) => (timers.set(timerId, { at: now + Math.max(0, +ms || 0), cb, args, every: 0 }), timerId++);
  window.setInterval = (cb, ms = 0, ...args) => (timers.set(timerId, { at: now + Math.max(1, +ms || 0), cb, args, every: Math.max(1, +ms || 0) }), timerId++);
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  function runTimers() {
    for (let n = 0; ; n++) {
      if (n > 10000) throw new Error('1コマの間に、タイマーが1万回を超えて動きました。');
      let next = null;
      for (const [id, t] of timers) if (t.at <= now && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) return;
      const [id, t] = next;
      if (t.every) t.at += t.every;
      else timers.delete(id);
      if (typeof t.cb === 'function') t.cb(...t.args);
    }
  }

  const errors = [];
  const cues = [];
  const hooks = [];
  const sounds = [];
  const sceneOf = (el) => el?.closest?.('.zk-scene');
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const guard = (scene, what, fn) => {
    try {
      return fn();
    } catch (e) {
      errors.push({ scene, message: `${what}で例外が起きました。${e?.message ?? e}` });
    }
  };
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
    // 図の部品。<zk-figure> で置いた図の中から、ラベルで探す。
    part: (root, label) => root.querySelector(`[data-label="${CSS.escape(label)}"]`),
    // このシーンの根拠。原稿の yaml refs を、Lint と同じ方法で確かめたもの。スクリプトの読み込み中に呼ぶ。
    // コードは { kind: 'code', label, note, excerpt }、引用は { kind: 'quote', source, quote, ja, verified }。
    refs: () => plan.scenes[running]?.refs ?? [],
  };

  // ---- 図の部品 ----
  // 図の SVG の直下の要素を部品にし、data-part、data-kind、data-label の印を付ける。AI は印で部品を狙って動かせる。
  // 箱は g、線は path。線の直後の文字は、その線のラベルとして一緒に扱う。
  function tagParts(svg) {
    const parts = [];
    for (const ch of [...svg.children]) {
      const tag = ch.tagName.toLowerCase();
      if (['style', 'defs', 'title'].includes(tag)) continue;
      if (tag === 'text' && parts.length && parts.at(-1).kind === 'draw') {
        parts.at(-1).extra.push(ch);
        parts.at(-1).label ??= ch.textContent;
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
      p.el.dataset.part = k;
      p.el.dataset.kind = p.kind;
      if (p.label) p.el.dataset.label = p.label;
      if (p.em) p.el.dataset.emphasis = '';
    });
    return parts;
  }

  // ---- 自動の動き（AI が html motion を書かなかったシーンと、ガードレールで差し替えたシーン） ----
  // 部品が現れる時刻。ラベルを読み上げた瞬間に出す。ラベルの無い部品（矢印）は、次に出る部品の少し前に出す。
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

  const markerHolds = [];
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

  let sceneEls = [];
  // ページを読み終えた後に、エンジンが1回だけ呼ぶ。効果音のきっかけと、読み込み中の例外を返す。
  window.zkInit = () => {
    sceneEls = [...document.querySelectorAll('.zk-scene')];
    for (const el of sceneEls) {
      const sc = plan.scenes[+el.dataset.id];
      guard(sc.id, '準備', () => {
        // 代わりの手段の自動の動きでだけ、題名と主張文を出す。
        const claim = el.querySelector(':scope > .zk-claim, :scope > .zk-title');
        if (claim) claim.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: sc.kind === 'title' ? 300 : 150, fill: 'both', easing: 'cubic-bezier(.2,.8,.3,1)' });
        if (sc.kind === 'title') cues.push({ scene: sc.id, t: 0.3, kind: 'chime' });
        el.querySelectorAll('.zk-fig').forEach((w) => {
          const svg = w.querySelector('svg');
          const parts = svg ? tagParts(svg) : [];
          // 自由なシーンでも、manual を付けなかった図には自動の動きを付ける。
          if (!w.hasAttribute('data-manual')) animateFigure(sc, w, parts);
        });
        // data-sfx を付けた要素は、最初のアニメーションが始まる時刻に音を鳴らす。2つ目からは、浮く動きのような続きの動きとみなす。
        // data-zzfx には ZzFX の数値を、カンマ区切りで書く。空の値は既定値になる。
        el.querySelectorAll('[data-zzfx]').forEach((x) => {
          const a = x.getAnimations()[0];
          if (a) cues.push({ scene: sc.id, t: (a.effect.getTiming().delay ?? 0) / 1000, kind: 'zzfx', params: x.dataset.zzfx.split(',').map((v) => (v.trim() === '' ? null : Number(v))) });
        });
        el.querySelectorAll('[data-sfx]').forEach((x) => {
          const a = x.getAnimations()[0];
          if (a) cues.push({ scene: sc.id, t: (a.effect.getTiming().delay ?? 0) / 1000, kind: x.dataset.sfx });
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
    for (const s of list) await s.fn(ctx);
    const buf = (await ctx.startRendering()).getChannelData(0);
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
  function lineInfo(id, t) {
    const sc = plan.scenes[id];
    const n = t - sc.narrStart;
    const index = sc.lines.findIndex((l) => n >= l.start && n <= l.end);
    const l = sc.lines[index];
    const level = index < 0 ? 0 : sc.levels ? sc.levels[Math.floor(n * 30)] ?? 0 : 0.5 + 0.5 * Math.sin(n * 23) * Math.sin(n * 7);
    return { index, text: l?.text ?? null, example: Boolean(l?.example), talking: index >= 0, level: Math.max(0, level) };
  }

  // ---- 時刻 T（秒）のコマ ----
  const $ = (id) => document.getElementById(id);
  const opt = (i, k) => plan.scenes[i]?.options?.[k] ?? 'on';

  // 今のシーンと、切り替えの途中なら次のシーン。p は切り替えの進み具合。
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
      const el = sceneOf(a.effect?.target);
      if (!el) continue;
      a.pause();
      a.currentTime = Math.max(0, T - plan.scenes[+el.dataset.id].start) * 1000;
    }
    document.querySelectorAll('.zk-scene svg').forEach((svg) => {
      if (svg.parentElement.closest('svg') || !svg.pauseAnimations) return;
      svg.pauseAnimations();
      svg.setCurrentTime(Math.max(0, T - plan.scenes[+sceneOf(svg).dataset.id].start));
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
      const t = Math.max(0, T - plan.scenes[h.id].start);
      guard(h.id, 'zk.scene の frame', () => h.frame(t, el, lineInfo(h.id, t)));
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
    const out = [];
    const el = sceneEls.find((e) => +e.dataset.id === id);
    const sc = plan.scenes[id];
    const L = plan.limits;
    const count = el.querySelectorAll('*').length;
    if (count > L.maxElements) out.push({ severity: 'error', rule: 'V105', message: `要素が${count}個あります。上限は${L.maxElements}個です。` });
    const visible = (x) => {
      let o = 1;
      for (let n = x; n && n !== el.parentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        o *= +cs.opacity;
      }
      return o > 0.05;
    };
    const texts = [...el.querySelectorAll('*')].filter((x) => [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && visible(x));
    const band = sc.lines.length && sc.options.subtitles === 'on' ? { left: W / 2 - 640, right: W / 2 + 640, top: H - 190, bottom: H } : null;
    const seen = new Set();
    for (const x of texts) {
      const r = x.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const label = x.textContent.trim().slice(0, 20);
      const key = (rule) => `${rule}:${label}`;
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
      const end = a.effect?.getComputedTiming().endTime;
      if (Number.isFinite(end) && end > dur + 50) {
        out.push({ severity: 'warn', rule: 'V104', message: `アニメーションが ${(end / 1000).toFixed(1)}秒まで続き、シーンの長さ ${(dur / 1000).toFixed(1)}秒を超えます。目印の時刻か <zk-options hold> で合わせてください。` });
        break;
      }
    }
    return out;
  };
  window.zkErrors = () => errors.splice(0);
})();
