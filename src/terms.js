// 用語集。用語の表記と具体例を、zukai.config.json の terms に書く。
// { "use": "バージョン", "avoid": ["版"], "except": ["初版"] } と書くと、「版」を見つけたら「バージョン」と書くよう知らせる。
// except は、避ける表記を含むが正しい語。「印」を避けても「矢印」は知らせないようにするために使う。
// { "use": "認証サービス", "examples": ["Amazon Cognito", "Auth0"], "actual": "Amazon Cognito" } と書くと、
// 用語を説明するときの具体例（examples）と、このシステムが実際に使っているもの（actual）を AI に渡す。
import { loadConfig } from './refs.js';

export const termsOf = (baseDir) => (loadConfig(baseDir).terms ?? []).filter((t) => typeof t?.use === 'string' && t.use);

// 文の中の、避ける表記を返す。使う表記と except の語の中に現れたものは数えない。
export function findAvoided(text, terms) {
  const out = [];
  for (const t of terms) {
    if (!Array.isArray(t.avoid) || !t.avoid.length) continue;
    let masked = String(text ?? '');
    // 使う表記そのものも先に隠す。「ユーザ」を避けて「ユーザー」と書く場合に、正しい「ユーザー」を知らせないため。
    for (const e of [t.use, ...(t.except ?? [])]) if (e) masked = masked.split(e).join('\u0000'.repeat(e.length));
    for (const a of t.avoid) if (a && masked.includes(a)) out.push({ use: t.use, avoid: a });
  }
  return out;
}

const list = (xs) => (Array.isArray(xs) ? xs.filter(Boolean).join('、') : '');

// AI に渡す指示に入れる表。表記の表と、具体例の表。
export function termsTable(terms) {
  const spell = terms.filter((t) => Array.isArray(t.avoid) && t.avoid.length);
  const known = terms.filter((t) => t.actual || (Array.isArray(t.examples) && t.examples.length));
  const out = [];
  if (spell.length) {
    out.push(`## 用語の表記\n\n次の用語は、この表記で書きます。資料の本文、図のラベル、ナレーションのすべてに当てはまります。避ける表記を使うと、Lint が P007 の error を返します。\n\n| 使う表記 | 避ける表記 |\n|---|---|\n${spell.map((t) => `| ${t.use} | ${t.avoid.join('、')} |`).join('\n')}`);
  }
  if (known.length) {
    out.push(`## 用語の具体例\n\n用語を説明するときは、次の具体例を使います。「このシステムで使っているもの」がある用語は、「このシステムでは〜」と実物の名前で説明できます。「一般的な例」は、例であることを「たとえば〜のような」と言葉で示し、このシステムが使っているものと取り違えないようにします。\n\n| 用語 | このシステムで使っているもの | 一般的な例 |\n|---|---|---|\n${known.map((t) => `| ${t.use} | ${t.actual ?? '—'} | ${list(t.examples) || '—'} |`).join('\n')}`);
  }
  return out.join('\n\n');
}
