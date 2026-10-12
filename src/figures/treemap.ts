import { px } from './svg.ts';
import { renderChart, layoutOf, fmt, seriesColor, neutral, mix } from './chart.ts';
import { checkSpec, contractLimits, describe } from './schema.ts';
import type { Fields, Infer } from './schema.ts';
import type { FigureType, Tokens } from '../types.ts';
import type { ChartOption } from './chart.ts';

const schema = {
  unit: { type: 'string', required: true, nonEmpty: true, desc: '値の単位' },
  groups: {
    type: 'list', required: true, min: 2, max: 'treemap.maxGroups', desc: '上の階層の配列。階層がない内訳は stack を使う',
    of: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, desc: '上の階層の名前' },
        items: {
          type: 'list', required: true, min: 1, desc: '下の階層の配列。上の階層の合計は自動で計算する',
          of: {
            type: 'object',
            fields: {
              label: { type: 'string', required: true, desc: '下の階層の名前' },
              value: { type: 'number', required: true, above: 0, desc: '数値' },
            },
          },
        },
      },
    },
  },
} as const satisfies Fields;
export type TreemapSpec = { type: 'treemap' } & Infer<typeof schema>;

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
  fields: describe(schema, contractLimits),

  validate(spec, limits) {
    const errors = checkSpec(spec, schema, 'treemap', limits);
    if (errors.length) return errors;
    // 形は上で確かめたので、ここからは検証した後の形として読む。
    const s = spec as TreemapSpec;
    const count = s.groups.reduce((n, g) => n + g.items.length, 0);
    if (count > limits.treemap.maxItems) errors.push(`items が合計${count}個あります。上限は${limits.treemap.maxItems}個です。`);
    return errors;
  },

  labels: (spec) => spec.groups.flatMap((g) => [g.label, ...g.items.map((it) => it.label)]),
  notes: () => [],

  // 枠が小さいと、ECharts は名前を省略するか、表示しない。読者が項目を見分けられなくなるので、収まらない項目を検査で止める。
  fit(spec, t) {
    // 枠は id（groups と items の番号）で引く。名前で引くと、別のグループにある同じ名前の項目（例の「実行環境」など）を取り違える。
    const boxes = layoutOf(option(spec, t, true), t, HEIGHT);
    const out: string[] = [];
    for (const [i, g] of spec.groups.entries()) for (const [j, it] of g.items.entries()) {
      const box = boxes.find((b) => b.id === idOf(i, j) && b.width !== undefined);
      const need = Math.max(px(it.label, 12), px(fmt(it.value) + spec.unit, 12)) + 8;
      // find で width があることを確かめた。width を持つ枠は、height も持つ。
      if (box && (box.width! < need || box.height! < 42)) out.push(`「${it.label}」の枠が小さく、名前と値を表示できません。小さい項目を1つにまとめるか、bar か表にしてください。`);
    }
    return out;
  },

  render(spec, t) {
    return renderChart(option(spec, t), t, HEIGHT, spec.groups.map((g) => `${g.label} ${fmt(g.items.reduce((s, it) => s + it.value, 0))}${spec.unit}`).join('、'));
  },
} satisfies FigureType<TreemapSpec>;

const HEIGHT = 280;

const idOf = (group: number, item: number) => `zk-${group}-${item}`;

// ids は、検査のために項目へ id を付けるか。描く図には付けない。
function option(spec: TreemapSpec, t: Tokens, ids = false): ChartOption {
  return {
    series: [{
      type: 'treemap', left: 0, right: 0, top: 0, bottom: 0, roam: false, nodeClick: false, breadcrumb: { show: false }, squareRatio: 1.2,
      // neutral では、塗った面の上に白抜きの文字を載せず、淡い灰色のマスに本文の色で書く。
      label: { show: true, color: neutral(t) ? t.color.ink : t.color.onAccent, fontSize: 12, lineHeight: 18, formatter: (p) => `${p.name}\n${fmt(p.value as number)}${spec.unit}` },
      upperLabel: { show: true, height: 28, color: t.color.ink, fontSize: 13, fontWeight: 700, formatter: (p) => `${p.name} ${fmt(p.value as number)}${spec.unit}` },
      levels: [
        { itemStyle: { borderWidth: 0, gapWidth: 10 }, upperLabel: { show: false } },
        { itemStyle: { borderColor: t.color.paper, borderWidth: 0, gapWidth: 2 } },
        { itemStyle: { borderWidth: 0, gapWidth: 0, borderRadius: 3 } },
      ],
      data: spec.groups.map((g, i) => ({ name: g.label, itemStyle: { color: neutral(t) ? mix(t.chart.muted, t.color.paper, [0.72, 0.8, 0.86][i % 3]) : seriesColor(t, i) }, children: g.items.map((it, j) => ({ name: it.label, value: it.value, ...(ids ? { id: idOf(i, j) } : {}) })) })),
    }],
  };
}
