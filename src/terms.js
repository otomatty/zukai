// 用語集。表記をそろえたい用語を、zukai.config.json の terms に書く。
// { "use": "バージョン", "avoid": ["版"], "except": ["初版"] } と書くと、「版」を見つけたら「バージョン」と書くよう知らせる。
// except は、避ける表記を含むが正しい語。「印」を避けても「矢印」は知らせないようにするために使う。
import { loadConfig } from './refs.js';

export const termsOf = (baseDir) => (loadConfig(baseDir).terms ?? []).filter((t) => typeof t?.use === 'string' && Array.isArray(t.avoid) && t.avoid.length);

// 文の中の、避ける表記を返す。except の語の中に現れたものは数えない。
export function findAvoided(text, terms) {
  const out = [];
  for (const t of terms) {
    let masked = String(text ?? '');
    // 使う表記そのものも先に隠す。「ユーザ」を避けて「ユーザー」と書く場合に、正しい「ユーザー」を知らせないため。
    for (const e of [t.use, ...(t.except ?? [])]) if (e) masked = masked.split(e).join('\u0000'.repeat(e.length));
    for (const a of t.avoid) if (a && masked.includes(a)) out.push({ use: t.use, avoid: a });
  }
  return out;
}

// AI に渡す指示に入れる表。
export const termsTable = (terms) =>
  terms.length
    ? `## 用語の表記\n\n次の用語は、この表記で書きます。資料の本文、図のラベル、ナレーションのすべてに当てはまります。避ける表記を使うと、Lint が P007 の error を返します。\n\n| 使う表記 | 避ける表記 |\n|---|---|\n${terms.map((t) => `| ${t.use} | ${t.avoid.join('、')} |`).join('\n')}`
    : '';
