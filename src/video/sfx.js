// 効果音の合成と、音声の足し合わせ。音のファイルを配布しないので、権利の問題が無い。同じ原稿からは毎回同じ音になる。
export const RATE = 48000;

// 種を固定した乱数。背景の星と同じ作り方。
export function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const normalize = (buf, peak = 0.9) => {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
};

// ポッと出る音。正弦波を60msで4割下げ、すぐに減衰させる。頭に小さなノイズを入れる。
function pop(freq, rand) {
  const n = Math.round(RATE * 0.16);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * freq * (1 - 0.4 * Math.min(1, t / 0.06))) / RATE;
    const env = t < 0.002 ? t / 0.002 : Math.exp(-(t - 0.002) / 0.035);
    out[i] = Math.sin(phase) * env + (t < 0.005 ? (rand() * 2 - 1) * 0.3 * (1 - t / 0.005) : 0);
  }
  return normalize(out);
}

// 風切り音。ノイズの帯域を 400→2000→600Hz と動かす。
function whoosh(dur, rand) {
  const n = Math.round(RATE * dur);
  const out = new Float32Array(n);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const f = p < 0.5 ? 400 + 1600 * (p / 0.5) : 2000 - 1400 * ((p - 0.5) / 0.5);
    // 共振の帯域フィルタ。係数を毎サンプル更新する。
    const w = (2 * Math.PI * f) / RATE;
    const r = 0.97;
    const y = (rand() * 2 - 1) * (1 - r) + 2 * r * Math.cos(w) * y1 - r * r * y2;
    y2 = y1;
    y1 = y;
    out[i] = y * Math.sin(Math.PI * p) ** 2;
  }
  return normalize(out, 0.7);
}

// 線が伸びる音。高い音域だけのノイズを小さく鳴らす。
function draw(dur, rand) {
  const n = Math.round(RATE * dur);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const x = rand() * 2 - 1;
    const env = Math.min(1, t / 0.03, (dur - t) / 0.03) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 18 * t));
    out[i] = (x - prev) * env;
    prev = x;
  }
  return normalize(out, 0.35);
}

// きらっとした音。基音、2倍音、3.01倍音を重ねる。
function chime(freq) {
  const n = Math.round(RATE * 1.2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.005) * Math.exp(-t / 0.35);
    out[i] = (Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(4 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * 3.01 * freq * t)) * env;
  }
  return normalize(out, 0.6);
}

export function synth(kind, { freq = 660, dur = 0.5, seed = 1 } = {}) {
  const rand = rng(seed);
  if (kind === 'pop') return pop(freq, rand);
  if (kind === 'whoosh') return whoosh(dur, rand);
  if (kind === 'draw') return draw(dur, rand);
  if (kind === 'chime') return chime(freq);
  throw new Error(`効果音「${kind}」はありません。pop、whoosh、draw、chime から選んでください。`);
}

// 鳴りすぎを防ぐ。同じ種類の音は90ms以上あけ、1秒に4回を超える pop は鳴らさない。
export function thin(cues) {
  const out = [];
  const lastOf = {};
  const pops = [];
  for (const c of [...cues].sort((a, b) => a.t - b.t)) {
    if (c.t - (lastOf[c.kind] ?? -Infinity) < 0.09) continue;
    if (c.kind === 'pop') {
      while (pops.length && c.t - pops[0] >= 1) pops.shift();
      if (pops.length >= 4) continue;
      pops.push(c.t);
    }
    lastOf[c.kind] = c.t;
    out.push(c);
  }
  return out;
}

// 同じシーンの pop は、五音音階で1段ずつ上げる。少しだけ揺らして、同じ音の繰り返しに聞こえないようにする。
const PENTA = [0, 2, 4, 7, 9];
export function voiceCues(cues, files = {}) {
  const count = {};
  const rand = rng(7);
  return thin(cues).map((c, i) => {
    const k = (count[`${c.scene}:${c.kind}`] = (count[`${c.scene}:${c.kind}`] ?? -1) + 1);
    const step = Math.min(k, 9);
    const base = c.kind === 'chime' ? 1046 : 520;
    const freq = base * 2 ** ((PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12) * (1 + (rand() - 0.5) * 0.03);
    return { at: c.t, samples: files[c.kind] ?? synth(c.kind, { freq, dur: c.dur ?? 0.5, seed: i + 1 }) };
  });
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
