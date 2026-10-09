// AI に渡す指示を組み立てる。閾値と図の型は Lint と同じファイルから読むので、指示と検査がずれない。
import fs from 'node:fs';
import path from 'node:path';
import { types } from './figures/index.js';
import { root, readJson } from './lint/index.js';

export function buildPrompt({ full = false, only = null } = {}) {
  const limits = readJson('contract/limits.json');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').trim();

  const base = read('prompts/base.md')
    .replaceAll('{{claimMax}}', limits.claim.maxChars)
    .replaceAll('{{explanationMax}}', limits.explanation.maxChars)
    .replaceAll('{{labelMax}}', limits.figure.labelMaxWidth)
    .replaceAll('{{noteMax}}', limits.figure.noteMaxWidth);

  const tokens = readJson('contract/tokens.json');
  const cap = (t) => Object.entries(limits[t.name]).map(([k, v]) => `${k}=${v}`).join('、');
  const detail = (t) => `### ${t.name}\n\n${t.summary}。使うのは、${t.when}ときです。上限は ${cap(t)} です。\n\n${[...t.fields, ...(t.guide?.(tokens, limits) ?? [])].map((f) => `- ${f}`).join('\n')}\n\n\`\`\`${t.fence ?? 'yaml figure'}\n${t.example}\n\`\`\``;
  // 型が増えたので、最初は一覧だけを渡す。書き方の詳細は、使う型が決まってから zukai type で取り出す。
  const index = `図は、次の順に選びます。

1. 説明する対象に実物の画面があるときは、\`screenshot\` で実物を示します。画面、Web ページ、管理コンソール、ダッシュボードが当てはまります。画面を図で描き直しません。
2. 実物の画面がない内容は、下の表から、データの形に合う型を選びます。
3. どの型にも合わない、または型では伝わらないと判断したときは、\`free\` で SVG を直接書きます。

| 型 | こういうデータのとき |\n|---|---|\n${Object.values(types).filter((t) => t.name !== 'free').map((t) => `| ${t.name} | ${t.when} |`).join('\n')}\n| 表（Markdown） | 複数の項目を、複数の観点で比べる。正確な値や文言を読ませたい |\n| free | ${types.free.when} |\n\n使う型を決めたら、\`zukai type 型の名前\` を実行して、その型の書き方と上限を確認します。複数の型をまとめて確認できます。`;
  const catalog = full ? Object.values(types).map(detail).join('\n\n') : index;
  if (only) return only.map((name) => (types[name] ? detail(types[name]) : `### ${name}\n\nこの名前の型はありません。使える型は ${Object.keys(types).join('、')} です。`)).join('\n\n') + '\n';

  // model-notes.md は、見出し「## 指示」より後ろに実際の指示を書く。指示が1つもなければ出力に含めない。
  const notes = read('prompts/model-notes.md').split(/^## 指示\s*$/m)[1]?.trim();
  return [base, `## 図の型\n\n${catalog}`, notes ? `## 追加の指示\n\n${notes}` : ''].filter(Boolean).join('\n\n') + '\n';
}
