import { open, close, px, esc, mid, unknownKeys } from './svg.ts';
import type { FigureType } from '../types.ts';

// 日付は YYYY-MM-DD で書く。
export interface GanttTask {
  label: string;
  start?: string;
  end?: string;
  // 期間のない節目の日付。start と end の代わりに書く。
  at?: string;
  group?: string;
  emphasis?: boolean;
}
export interface GanttSpec {
  type: 'gantt';
  tasks: GanttTask[];
  marker?: { at: string; label: string };
}
// 横軸の目盛り。center は、日付を書く位置を目盛りの線からずらす量。
interface Tick {
  at: number;
  label: string;
  center?: number;
}
// 表の行。まとまりの見出しの行か、作業の行。
type Row = { group: string; task?: undefined } | { group?: undefined; task: GanttTask };

const DAY = 86400000;
const ROW = 30;
const TOP = 30;
// 実在する日付なら、その日の0時（UTC）のミリ秒。そうでなければ null。
const date = (v: unknown): number | null => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(d).getUTCDate() === Number(m[3]) ? d : null;
};
const md = (ms: number) => `${new Date(ms).getUTCMonth() + 1}/${new Date(ms).getUTCDate()}`;
// 検証を通った作業だけに使う。日付は実在すると確かめてある。
const startOf = (task: GanttTask) => date(task.at ?? task.start)!;
const endOf = (task: GanttTask) => (task.at !== undefined ? date(task.at) : date(task.end))! + DAY;

// 横軸の範囲と目盛り。期間が短ければ日ごと、10週までは週ごと（月曜）、それより長ければ月ごとに刻む。
function axis(spec: GanttSpec) {
  const from = Math.min(...spec.tasks.map(startOf));
  const to = Math.max(...spec.tasks.map(endOf));
  const days = (to - from) / DAY;
  const ticks: Tick[] = [];
  let [lo, hi] = [from, to];
  if (days <= 14) {
    // 日ごとの刻みでは、日付を1日の幅の中央に書く。線の上に書くと、棒の終わりが翌日の日付に重なって読める。
    for (let d = lo; d <= hi; d += DAY) ticks.push({ at: d, label: d < hi ? md(d) : '', center: DAY / 2 });
  } else if (days <= 70) {
    lo = from - ((new Date(from).getUTCDay() + 6) % 7) * DAY;
    hi = to + ((8 - new Date(to).getUTCDay()) % 7) * DAY;
    for (let d = lo; d <= hi; d += 7 * DAY) ticks.push({ at: d, label: md(d) });
  } else {
    const first = (ms: number, add: number) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth() + add, 1);
    lo = first(from, 0);
    hi = new Date(to).getUTCDate() === 1 ? to : first(to, 1);
    for (let d = lo; d <= hi; d = first(d, 1)) ticks.push({ at: d, label: `${new Date(d).getUTCMonth() + 1}月` });
  }
  return { lo, hi, ticks, days };
}
// 行の並び。group が変わるところに、見出しの行を入れる。
function rows(spec: GanttSpec): Row[] {
  const out: Row[] = [];
  let group: string | undefined;
  for (const task of spec.tasks) {
    if (task.group !== undefined && task.group !== group) out.push({ group: task.group });
    group = task.group;
    out.push({ task });
  }
  return out;
}
const leftOf = (spec: GanttSpec) => Math.min(220, Math.max(...spec.tasks.map((x) => px(x.label, 13))) + 28);

// gantt: 作業の期間と順番を、日付の軸に沿った横棒で示す。
export default {
  name: 'gantt',
  summary: '作業の期間と順番を、日付の軸に沿った横棒で示す',
  when: '開始日と終了日のある作業が複数あり、期間の長さや重なりを見せたい',
  example: `type: gantt
tasks:
  - label: 設計
    start: 2026-10-05
    end: 2026-10-09
    group: 準備
  - label: レビュー
    start: 2026-10-12
    end: 2026-10-14
    group: 準備
  - label: 実装
    start: 2026-10-13
    end: 2026-10-27
    group: 開発
    emphasis: true
  - label: リリース
    at: 2026-10-30
    group: 開発
marker:
  at: 2026-10-16
  label: 今日`,
  fields: [
    'tasks: 作業の配列（必須）。上から順に並べる',
    'tasks[].label: 作業の名前（必須）',
    'tasks[].start / end: 開始日と終了日（YYYY-MM-DD）。終了日はその日を含む',
    'tasks[].at: 期間のない節目の日付（YYYY-MM-DD）。start と end の代わりに書くと、ひし形で描く',
    'tasks[].group: まとまりの名前（任意）。同じ group の作業は続けて並べる',
    'tasks[].emphasis: true にすると強調色で描き、ほかの棒を灰色にする（任意、図全体で1つまで）',
    'marker.at / marker.label: 縦線で示す日付と、その名前（任意）。今日や締め切りに使う',
    '横軸は、期間に合わせて日、週、月のどれかで自動的に刻む',
  ],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'tasks', 'marker'], 'gantt')];
    if (!Array.isArray(spec.tasks) || spec.tasks.length < 2) return [...errors, 'gantt には tasks が2つ以上必要です。'];
    if (spec.tasks.length > limits.gantt.maxTasks) errors.push(`tasks が${spec.tasks.length}個あります。上限は${limits.gantt.maxTasks}個です。セクションを分けてください。`);
    spec.tasks.forEach((x, i) => {
      errors.push(...unknownKeys(x, ['label', 'start', 'end', 'at', 'group', 'emphasis'], `tasks[${i}]`));
      if (typeof x?.label !== 'string' || !x.label) { errors.push(`tasks[${i}] に label がありません。`); return; }
      if (x.at !== undefined) {
        if (x.start !== undefined || x.end !== undefined) errors.push(`tasks[${i}]「${x.label}」は、at か、start と end のどちらかだけを書いてください。`);
        else if (date(x.at) === null) errors.push(`tasks[${i}]「${x.label}」の at は、YYYY-MM-DD の実在する日付にしてください。`);
      } else if (date(x.start) === null || date(x.end) === null) errors.push(`tasks[${i}]「${x.label}」には、start と end を YYYY-MM-DD の実在する日付で書いてください。`);
      else if (date(x.end)! < date(x.start)!) errors.push(`tasks[${i}]「${x.label}」の end が start より前です。`);
      if (x.group !== undefined && (typeof x.group !== 'string' || !x.group)) errors.push(`tasks[${i}].group は名前で書いてください。`);
    });
    if (errors.length) return errors;
    // 上の検査で、tasks の形を確かめた。marker は、まだ確かめていない。
    const ok = spec as GanttSpec;
    const groups = rows(ok).filter((r) => r.group).map((r) => r.group);
    if (new Set(groups).size !== groups.length) errors.push('同じ group の作業が離れています。続けて並べてください。');
    if (groups.length > limits.gantt.maxGroups) errors.push(`group が${groups.length}個あります。上限は${limits.gantt.maxGroups}個です。`);
    if (ok.tasks.every((x) => x.at !== undefined)) errors.push('期間のある作業がありません。日付だけの並びは timeline を使います。');
    if (ok.tasks.filter((x) => x.emphasis).length > 1) errors.push('emphasis を付けられる作業は1つまでです。');
    const a = axis(ok);
    if (a.days > limits.gantt.maxDays) errors.push(`全体の期間が${Math.round(a.days)}日あります。上限は${limits.gantt.maxDays}日です。期間を分けてください。`);
    if (spec.marker !== undefined) {
      errors.push(...unknownKeys(spec.marker, ['at', 'label'], 'marker'));
      if (date(spec.marker?.at) === null || typeof spec.marker?.label !== 'string' || !spec.marker.label) errors.push('marker には、at（YYYY-MM-DD）と label が必要です。');
      else if (date(spec.marker.at)! < a.lo || date(spec.marker.at)! > a.hi) errors.push('marker.at が、作業の期間の外にあります。');
    }
    return errors;
  },

  fit(spec, t) {
    const out = spec.tasks.filter((x) => px(x.label, 13) + 28 > 220).map((x) => `作業「${x.label}」が長すぎます。短くしてください。`);
    const a = axis(spec);
    const slot = (t.figure.width - leftOf(spec) - 16) / Math.max(1, a.ticks.length - 1);
    if (slot < 34) out.push('目盛りの間隔が狭く、日付が重なります。期間を短くするか、セクションを分けてください。');
    return out;
  },

  labels: (spec) => [...spec.tasks.map((x) => x.label), ...new Set(spec.tasks.map((x) => x.group).filter((g): g is string => Boolean(g))), ...(spec.marker ? [spec.marker.label] : [])],
  notes: () => [],

  render(spec, t) {
    const a = axis(spec);
    const left = leftOf(spec);
    const right = t.figure.width - 16;
    const x = (ms: number) => left + ((ms - a.lo) / (a.hi - a.lo)) * (right - left);
    const list = rows(spec);
    const bottom = TOP + list.length * ROW;
    const font = `font-family:${t.font.replace(/"/g, "'")}`;
    const anyEm = spec.tasks.some((k) => k.emphasis);
    // 縦線の名前は、図の下に書く。
    const out = [open(t, bottom + (spec.marker ? 30 : 10), spec.tasks.map((k) => (k.at !== undefined ? `${k.label} ${md(date(k.at)!)}` : `${k.label} ${md(date(k.start)!)}から${md(date(k.end)!)}`)).join('、'))];

    // まとまりの見出しは、帯で区切る。
    list.forEach((r, i) => {
      if (r.group) out.push(`<rect x="0" y="${TOP + i * ROW}" width="${t.figure.width}" height="${ROW}" fill="${t.color.surface}"/>`, `<text x="10" y="${mid(TOP + i * ROW + ROW / 2, 12)}" style="${font};font-size:12px;font-weight:700;fill:${t.color.sub}">${esc(r.group)}</text>`);
    });
    // 目盛りの縦線と日付。
    for (const tick of a.ticks) {
      out.push(`<line x1="${x(tick.at)}" y1="${TOP - 4}" x2="${x(tick.at)}" y2="${bottom}" stroke="${t.chart.grid}" stroke-width="1"/>`);
      out.push(`<text class="zk-note" x="${x(tick.at + (tick.center ?? 0))}" y="16" text-anchor="middle">${tick.label}</text>`);
    }
    out.push(`<line x1="${left}" y1="${TOP - 4}" x2="${right}" y2="${TOP - 4}" stroke="${t.chart.axis}" stroke-width="1"/>`);

    list.forEach((r, i) => {
      if (!r.task) return;
      const k = r.task;
      const cy = TOP + i * ROW + ROW / 2;
      const color = anyEm && !k.emphasis ? t.chart.muted : t.color.accent;
      out.push(`<text x="${r.task.group !== undefined ? 22 : 10}" y="${mid(cy, 13)}" style="${font};font-size:13px;fill:${t.color.ink};font-weight:${k.emphasis ? 700 : 400}">${esc(k.label)}</text>`);
      const [x1, x2] = [x(startOf(k)), x(endOf(k))];
      const text = k.at !== undefined || k.start === k.end ? md(startOf(k)) : `${md(date(k.start)!)}〜${md(date(k.end)!)}`;
      const w = px(text, 12);
      if (k.at !== undefined) {
        // 節目は、その日の中央にひし形で描く。
        const cx = (x1 + x2) / 2;
        out.push(`<path d="M${cx} ${cy - 8} L${cx + 8} ${cy} L${cx} ${cy + 8} L${cx - 8} ${cy} Z" fill="${anyEm && !k.emphasis ? t.chart.muted : t.color.ink}"/>`);
        out.push(cx + 14 + w <= right ? `<text class="zk-note" x="${cx + 14}" y="${mid(cy, 12)}">${text}</text>` : `<text class="zk-note" x="${cx - 14}" y="${mid(cy, 12)}" text-anchor="end">${text}</text>`);
      } else {
        out.push(`<rect x="${x1}" y="${cy - 8}" width="${Math.max(3, x2 - x1)}" height="16" rx="4" fill="${color}"/>`);
        // 日付は棒の右に書く。右に収まらなければ左に書く。
        out.push(x2 + 8 + w <= right ? `<text class="zk-note" x="${x2 + 8}" y="${mid(cy, 12)}">${text}</text>` : `<text class="zk-note" x="${x1 - 8}" y="${mid(cy, 12)}" text-anchor="end">${text}</text>`);
      }
    });
    if (spec.marker) {
      const mx = x(date(spec.marker.at)! + DAY / 2);
      const label = `${spec.marker.label} ${md(date(spec.marker.at)!)}`;
      const lw = px(label, 12) + 12;
      const lx = Math.min(Math.max(mx, left + lw / 2), right - lw / 2);
      out.push(`<line x1="${mx}" y1="${TOP - 4}" x2="${mx}" y2="${bottom}" stroke="${t.color.ink}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      out.push(`<rect x="${lx - lw / 2}" y="${bottom + 2}" width="${lw}" height="20" rx="10" fill="${t.color.ink}"/><text x="${lx}" y="${mid(bottom + 12, 12)}" text-anchor="middle" style="${font};font-size:12px;font-weight:600;fill:${t.color.onAccent}">${esc(label)}</text>`);
    }
    out.push(close());
    return out.join('');
  },
} satisfies FigureType<GanttSpec>;
