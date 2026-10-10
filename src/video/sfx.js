// 効果音の合成と、音声の足し合わせ。効果音は ZzFX（MIT、src/video/vendor）で作る。音のファイルを配布しないので、権利の問題が無い。
// AI は、名前の付いた音（PRESETS）を選ぶか、ZzFX の21個の数値を自分で書く。乱数は種を固定するので、同じ原稿からは毎回同じ音になる。
export const RATE = 48000;

// 種を固定した乱数。
export function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 名前の付いた音。spikes/sfx で聞き比べて選んだ値。
// ZzFX の数値の順: 音量, ばらつき, 周波数, attack, sustain, release, 波形, 波形の曲がり, slide, deltaSlide, 音程の跳び, 跳ぶ時刻,
// 繰り返し, ノイズ, 変調, ビット落とし, ディレイ, sustain の音量, decay, トレモロ, フィルタ（負の値がローパス、正の値がハイパス、区切りは値の2倍の周波数）。
export const PRESETS = {
  appear: [1, 0, 520, 0.005, 0.02, 0.08, 0, 1.6, 18],
  bubble: [0.8, 0, 700, 0.01, 0.03, 0.1, 0, 1, 0, 0, 300, 0.04],
  draw: [0.5, 0, 1200, 0.03, 0.4, 0.1, 4, 1, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0.6, 0, 0.3, -1800],
  whoosh: [0.6, 0, 300, 0.2, 0.2, 0.3, 4, 1, 4, 0, 0, 0, 0, 1, 0, 0, 0, 0.5, 0, 0, -600],
  chime: [0.7, 0, 1046, 0.005, 0.05, 0.9, 0, 1, 0, 0, 523, 0.08, 0, 0, 0, 0, 0, 0.6, 0.1, 0.02],
  success: [0.8, 0, 660, 0.01, 0.06, 0.2, 1, 1, 0, 0, 330, 0.07],
  error: [0.7, 0, 180, 0.01, 0.12, 0.15, 2, 1, -6, 0, 0, 0, 0.06],
  click: [0.6, 0, 1800, 0, 0.005, 0.02, 3, 1, 0, 0, 0, 0, 0, 0.3],
  tick: [0.5, 0, 2400, 0, 0.003, 0.02, 0],
  drop: [1, 0, 90, 0.002, 0.04, 0.2, 0, 2, -12, 0, 0, 0, 0, 0.4],
  rise: [0.6, 0, 200, 0.4, 0.3, 0.2, 1, 1, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0.7],
  vanish: [0.7, 0, 900, 0.01, 0.08, 0.25, 0, 1, -24],
};
// 以前の名前。pop は appear と同じ音にする。
const ALIASES = { pop: 'appear' };
export const presetOf = (kind) => PRESETS[ALIASES[kind] ?? kind] ?? null;
// 音の高さを1段ずつ上げる音。同じシーンで続けて鳴ると、五音音階で上がっていく。
const STEPPED = new Set(['appear', 'bubble', 'chime']);

// ZzFX は読み込んだ時点で AudioContext を作るので、Node では空のものを置いてから読む。
let zzfx = null;
async function engine() {
  if (!zzfx) {
    globalThis.AudioContext ??= class {};
    ({ ZZFX: zzfx } = await import('./vendor/ZzFX.js'));
    zzfx.sampleRate = RATE;
  }
  return zzfx;
}

// ZzFX の数値を確かめる。数値か空（既定値）だけを、21個まで受け付ける。
export function checkParams(params) {
  if (!Array.isArray(params) || params.length > 21) return 'ZzFX の数値は、21個までの配列で書いてください。';
  const bad = params.find((v) => v != null && !Number.isFinite(Number(v)));
  return bad === undefined ? null : `ZzFX の数値に「${bad}」があります。数値か空にしてください。`;
}

// 数値から音を作る。ばらつき（2番目の数値）に使う乱数も、種を固定する。
export async function synthParams(params, seed = 1) {
  const Z = await engine();
  const real = Math.random;
  Math.random = rng(seed);
  try {
    return Float32Array.from(Z.buildSamples(...params.map((v) => (v == null ? undefined : Number(v)))));
  } finally {
    Math.random = real;
  }
}

// 名前の付いた音を作る。freqScale で高さを変え、dur があれば sustain を延ばして長さを合わせる。
export async function synth(kind, { freqScale = 1, dur = null, seed = 1 } = {}) {
  const base = presetOf(kind);
  if (!base) throw new Error(`効果音「${kind}」はありません。${Object.keys(PRESETS).join('、')} から選んでください。`);
  const p = [...base];
  p[2] *= freqScale;
  if (dur && (kind === 'whoosh' || kind === 'draw')) p[4] = Math.max(0.05, dur - p[3] - p[5]);
  return synthParams(p, seed);
}

// 鳴りすぎを防ぐ。同じ種類の音は90ms以上あけ、1秒に4回を超える appear は鳴らさない。
export function thin(cues) {
  const out = [];
  const lastOf = {};
  const pops = [];
  for (const c of [...cues].sort((a, b) => a.t - b.t)) {
    const kind = ALIASES[c.kind] ?? c.kind;
    const key = kind === 'zzfx' ? `zzfx:${c.params}` : kind;
    if (c.t - (lastOf[key] ?? -Infinity) < 0.09) continue;
    if (kind === 'appear') {
      while (pops.length && c.t - pops[0] >= 1) pops.shift();
      if (pops.length >= 4) continue;
      pops.push(c.t);
    }
    lastOf[key] = c.t;
    out.push(c);
  }
  return out;
}

// きっかけを音にする。files は settings.json の sfx.files で差し替えた音（名前ごと）。
const PENTA = [0, 2, 4, 7, 9];
export async function voiceCues(cues, files = {}) {
  const count = {};
  const rand = rng(7);
  const out = [];
  for (const [i, c] of thin(cues).entries()) {
    if (c.kind === 'zzfx') {
      if (!checkParams(c.params)) out.push({ at: c.t, samples: await synthParams(c.params, i + 1) });
      continue;
    }
    const kind = ALIASES[c.kind] ?? c.kind;
    if (!PRESETS[kind]) continue;
    const k = (count[`${c.scene}:${kind}`] = (count[`${c.scene}:${kind}`] ?? -1) + 1);
    const step = STEPPED.has(kind) ? Math.min(k, 9) : 0;
    const freqScale = 2 ** ((PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12) * (1 + (rand() - 0.5) * 0.03);
    out.push({ at: c.t, samples: files[kind] ?? files[c.kind] ?? (await synth(kind, { freqScale, dur: c.dur, seed: i + 1 })) });
  }
  return out;
}

// BGM。曲を繰り返して動画の長さに合わせ、ナレーションの間（talk の [始まり, 終わり] の秒）は音量を下げる。
// 最初の1秒で大きくし、最後の1.5秒で消す。音量の変化は0.3秒かけて、ぶつ切りに聞こえないようにする。
export function bgmTrack(song, duration, talk, { volume = 0.2, duck = 0.3 } = {}) {
  const n = Math.ceil(duration * RATE);
  const out = new Float32Array(n);
  if (!song.length) return out;
  const ramp = 0.3;
  const sorted = [...talk].sort((a, b) => a[0] - b[0]);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    while (k < sorted.length && sorted[k][1] + ramp < t) k++;
    // 近いナレーションの区間ほど、音量を下げる。区間の前後 ramp 秒で、なめらかに変える。
    let near = 0;
    for (let j = k; j < sorted.length && sorted[j][0] - ramp <= t; j++) {
      const [a, b] = sorted[j];
      near = Math.max(near, t < a ? 1 - (a - t) / ramp : t > b ? 1 - (t - b) / ramp : 1);
    }
    const fade = Math.min(1, t / 1, (duration - t) / 1.5);
    out[i] = song[i % song.length] * volume * (1 - near * (1 - duck)) * Math.max(0, fade);
  }
  return out;
}

// 音を時刻に合わせて足し合わせる。標本化の周波数が違う音は、線形補間で 48kHz にそろえる。
export function mix(duration, parts) {
  const out = new Float32Array(Math.ceil(duration * RATE));
  for (const { at, samples, rate = RATE, gain = 1 } of parts) {
    const start = Math.round(at * RATE);
    const len = Math.floor((samples.length * RATE) / rate);
    for (let i = 0; i < len && start + i < out.length; i++) {
      if (start + i < 0) continue;
      const x = (i * rate) / RATE;
      const j = Math.floor(x);
      const v = j + 1 < samples.length ? samples[j] + (samples[j + 1] - samples[j]) * (x - j) : samples[j];
      out[start + i] += v * gain;
    }
  }
  let m = 0;
  for (const v of out) m = Math.max(m, Math.abs(v));
  if (m > 0.99) for (let i = 0; i < out.length; i++) out[i] *= 0.99 / m;
  return out;
}

export function wav16(samples, rate = RATE) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}
