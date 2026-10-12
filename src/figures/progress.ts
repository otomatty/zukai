import { px, unknownKeys } from './svg.ts';
import { renderChart, isNumber, fmt, unitError, highlight, neutral, modeGuide } from './chart.ts';
import type { FigureType } from '../types.ts';

export interface ProgressItem {
  label: string;
  value: number;
  emphasis?: boolean;
}
export interface ProgressSpec {
  type: 'progress';
  unit: string;
  max: number;
  target?: number;
  items: ProgressItem[];
}

// progress: 目標に対する達成度を、項目ごとの横棒で示す。
export default {
  name: 'progress',
  summary: '目標に対する達成度を、項目ごとの横棒で示す',
  when: '上限と目標値があり、達成度を項目ごとに示す',
  example: `type: progress
unit: "%"
max: 100
target: 80
items:
  - label: 受付
    value: 91
  - label: 照合
    value: 72
    emphasis: true`,
  fields: ['unit: 値の単位（必須）', 'max: 棒の右端にあたる上限の値（必須）', 'target: 目標値。縦線で示す（任意）', 'items[].label / items[].value: 項目の名前と、0以上 max 以下の数値（必須）', 'items[].emphasis: true にすると名前と値を太字にする（任意、図全体で1つまで）'],

  guide: (t) => modeGuide(t),

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'unit', 'max', 'target', 'items'], 'progress'), ...unitError(spec, 'progress')];
    if (!isNumber(spec.max) || spec.max <= 0) return [...errors, 'progress には max（上限の値）が必要です。'];
    // 下の forEach の中では spec.max の絞り込みが効かないので、確かめた値を取っておく。
    const max = spec.max;
    if (spec.target !== undefined && (!isNumber(spec.target) || spec.target < 0 || spec.target > spec.max)) errors.push('target は0以上 max 以下の数値にしてください。');
    if (!Array.isArray(spec.items) || spec.items.length === 0) return [...errors, 'progress には items が1つ以上必要です。'];
    if (spec.items.length > limits.progress.maxItems) errors.push(`items が${spec.items.length}個あります。上限は${limits.progress.maxItems}個です。`);
    spec.items.forEach((it, i) => {
      errors.push(...unknownKeys(it, ['label', 'value', 'emphasis'], `items[${i}]`));
      if (typeof it?.label !== 'string') errors.push(`items[${i}] に label がありません。`);
      if (!isNumber(it?.value) || it.value < 0 || it.value > max) errors.push(`items[${i}].value は0以上${max}以下の数値にしてください。`);
    });
    if (spec.items.filter((it) => it?.emphasis).length > 1) errors.push('emphasis を付けられる項目は1つまでです。');
    return errors;
  },

  labels: (spec) => spec.items.map((it) => it.label),
  notes: () => [],

  render(spec, t) {
    const left = Math.max(...spec.items.map((it) => px(it.label, 13))) + 24;
    const top = spec.target === undefined ? 6 : 30;
    return renderChart(
      {
        grid: { left, right: Math.max(...spec.items.map((it) => px(fmt(it.value) + spec.unit, 13))) + 24, top, bottom: 8 },
        xAxis: { type: 'value', min: 0, max: spec.max, show: false },
        yAxis: {
          type: 'category', inverse: true, axisLine: { show: false }, axisTick: { show: false },
          data: spec.items.map((it) => ({ value: it.label, textStyle: { fontWeight: it.emphasis ? 700 : 400 } })), axisLabel: { color: t.color.ink, fontSize: 13, margin: 14 },
        },
        series: [{
          type: 'bar', barWidth: 16, showBackground: true, backgroundStyle: { color: t.chart.track, borderRadius: [0, 4, 4, 0] },
          data: spec.items.map((it) => ({ value: it.value, label: { fontWeight: it.emphasis ? 700 : 400 }, itemStyle: { color: it.emphasis ? highlight(t) : neutral(t) ? t.chart.muted : t.color.accent, borderRadius: [0, 4, 4, 0] } })),
          ...(spec.target === undefined ? {} : { markLine: { silent: true, symbol: 'none', lineStyle: { color: t.color.ink, type: 'solid', width: 2 }, label: { formatter: `目標 ${fmt(spec.target)}${spec.unit}`, color: t.color.ink, fontSize: 12, fontWeight: 700, position: 'start', rotate: 0 }, data: [{ xAxis: spec.target }] } }),
        }, {
          // 値は右端に揃えて書く。棒の先に書くと、目標の線の近くで線と重なる。
          type: 'bar', barWidth: 16, barGap: '-100%', silent: true, itemStyle: { color: 'transparent' },
          data: spec.items.map((it) => ({ value: spec.max, label: { fontWeight: it.emphasis ? 700 : 400, formatter: fmt(it.value) + spec.unit } })),
          label: { show: true, position: 'right', distance: 10, color: t.color.ink, fontSize: 13 },
        }],
      },
      t, spec.items.length * 38 + top + 14, spec.items.map((it) => `${it.label} ${fmt(it.value)}${spec.unit}`).join('、'),
    );
  },
} satisfies FigureType<ProgressSpec>;
