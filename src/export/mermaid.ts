// 対応する組み込み型だけを変換する。変換できない図は呼び出し側で PNG にする。
import type { RawSpec } from '../types.ts';
import type { FlowSpec } from '../figures/flow.ts';
import type { BranchSpec } from '../figures/branch.ts';
import type { SequenceSpec } from '../figures/sequence.ts';
import type { StateSpec } from '../figures/state.ts';

const quote = (s: unknown) => String(s).replace(/[&"<>:;#\r\n]/g, (ch) => /[\r\n]/.test(ch) ? ' ' : `#${ch.charCodeAt(0)};`);
const label = (s: { label: string; note?: string; ref?: number }) => quote(`${s.label}${s.note ? ` / ${s.note}` : ''}${s.ref ? ` [${s.ref}]` : ''}`);

export function mermaid(spec: RawSpec): string | null {
  if (spec.type === 'flow') {
    const s = spec as FlowSpec;
    return ['flowchart LR', ...s.steps.map((x, i) => `  n${i}["${label(x)}"]`), ...s.steps.slice(1).map((_, i) => `  n${i} --> n${i + 1}`)].join('\n');
  }
  if (spec.type === 'branch') {
    const s = spec as BranchSpec;
    return ['flowchart TD', `  root{"${quote(s.condition)}"}`, ...s.cases.flatMap((x, i) => [`  n${i}["${label(x)}"]`, `  root -->|"${quote(x.when)}"| n${i}`])].join('\n');
  }
  if (spec.type === 'sequence') {
    const s = spec as SequenceSpec;
    // Mermaid の行構文を変更する文字はエンティティにする。
    const text = (v: string) => quote(v);
    return ['sequenceDiagram', ...s.actors.map((x, i) => `  participant n${i} as ${text(x)}`), ...s.messages.map((m) => `  n${s.actors.indexOf(m.from)}${m.reply ? '-->>' : '->>'}n${s.actors.indexOf(m.to)}: ${text(m.label)}`)].join('\n');
  }
  if (spec.type === 'state') {
    const s = spec as StateSpec;
    return ['stateDiagram-v2', ...s.states.map((x, i) => `  state "${quote(x)}" as n${i}`), ...s.transitions.map(([from, to, text]) => `  n${s.states.indexOf(from)} --> n${s.states.indexOf(to)}: ${quote(text)}`)].join('\n');
  }
  return null;
}
