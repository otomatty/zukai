// テーマの独自の型（types/<名前>/figure.svg）のひな形を、図の仕様で埋める。JavaScript は動かさない。
//   {{名前}}               値を差し込む。文字は SVG の中で安全な形にする。入れ子は {{theme.color.accent}} のように書く
//   {{#名前}}…{{/名前}}     配列なら要素ごとに繰り返し、値があれば1回書く。中では要素の項目と {{@index}}（0から）、{{@n}}（1から）、{{@count}} が使える
//   {{^名前}}…{{/名前}}     値が無いか、空の配列のときだけ書く
//   {{= 式}}               数値の計算。+ - * / %、かっこ、min max round floor ceil、width(文字, 大きさ)（文字の幅の見積り）が使える
// このファイルは重い依存を読まない。theme.ts が、テーマを読むときにひな形を確かめるため。
import { widthOf } from './figures/svg.ts';

// 数式の木。
type Expr =
  | { num: number }
  | { str: string }
  | { name: string }
  | { fn: string; args: Expr[] }
  | { op: 'neg'; a: Expr }
  | { op: '+' | '-' | '*' | '/' | '%'; a: Expr; b: Expr };
// ひな形の木。文字はそのまま書き、{{名前}} は値、{{= 式}} は計算、{{#名前}} と {{^名前}} は中を持つ区切り。
type Part = string | { op: 'value'; name: string } | { op: '='; expr: Expr } | Block;
interface Block {
  op: '#' | '^';
  name: string;
  children: Part[];
}
export interface Template {
  children: Part[];
}
// ひな形の名前を引く範囲。図の仕様、テーマの値、繰り返しの要素と @index など。
type Scope = Record<string, unknown>;
// 項目の形。unknownNames が読む。
export interface Shape {
  fields?: Record<string, Shape>;
  of?: Shape;
  // 繰り返しの要素そのもの（{{.}}）が使える。
  dot?: boolean;
  // 繰り返しの中。@index などが使える。
  loop?: boolean;
  // 名前の分からない区切りの中。どの名前も調べない。
  any?: boolean;
}

const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ひな形を木にする。閉じていない区切りや、名前の合わない区切りは、場所を添えて止める。
export function compile(src: string): Template {
  const re = /\{\{\s*([#^/=]?)\s*([^}]*?)\s*\}\}/g;
  const root: Template = { children: [] };
  const stack: (Template | Block)[] = [root];
  const top = () => stack.at(-1)!;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) top().children.push(src.slice(last, m.index));
    last = re.lastIndex;
    const [, op, body = ''] = m;
    if (!body) throw new Error(`空の {{ }} があります（${m.index}文字目）。`);
    if (op === '#' || op === '^') {
      const node: Block = { op, name: body, children: [] };
      top().children.push(node);
      stack.push(node);
    } else if (op === '/') {
      const opened = stack.length > 1 ? (stack.pop() as Block) : null;
      if (!opened || opened.name !== body) throw new Error(`{{/${body}}} に対応する {{#${body}}} がありません。`);
    } else if (op === '=') {
      top().children.push({ op, expr: parseExpr(body) });
    } else top().children.push({ op: 'value', name: body });
  }
  if (stack.length > 1) throw new Error(`{{#${(top() as Block).name}}} が閉じていません。`);
  if (last < src.length) root.children.push(src.slice(last));
  // 閉じていない {{ や、対応の無い }} は、文字としてそのまま図に出てしまうので止める。
  const stray = (node: Template | Block): boolean => node.children.some((c) => (typeof c === 'string' ? /\{\{|\}\}/.test(c) : 'children' in c && stray(c)));
  if (stray(root)) throw new Error('閉じていない {{ か、対応の無い }} があります。');
  return root;
}

// 名前を、内側の範囲から順に探す。「.」は今の要素そのもの。
function lookup(scopes: Scope[], name: string): unknown {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (name === '.') {
      if ('.' in scopes[i]) return scopes[i]['.'];
      continue;
    }
    let v: unknown = scopes[i];
    let found = true;
    for (const k of name.split('.')) {
      if (v !== null && typeof v === 'object' && Object.hasOwn(v, k)) v = (v as Scope)[k];
      else {
        found = false;
        break;
      }
    }
    if (found) return v;
  }
  return undefined;
}

function render(node: Template | Block, scopes: Scope[]): string {
  return node.children
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c.op === 'value') {
        const v = lookup(scopes, c.name);
        if (v !== null && typeof v === 'object') throw new Error(`{{${c.name}}} は値ではなく、まとまりです。{{#${c.name}}} で中を書きます。`);
        return v === undefined || v === null ? '' : esc(v);
      }
      if (c.op === '=') {
        const n = evaluate(c.expr, scopes);
        return String(Math.round(Number(n) * 100) / 100);
      }
      const v = lookup(scopes, c.name);
      const empty = v === undefined || v === null || v === false || v === '' || (Array.isArray(v) && !v.length);
      if (c.op === '^') return empty ? render(c, scopes) : '';
      if (empty) return '';
      if (Array.isArray(v)) {
        return v
          .map((item, i) => {
            const scope: Scope = item !== null && typeof item === 'object' ? { ...item } : { '.': item };
            Object.assign(scope, { '@index': i, '@n': i + 1, '@count': v.length, '@first': i === 0, '@last': i === v.length - 1 });
            return render(c, [...scopes, scope]);
          })
          .join('');
      }
      return render(c, typeof v === 'object' ? [...scopes, v as Scope] : scopes);
    })
    .join('');
}

// ひな形が使う名前のうち、shape に無いものを返す。shape は項目の形で、
// { fields: { 名前: 形 } }（まとまり）、{ of: 形 }（配列）、{}（値）のどれか。繰り返しの中では、要素の項目と @index などが使える。
const LOCALS = ['@index', '@n', '@count', '@first', '@last'];
export function unknownNames(tree: Template, shape: Shape): string[] {
  const out = new Set<string>();
  const find = (scopes: Shape[], name: string): Shape | null => {
    if (name === '.') return scopes.some((s) => s.dot || s.any) ? {} : null;
    const [head, ...rest] = name.split('.');
    for (let i = scopes.length - 1; i >= 0; i--) {
      const s = scopes[i];
      if (s.any) return {};
      if (s.loop && LOCALS.includes(head)) return rest.length ? null : {};
      if (!s.fields || !Object.hasOwn(s.fields, head)) continue;
      let cur: Shape | null | undefined = s.fields[head];
      for (const k of rest) cur = cur?.fields && Object.hasOwn(cur.fields, k) ? cur.fields[k] : null;
      if (cur) return cur;
    }
    return null;
  };
  const expr = (n: Expr, scopes: Shape[]) => {
    if ('name' in n && n.name && !find(scopes, n.name)) out.add(n.name);
    if ('args' in n) n.args.forEach((a) => expr(a, scopes));
    if ('a' in n) expr(n.a, scopes);
    if ('b' in n) expr(n.b, scopes);
  };
  const walk = (node: Template | Block, scopes: Shape[]) => {
    for (const c of node.children) {
      if (typeof c === 'string') continue;
      if (c.op === '=') {
        expr(c.expr, scopes);
        continue;
      }
      const s = find(scopes, c.name);
      if (!s) out.add(c.name);
      if (c.op === 'value') continue;
      // 繰り返しと、まとまりの中では、その項目の名前が使える。値の項目は、値があるときだけ書く条件になる。
      // 名前の分からない区切りの中は、その名前の誤りだけを知らせ、中の名前は調べない。
      let inner = scopes;
      if (!s) inner = [...scopes, { any: true }];
      else if (c.op === '#' && s.of) inner = [...scopes, s.of.fields ? { fields: s.of.fields, loop: true } : { dot: true, loop: true }];
      else if (c.op === '#' && s.fields) inner = [...scopes, s];
      walk(c, inner);
    }
  };
  walk(tree, [shape]);
  return [...out];
}

// ひな形を埋める。data は図の仕様と、theme（テーマの値）。
export const fill = (tree: Template, data: Scope): string => render(tree, [data]);

// ---- 数式 ----
const FNS: Record<string, (...xs: number[]) => number> = { min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil };

function parseExpr(src: string): Expr {
  const tokens = src.match(/\s*(\d+(?:\.\d+)?|[A-Za-z_@.][\w@.]*|"[^"]*"|[-+*/%(),])/g);
  if (!tokens || tokens.join('').replace(/\s/g, '') !== src.replace(/\s/g, '')) throw new Error(`{{= ${src}}} を読めません。数、名前、+ - * / %、かっこだけを使えます。`);
  const ts = tokens.map((t) => t.trim());
  let i = 0;
  const peek = () => ts[i];
  const take = (t: string) => {
    if (ts[i] !== t) throw new Error(`{{= ${src}}} の「${ts[i] ?? '終わり'}」の前に「${t}」が要ります。`);
    i++;
  };
  const expr = (): Expr => {
    let n = term();
    while (peek() === '+' || peek() === '-') n = { op: ts[i++] as '+' | '-', a: n, b: term() };
    return n;
  };
  const term = (): Expr => {
    let n = factor();
    while (peek() === '*' || peek() === '/' || peek() === '%') n = { op: ts[i++] as '*' | '/' | '%', a: n, b: factor() };
    return n;
  };
  const factor = (): Expr => {
    const t = ts[i++];
    if (t === undefined) throw new Error(`{{= ${src}}} が途中で終わっています。`);
    if (t === '-') return { op: 'neg', a: factor() };
    if (t === '(') {
      const n = expr();
      take(')');
      return n;
    }
    if (/^\d/.test(t)) return { num: Number(t) };
    if (t.startsWith('"')) return { str: t.slice(1, -1) };
    if (peek() === '(') {
      if (t !== 'width' && !Object.hasOwn(FNS, t)) throw new Error(`{{= ${src}}} の関数「${t}」は使えません。min、max、round、floor、ceil、width を使えます。`);
      i++;
      const args: Expr[] = [];
      if (peek() !== ')') {
        args.push(expr());
        while (peek() === ',') {
          i++;
          args.push(expr());
        }
      }
      take(')');
      return { fn: t, args };
    }
    return { name: t };
  };
  const tree = expr();
  if (i < ts.length) throw new Error(`{{= ${src}}} の「${ts[i]}」を読めません。`);
  return tree;
}

// 計算の結果。文字は width() の引数としてだけ使える。
function evaluate(n: Expr, scopes: Scope[]): number | string {
  if ('num' in n) return n.num;
  if ('str' in n) return n.str;
  if ('name' in n) {
    const v = lookup(scopes, n.name);
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    if (Array.isArray(v)) return v.length;
    // 文字の項目は、width() の引数としてだけ使える。
    if (typeof v === 'string') return v;
    throw new Error(`{{= }} の「${n.name}」は数値ではありません。`);
  }
  if ('fn' in n) {
    const args = n.args.map((a) => evaluate(a, scopes));
    if (n.fn === 'width') {
      const [text, size] = args;
      return widthOf(String(text ?? '')) * Number(size ?? 15);
    }
    return FNS[n.fn](...args.map(Number));
  }
  if (n.op === 'neg') return -evaluate(n.a, scopes);
  const [a, b] = [evaluate(n.a, scopes), evaluate(n.b, scopes)];
  if (typeof a !== 'number' || typeof b !== 'number') throw new Error('{{= }} で、文字を計算に使っています。文字の幅は width(名前, 大きさ) で求めます。');
  return { '+': a + b, '-': a - b, '*': a * b, '/': b === 0 ? 0 : a / b, '%': b === 0 ? 0 : a % b }[n.op];
}
