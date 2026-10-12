// node --test tests/imports.test.ts
// 相対パスの import が、実在するファイルを指すことを確かめる。
// tsc は「./x.js」を「./x.ts」と読み替えて通すが、Node は書いたパスのファイルをそのまま読むので、実行して初めて失敗するため。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return files(rel);
    return /\.(ts|js|mjs)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [rel] : [];
  });

test('相対パスの import は、実在するファイルを指す', () => {
  const missing: string[] = [];
  for (const file of [...files('src'), ...files('tests')]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    // from '…'、import '…'（読み込むだけ）、import('…') の、どちらの引用符でも拾う。
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
      if (!fs.existsSync(path.resolve(root, path.dirname(file), m[2]))) missing.push(`${file}: ${m[2]}`);
    }
  }
  assert.deepEqual(missing, []);
});
