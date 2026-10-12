import { open, close, px, esc, mid } from './svg.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType, Tokens } from '../types.ts';

const schema = {
  branches: { type: 'list', required: true, min: 1, max: 'gitgraph.maxBranches', of: { type: 'string' }, desc: 'ブランチの名前の配列。上から順に並べる' },
  commits: {
    type: 'list', required: true, min: 2, max: 'gitgraph.maxCommits', desc: 'コミットの配列。古い順に並べる',
    of: {
      type: 'object',
      fields: {
        branch: { type: 'string', required: true, desc: 'コミットを置くブランチ' },
        from: { type: 'string', desc: 'そのブランチの最初のコミットで、分岐元のブランチを書く', note: '最初のブランチ以外は必須' },
        merge: { type: 'string', desc: '取り込むブランチの名前' },
        label: { type: 'string', desc: 'コミットの内容', note: 'label か tag のどちらかは必須' },
        tag: { type: 'string', desc: 'タグの名前' },
      },
    },
  },
} as const satisfies Fields;
export type GitgraphSpec = { type: 'gitgraph' } & Infer<typeof schema>;
type GitCommit = GitgraphSpec['commits'][number];

// 見た目は Mermaid の gitGraph（テーマ redux-color）に合わせる。
// 破線のレーン、左端のブランチ名の札、斜めに書くコミットのラベル、荷札の形のタグ、白抜きの取り込みコミットを同じ形で描く。
// 色は contract/tokens.json の gitgraph に置く。寸法は、本文の文字サイズに合わせて Mermaid の約1.2倍にしている。
const R = 8; // コミットの半径
const RAD = 20; // 分岐と取り込みの角の丸み
const SIN = Math.SQRT1_2;
const NAME = 14; // ブランチ名の文字サイズ
const LABEL = 12; // コミットのラベルの文字サイズ
const TAG = 11; // タグの文字サイズ

const nameWidth = (b: string) => px(b, NAME) + 24;
const tagWidth = (c: GitCommit) => px(c.tag, TAG);
// レーンの左端。ブランチ名の札は、ここから19px 左に右端を揃える。最初のコミットは10px 右に置く。
const leftOf = (spec: GitgraphSpec) => Math.max(...spec.branches.map(nameWidth)) + 21;
const stepOf = (spec: GitgraphSpec, t: Tokens) => Math.min(60, (t.figure.width - leftOf(spec) - 52) / Math.max(1, spec.commits.length - 1));
// 斜めのラベルが下へ伸びる長さ。
const drop = (label: string | undefined) => (label ? px(label, LABEL) * SIN + R + 20 : 0);

// レーンの縦の位置。ラベルが下のレーンのブランチ名やタグに重ならないよう、ラベルの長さに合わせて間隔を広げる。
function lanes(spec: GitgraphSpec) {
  const of = (b: string) => spec.commits.filter((c) => c.branch === b);
  const ys: number[] = [];
  let y = of(spec.branches[0]).some((c) => c.tag) ? 42 : 20;
  spec.branches.forEach((b, i) => {
    ys.push(y);
    const next = spec.branches[i + 1];
    const tagBelow = next && of(next).some((c) => c.tag) ? 16 : 0;
    y += Math.max(72, Math.max(0, ...of(b).map((c) => drop(c.label))) + 20 + tagBelow);
  });
  const last = of(spec.branches.at(-1)!);
  return { ys, height: ys.at(-1)! + Math.max(26, Math.max(0, ...last.map((c) => drop(c.label))) + 8) };
}

// gitgraph: ブランチの分岐と取り込みを、コミットの並びで示す。
export default {
  name: 'gitgraph',
  summary: 'ブランチの分岐と取り込みを、コミットの並びで示す',
  when: 'ブランチの分岐と取り込みの順番を説明する',
  example: `type: gitgraph
branches: [main, develop, feature/login]
commits:
  - branch: main
    label: 初期構成
  - branch: develop
    from: main
    label: 認証の土台
  - branch: feature/login
    from: develop
    label: 画面を追加
  - branch: develop
    merge: feature/login
    label: 機能を取り込み
  - branch: main
    merge: develop
    tag: v1.2.0`,
  fields: describe(schema, contractLimits),

  validate(spec, limits) {
    const errors = checkSpec(spec, schema, 'gitgraph', limits);
    if (errors.length) return errors;
    // 上の検査で、形が GitgraphSpec のとおりだと確かめた。ここからは、コミットの並び順を確かめる。
    const s = spec as GitgraphSpec;
    const seen = new Set<unknown>();
    s.commits.forEach((c, i) => {
      if (!s.branches.includes(c.branch)) { errors.push(`commits[${i}].branch「${c.branch}」は branches にありません。`); return; }
      const first = !seen.has(c.branch);
      if (first && seen.size > 0 && c.from === undefined) errors.push(`commits[${i}] は「${c.branch}」の最初のコミットです。from に分岐元のブランチを書いてください。`);
      if (!first && c.from !== undefined) errors.push(`commits[${i}] の from は、ブランチの最初のコミットにだけ書けます。`);
      for (const key of ['from', 'merge'] as const) {
        if (c[key] !== undefined && !seen.has(c[key])) errors.push(`commits[${i}].${key}「${c[key]}」には、まだコミットがありません。`);
        if (c[key] === c.branch) errors.push(`commits[${i}].${key} が自分自身のブランチです。`);
      }
      if (c.label === undefined && c.tag === undefined) errors.push(`commits[${i}] に label か tag を書いてください。`);
      seen.add(c.branch);
    });
    return errors;
  },

  fit(spec, t) {
    const step = stepOf(spec, t);
    const out = spec.branches.filter((b) => nameWidth(b) > 220).map((b) => `ブランチ名「${b}」が長すぎます。`);
    // 同じブランチで隣り合うコミットのタグが重ならないかを確かめる。ラベルは斜めに書くので重ならない。
    spec.commits.forEach((c, i) => {
      const next = spec.commits.findIndex((d, j) => j > i && d.branch === c.branch && d.tag);
      if (c.tag && next > 0 && (tagWidth(c) + tagWidth(spec.commits[next])) / 2 + 20 > (next - i) * step) out.push(`タグ「${c.tag}」が隣のタグと重なります。タグを減らすか、commits を減らしてください。`);
    });
    const end = spec.commits.at(-1)!;
    if (end.tag && leftOf(spec) + 10 + (spec.commits.length - 1) * step + tagWidth(end) / 2 + 7 > t.figure.width) out.push(`タグ「${end.tag}」が図の右端からはみ出します。短くしてください。`);
    return out;
  },

  labels: (spec) => spec.commits.map((c) => c.label).filter((n): n is string => Boolean(n)),
  notes: () => [],

  render(spec, t) {
    const g = t.gitgraph;
    const step = stepOf(spec, t);
    // 図を左右の中央に置く。
    const used = leftOf(spec) + 10 + (spec.commits.length - 1) * step + 40;
    const left = leftOf(spec) + Math.max(0, (t.figure.width - used) / 2);
    const { ys, height } = lanes(spec);
    const y = (b: string) => ys[spec.branches.indexOf(b)];
    const x = (i: number) => left + 10 + i * step;
    const color = (b: string) => g.branch[spec.branches.indexOf(b) % g.branch.length];
    const font = `font-family:${t.font.replace(/"/g, "'")}`;
    const line = (d: string, c: string) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`;
    const right = x(spec.commits.length - 1) + 40;
    const out = [open(t, height, spec.commits.map((c) => `${c.branch} ${c.label ?? c.tag}`).join('、'))];

    // レーンの破線と、ブランチ名の札。最初のブランチは白地に枠、ほかはブランチの色で塗る。
    spec.branches.forEach((b, i) => {
      const w = nameWidth(b);
      out.push(`<line x1="${left}" y1="${ys[i]}" x2="${right}" y2="${ys[i]}" stroke="${g.lane}" stroke-width="2" stroke-dasharray="4 2"/>`);
      out.push(`<rect x="${left - 19 - w}" y="${ys[i] - 15}" width="${w}" height="30" fill="${i === 0 ? t.color.paper : color(b)}" stroke="${color(b)}" stroke-width="2"/>`);
      out.push(`<text x="${left - 19 - w / 2}" y="${mid(ys[i], NAME)}" text-anchor="middle" style="${font};font-size:${NAME}px;font-weight:600;fill:${g.ink}">${esc(b)}</text>`);
    });

    // ブランチごとの、最後のコミットの番号。
    const last: Record<string, number> = {};
    const marks: string[] = [];
    const texts: string[] = [];
    spec.commits.forEach((c, i) => {
      const [cx, cy] = [x(i), y(c.branch)];
      if (c.from !== undefined) {
        // 分岐は、分岐元のコミットから縦に進み、角を丸めてレーンに入る。線は分岐したブランチの色で描く。
        const [px0, py0] = [x(last[c.from]), y(c.from)];
        const down = cy > py0 ? 1 : -1;
        out.push(line(`M${px0} ${py0} L${px0} ${cy - down * RAD} A${RAD} ${RAD} 0 0 ${down > 0 ? 0 : 1} ${px0 + RAD} ${cy} L${cx} ${cy}`, color(c.branch)));
      } else if (last[c.branch] !== undefined) {
        out.push(line(`M${x(last[c.branch])} ${cy} L${cx} ${cy}`, color(c.branch)));
      }
      if (c.merge !== undefined) {
        // 取り込みは、取り込まれるブランチのレーンを横に進み、角を丸めて縦に入る。線は取り込まれるブランチの色で描く。
        const [px0, py0] = [x(last[c.merge]), y(c.merge)];
        const up = cy < py0 ? 1 : -1;
        out.push(line(`M${px0} ${py0} L${cx - RAD} ${py0} A${RAD} ${RAD} 0 0 ${up > 0 ? 0 : 1} ${cx} ${py0 - up * RAD} L${cx} ${cy}`, color(c.merge)));
      }
      last[c.branch] = i;
      marks.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${color(c.branch)}"/>`);
      // 取り込みのコミットは、中を白く抜く。
      if (c.merge !== undefined) marks.push(`<circle cx="${cx}" cy="${cy}" r="${R - 2.5}" fill="${t.color.paper}"/>`);
      if (c.label) {
        // ラベルは、コミットの下から左下へ45度傾けて書く。線と重なっても読めるよう、白い縁を付ける。
        const [ax, ay] = [cx + 3, cy + R + 13];
        texts.push(`<text x="${ax}" y="${ay}" text-anchor="end" transform="rotate(-45 ${ax} ${ay})" style="${font};font-size:${LABEL}px;font-weight:600;fill:${g.ink};stroke:${t.color.paper};stroke-width:3;stroke-linejoin:round;paint-order:stroke">${esc(c.label)}</text>`);
      }
      if (c.tag) {
        // タグは荷札の形。左側を尖らせ、穴を1つ開ける。
        const w = px(c.tag, TAG);
        const [l, r, top, bottom] = [cx - w / 2, cx + w / 2, cy - R - 23, cy - R - 5];
        const m = (top + bottom) / 2;
        texts.push(`<polygon points="${l - 13},${m + 2.5} ${l - 13},${m - 2.5} ${l - 4},${top} ${r + 5},${top} ${r + 5},${bottom} ${l - 4},${bottom}" fill="${t.color.paper}" stroke="${g.ink}" stroke-width="1"/>`);
        texts.push(`<circle cx="${l - 8.5}" cy="${m}" r="1.6" fill="${g.ink}"/>`);
        texts.push(`<text x="${cx}" y="${mid(m, TAG)}" text-anchor="middle" style="${font};font-size:${TAG}px;fill:${g.ink}">${esc(c.tag)}</text>`);
      }
    });
    out.push(...marks, ...texts, close());
    return out.join('');
  },
} satisfies FigureType<GitgraphSpec>;
