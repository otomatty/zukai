// ZzFX.js（同梱した第三者のコード。手を入れない）の型。tsc は ZzFX.js ではなく、このファイルを読む。
// 数値の並びは ZzFX の README のとおり。空（undefined）の数値は既定値になる。

// 音を作る21個の数値。音量, ばらつき, 周波数, attack, sustain, release, 波形, 波形の曲がり, slide, deltaSlide, 音程の跳び, 跳ぶ時刻,
// 繰り返し, ノイズ, 変調, ビット落とし, ディレイ, sustain の音量, decay, トレモロ, フィルタ。
export type ZzfxParams = (number | undefined)[];

export declare function zzfx(...parameters: ZzfxParams): AudioBufferSourceNode;

export declare const ZZFX: {
  volume: number;
  sampleRate: number;
  // 読み込んだ時点で作る。
  audioContext: AudioContext;
  play(...parameters: ZzfxParams): AudioBufferSourceNode;
  playSamples(sampleChannels: ArrayLike<number>[], volumeScale?: number, rate?: number, pan?: number, loop?: boolean): AudioBufferSourceNode;
  buildSamples(...parameters: ZzfxParams): Float32Array;
  getNote(semitoneOffset?: number, rootNoteFrequency?: number): number;
};

export declare class ZZFXSound {
  constructor(zzfxSound?: ZzfxParams);
  zzfxSound: ZzfxParams;
  randomness: number;
  samples: Float32Array;
  source?: AudioBufferSourceNode;
  play(volume?: number, pitch?: number, randomnessScale?: number, pan?: number, loop?: boolean): AudioBufferSourceNode | undefined;
}
