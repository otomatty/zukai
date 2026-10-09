import { open, close, arrow, px, txt, rect, mid, unknownKeys } from './svg.js';
import { iconExists, iconSvg } from './icons.js';

const PAD = 12;
const BAND = 30;
const nodeOf = (n) => (typeof n === 'string' ? { label: n } : n);
const allNodes = (spec) => spec.zones.flatMap((z, c) => z.nodes.map((n, r) => ({ ...nodeOf(n), c, r })));

// 枠（領域の枠と、複数の領域をまとめる枠）を、入れ子の深さつきで返す。
function framesOf(spec) {
  const frames = [
    ...(spec.groups ?? []).map((g, i) => ({ label: g.label, from: g.from - 1, to: g.to - 1, order: i })),
    ...spec.zones.map((z, c) => (z.label ? { label: z.label, from: c, to: c, order: 1000 + c } : null)).filter(Boolean),
  ];
  const contains = (a, b) => a !== b && a.from <= b.from && a.to >= b.to && (a.to - a.from > b.to - b.from || a.order < b.order);
  for (const f of frames) {
    f.level = frames.filter((a) => contains(a, f)).length;
    f.inside = frames.filter((b) => contains(f, b));
  }
  for (const f of frames) f.deepest = Math.max(f.level, ...f.inside.map((b) => b.level));
  return frames;
}

function geometry(spec, t) {
  const frames = framesOf(spec);
  const n = spec.zones.length;
  const nodes = allNodes(spec);
  const iconMode = nodes.some((nd) => nd.icon);
  const anyNote = nodes.some((nd) => nd.note);
  const starts = (c) => frames.filter((f) => f.from === c).length;
  const ends = (c) => frames.filter((f) => f.to === c).length;
  // アイコンは箱より幅を取らないので、領域の間隔を詰める。
  const base = iconMode ? 48 : 56;
  const gaps = Array.from({ length: n - 1 }, (_, c) => base + PAD * (ends(c) + starts(c + 1)));
  const left = 1 + PAD * starts(0);
  const right = 1 + PAD * ends(n - 1);
  const w = Math.min(iconMode ? 120 : 160, (t.figure.width - left - right - gaps.reduce((a, b) => a + b, 0)) / n);
  const used = left + right + n * w + gaps.reduce((a, b) => a + b, 0);
  const x0 = [];
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
  fields: [
    'zones: 領域の配列。左から順に並べる',
    'zones[].label: 領域の名前（任意）。書くと枠で囲む',
    'zones[].nodes: 領域の中の要素。名前だけか、{label, note, icon} で書く。上から順に並べる',
    'nodes[].icon: アイコンの名前（任意）。AWS は aws/AmazonCloudFront のように書き、名前は zukai icons で調べる。user、browser、server、database も使える',
    'links: [つなぐ元, つなぐ先, 通信の名前] の配列。隣り合う領域どうしか、同じ領域の上下どうしをつなぐ。通信の名前は任意',
    'groups: 複数の領域をまとめる枠の配列（任意）。{label, from, to} で、from と to は領域の番号（1始まり）',
    'emphasis: 強調する要素の名前（任意、アイコンを使わない図だけ）',
  ],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'zones', 'links', 'groups', 'emphasis'], 'zones')];
    if (!Array.isArray(spec.zones) || spec.zones.length < 2) return [...errors, 'zones には zones が2つ以上必要です。'];
    if (spec.zones.length > limits.zones.maxZones) errors.push(`zones が${spec.zones.length}個あります。上限は${limits.zones.maxZones}個です。`);
    for (const [c, z] of spec.zones.entries()) {
      errors.push(...unknownKeys(z, ['label', 'nodes'], `zones[${c}]`));
      if (!Array.isArray(z?.nodes) || z.nodes.length === 0) return [...errors, `zones[${c}] に nodes がありません。`];
      if (z.nodes.length > limits.zones.maxNodes) errors.push(`zones[${c}].nodes が${z.nodes.length}個あります。上限は${limits.zones.maxNodes}個です。`);
      for (const [r, raw] of z.nodes.entries()) {
        const nd = nodeOf(raw);
        if (typeof nd?.label !== 'string') return [...errors, `zones[${c}].nodes[${r}] に label がありません。`];
        errors.push(...unknownKeys(nd, ['label', 'note', 'icon'], `zones[${c}].nodes[${r}]`));
        if (nd.icon !== undefined && !iconExists(String(nd.icon))) errors.push(`アイコン「${nd.icon}」はありません。名前は zukai icons で調べてください。`);
      }
    }
    const nodes = allNodes(spec);
    const names = nodes.map((nd) => nd.label);
    if (new Set(names).size !== names.length) errors.push('同じ名前の要素があります。links で区別できるよう、名前を変えてください。');
    const n = spec.zones.length;
    for (const [i, g] of (spec.groups ?? []).entries()) {
      errors.push(...unknownKeys(g, ['label', 'from', 'to'], `groups[${i}]`));
      if (typeof g?.label !== 'string' || !Number.isInteger(g?.from) || !Number.isInteger(g?.to) || g.from < 1 || g.to > n || g.from > g.to) return [...errors, `groups[${i}] は {label, from, to} で、from と to を1〜${n}の領域の番号にしてください。`];
    }
    if ((spec.groups?.length ?? 0) > limits.zones.maxGroups) errors.push(`groups が${spec.groups.length}個あります。上限は${limits.zones.maxGroups}個です。`);
    const gs = spec.groups ?? [];
    if (gs.some((a) => gs.some((b) => a.from < b.from && b.from <= a.to && a.to < b.to))) errors.push('groups の範囲が部分的に重なっています。入れ子にするか、離してください。');
    if (errors.length) return errors;

    const find = (name) => nodes.find((nd) => nd.label === name);
    const elbows = new Set();
    if (!Array.isArray(spec.links) || spec.links.length === 0) return [...errors, 'zones には links が1本以上必要です。'];
    if (spec.links.length > limits.zones.maxLinks) errors.push(`links が${spec.links.length}本あります。上限は${limits.zones.maxLinks}本です。`);
    for (const [i, l] of spec.links.entries()) {
      if (!Array.isArray(l) || l.length < 2 || l.length > 3 || l.some((x) => typeof x !== 'string')) return [...errors, `links[${i}] は [つなぐ元, つなぐ先, 通信の名前] の組にしてください。`];
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
    if (spec.emphasis !== undefined && !names.includes(spec.emphasis)) errors.push(`emphasis「${spec.emphasis}」は zones にありません。`);
    return errors;
  },

  fit(spec, t) {
    const g = geometry(spec, t);
    const out = [];
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

  labels: (spec) => [...allNodes(spec).map((nd) => nd.label), ...spec.zones.map((z) => z.label).filter(Boolean), ...(spec.groups ?? []).map((g) => g.label)],
  notes: (spec) => allNodes(spec).map((nd) => nd.note).filter(Boolean),

  render(spec, t) {
    const g = geometry(spec, t);
    const nodes = allNodes(spec);
    const cx = (nd) => g.x0[nd.c] + g.w / 2;
    const y = (nd) => g.top + nd.r * g.pitch;
    const half = g.iconMode ? 24 : g.w / 2;
    const cy = (nd) => y(nd) + (g.iconMode ? 24 : g.blockH / 2);
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
      const a = nodes.find((nd) => nd.label === l[0]);
      const b = nodes.find((nd) => nd.label === l[1]);
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
        out.push(rect(t, g.x0[nd.c], y(nd), g.w, g.blockH, { fill: em ? t.color.accentSurface : t.color.paper, stroke: em ? t.color.accent : t.color.line, sw: t.figure.stroke * (em ? 1.5 : 1) }));
        out.push(txt(t, cx(nd), mid(cy(nd) - (nd.note ? 9 : 0), t.size.label), nd.label, { cls: 'zk-text', fill: em ? t.color.accent : t.color.ink }));
        if (nd.note) out.push(txt(t, cx(nd), mid(cy(nd) + 12, t.size.note), nd.note));
      }
    }
    out.push(close());
    return out.join('');
  },
};
