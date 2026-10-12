import { open, close, arrow, px, txt, rect, emRect, mid } from './svg.ts';
import { iconExists, iconSvg } from './icons.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType, Tokens } from '../types.ts';

// 要素を {label, note, icon} で書くときの項目。
const nodeFields = {
  label: { type: 'string', required: true, desc: '要素の名前' },
  note: { type: 'string', desc: '要素の補足' },
  icon: { type: 'string', desc: 'アイコンの名前。AWS は aws/AmazonCloudFront のように書き、名前は zukai icons で調べる。user、browser、server、database も使える' },
} as const satisfies Fields;
const schema = {
  zones: {
    type: 'list', required: true, min: 2, max: 'zones.maxZones', desc: '領域の配列。左から順に並べる',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', desc: '領域の名前。書くと枠で囲む' },
        nodes: {
          type: 'list', required: true, min: 1, max: 'zones.maxNodes', desc: '領域の中の要素。名前だけか、{label, note, icon} で書く。上から順に並べる',
          of: { type: 'oneOf', options: [{ type: 'string' }, { type: 'object', fields: nodeFields }] },
        },
      },
    },
  },
  links: {
    type: 'list', required: true, min: 1, max: 'zones.maxLinks', desc: '[つなぐ元, つなぐ先, 通信の名前] の配列。隣り合う領域どうしか、同じ領域の上下どうしをつなぐ。通信の名前は任意',
    of: { type: 'tuple', items: [{ type: 'string' }, { type: 'string' }, { type: 'string' }], min: 2, desc: 'つなぐ元, つなぐ先, 通信の名前' },
  },
  groups: {
    type: 'list', max: 'zones.maxGroups', desc: '複数の領域をまとめる枠の配列。from と to は、1から数えた領域の番号',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, desc: '枠の名前' },
        from: { type: 'number', required: true, integer: true, min: 1, desc: '最初の領域の番号' },
        to: { type: 'number', required: true, integer: true, min: 1, desc: '最後の領域の番号。zones の数まで' },
      },
    },
  },
  emphasis: { type: 'string', desc: '強調する要素の名前', note: 'アイコンを使わない図だけ' },
} as const satisfies Fields;
export type ZonesSpec = { type: 'zones' } & Infer<typeof schema>;
type ZoneNode = Infer<typeof nodeFields>;
type ZoneGroup = NonNullable<ZonesSpec['groups']>[number];
// 書き方の説明では、zones の後ろに要素の項目を挟む。
const { zones, ...rest } = schema;
// 置き場所の決まった要素。c は領域の番号、r は領域の中の段の番号（どちらも0始まり）。
interface PlacedNode extends ZoneNode {
  c: number;
  r: number;
}
// 枠。from と to は領域の番号（0始まり）。level は外側にある枠の数、inside は内側にある枠、deepest は内側の枠の level の最大。
interface Frame {
  label: string;
  from: number;
  to: number;
  order: number;
  level: number;
  inside: Frame[];
  deepest: number;
}

const PAD = 12;
const BAND = 30;
// 名前だけの要素を {label} にし、それ以外はそのまま返す。
const nodeOf = (n: string | ZoneNode): ZoneNode => (typeof n === 'string' ? { label: n } : n);
const allNodes = (spec: ZonesSpec): PlacedNode[] => spec.zones.flatMap((z, c) => z.nodes.map((n, r) => ({ ...nodeOf(n), c, r })));

// 枠（領域の枠と、複数の領域をまとめる枠）を、入れ子の深さつきで返す。
function framesOf(spec: ZonesSpec): Frame[] {
  // level、inside、deepest は、この後で埋める。
  const frames = [
    ...(spec.groups ?? []).map((g, i) => ({ label: g.label, from: g.from - 1, to: g.to - 1, order: i })),
    ...spec.zones.map((z, c) => (z.label ? { label: z.label, from: c, to: c, order: 1000 + c } : null)).filter(Boolean),
  ] as Frame[];
  const contains = (a: Frame, b: Frame) => a !== b && a.from <= b.from && a.to >= b.to && (a.to - a.from > b.to - b.from || a.order < b.order);
  for (const f of frames) {
    f.level = frames.filter((a) => contains(a, f)).length;
    f.inside = frames.filter((b) => contains(f, b));
  }
  for (const f of frames) f.deepest = Math.max(f.level, ...f.inside.map((b) => b.level));
  return frames;
}

function geometry(spec: ZonesSpec, t: Tokens) {
  const frames = framesOf(spec);
  const n = spec.zones.length;
  const nodes = allNodes(spec);
  const iconMode = nodes.some((nd) => nd.icon);
  const anyNote = nodes.some((nd) => nd.note);
  const starts = (c: number) => frames.filter((f) => f.from === c).length;
  const ends = (c: number) => frames.filter((f) => f.to === c).length;
  // アイコンは箱より幅を取らないので、領域の間隔を詰める。
  const base = iconMode ? 48 : 56;
  const gaps = Array.from({ length: n - 1 }, (_, c) => base + PAD * (ends(c) + starts(c + 1)));
  const left = 1 + PAD * starts(0);
  const right = 1 + PAD * ends(n - 1);
  const w = Math.min(iconMode ? 120 : 160, (t.figure.width - left - right - gaps.reduce((a, b) => a + b, 0)) / n);
  const used = left + right + n * w + gaps.reduce((a, b) => a + b, 0);
  const x0: number[] = [];
  let x = (t.figure.width - used) / 2 + left;
  for (let c = 0; c < n; c++) { x0.push(x); x += w + (gaps[c] ?? 0); }
  const depth = frames.length ? Math.max(...frames.map((f) => f.level)) + 1 : 0;
  const top = 2 + depth * BAND + (depth ? 10 : 2);
  const blockH = iconMode ? 48 + (anyNote ? 40 : 24) : anyNote ? 60 : 48;
  const pitch = blockH + (iconMode ? 28 : 40);
  const rows = Math.max(...spec.zones.map((z) => z.nodes.length));
  const bottom = top + (rows - 1) * pitch + blockH;
  return { frames, w, x0, gaps, base, top, pitch, blockH, bottom, iconMode, depth };
}

// zones: 領域の境界と、境界をまたぐ接続を示す。アイコンを付けると、クラウドの構成図になる。
export default {
  name: 'zones',
  summary: '領域の境界と、境界をまたぐ接続を、左から右へ並べて示す。アイコンを付けるとクラウドの構成図になる',
  when: '領域の境界があり、境界をまたぐ接続を示したい',
  example: `type: zones
zones:
  - label: 外部
    nodes: [ブラウザ]
  - label: 公開領域
    nodes: [ゲートウェイ]
  - label: 社内領域
    nodes: [認証サービス, セッションDB]
links:
  - [ブラウザ, ゲートウェイ, HTTPS]
  - [ゲートウェイ, 認証サービス, 社内通信]
  - [認証サービス, セッションDB]
emphasis: ゲートウェイ`,
  fields: [...describe({ zones }, contractLimits), ...describe(nodeFields, contractLimits, 'zones[].nodes[].'), ...describe(rest, contractLimits)],

  validate(spec, limits) {
    const errors = checkSpec(spec, schema, 'zones', limits);
    if (errors.length) return errors;
    // 上の検査で、形が ZonesSpec のとおりだと確かめた。ここからは、要素の名前、枠の範囲、接続を確かめる。
    const s = spec as ZonesSpec;
    const nodes = allNodes(s);
    for (const nd of nodes) {
      if (nd.icon !== undefined && !iconExists(String(nd.icon))) errors.push(`アイコン「${nd.icon}」はありません。名前は zukai icons で調べてください。`);
    }
    const names = nodes.map((nd) => nd.label);
    if (new Set(names).size !== names.length) errors.push('同じ名前の要素があります。links で区別できるよう、名前を変えてください。');
    const n = s.zones.length;
    for (const [i, g] of (s.groups ?? []).entries()) {
      if (g.to > n || g.from > g.to) return [...errors, `groups[${i}] は {label, from, to} で、from と to を1〜${n}の領域の番号にしてください。`];
    }
    const gs: ZoneGroup[] = s.groups ?? [];
    if (gs.some((a) => gs.some((b) => a.from < b.from && b.from <= a.to && a.to < b.to))) errors.push('groups の範囲が部分的に重なっています。入れ子にするか、離してください。');
    if (errors.length) return errors;

    const find = (name: string) => nodes.find((nd) => nd.label === name);
    const elbows = new Set<number>();
    for (const [i, l] of s.links.entries()) {
      const [a, b] = [find(l[0]), find(l[1])];
      if (!a || !b) { errors.push(`links[${i}] の「${a ? l[1] : l[0]}」は zones にありません。`); continue; }
      const [dc, dr] = [Math.abs(a.c - b.c), Math.abs(a.r - b.r)];
      if (dc === 0 && dr === 1) { if (l[2]) errors.push(`links[${i}] は上下の接続です。通信の名前は書けません。`); continue; }
      if (dc !== 1) { errors.push(`links[${i}]「${l[0]}」と「${l[1]}」は離れています。隣り合う領域どうしか、同じ領域の上下どうしだけをつなげます。`); continue; }
      if (dr === 0) continue;
      const gap = Math.min(a.c, b.c);
      if (l[2]) errors.push(`links[${i}] は段の違う要素をつなぐので、通信の名前は書けません。`);
      if (elbows.has(gap)) errors.push(`links[${i}] と同じ境界に、段の違う要素をつなぐ線がもう1本あります。線が重なるので、1本にしてください。`);
      elbows.add(gap);
    }
    if (s.emphasis !== undefined && !names.includes(s.emphasis)) errors.push(`emphasis「${s.emphasis}」は zones にありません。`);
    return errors;
  },

  fit(spec, t) {
    const g = geometry(spec, t);
    const out: string[] = [];
    if (g.w < (g.iconMode ? 64 : 96)) out.push('領域と枠が多く、横に収まりません。zones か groups を減らしてください。');
    const size = g.iconMode ? 13 : t.size.label;
    // アイコンの下の文字は、領域の枠の内側に収める。
    const room = g.iconMode ? g.w + 2 * PAD - 12 : g.w - 16;
    for (const nd of allNodes(spec)) {
      if (px(nd.label, size) > room) out.push(`要素「${nd.label}」が収まりません。短くしてください。`);
      if (nd.note && px(nd.note, t.size.note) > room) out.push(`補足「${nd.note}」が収まりません。短くしてください。`);
    }
    const nodes = allNodes(spec);
    for (const l of spec.links) {
      const a = nodes.find((nd) => nd.label === l[0]);
      const b = nodes.find((nd) => nd.label === l[1]);
      // 通信の名前は、枠と枠の間に書く。枠の線に重ならない幅にする。
      if (l[2] && px(l[2], t.size.note) + 4 > g.base) out.push(`通信の名前「${l[2]}」が矢印の長さに収まりません。短くしてください。`);
    }
    return out;
  },

  labels: (spec) => [...allNodes(spec).map((nd) => nd.label), ...spec.zones.map((z) => z.label).filter((n): n is string => Boolean(n)), ...(spec.groups ?? []).map((g) => g.label)],
  notes: (spec) => allNodes(spec).map((nd) => nd.note).filter((n): n is string => Boolean(n)),

  render(spec, t) {
    const g = geometry(spec, t);
    const nodes = allNodes(spec);
    const cx = (nd: PlacedNode) => g.x0[nd.c] + g.w / 2;
    const y = (nd: PlacedNode) => g.top + nd.r * g.pitch;
    const half = g.iconMode ? 24 : g.w / 2;
    const cy = (nd: PlacedNode) => y(nd) + (g.iconMode ? 24 : g.blockH / 2);
    const lowest = g.frames.length ? Math.max(...g.frames.map((f) => g.bottom + PAD + (f.deepest - f.level) * 10)) : g.bottom;
    const out = [open(t, lowest + 4, nodes.map((nd) => nd.label).join('、'))];

    for (const f of [...g.frames].sort((a, b) => a.level - b.level)) {
      const x1 = g.x0[f.from] - PAD * (1 + f.inside.filter((b) => b.from === f.from).length);
      const x2 = g.x0[f.to] + g.w + PAD * (1 + f.inside.filter((b) => b.to === f.to).length);
      const fy = 2 + f.level * BAND;
      const leaf = f.inside.length === 0;
      out.push(
        `<rect x="${x1}" y="${fy}" width="${x2 - x1}" height="${g.bottom + PAD + (f.deepest - f.level) * 10 - fy}" rx="${leaf ? 8 : 4}" fill="${leaf ? t.color.surface : t.color.paper}" stroke="${leaf ? t.color.line : f.level === 0 ? t.color.ink : t.color.sub}" stroke-width="${t.figure.stroke}"${leaf ? ' stroke-dasharray="5 4"' : ''}/>`,
        txt(t, x1 + 12, fy + 20, f.label, { anchor: 'start', weight: 700, size: 12, fill: leaf ? t.color.sub : t.color.ink }),
      );
    }

    for (const l of spec.links) {
      // links は検証で、zones にある要素どうしをつなぐと確かめてある。
      const a = nodes.find((nd) => nd.label === l[0])!;
      const b = nodes.find((nd) => nd.label === l[1])!;
      if (a.c === b.c) {
        const down = b.r > a.r;
        const from = down ? y(a) + g.blockH + 3 : y(a) - 3;
        const to = down ? y(b) - 4 : y(b) + g.blockH + 4;
        out.push(arrow(`M${cx(a)} ${from} L${cx(b)} ${to}`));
        continue;
      }
      const dir = b.c > a.c ? 1 : -1;
      const x1 = cx(a) + dir * (half + 3);
      const x2 = cx(b) - dir * (half + 4);
      if (a.r === b.r) {
        out.push(arrow(`M${x1} ${cy(a)} L${x2} ${cy(b)}`));
        if (l[2]) {
          // 左の列で終わる枠と、右の列で始まる枠の間の中央に置く。
          const [lo, hi] = [Math.min(a.c, b.c), Math.max(a.c, b.c)];
          const free1 = g.x0[lo] + g.w + PAD * g.frames.filter((f) => f.to === lo).length;
          const free2 = g.x0[hi] - PAD * g.frames.filter((f) => f.from === hi).length;
          out.push(txt(t, (free1 + free2) / 2, cy(a) - 8, l[2]));
        }
      } else {
        const mx = (x1 + x2) / 2;
        out.push(arrow(`M${x1} ${cy(a)} L${mx} ${cy(a)} L${mx} ${cy(b)} L${x2} ${cy(b)}`));
      }
    }

    for (const nd of nodes) {
      if (g.iconMode) {
        out.push(iconSvg(String(nd.icon ?? 'box'), cx(nd) - 24, y(nd), 48, t), txt(t, cx(nd), y(nd) + 66, nd.label, { fill: t.color.ink, weight: 600, size: 13 }));
        if (nd.note) out.push(txt(t, cx(nd), y(nd) + 83, nd.note));
      } else {
        const em = nd.label === spec.emphasis;
        out.push(em ? emRect(t, g.x0[nd.c], y(nd), g.w, g.blockH) : rect(t, g.x0[nd.c], y(nd), g.w, g.blockH));
        out.push(txt(t, cx(nd), mid(cy(nd) - (nd.note ? 9 : 0), t.size.label), nd.label, { cls: em ? 'zk-text zk-on-em' : 'zk-text' }));
        if (nd.note) out.push(txt(t, cx(nd), mid(cy(nd) + 12, t.size.note), nd.note, em ? { cls: 'zk-note zk-on-em-note' } : {}));
      }
    }
    out.push(close());
    return out.join('');
  },
} satisfies FigureType<ZonesSpec>;
