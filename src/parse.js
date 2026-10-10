// Markdown を「タイトル、リード、セクションの配列」に分ける。Lint とレンダリングの両方がこの結果を使う。
import MarkdownIt from 'markdown-it';
import YAML from 'yaml';

export const md = new MarkdownIt({ html: true });

const IGNORE = /<!--\s*zukai-ignore\s+(\S+)\s*(.*?)\s*-->/g;

// 文字数を数えるために Markdown の記号を外す。
export const plain = (s) =>
  s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|`)/g, '')
    .replace(/\s*\n\s*/g, '')
    .trim();

// かぎ括弧と丸括弧の中の句点では切らない。括弧が閉じていない文は、括弧を無視して句点で切る。
export const sentences = (text) => {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const ch of text) {
    cur += ch;
    if ('「『（('.includes(ch)) depth++;
    else if ('」』）)'.includes(ch) && depth > 0) depth--;
    else if (depth === 0 && '。！？'.includes(ch)) (out.push(cur), (cur = ''));
  }
  if (depth > 0) return text.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
  return [...out, cur].map((s) => s.trim()).filter(Boolean);
};

// 図のコードブロック。型のある図は yaml figure、自由な図は svg figure と書く。
export const isFreeFigure = (info) => /^svg\s+figure\b/.test(info.trim());
export const isFigure = (info) => /^ya?ml\s+figure\b/.test(info.trim()) || isFreeFigure(info);
export const isRefs = (info) => /^ya?ml\s+refs\b/.test(info.trim());
// 動画のナレーション。話し言葉の文を、字幕1枚ずつの配列で書く。資料には表示しない。
export const isNarration = (info) => /^ya?ml\s+narration\b/.test(info.trim());
// 動画のシーンを AI が自由に書くブロック。HTML、SVG、CSS、JS をブラウザの中で動かす。資料には表示しない。
export const isMotion = (info) => /^html\s+motion\b/.test(info.trim());
export const isVideoOnly = (info) => isNarration(info) || isMotion(info);

export function parse(source) {
  const tokens = md.parse(source, {});
  const doc = { title: null, lead: [], sections: [] };
  let current = null;
  const push = (block) => (current ? current.blocks : doc.lead).push(block);

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.level !== 0 || !tk.map) continue;
    const line = tk.map[0] + 1;
    const endLine = tk.map[1];

    if (tk.type === 'heading_open') {
      const level = Number(tk.tag.slice(1));
      const title = plain(tokens[i + 1].content);
      if (level === 1) {
        doc.title = title;
      } else {
        current = { level, title, line, blocks: [], ignores: [] };
        doc.sections.push(current);
      }
    } else if (tk.type === 'paragraph_open') {
      push({ kind: 'paragraph', text: plain(tokens[i + 1].content), line, endLine });
    } else if (tk.type === 'fence') {
      if (isFreeFigure(tk.info)) {
        push({ kind: 'figure', line, endLine, raw: tk.content, spec: { type: 'free', svg: tk.content } });
      } else if (isFigure(tk.info)) {
        const block = { kind: 'figure', line, endLine, raw: tk.content };
        try {
          block.spec = YAML.parse(tk.content);
        } catch (e) {
          block.parseError = e.message.split('\n')[0];
        }
        push(block);
      } else if (isNarration(tk.info)) {
        // ending を付けたブロックは、動画の最後のまとめのシーンに使う。
        const block = { kind: 'narration', line, endLine, ending: /\bending\b/.test(tk.info) };
        try {
          block.lines = YAML.parse(tk.content);
        } catch (e) {
          block.parseError = e.message.split('\n')[0];
        }
        push(block);
      } else if (isMotion(tk.info)) {
        push({ kind: 'motion', line, endLine, html: tk.content, ending: /\bending\b/.test(tk.info) });
      } else if (isRefs(tk.info)) {
        const block = { kind: 'refs', line, endLine };
        try {
          block.list = YAML.parse(tk.content);
        } catch (e) {
          block.parseError = e.message.split('\n')[0];
        }
        push(block);
      } else {
        push({ kind: 'code', line, endLine, lang: tk.info.trim().split(/\s+/)[0] ?? '' });
      }
    } else if (tk.type === 'table_open') {
      push({ kind: 'table', line, endLine });
    } else if (tk.type === 'bullet_list_open' || tk.type === 'ordered_list_open') {
      let text = '';
      let depth = 1;
      for (let j = i + 1; depth > 0; j++) {
        if (tokens[j].type === tk.type) depth++;
        if (tokens[j].type === tk.type.replace('_open', '_close')) depth--;
        if (tokens[j].type === 'inline') text += plain(tokens[j].content);
      }
      push({ kind: 'list', text, line, endLine });
    } else if (tk.type === 'html_block') {
      for (const m of tk.content.matchAll(IGNORE)) {
        (current ? current.ignores : (doc.ignores ??= [])).push({ rule: m[1], reason: m[2], line });
      }
    } else if (tk.type.endsWith('_open') || tk.type === 'code_block' || tk.type === 'hr') {
      push({ kind: 'other', line, endLine });
    }
  }

  const total = source.split('\n').length;
  doc.sections.forEach((s, i) => {
    s.endLine = (doc.sections[i + 1]?.line ?? total + 1) - 1;
    // 本文を持たず、直後に下位の見出しが続く見出しは、まとめ役として検査から外す。
    s.container = s.blocks.length === 0 && (doc.sections[i + 1]?.level ?? 0) > s.level;
  });
  return doc;
}
