// AI に渡す指示を組み立てる。閾値と図の型は Lint と同じファイルから読むので、指示と検査がずれない。
import fs from 'node:fs';
import path from 'node:path';
import { typesFor } from './figures/custom.ts';
import { root, readJson } from './lint/index.ts';
import { termsTable } from './terms.ts';
import { hasVideoRules, readTheme, rulesPrompt } from './theme.ts';
import type { Theme } from './theme.ts';
import type { AnyFigureType, Limits, Term } from './types.ts';

export interface PromptOptions {
  full?: boolean;
  only?: string[] | null;
  type?: string;
  video?: boolean;
  terms?: Term[];
  voice?: boolean;
  theme?: Theme;
  part?: string[] | null;
}

// 動画の書き方のうち、必要になったときに zukai prompt --part で取り出す部分。名前と、ファイル。
export const videoParts: Record<string, string> = { sound: 'prompts/video-sound.md', checks: 'prompts/video-checks.md' };

// type は、型の書き方を取り出すコマンド。zukai を入れていない環境では、node と CLI のパスを含めて渡す。
// video を true にすると、動画の書き方（prompts/video.md）を足す。効果音と検査の一覧は、part で取り出す。terms は用語集（設定の terms）。
// voice は、ナレーションを読み上げられるか（Gemini の API キーがあるか）。無いときは、AI が利用者に知らせられるよう指示に書く。
// theme は、プロジェクトのテーマ（readTheme の結果）。自由な図に使える色と、デザインのルールが変わる。
// part は、動画の書き方のうち、あとから取り出す部分の名前（videoParts）。渡すと、その部分だけを返す。
export function buildPrompt({ full = false, only = null, type = 'zukai type', video = false, terms = [], voice = true, theme = readTheme(null), part = null }: PromptOptions = {}): string {
  const limits: Limits = readJson('contract/limits.json');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').trim();
  const fill = (s: string) =>
    s
      .replaceAll('{{claimMax}}', String(limits.claim.maxChars))
      .replaceAll('{{explanationMax}}', String(limits.explanation.maxChars))
      .replaceAll('{{labelMax}}', String(limits.figure.labelMaxWidth))
      .replaceAll('{{noteMax}}', String(limits.figure.noteMaxWidth));

  const tokens = theme.tokens;
  // テーマの独自の型も、組み込みの型と同じ一覧と書き方で渡す。
  const types = typesFor(theme);
  // 組み込みの型は、型と同じ名前の上限を持つ。テーマの独自の型は caps を持つ。
  const cap = (t: AnyFigureType) => t.caps ?? Object.entries(limits[t.name as keyof Limits]).map(([k, v]) => `${k}=${v}`).join('、');
  const detail = (t: AnyFigureType) => `### ${t.name}\n\n${t.summary}。使うのは、${t.when}ときです。上限は ${cap(t)} です。\n\n${[...t.fields, ...(t.guide?.(tokens, limits) ?? [])].map((f) => `- ${f}`).join('\n')}\n\n\`\`\`${t.fence ?? 'yaml figure'}\n${t.example}\n\`\`\``;
  if (only) return only.map((name) => (types[name] ? detail(types[name]) : `### ${name}\n\nこの名前の型はありません。使える型は ${Object.keys(types).join('、')} です。`)).join('\n\n') + '\n';

  // 型が増えたので、最初は一覧だけを渡す。書き方の詳細は、使う型が決まってから zukai type で取り出す。
  const index = `図は、次の順に選びます。

1. 説明する対象に実物の画面があるときは、\`screenshot\` で実物を示します。画面、Web ページ、管理コンソール、ダッシュボードが当てはまります。画面を図で描き直しません。
2. 実物の画面がない内容は、下の表から、データの形に合う型を選びます。
3. どの型にも合わない、または型では伝わらないと判断したときは、\`free\` で SVG を直接書きます。

| 型 | こういうデータのとき |\n|---|---|\n${Object.values(types).filter((t) => t.name !== 'free').map((t) => `| ${t.name}${t.custom ? '（このテーマの型）' : ''} | ${t.when} |`).join('\n')}\n| 表（Markdown） | 複数の項目を、複数の観点で比べる。正確な値や文言を読ませたい |\n| free | ${types.free.when} |\n\n使う型を決めたら、\`${type} 型の名前\` を実行して、その型の書き方と上限を確認します。複数の型をまとめて確認できます。`;
  const catalog = `## 図の型\n\n${full ? Object.values(types).map(detail).join('\n\n') : index}`;

  // model-notes.md は、見出し「## 指示」より後ろに実際の指示を書く。指示が1つもなければ出力に含めない。
  const notes = read('prompts/model-notes.md').split(/^## 指示\s*$/m)[1]?.trim();
  const v = limits.video;
  const fillVideo = (rel: string) =>
    read(rel)
      .replace(/<!--[\s\S]*?-->\n?/g, '')
      .replaceAll('{{cli}}', type.replace(/\s+type$/, ''))
      .replaceAll('{{lineMax}}', String(v.maxLineChars))
      .replaceAll('{{shotLines}}', String(v.maxShotLines))
      .replaceAll('{{shotSec}}', String(v.maxShotSeconds))
      .replaceAll('{{sameLead}}', String(v.maxSameLead))
      .replaceAll('{{loadSec}}', String(v.loadTimeoutMs / 1000))
      .replaceAll('{{frameSec}}', String(v.frameTimeoutMs / 1000))
      .replaceAll('{{minFont}}', String(v.minFontPx))
      .replaceAll('{{maxElements}}', String(v.maxElements))
      .replaceAll('{{maxScene}}', String(v.maxSceneSeconds))
      .replaceAll('{{maxTotal}}', String(v.maxTotalSeconds));
  if (part) return part.map((name) => (videoParts[name] ? fillVideo(videoParts[name]) : `## ${name}\n\nこの名前の部分はありません。取り出せるのは ${Object.keys(videoParts).join('、')} です。`)).join('\n\n') + '\n';
  // 絵柄は、テーマが「## 動画」で決めていれば、zukai の既定（video-style.md）を入れない。テーマのルールと食い違う指示を、両方渡さないため。
  const videoGuide = () => fillVideo('prompts/video.md').replace('{{style}}', hasVideoRules(theme) ? '' : fillVideo('prompts/video-style.md').trim()).replace(/\n{3,}/g, '\n\n');
  const silent = video && !voice ? '## この環境の状態\n\nGemini の API キーが無いので、動画は字幕だけの無音になります。動画を作ったら、そのことと、利用者が自分で `zukai login gemini` を実行すればナレーションが付くことを、チャットで伝えます。キーをチャットで尋ねません。' : '';
  return [fill(read('prompts/base.md')), termsTable(terms), catalog, video ? videoGuide() : '', rulesPrompt(theme, { video }), silent, notes ? `## 追加の指示\n\n${notes}` : ''].filter(Boolean).join('\n\n') + '\n';
}
