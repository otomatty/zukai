// チャットの返答に書かれた図を描く。資料と違い、返答は検査せずに、描ける図だけを描く。
// 返答を表示する側（mod、VS Code）は、行の範囲で返答を切り分け、図のブロックを描いた図に置き換える。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parse } from './parse.js';
import { types } from './figures/index.js';
import { readJson } from './lint/index.js';
import { toPng, pngFont } from './png.js';

const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// 図ごとに、返答の中の行の範囲（0始まり、end は含まない）と SVG を返す。描けない図は error を持つ。
export function figuresOf(text, baseDir) {
  const tokens = readJson('contract/tokens.json');
  const limits = readJson('contract/limits.json');
  const ctx = { baseDir };
  const doc = parse(text);
  return [...doc.lead, ...doc.sections.flatMap((s) => s.blocks)]
    .filter((b) => b.kind === 'figure')
    .map((b) => {
      const at = { start: b.line - 1, end: b.endLine };
      // 型の名前は types 自身のキーだけを受け付ける。constructor のような継承した名前を型として使わない。
      const name = b.spec?.type;
      const type = typeof name === 'string' && Object.hasOwn(types, name) ? types[name] : undefined;
      if (b.parseError) return { ...at, error: `YAML を読めません。${b.parseError}` };
      if (!type) return { ...at, error: `type「${b.spec?.type}」は使えません。` };
      // 返答の screenshot は、作業フォルダの中の画像だけを読む。返答に書かれたパスから、ほかの場所の画像を表示しない。
      if (b.spec.type === 'screenshot') {
        const rel = path.relative(baseDir, path.resolve(baseDir, String(b.spec.image)));
        if (rel.startsWith('..') || path.isAbsolute(rel)) return { ...at, error: `画像「${b.spec.image}」は作業フォルダの外にあります。` };
      }
      const errors = type.validate(b.spec, limits, ctx);
      if (errors.length) return { ...at, error: errors.join(' ') };
      const svg = type.render(b.spec, tokens, ctx);
      const label = svg.match(/aria-label="([^"]*)"/)?.[1];
      const alt = (b.spec.type === 'free' ? types.free.title(b.spec) : label && unesc(label)) || `${b.spec.type} の図`;
      return { ...at, type: name, alt, svg };
    });
}

// PNG を一時フォルダに書き出す。名前は SVG の内容とフォントから決めるので、同じ図は2回書かない。
export function writePngs(figures, dir = path.join(os.tmpdir(), 'zukai-figures')) {
  fs.mkdirSync(dir, { recursive: true });
  return figures.map((f) => {
    if (!f.svg) return f;
    const file = path.join(dir, `${crypto.createHash('sha256').update(`${pngFont()}\0${f.svg}`).digest('hex').slice(0, 16)}.png`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, toPng(f.svg).data);
    // 幅と高さは、PNG の先頭（IHDR）から読む。
    const head = fs.readFileSync(file).subarray(16, 24);
    return { ...f, png: file, width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
  });
}

// エディタのタブで開く。Cursor も `code` を入れるので、既定は code。変えたいときは環境変数 ZUKAI_EDITOR で指定する。
export function openInEditor(files) {
  const editor = process.env.ZUKAI_EDITOR ?? 'code';
  // Windows の code は .cmd なので、シェル経由で起動する。パスは一時フォルダの中の16進の名前なので、引用符で囲めば足りる。
  const r =
    process.platform === 'win32'
      ? spawnSync(`${editor} -r ${files.map((f) => `"${f}"`).join(' ')}`, { shell: true, stdio: 'ignore' })
      : spawnSync(editor, ['-r', ...files], { stdio: 'ignore' });
  if (r.error || r.status !== 0) throw new Error(`${editor} で図を開けませんでした。環境変数 ZUKAI_EDITOR にエディタのコマンドを指定してください。`);
}
