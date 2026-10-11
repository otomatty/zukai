import { open, close, arrow, px, txt, rect, emRect, mid, unknownKeys } from './svg.js';

const H = 60;
const pillWidth = (n) => (n <= 3 ? 132 : n === 4 ? 108 : 88);
const gapOf = (spec, t) => (t.figure.width - 2 - spec.states.length * pillWidth(spec.states.length)) / (spec.states.length - 1);
const idx = (spec, name) => spec.states.indexOf(name);
const kind = (spec, tr) => {
  const d = idx(spec, tr[1]) - idx(spec, tr[0]);
  return Math.abs(d) === 1 ? 'adjacent' : d > 0 ? 'above' : 'below';
};

// state: 1つの対象が状態を移る様子を、横に並べた状態と矢印で示す。
export default {
  name: 'state',
  summary: '1つの対象が状態を移る様子を、横に並べた状態と矢印で示す',
  when: '1つの対象が状態を移り、元の状態に戻ることがある',
  example: `type: state
states: [仮登録, 有効, ロック中, 停止]
transitions:
  - [仮登録, 有効, メール確認]
  - [有効, ロック中, 5回失敗]
  - [ロック中, 有効, 15分経過]
  - [ロック中, 停止, 管理者が停止]
emphasis: 有効`,
  fields: [
    'states: 状態の名前の配列。よく通る順に左から並べる',
    'transitions: [移る前, 移った後, きっかけ] の配列（必須）',
    'emphasis: 強調する状態の名前（任意）',
    '隣り合わない状態への移り変わりは、右向きと左向きに2本ずつまで書ける',
  ],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'states', 'transitions', 'emphasis'], 'state')];
    if (!Array.isArray(spec.states) || spec.states.length < 2 || spec.states.some((s) => typeof s !== 'string')) return [...errors, 'state には states（名前の配列）が2つ以上必要です。'];
    if (new Set(spec.states).size !== spec.states.length) errors.push('states に同じ名前があります。');
    if (spec.states.length > limits.state.maxStates) errors.push(`states が${spec.states.length}個あります。上限は${limits.state.maxStates}個です。`);
    if (!Array.isArray(spec.transitions) || spec.transitions.length === 0) return [...errors, 'state には transitions が1つ以上必要です。'];
    if (spec.transitions.length > limits.state.maxTransitions) errors.push(`transitions が${spec.transitions.length}本あります。上限は${limits.state.maxTransitions}本です。`);
    for (const [i, tr] of spec.transitions.entries()) {
      if (!Array.isArray(tr) || tr.length !== 3 || tr.some((x) => typeof x !== 'string')) return [...errors, `transitions[${i}] は [移る前, 移った後, きっかけ] の組にしてください。`];
      for (const name of tr.slice(0, 2)) if (!spec.states.includes(name)) errors.push(`transitions[${i}] の「${name}」は states にありません。`);
      if (tr[0] === tr[1]) errors.push(`transitions[${i}] は同じ状態に戻っています。別の状態への移り変わりだけを書けます。`);
    }
    if (errors.length) return errors;
    const pairs = spec.transitions.map((tr) => `${tr[0]}→${tr[1]}`);
    if (new Set(pairs).size !== pairs.length) errors.push('同じ移り変わりが2回書かれています。きっかけを1つにまとめてください。');
    for (const k of ['above', 'below']) {
      if (spec.transitions.filter((tr) => kind(spec, tr) === k).length > 2) errors.push(`隣り合わない状態への${k === 'above' ? '右向き' : '左向き'}の移り変わりは2本までです。states の並び順を見直してください。`);
    }
    if (spec.emphasis !== undefined && !spec.states.includes(spec.emphasis)) errors.push(`emphasis「${spec.emphasis}」は states にありません。`);
    return errors;
  },

  fit(spec, t) {
    const w = pillWidth(spec.states.length);
    const gap = gapOf(spec, t);
    const out = spec.states.filter((s) => px(s, t.size.label) + 20 > w).map((s) => `状態「${s}」が枠に収まりません。短くするか、states を減らしてください。`);
    for (const tr of spec.transitions) {
      if (kind(spec, tr) === 'adjacent' && px(tr[2], t.size.note) + 12 > gap) out.push(`きっかけ「${tr[2]}」が矢印の長さに収まりません。短くするか、states を減らしてください。`);
    }
    return out;
  },

  labels: (spec) => spec.states,
  notes: (spec) => spec.transitions.map((tr) => tr[2]),

  render(spec, t) {
    const n = spec.states.length;
    const w = pillWidth(n);
    const gap = gapOf(spec, t);
    const xs = spec.states.map((_, i) => 1 + i * (w + gap));
    // 回り込む矢印は、向きごとに2本まで。短いほうを内側、長いほうを外側に通す。
    const arcs = (k) => spec.transitions.filter((tr) => kind(spec, tr) === k).sort((p, q) => Math.abs(idx(spec, p[1]) - idx(spec, p[0])) - Math.abs(idx(spec, q[1]) - idx(spec, q[0])));
    const level = (tr) => arcs(kind(spec, tr)).indexOf(tr);
    const LV = 30;
    const y0 = 16 + arcs('above').length * LV;
    const cy = y0 + H / 2;
    const out = [open(t, y0 + H + 16 + arcs('below').length * LV, spec.states.join('、'))];
    const both = (a, b) => spec.transitions.some((tr) => tr[0] === b && tr[1] === a);
    // 同じ状態の同じ側に矢印が2本つくときは、付け根を左右にずらす。相手が左にある矢印を左、内側の矢印を相手に近い側に置く。
    const foot = (tr, i) => {
      const k = kind(spec, tr);
      const other = (x) => idx(spec, x[0] === spec.states[i] ? x[1] : x[0]);
      const key = (x) => (other(x) < i ? -10 + level(x) : 10 - level(x));
      const here = arcs(k).filter((x) => idx(spec, x[0]) === i || idx(spec, x[1]) === i).sort((p, q) => key(p) - key(q));
      return xs[i] + w / 2 + (here.indexOf(tr) - (here.length - 1) / 2) * 24;
    };
    for (const tr of spec.transitions) {
      const a = idx(spec, tr[0]);
      const b = idx(spec, tr[1]);
      const k = kind(spec, tr);
      if (k === 'adjacent') {
        const forward = b > a;
        // 行きと帰りの両方がある組は、上下にずらして2本描く。
        const y = both(tr[0], tr[1]) ? cy + (forward ? -10 : 10) : cy;
        const [x1, x2] = forward ? [xs[a] + w + 2, xs[b] - 3] : [xs[a] - 2, xs[b] + w + 3];
        out.push(arrow(`M${x1} ${y} L${x2} ${y}`), txt(t, (x1 + x2) / 2, forward || !both(tr[0], tr[1]) ? y - 8 : y + 18, tr[2]));
      } else {
        // 隣り合わない状態へは、上か下を回り込む。
        const up = k === 'above';
        const d = 24 + level(tr) * LV;
        const yl = up ? y0 - d : y0 + H + d;
        const edge = up ? y0 : y0 + H;
        const [sx, tx] = [foot(tr, a), foot(tr, b)];
        out.push(arrow(`M${sx} ${edge + (up ? -2 : 2)} L${sx} ${yl} L${tx} ${yl} L${tx} ${edge + (up ? -3 : 3)}`), txt(t, (sx + tx) / 2, up ? yl - 7 : yl + 16, tr[2]));
      }
    }
    spec.states.forEach((s, i) => {
      const em = s === spec.emphasis;
      out.push(em ? emRect(t, xs[i], y0, w, H, H / 2) : rect(t, xs[i], y0, w, H, { rx: H / 2, fill: t.color.surface }));
      out.push(txt(t, xs[i] + w / 2, mid(cy, t.size.label), s, { cls: em ? 'zk-text zk-on-em' : 'zk-text' }));
    });
    out.push(close());
    return out.join('');
  },
};
