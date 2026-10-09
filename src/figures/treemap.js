import { px, unknownKeys } from './svg.js';
import { renderChart, layoutOf, isNumber, fmt, unitError, seriesColor } from './chart.js';

// treemap: 階層のある内訳を、面積で示す。
export default {
  name: 'treemap',
  summary: '階層のある内訳を、面積で示す',
  when: '内訳が2階層あり、項目が6個以上ある',
  example: `type: treemap
unit: 万円
groups:
  - label: 認証サービス
    items:
      - label: 実行環境
        value: 8
      - label: データベース
        value: 3
  - label: 管理画面
    items:
      - label: 実行環境
        value: 3
      - label: 配信
        value: 2`,
  fields: ['unit: 値の単位（必須）', 'groups: 上の階層の配列（必須）', 'groups[].label: 上の階層の名前（必須）', 'groups[].items[].label / value: 下の階層の名前と、0より大きい数値（必須）。上の階層の合計は自動で計算する'],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'unit', 'groups'], 'treemap'), ...unitError(spec, 'treemap')];
    if (!Array.isArray(spec.groups) || spec.groups.length < 2) return [...errors, 'treemap には groups が2つ以上必要です。階層がない内訳は stack を使います。'];
    if (spec.groups.length > limits.treemap.maxGroups) errors.push(`groups が${spec.groups.length}個あります。上限は${limits.treemap.maxGroups}個です。`);
    let count = 0;
    spec.groups.forEach((g, i) => {
      errors.push(...unknownKeys(g, ['label', 'items'], `groups[${i}]`));
      if (typeof g?.label !== 'string') errors.push(`groups[${i}] に label がありません。`);
      if (!Array.isArray(g?.items) || g.items.length === 0) return errors.push(`groups[${i}] に items がありません。`);
      count += g.items.length;
      g.items.forEach((it, j) => {
        errors.push(...unknownKeys(it, ['label', 'value'], `groups[${i}].items[${j}]`));
        if (typeof it?.label !== 'string' || !isNumber(it?.value) || it.value <= 0) errors.push(`groups[${i}].items[${j}] には label と、0より大きい value が必要です。`);
      });
    });
    if (count > limits.treemap.maxItems) errors.push(`items が合計${count}個あります。上限は${limits.treemap.maxItems}個です。`);
    return errors;
  },

  labels: (spec) => spec.groups.flatMap((g) => [g.label, ...g.items.map((it) => it.label)]),
  notes: () => [],

  // 枠が小さいと、ECharts は名前を省略するか、表示しない。読者が項目を見分けられなくなるので、収まらない項目を検査で止める。
  fit(spec, t) {
    const boxes = layoutOf(option(spec, t), t, HEIGHT);
    const out = [];
    for (const it of spec.groups.flatMap((g) => g.items)) {
      const box = boxes.find((b) => b.name === it.label && b.width !== undefined);
      const need = Math.max(px(it.label, 12), px(fmt(it.value) + spec.unit, 12)) + 8;
      if (box && (box.width < need || box.height < 42)) out.push(`「${it.label}」の枠が小さく、名前と値を表示できません。小さい項目を1つにまとめるか、bar か表にしてください。`);
    }
    return out;
  },

  render(spec, t) {
    return renderChart(option(spec, t), t, HEIGHT, spec.groups.map((g) => `${g.label} ${fmt(g.items.reduce((s, it) => s + it.value, 0))}${spec.unit}`).join('、'));
  },
};

const HEIGHT = 280;

function option(spec, t) {
  return {
    series: [{
      type: 'treemap', left: 0, right: 0, top: 0, bottom: 0, roam: false, nodeClick: false, breadcrumb: { show: false }, squareRatio: 1.2,
      label: { show: true, color: '#fff', fontSize: 12, lineHeight: 18, formatter: (p) => `${p.name}\n${fmt(p.value)}${spec.unit}` },
      upperLabel: { show: true, height: 28, color: t.color.ink, fontSize: 13, fontWeight: 700, formatter: (p) => `${p.name} ${fmt(p.value)}${spec.unit}` },
      levels: [
        { itemStyle: { borderWidth: 0, gapWidth: 10 }, upperLabel: { show: false } },
        { itemStyle: { borderColor: t.color.paper, borderWidth: 0, gapWidth: 2 } },
        { itemStyle: { borderWidth: 0, gapWidth: 0, borderRadius: 3 } },
      ],
      data: spec.groups.map((g, i) => ({ name: g.label, itemStyle: { color: seriesColor(t, i) }, children: g.items.map((it) => ({ name: it.label, value: it.value })) })),
    }],
  };
}
