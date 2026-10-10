// ナレーションの音声。Gemini TTS をシーンごとに1回呼び、結果を .zukai/cache/tts に保存する。
// Gemini TTS は文の時刻を返さないので、音声の無音の区間から文の切れ目を見つける。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { estimateVoice } from './script.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// WAV（16bit PCM）を -1〜1 の配列にする。RIFF の頭が無ければ、24kHz モノラルの生の PCM とみなす。
export function decodeWav(buf) {
  const pcm16 = (b, ch) => {
    const n = Math.floor(b.length / 2 / ch);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = b.readInt16LE(i * 2 * ch) / 32768;
    return out;
  };
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return { rate: 24000, samples: pcm16(buf, 1) };
  let off = 12;
  let fmt = { ch: 1, rate: 24000, bits: 16 };
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') {
      // ストリーミングで作った WAV は、data の長さが 0xFFFFFFFF のことがある。
      if (off + 8 + size > buf.length) size = buf.length - off - 8;
      if (fmt.bits !== 16) throw new Error(`${fmt.bits}bit の WAV は読めません。`);
      return { rate: fmt.rate, samples: pcm16(buf.subarray(off + 8, off + 8 + size), fmt.ch) };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('WAV に data がありません。');
}

// 文の始まりと終わりの時刻（秒）。20ms ごとの音量で無音を探し、長い無音から順に文の切れ目にする。
// ponytail: 文の途中の読点の間を、文の切れ目と取り違えることがある。ずれが目立つなら、1文ずつ API を呼ぶ。
export function lineTimes(samples, rate, lines) {
  const win = Math.max(1, Math.round(rate * 0.02));
  const n = Math.floor(samples.length / win);
  const loud = Array.from({ length: n }, (_, i) => {
    let s = 0;
    for (let j = i * win; j < (i + 1) * win; j++) s += samples[j] ** 2;
    return Math.sqrt(s / win) > 0.01;
  });
  const first = loud.indexOf(true);
  const last = loud.lastIndexOf(true);
  if (first < 0) return estimateVoice(lines).lines;
  const runs = [];
  for (let i = first; i <= last; ) {
    if (loud[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j <= last && !loud[j]) j++;
    if ((j - i) * 0.02 >= 0.15) runs.push({ at: ((i + j) / 2) * 0.02, len: j - i });
    i = j;
  }
  const need = lines.length - 1;
  const a = first * 0.02;
  const b = (last + 1) * 0.02;
  let cuts;
  if (runs.length >= need) {
    cuts = runs.sort((x, y) => y.len - x.len).slice(0, need).map((r) => r.at).sort((x, y) => x - y);
  } else {
    // 無音が足りないときは、文字数の比で割り振る。
    const total = lines.reduce((s, l) => s + l.text.length, 0) || 1;
    let acc = 0;
    cuts = lines.slice(0, -1).map((l) => a + ((b - a) * (acc += l.text.length)) / total);
  }
  const bounds = [a, ...cuts, b];
  return lines.map((_, k) => ({ start: bounds[k], end: bounds[k + 1] }));
}

// 応答の中の音声を探す。形が版によって違っても読めるよう、data を持つ音声の要素を深さ優先で探す。
function findAudio(node) {
  if (!node || typeof node !== 'object') return null;
  const mime = String(node.mime_type ?? node.mimeType ?? node.type ?? '');
  if (typeof node.data === 'string' && node.data.length > 100 && /audio/.test(mime)) return node.data;
  for (const v of Object.values(node)) {
    const found = findAudio(v);
    if (found) return found;
  }
  return null;
}

// 1行を1つの text にして送る。行ごとに語り口（style）を変えられる。<short pause> などのタグは、読み上げの指示としてそのまま渡す。
async function request(lines, video, apiKey) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: video.model,
      input: [{ type: 'user_input', content: lines.map((l, i) => ({ type: 'text', text: (i ? '\n' : '') + l.speech, annotations: [{ type: 'speech_metadata', style: l.style ?? video.style }] })) }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: video.voice }] },
    }),
  });
  if (!res.ok) throw new Error(`Gemini TTS が ${res.status} を返しました。${(await res.text()).slice(0, 300)}`);
  const data = findAudio(await res.json());
  if (!data) throw new Error('Gemini TTS の応答に音声がありません。');
  return Buffer.from(data, 'base64');
}

// 1/30秒ごとの声の大きさ（0〜1）。AI がキャラクターの口の動きを声に合わせるときに使う。
export function levelsOf(samples, rate, fps = 30) {
  const win = Math.max(1, Math.round(rate / fps));
  const out = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += samples[j] ** 2;
    out.push(Math.sqrt(s / win));
  }
  const max = Math.max(1e-6, ...out);
  return out.map((v) => Math.round((v / max) * 100) / 100);
}

// 1シーンの音声と、文ごとの時刻。
export async function voiceOf(lines, settings, cacheDir) {
  if (!lines.length) return estimateVoice(lines);
  const video = settings.video;
  const key = JSON.stringify([video.model, video.voice, video.style, lines.map((l) => [l.speech, l.style])]);
  const file = path.join(cacheDir, crypto.createHash('sha256').update(key).digest('hex').slice(0, 32) + '.wav');
  let buf;
  if (fs.existsSync(file)) buf = fs.readFileSync(file);
  else {
    buf = await request(lines, video, settings.apiKey);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, buf);
  }
  const { rate, samples } = decodeWav(buf);
  return { duration: samples.length / rate, lines: lineTimes(samples, rate, lines), samples, rate, levels: levelsOf(samples, rate) };
}

// すべてのシーンの音声。キーが無いときと、1つでも失敗したときは、全部を見積もりの長さにして無音の動画にする。
export async function voicesFor(scenes, settings, cacheDir) {
  const silent = (reason) => ({ voices: scenes.map((s) => estimateVoice(s.lines)), silentReason: reason });
  if (!settings.apiKey) return silent('Gemini の API キーがありません。環境変数 GEMINI_API_KEY を設定するか、zukai init --api-key を実行してください。');
  try {
    const voices = [];
    for (const s of scenes) voices.push(await voiceOf(s.lines, settings, cacheDir));
    return { voices, silentReason: null };
  } catch (e) {
    return silent(e.message);
  }
}
