import { open, close, box, arrow, px, unknownKeys } from './svg.js';

// flow: 順番に進む処理や手順。分岐は扱わない。
export default {
  name: 'flow',
  summary: '順番に進む処理や手順を、左から右へ並べる',
  when: '手順が2〜6個あり、一本道で進む',
  example: `type: flow
steps:
  - label: ゲートウェイ
    note: 要求を受け付ける
  - label: 認証サービス
    note: パスワードを照合する
    emphasis: true
  - label: セッションDB
    note: 30分間保存する`,
  fields: [
    'steps: 手順の配列。上から順に矢印でつなぐ',
    'steps[].label: 箱の名前（必須）',
    'steps[].note: 箱の中の補足（任意）',
    'steps[].emphasis: true にすると強調色で描く（任意、図全体で1つまで）',
    'steps[].ref: 根拠の番号（任意）。同じセクションの yaml refs の何番目かを書く',
  ],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'steps'], 'flow')];
    if (!Array.isArray(spec.steps) || spec.steps.length < 2) {
      errors.push('flow には steps が2つ以上必要です。');
      return errors;
    }
    if (spec.steps.length > limits.flow.maxSteps) {
      errors.push(`steps が${spec.steps.length}個あります。上限は${limits.flow.maxSteps}個です。セクションを分けてください。`);
    }
    spec.steps.forEach((s, i) => {
      if (!s || typeof s.label !== 'string') errors.push(`steps[${i}] に label がありません。`);
      errors.push(...unknownKeys(s, ['label', 'note', 'emphasis', 'ref'], `steps[${i}]`));
    });
    if (spec.steps.filter((s) => s?.emphasis).length > 1) errors.push('emphasis を付けられる箱は1つまでです。');
    return errors;
  },

  labels: (spec) => spec.steps.map((s) => s.label),
  notes: (spec) => spec.steps.map((s) => s.note).filter(Boolean),
  refs: (spec) => spec.steps.map((s) => s.ref).filter((r) => r !== undefined),

  render(spec, t) {
    const f = t.figure;
    const hasNote = spec.steps.some((s) => s.note);
    const h = hasNote ? 64 : 48;
    const w = Math.max(
      120,
      ...spec.steps.map((s) => Math.max(px(s.label, t.size.label), px(s.note ?? '', t.size.note)) + f.padX * 2),
    );
    const perRow = Math.max(1, Math.floor((f.width + f.gap) / (w + f.gap)));
    const rows = Math.ceil(spec.steps.length / perRow);
    const cols = Math.min(perRow, spec.steps.length);
    const left = (f.width - (cols * w + (cols - 1) * f.gap)) / 2;
    const rowGap = 40;
    // 根拠の番号は箱の上にはみ出すので、番号があるときは上を空ける。
    const top = spec.steps.some((s) => s.ref !== undefined) ? 12 : 4;
    const height = rows * h + (rows - 1) * rowGap + top + 4;
    const pos = spec.steps.map((_, i) => ({
      x: left + (i % perRow) * (w + f.gap),
      y: top + Math.floor(i / perRow) * (h + rowGap),
    }));

    const out = [open(t, height, spec.steps.map((s) => s.label).join(' → '))];
    spec.steps.forEach((s, i) => {
      out.push(box(t, pos[i].x, pos[i].y, w, h, s.label, s));
      if (i === spec.steps.length - 1) return;
      const a = pos[i];
      const b = pos[i + 1];
      if (a.y === b.y) {
        out.push(arrow(`M${a.x + w + 4} ${a.y + h / 2} L${b.x - 5} ${b.y + h / 2}`));
      } else {
        // 行を折り返す。行間を通る折れ線で、次の行の先頭へつなぐ。
        const mid = a.y + h + rowGap / 2;
        out.push(arrow(`M${a.x + w / 2} ${a.y + h + 4} L${a.x + w / 2} ${mid} L${b.x + w / 2} ${mid} L${b.x + w / 2} ${b.y - 5}`));
      }
    });
    out.push(close());
    return out.join('');
  },
};
