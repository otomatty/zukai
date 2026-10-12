import { open, close, arrow, px, txt, ln, rect, emRect, mid, unknownKeys } from './svg.ts';
import type { FigureType, Tokens } from '../types.ts';

export interface SwimlaneStep {
  lane: string;
  label: string;
  emphasis?: boolean;
}
export interface SwimlaneSpec {
  type: 'swimlane';
  lanes: string[];
  steps: SwimlaneStep[];
}
// 手順を置くマス。row はレーンの番号、col は列の番号。
interface Cell {
  row: number;
  col: number;
}

const LABEL_W = 128;
const LANE_H = 88;
const LANE_GAP = 8;

// 手順を置く列を決める。同じレーンが続けば右へ進み、レーンが変わるときは真下か真上に置けるなら同じ列に置く。
function place(spec: SwimlaneSpec): Cell[] {
  const lane = (s: SwimlaneStep) => spec.lanes.indexOf(s.lane);
  const used = new Set<string>();
  const cells: Cell[] = [];
  spec.steps.forEach((s, i) => {
    const row = lane(s);
    let col = 0;
    if (i > 0) {
      const prev = cells[i - 1];
      const rows: number[] = [];
      for (let r = Math.min(prev.row, row); r <= Math.max(prev.row, row); r++) rows.push(r);
      const straight = row !== prev.row && rows.filter((r) => r !== prev.row).every((r) => !used.has(`${r}:${prev.col}`));
      col = straight ? prev.col : prev.col + 1;
      // 折れ線で次の列へ進むときは、線が通るマスも使用済みにする。あとの手順が線の上に重ならない。
      if (!straight && row !== prev.row) rows.forEach((r) => used.add(`${r}:${col}`));
    }
    used.add(`${row}:${col}`);
    cells.push({ row, col });
  });
  return cells;
}
const geometry = (spec: SwimlaneSpec, t: Tokens) => {
  const cells = place(spec);
  const cols = Math.max(...cells.map((c) => c.col)) + 1;
  const colW = Math.min(200, (t.figure.width - LABEL_W - 8) / cols);
  return { cells, cols, colW, w: Math.min(152, colW - 24) };
};

// swimlane: 担当ごとにレーンを分けて、手順の受け渡しを示す。
export default {
  name: 'swimlane',
  summary: '担当ごとにレーンを分けて、手順の受け渡しを示す',
  when: '手順ごとに担当者や担当システムが変わる',
  example: `type: swimlane
lanes: [人事, 管理者, 認証サービス]
steps:
  - lane: 人事
    label: 退職日を登録
  - lane: 管理者
    label: 停止を承認
  - lane: 認証サービス
    label: アカウントを停止
    emphasis: true
  - lane: 認証サービス
    label: セッションを削除`,
  fields: ['lanes: 担当の名前の配列。上から順に並べる', 'steps: 手順の配列。実行する順に並べる', 'steps[].lane: その手順の担当（必須、lanes にある名前）', 'steps[].label: 手順の名前（必須）', 'steps[].emphasis: true にすると強調色で描く（任意、図全体で1つまで）'],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'lanes', 'steps'], 'swimlane')];
    if (!Array.isArray(spec.lanes) || spec.lanes.length < 2 || spec.lanes.some((l) => typeof l !== 'string')) return [...errors, 'swimlane には lanes（名前の配列）が2つ以上必要です。担当が1つなら flow を使います。'];
    if (spec.lanes.length > limits.swimlane.maxLanes) errors.push(`lanes が${spec.lanes.length}個あります。上限は${limits.swimlane.maxLanes}個です。`);
    if (!Array.isArray(spec.steps) || spec.steps.length < 2) return [...errors, 'swimlane には steps が2つ以上必要です。'];
    if (spec.steps.length > limits.swimlane.maxSteps) errors.push(`steps が${spec.steps.length}個あります。上限は${limits.swimlane.maxSteps}個です。セクションを分けてください。`);
    // コールバックの中では spec.lanes の絞り込みが効かないので、変数に取っておく。
    const lanes = spec.lanes;
    spec.steps.forEach((s, i) => {
      errors.push(...unknownKeys(s, ['lane', 'label', 'emphasis'], `steps[${i}]`));
      if (!lanes.includes(s?.lane)) errors.push(`steps[${i}].lane「${s?.lane}」は lanes にありません。`);
      if (typeof s?.label !== 'string') errors.push(`steps[${i}] に label がありません。`);
    });
    if (spec.steps.filter((s) => s?.emphasis).length > 1) errors.push('emphasis を付けられる手順は1つまでです。');
    return errors;
  },

  fit(spec, t) {
    const { w } = geometry(spec, t);
    return [
      ...spec.lanes.filter((l) => px(l, 13) + 28 > LABEL_W).map((l) => `担当「${l}」が長すぎます。全角7字相当までにしてください。`),
      ...spec.steps.filter((s) => px(s.label, t.size.label) + 20 > w).map((s) => `手順「${s.label}」が箱に収まりません。短くするか、steps を減らしてください。`),
    ];
  },

  labels: (spec) => [...spec.lanes, ...spec.steps.map((s) => s.label)],
  notes: () => [],

  render(spec, t) {
    const { cells, colW, w } = geometry(spec, t);
    const laneY = (r: number) => r * (LANE_H + LANE_GAP);
    const pos = cells.map((c) => ({ x: LABEL_W + c.col * colW + (colW - w) / 2, y: laneY(c.row) + 20, cx: LABEL_W + c.col * colW + colW / 2, cy: laneY(c.row) + 44 }));
    const out = [open(t, spec.lanes.length * (LANE_H + LANE_GAP) - LANE_GAP, spec.steps.map((s) => `${s.lane}が${s.label}`).join('、'))];
    spec.lanes.forEach((l, r) => out.push(rect(t, 0, laneY(r), t.figure.width, LANE_H, { fill: t.color.surface, stroke: 'none', sw: 0 }), txt(t, 16, mid(laneY(r) + 44, 13), l, { anchor: 'start', weight: 700, size: 13 })));
    for (let i = 1; i < pos.length; i++) {
      const a = pos[i - 1];
      const b = pos[i];
      const down = b.cy > a.cy;
      if (a.cy === b.cy) out.push(arrow(`M${a.x + w + 2} ${a.cy} L${b.x - 3} ${b.cy}`));
      else if (a.cx === b.cx) out.push(arrow(`M${a.cx} ${a.cy + (down ? 26 : -26)} L${b.cx} ${b.cy + (down ? -27 : 27)}`));
      else out.push(ln(t, `M${a.x + w + 2} ${a.cy} L${b.cx} ${a.cy}`, { color: t.color.sub }), arrow(`M${b.cx} ${a.cy} L${b.cx} ${b.cy + (down ? -27 : 27)}`));
    }
    spec.steps.forEach((s, i) => {
      const em = s.emphasis;
      out.push(em ? emRect(t, pos[i].x, pos[i].y, w, 48) : rect(t, pos[i].x, pos[i].y, w, 48));
      out.push(txt(t, pos[i].cx, mid(pos[i].cy, t.size.label), s.label, { cls: em ? 'zk-text zk-on-em' : 'zk-text' }));
    });
    out.push(close());
    return out.join('');
  },
} satisfies FigureType<SwimlaneSpec>;
