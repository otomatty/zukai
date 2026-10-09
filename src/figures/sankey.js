import { px, unknownKeys } from './svg.js';
import { renderChart, isNumber, fmt, unitError, seriesColor } from './chart.js';

const nodesOf = (spec) => [...new Set(spec.links.flatMap((l) => [l[0], l[1]]))];

// sankey: 全体の量が枝分かれしていく様子を、帯の太さで示す。
export default {
  name: 'sankey',
  summary: '全体の量が枝分かれしていく様子を、帯の太さで示す',
  when: '全体の量が、段階ごとに枝分かれして減っていく',
  example: `type: sankey
unit: 件
links:
  - [ログイン要求, 照合に成功, 880]
  - [ログイン要求, 照合に失敗, 120]
  - [照合に成功, セッション発行, 850]
  - [照合に成功, 途中で離脱, 30]`,
  fields: ['unit: 値の単位（必須）', 'links: [流れの元, 流れの先, 量] の配列（必須）。元に戻る流れは書けない'],

  validate(spec, limits) {
    const errors = [...unknownKeys(spec, ['type', 'unit', 'links'], 'sankey'), ...unitError(spec, 'sankey')];
    if (!Array.isArray(spec.links) || spec.links.length < 2) return [...errors, 'sankey には links が2つ以上必要です。'];
    if (!spec.links.every((l) => Array.isArray(l) && l.length === 3 && typeof l[0] === 'string' && typeof l[1] === 'string' && isNumber(l[2]) && l[2] > 0)) {
      return [...errors, 'links は [流れの元, 流れの先, 0より大きい量] の組にしてください。'];
    }
    if (spec.links.length > limits.sankey.maxLinks) errors.push(`links が${spec.links.length}本あります。上限は${limits.sankey.maxLinks}本です。`);
    const nodes = nodesOf(spec);
    if (nodes.length > limits.sankey.maxNodes) errors.push(`箱が${nodes.length}個あります。上限は${limits.sankey.maxNodes}個です。`);
    // 元に戻る流れがあると描けない。行き先をたどって確かめる。
    const next = (n) => spec.links.filter((l) => l[0] === n).map((l) => l[1]);
    const loops = (n, seen) => seen.includes(n) || next(n).some((m) => loops(m, [...seen, n]));
    if (nodes.some((n) => loops(n, []))) errors.push('元の箱に戻る流れがあります。sankey は一方向の流れだけを描けます。');
    return errors;
  },

  labels: nodesOf,
  notes: () => [],

  render(spec, t) {
    const nodes = nodesOf(spec);
    const incoming = (n) => spec.links.filter((l) => l[1] === n);
    const total = (n) => Math.max(incoming(n).reduce((s, l) => s + l[2], 0), spec.links.filter((l) => l[0] === n).reduce((s, l) => s + l[2], 0));
    // 色は、最初の枝分かれのどれに属するかで決める。始まりの箱は灰色にする。
    const roots = nodes.filter((n) => incoming(n).length === 0);
    const firsts = [...new Set(spec.links.filter((l) => roots.includes(l[0])).map((l) => l[1]))];
    const branch = (n) => (roots.includes(n) ? -1 : firsts.includes(n) ? firsts.indexOf(n) : branch(incoming(n)[0][0]));
    const name = (n) => `${n} ${fmt(total(n))}${spec.unit}`;
    const ends = nodes.filter((n) => !spec.links.some((l) => l[0] === n));
    return renderChart(
      {
        series: [{
          type: 'sankey', left: 4, right: Math.max(...ends.map((n) => px(name(n), 12))) + 16, top: 10, bottom: 10, nodeWidth: 14, nodeGap: 16, draggable: false,
          label: { color: t.color.ink, fontSize: 12, formatter: (p) => name(p.name) },
          lineStyle: { color: 'source', opacity: 0.25, curveness: 0.5 },
          data: nodes.map((n) => ({ name: n, itemStyle: { color: branch(n) < 0 ? t.color.sub : seriesColor(t, branch(n)), borderRadius: 2 } })),
          links: spec.links.map(([source, target, value]) => ({ source, target, value })),
        }],
      },
      t, Math.max(220, ends.length * 44 + 60), spec.links.map((l) => `${l[0]}から${l[1]}へ${fmt(l[2])}${spec.unit}`).join('、'),
    );
  },
};
