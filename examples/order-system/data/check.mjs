// 資料の図に書いた数値が、CSV の集計と一致するかを確かめる。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

const dir = path.dirname(new URL(import.meta.url).pathname);
const want = JSON.parse(execFileSync('node', [path.join(dir, 'summarize.mjs')], { encoding: 'utf8' }));
const md = fs.readFileSync(path.join(dir, '../monthly-report.md'), 'utf8');
const figs = Object.fromEntries([...md.matchAll(/```yaml figure\n([\s\S]*?)```/g)].map((m) => YAML.parse(m[1])).map((f) => [f.type, f]));
const same = (name, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? 'ok  ' : 'NG  '} ${name}`);
  if (!ok) process.exitCode = 1;
};
same('line', figs.line.series[0].values, want.monthly.注文作成);
same('heatmap', figs.heatmap.values, want.heatmap.values);
same('progress', Object.fromEntries(figs.progress.items.map((i) => [i.label, i.value]).sort()), Object.fromEntries(Object.entries(want.slo).sort()));
same('boxplot', Object.fromEntries(figs.boxplot.items.map((i) => [i.label, i.values]).sort()), Object.fromEntries(Object.entries(want.latency).sort()));
same('sankey', figs.sankey.links, want.funnel);
same('stack', figs.stack.items.map((i) => [i.label, i.value]), want.errors.内訳.map(([l, v]) => [l, v]));
const cost = Object.values(want.cost).flatMap((g) => g.項目);
const small = cost.filter(([, v]) => v < 3);
const merged = [...cost.filter(([, v]) => v >= 3).sort((a, b) => b[1] - a[1]), ['その他', Math.round(small.reduce((s, [, v]) => s + v, 0) * 10) / 10]];
same('bar', figs.bar.items.map((i) => [i.label, i.value]), merged);
