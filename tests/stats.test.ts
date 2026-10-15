// node --test tests/stats.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LintResult } from '../src/lint/index.ts';

// 実績の記録（~/.zukai/logs）を、テストの中のフォルダに向ける。記録の場所は、読み込むときに決まる。
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zukai-stats-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { record, stats } = await import('../src/log.ts');

const result = (file: string, rules: string[]): LintResult => ({
  file,
  ok: !rules.length,
  sections: 1,
  figures: {},
  free: [],
  findings: rules.map((rule) => ({ rule, severity: 'error', line: 1, message: '' })),
  suppressed: [],
});

test('実績を、モデルごとに1回の実行あたりの発火で数える', () => {
  record(result('a.md', ['P001', 'P001', 'S004']), 'model-a');
  record(result('a.md', ['P001']), 'model-a');
  record(result('b.md', []), 'model-b');
  record(result('c.md', ['P002']));
  const all = stats();
  assert.equal(all.runs, 4);
  assert.deepEqual(
    all.models.map((m) => [m.model, m.runs, m.perRun]),
    [
      ['model-a', 2, { P001: 1.5, S004: 0.5 }],
      ['model-b', 1, {}],
      [null, 1, { P002: 1 }],
    ],
  );
  // モデルを指定すると、そのモデルの実行だけを数える。
  const a = stats({ model: 'model-a' });
  assert.equal(a.runs, 2);
  assert.deepEqual(a.rules.map((r) => [r.rule, r.fired, r.fixed]), [['P001', 3, 1], ['S004', 1, 1]]);
});
