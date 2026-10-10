// 効果音を増やす2つの案を、聞き比べられる WAV にするスパイク。本体からは使わない。
// node spikes/sfx/make.mjs --zzfx=<ZzFX.js のパス> --kenney=<Kenney の素材を展開したフォルダ>
// --kenney のフォルダには、interface（Interface Sounds）と impact（Impact Sounds）を展開しておく。
// 出力は spikes/sfx/out/。index.html をブラウザで開くと、表で聞き比べられる。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mix, wav16, rng, RATE } from '../../src/video/sfx.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');

// 動画で使いそうな動きと、それぞれの案の音。
// zzfx は ZzFX の引数（音量, ばらつき, 周波数, attack, sustain, release, 波形, 波形の曲がり, slide, deltaSlide, 音程の跳び, 跳ぶ時刻, 繰り返し, ノイズ, 変調, ビット落とし, ディレイ, sustain の音量, decay, トレモロ, フィルタ）。
// ばらつきは0にして、毎回同じ音にする。filter は負の値がローパス、正の値がハイパスで、区切りの周波数は値の2倍になる。
// kenney は素材のファイル。このスパイクの結果、ZzFX を採用し、zzfx の値を src/video/sfx.js の PRESETS に移した。
const EVENTS = [
  { id: 'appear', name: '部品が現れる', zzfx: [1, 0, 520, 0.005, 0.02, 0.08, 0, 1.6, 18], kenney: 'interface/Audio/drop_002.ogg', current: { kind: 'pop', freq: 520 } },
  { id: 'bubble', name: '吹き出しが出る', zzfx: [0.8, 0, 700, 0.01, 0.03, 0.1, 0, 1, 0, 0, 300, 0.04], kenney: 'interface/Audio/pluck_001.ogg', current: null },
  { id: 'draw', name: '線を描く', zzfx: [0.5, 0, 1200, 0.03, 0.4, 0.1, 4, 1, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0.6, 0, 0.3, -1800], kenney: 'interface/Audio/scratch_002.ogg', current: { kind: 'draw', dur: 0.5 } },
  { id: 'whoosh', name: '場面が移る', zzfx: [0.6, 0, 300, 0.2, 0.2, 0.3, 4, 1, 4, 0, 0, 0, 0, 1, 0, 0, 0, 0.5, 0, 0, -600], kenney: 'interface/Audio/maximize_006.ogg', current: { kind: 'whoosh', dur: 0.7 } },
  { id: 'chime', name: '強調する', zzfx: [0.7, 0, 1046, 0.005, 0.05, 0.9, 0, 1, 0, 0, 523, 0.08, 0, 0, 0, 0, 0, 0.6, 0.1, 0.02], kenney: 'interface/Audio/glass_001.ogg', current: { kind: 'chime', freq: 1046 } },
  { id: 'success', name: '正解、完了', zzfx: [0.8, 0, 660, 0.01, 0.06, 0.2, 1, 1, 0, 0, 330, 0.07], kenney: 'interface/Audio/confirmation_002.ogg', current: null },
  { id: 'error', name: '警告、×', zzfx: [0.7, 0, 180, 0.01, 0.12, 0.15, 2, 1, -6, 0, 0, 0, 0.06], kenney: 'interface/Audio/error_004.ogg', current: null },
  { id: 'click', name: '押す、選ぶ', zzfx: [0.6, 0, 1800, 0, 0.005, 0.02, 3, 1, 0, 0, 0, 0, 0, 0.3], kenney: 'interface/Audio/click_002.ogg', current: null },
  { id: 'tick', name: '数え上げ', zzfx: [0.5, 0, 2400, 0, 0.003, 0.02, 0], kenney: 'interface/Audio/tick_001.ogg', current: null },
  { id: 'drop', name: '着地する', zzfx: [1, 0, 90, 0.002, 0.04, 0.2, 0, 2, -12, 0, 0, 0, 0, 0.4], kenney: 'impact/Audio/impactSoft_medium_001.ogg', current: null },
  { id: 'rise', name: '盛り上がる', zzfx: [0.6, 0, 200, 0.4, 0.3, 0.2, 1, 1, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0.7], kenney: 'interface/Audio/maximize_003.ogg', current: null },
  { id: 'vanish', name: '消える', zzfx: [0.7, 0, 900, 0.01, 0.08, 0.25, 0, 1, -24], kenney: 'interface/Audio/minimize_003.ogg', current: null },
];

// 1シーン分の流れ。[秒, 動き]。部品が3つ現れ、線が伸び、場面が移り、数を数えて、正解で終わる。
const SEQUENCE = [[0.4, 'appear'], [0.75, 'appear'], [1.1, 'appear'], [1.6, 'draw'], [2.4, 'chime'], [3.2, 'bubble'], [3.8, 'tick'], [3.95, 'tick'], [4.1, 'tick'], [4.25, 'tick'], [4.4, 'tick'], [4.9, 'success'], [5.6, 'whoosh']];

// 3つの案で、聞こえる大きさをそろえる。平均の大きさ（RMS）を -16dB に合わせ、最大値は -1dB を超えないようにする。
// 最大値だけでそろえると、立ち上がりの鋭い素材の音が小さく聞こえるため。
const normalize = (s) => {
  let m = 0;
  let sum = 0;
  for (const v of s) {
    m = Math.max(m, Math.abs(v));
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, s.length));
  if (!m) return s;
  const g = Math.min(10 ** (-16 / 20) / rms, 0.89 / m);
  return Float32Array.from(s, (v) => v * g);
};
const stats = (s, rate) => {
  let peak = 0;
  let sum = 0;
  for (const v of s) {
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  return { sec: s.length / rate, rms: 20 * Math.log10(Math.sqrt(sum / Math.max(1, s.length)) || 1e-9) };
};

async function zzfxSounds(file) {
  // ZzFX は読み込んだ時点で AudioContext を作る。Node には無いので、空のものを置いておく。
  globalThis.AudioContext ??= class {};
  const { ZZFX } = await import(pathToFileURL(path.resolve(file)).href);
  ZZFX.sampleRate = RATE;
  Math.random = rng(1);
  return Object.fromEntries(EVENTS.map((e) => [e.id, Float32Array.from(ZZFX.buildSamples(...e.zzfx))]));
}

function kenneySounds(dir) {
  return Object.fromEntries(
    EVENTS.map((e) => {
      const f = path.join(dir, e.kenney);
      if (!fs.existsSync(f)) throw new Error(`${f} がありません。--kenney に、interface と impact を展開したフォルダを指定してください。`);
      const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', f, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 64 << 20 });
      // ffmpeg が見つからないときは status が null で、error に理由が入る。
      if (r.error || r.status !== 0) throw new Error(`ffmpeg が ${f} を読めませんでした。${r.error?.message ?? r.stderr}`);
      return [e.id, new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length))];
    }),
  );
}


const zzfxPath = arg('zzfx');
const kenneyDir = arg('kenney');
if (!zzfxPath || !kenneyDir) {
  console.error('使い方: node spikes/sfx/make.mjs --zzfx=<ZzFX.js のパス> --kenney=<Kenney の素材を展開したフォルダ>');
  process.exit(1);
}

const sets = {
  zzfx: { title: 'ZzFX（MIT）', sounds: await zzfxSounds(zzfxPath) },
  kenney: { title: 'Kenney（CC0）', sounds: kenneySounds(kenneyDir) },
};

fs.rmSync(out, { recursive: true, force: true });
const rows = {};
for (const [key, set] of Object.entries(sets)) {
  fs.mkdirSync(path.join(out, key), { recursive: true });
  for (const [id, raw] of Object.entries(set.sounds)) {
    const s = normalize(raw);
    fs.writeFileSync(path.join(out, key, `${id}.wav`), wav16(s));
    (rows[id] ??= {})[key] = stats(s, RATE);
  }
  // 1シーン分の流れ。音の無い動きは、今の合成音でも鳴らさない。
  const parts = SEQUENCE.filter(([, id]) => set.sounds[id]).map(([at, id]) => ({ at, samples: normalize(set.sounds[id]), gain: 0.6 }));
  fs.writeFileSync(path.join(out, key, 'sequence.wav'), wav16(mix(6.5, parts)));
}

const cell = (key, id) => (rows[id]?.[key] ? `<audio controls preload="none" src="${key}/${id}.wav"></audio><div class="m">${rows[id][key].sec.toFixed(2)}秒 / RMS ${rows[id][key].rms.toFixed(1)}dB</div>` : '<span class="m">なし</span>');
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>効果音のスパイク</title>
<style>body{font:15px/1.6 system-ui,sans-serif;margin:24px;color:#1c2530}table{border-collapse:collapse}th,td{border-bottom:1px solid #dfe4ea;padding:8px 12px;text-align:left;vertical-align:top}th{border-bottom:2px solid #1c2530}audio{height:32px;width:220px}.m{font-size:12px;color:#5b6673}</style>
<h1>効果音のスパイク</h1>
<p>このスパイクの結果、ZzFX を採用しました。採用前の合成音は、本体から削除しています。音の大きさは、平均の大きさ（RMS）を -16dB に合わせ、最大値が -1dB を超えないようにそろえています。下の「1シーン分の流れ」は、部品が3つ現れ、線が伸び、強調し、吹き出しが出て、数を数え、正解で終わり、場面が移る流れです。</p>
<table><tr><th>動き</th>${Object.values(sets).map((s) => `<th>${s.title}</th>`).join('')}</tr>
<tr><td><b>1シーン分の流れ</b></td>${Object.keys(sets).map((k) => `<td><audio controls preload="none" src="${k}/sequence.wav"></audio></td>`).join('')}</tr>
${EVENTS.map((e) => `<tr><td>${e.name}<div class="m">${e.id}${e.kenney ? ` / ${e.kenney.split('/').pop()}` : ''}</div></td>${Object.keys(sets).map((k) => `<td>${cell(k, e.id)}</td>`).join('')}</tr>`).join('\n')}
</table>
<p class="m">ZzFX: Frank Force, MIT License。Kenney: Interface Sounds、Impact Sounds（www.kenney.nl）, CC0。</p></html>`;
fs.writeFileSync(path.join(out, 'index.html'), html);

console.log('動き          ' + Object.keys(sets).map((k) => k.padEnd(18)).join(''));
for (const e of EVENTS) console.log(e.id.padEnd(14) + Object.keys(sets).map((k) => (rows[e.id]?.[k] ? `${rows[e.id][k].sec.toFixed(2)}s ${rows[e.id][k].rms.toFixed(1)}dB` : '-').padEnd(18)).join(''));
console.log(`\n${path.join(out, 'index.html')} を開くと聞き比べられます。`);
