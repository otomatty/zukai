// node --test tests/prompt.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, videoParts } from '../src/prompt.ts';
import { readTheme } from '../src/theme.ts';

test('動画の書き方は、効果音と検査の一覧を、あとから取り出す部分に分ける', () => {
  const guide = buildPrompt({ video: true });
  assert.match(guide, /# 動画の書き方/);
  assert.doesNotMatch(guide, /\{\{\w+\}\}/);
  // 本体には、取り出し方だけを書く。
  assert.match(guide, /zukai prompt --part=sound/);
  assert.doesNotMatch(guide, /ZzFX の数値は、次の順に21個まで/);
  assert.doesNotMatch(guide, /\| V301 \|/);
  for (const name of Object.keys(videoParts)) assert.doesNotMatch(buildPrompt({ part: [name] }), /\{\{\w+\}\}/);
  assert.match(buildPrompt({ part: ['sound'] }), /ZzFX の数値は、次の順に21個まで/);
  assert.match(buildPrompt({ part: ['checks'] }), /\| V301 \|/);
  assert.match(buildPrompt({ part: ['nothing'] }), /取り出せるのは sound、checks です/);
});

test('テーマが動画の絵柄を決めていれば、既定の絵柄を指示に入れない', () => {
  const base = readTheme(null);
  assert.match(buildPrompt({ video: true, theme: base }), /### 絵柄/);
  // 「## 動画」が見出しとコメントだけなら、決めていないものとして既定の絵柄を入れる。
  const empty = { ...base, name: 'brand', rules: '# brand\n\n## 動画\n\n<!-- 例 -->\n' };
  assert.match(buildPrompt({ video: true, theme: empty }), /### 絵柄/);
  const themed = { ...base, name: 'brand', rules: '# brand\n\n## 動画\n\n背景は白地にし、キャラクターは描かない。\n' };
  const guide = buildPrompt({ video: true, theme: themed });
  assert.doesNotMatch(guide, /### 絵柄/);
  assert.match(guide, /背景は白地にし、キャラクターは描かない。/);
});
