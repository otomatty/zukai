// Lint の実行を1行ずつ記録し、ルールごとの実績を集計する。ルールを削る判断はこの数字で行う。
// 記録は ~/.zukai/logs に置く。zukai のフォルダには書き込まない。どのプロジェクトの原稿も、同じ記録に集まる。
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './config.ts';
import type { LintResult } from './lint/index.ts';

// 記録の1行。figures と free は、あとから足した項目なので、古い記録には無い。
interface Run {
  at: string;
  file: string;
  model: string | null;
  sections: number;
  figures?: Record<string, number>;
  free?: string[];
  findings: Record<string, number>;
  suppressed: Record<string, number>;
}

// ルールごとの実績。files は、発火したファイルの数。
export interface RuleStats {
  rule: string;
  fired: number;
  files: number;
  fixed: number;
  remained: number;
  suppressed: number;
}
export interface Stats {
  runs: number;
  rules: RuleStats[];
  figures: [string, number][];
  free: { file: string; title: string }[];
}

const file = path.join(homeDir(), 'logs', 'runs.jsonl');

export function record(result: LintResult, model?: string | null): void {
  const count = (list: { rule: string }[]) => list.reduce<Record<string, number>>((acc, f) => ((acc[f.rule] = (acc[f.rule] ?? 0) + 1), acc), {});
  const entry: Run = {
    at: new Date().toISOString(),
    file: path.resolve(result.file),
    model: model ?? null,
    sections: result.sections,
    figures: result.figures ?? {},
    free: result.free ?? [],
    findings: count(result.findings),
    suppressed: count(result.suppressed),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

export function stats(): Stats {
  if (!fs.existsSync(file)) return { runs: 0, rules: [], figures: [], free: [] };
  const runs = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l): Run => JSON.parse(l));

  const table: Record<string, Omit<RuleStats, 'files'> & { files: Set<string> }> = {};
  const row = (rule: string) => (table[rule] ??= { rule, fired: 0, files: new Set<string>(), fixed: 0, remained: 0, suppressed: 0 });
  const last: Record<string, Run> = {};
  for (const run of runs) {
    for (const [rule, n] of Object.entries(run.findings)) {
      row(rule).fired += n;
      row(rule).files.add(run.file);
    }
    for (const [rule, n] of Object.entries(run.suppressed)) row(rule).suppressed += n;
    // 同じファイルの直前の実行と比べる。減った件数を「修正できた」、残った件数を「残った」と数える。
    const prev = last[run.file];
    if (prev) {
      for (const [rule, n] of Object.entries(prev.findings)) {
        const now = run.findings[rule] ?? 0;
        row(rule).fixed += Math.max(0, n - now);
        row(rule).remained += Math.min(n, now);
      }
    }
    last[run.file] = run;
  }
  // 図の型の利用実績。ファイルごとに、最後の実行の内容を数える。使われない型は削る候補、同じ形の自由な図が増えたら型にする候補。
  const figures: Record<string, number> = {};
  const free: { file: string; title: string }[] = [];
  for (const run of Object.values(last)) {
    for (const [type, n] of Object.entries(run.figures ?? {})) figures[type] = (figures[type] ?? 0) + n;
    for (const title of run.free ?? []) free.push({ file: run.file, title });
  }
  const rules = Object.values(table)
    .map((r) => ({ ...r, files: r.files.size }))
    .sort((a, b) => b.fired - a.fired);
  return { runs: runs.length, rules, figures: Object.entries(figures).sort((a, b) => b[1] - a[1]), free };
}
