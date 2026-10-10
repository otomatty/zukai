#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { lint, root } from './lint/index.js';
import { rules } from './lint/rules.js';
import { render, extract } from './render.js';
import { bundle, publish } from './confluence.js';
import { buildPrompt } from './prompt.js';
import { record, stats } from './log.js';
import { searchIcons } from './figures/icons.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--') && !a.includes('=')));
const opt = (name) => rest.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const files = rest.filter((a) => !a.startsWith('--'));

const usage = `使い方:
  zukai prompt [--full]                AI に渡す指示を出力する。図の型は一覧だけを含む（--full ですべての書き方を含む）
  zukai prompt --chat [--type-command=コマンド]  チャットの返答の書き方を出力する
  zukai type <型...>                   指定した型の書き方と上限を出力する
  zukai figures [--png] [--open] < 返答.md  返答の図を描き、JSON で出力する（--png で PNG も書き出す、--open でエディタのタブに開く）
  zukai lint <file.md...> [--json] [--model=名前] [--no-log] [--no-textlint]
  zukai build <file.md> [--out=file.html]                       1枚の HTML を書き出す（原稿を中に埋め込む）
  zukai build <file.md> --format=confluence [--out=フォルダ]     Confluence 用の本文、図の PNG、原稿をフォルダに書き出す
  zukai publish <file.md> [--space-id=ID] [--parent-id=ID]      Confluence Cloud にページを作成または更新する
  zukai capture <file.md>                                       原稿の screenshot の URL を撮影し、枠の位置を記録する
  zukai extract <file.html> [--out=file.md]                     HTML に埋め込んだ原稿を取り出す
  zukai corpus                         corpus/ の原稿で、期待したルールが発火するか確認する
  zukai stats                          ルールごとの発火・修正・抑制の実績を表示する
  zukai rules                          自作ルールの一覧を表示する
  zukai icons [語]                     図に使えるアイコンの名前を探す`;

function print(result) {
  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const warns = result.findings.length - errors;
  console.log(`${result.file}  ${result.ok ? 'PASS' : 'FAIL'}  error ${errors} / warn ${warns} / 抑制 ${result.suppressed.length}`);
  for (const f of result.findings) console.log(`  L${f.line}  ${f.severity.padEnd(5)}  ${f.rule}  ${f.message}`);
}

if (cmd === 'prompt') {
  process.stdout.write(buildPrompt({ full: flags.has('--full'), chat: flags.has('--chat'), type: opt('type-command') }));
} else if (cmd === 'figures') {
  // チャットの返答を標準入力から読み、図を描いて JSON で返す。mod と VS Code の表示が使う。
  const { figuresOf, writePngs, openInEditor } = await import('./chat.js');
  let figures = figuresOf(fs.readFileSync(0, 'utf8'), process.cwd());
  // PNG を書き出したときは SVG を出力しない。screenshot の SVG は画像を埋め込むので大きく、mod が読める出力の上限を超えるため。
  if (flags.has('--png') || flags.has('--open')) figures = writePngs(figures).map(({ svg, ...f }) => f);
  if (flags.has('--open')) {
    const pngs = figures.filter((f) => f.png).map((f) => f.png);
    try {
      if (pngs.length) openInEditor(pngs);
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(figures));
} else if (cmd === 'type' && files.length) {
  process.stdout.write(buildPrompt({ only: files }));
} else if (cmd === 'lint' && files.length) {
  let ok = true;
  const results = [];
  for (const file of files) {
    const result = await lint(fs.readFileSync(file, 'utf8'), file, { textlint: !flags.has('--no-textlint') });
    if (!flags.has('--no-log')) record(result, opt('model'));
    results.push(result);
    ok &&= result.ok;
  }
  if (flags.has('--json')) console.log(JSON.stringify(results, null, 2));
  else results.forEach(print);
  process.exit(ok ? 0 : 1);
} else if (cmd === 'build' && files.length === 1) {
  const source = fs.readFileSync(files[0], 'utf8');
  const stem = files[0].replace(/\.md$/, '');
  if (opt('format') === 'confluence') {
    const dir = opt('out') ?? `${stem}.confluence`;
    const page = await bundle(source, files[0]);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of page.files) fs.writeFileSync(path.join(dir, f.name), f.data);
    fs.writeFileSync(path.join(dir, 'body.xhtml'), page.body);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ title: page.title, representation: 'storage', attachments: page.files.map((f) => f.name) }, null, 2) + '\n');
    console.log(`${dir} に、本文（body.xhtml）、図 ${page.files.length - 1} 枚、原稿を書き出しました。`);
  } else {
    const out = opt('out') ?? `${stem}.html`;
    fs.writeFileSync(out, await render(source, files[0]));
    console.log(`${out} を書き出しました。`);
  }
} else if (cmd === 'publish' && files.length === 1) {
  // Lint に合格した原稿だけを登録する。
  const result = await lint(fs.readFileSync(files[0], 'utf8'), files[0], { textlint: !flags.has('--no-textlint') });
  if (!result.ok) {
    print(result);
    console.error('error が残っているため、登録を中止しました。');
    process.exit(1);
  }
  try {
    const r = await publish(files[0], { spaceId: opt('space-id'), parentId: opt('parent-id') });
    console.log(`ページを${r.created ? '作成' : '更新'}し、添付 ${r.attachments} 件を登録しました。`);
    if (r.created) console.log(`${files[0]} の先頭に、ページ ID ${r.pageId} を書き込みました。`);
    console.log(r.url);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
} else if (cmd === 'capture' && files.length === 1) {
  // 原稿の screenshot に書かれた URL を撮影し、枠の位置を記録する。
  try {
    const { capture } = await import('./capture.js');
    const done = await capture(files[0]);
    if (!done.length) console.log('url のある screenshot が原稿にありません。');
    for (const r of done) {
      console.log(`${r.image} を撮影しました。`);
      for (const sel of r.missing) console.log(`  セレクタ「${sel}」の要素が画面にありません。`);
    }
    process.exit(done.some((r) => r.missing.length) ? 1 : 0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
} else if (cmd === 'extract' && files.length === 1) {
  const source = extract(fs.readFileSync(files[0], 'utf8'));
  if (source === null) {
    console.error('この HTML には原稿が埋め込まれていません。');
    process.exit(1);
  }
  const out = opt('out') ?? files[0].replace(/\.html$/, '') + '.md';
  fs.writeFileSync(out, source);
  console.log(`${out} に原稿を取り出しました。`);
} else if (cmd === 'corpus') {
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'corpus/expected.json'), 'utf8'));
  let failed = 0;
  for (const [rel, want] of Object.entries(expected)) {
    const file = path.join(root, 'corpus', rel);
    const result = await lint(fs.readFileSync(file, 'utf8'), file);
    // 自作ルールは、発火したルールの集合が期待と一致すること。textlintClean の原稿は、textlint の error も0件であること。
    const own = [...new Set(result.findings.filter((f) => !f.rule.startsWith('T:')).map((f) => f.rule))].sort();
    const textlintErrors = want.textlintClean ? result.findings.filter((f) => f.rule.startsWith('T:') && f.severity === 'error') : [];
    const same = JSON.stringify(own) === JSON.stringify([...want.own].sort()) && textlintErrors.length === 0;
    if (!same) failed++;
    console.log(`${same ? 'ok  ' : 'NG  '} ${rel}  期待 [${want.own.join(', ')}]  実際 [${own.join(', ')}]`);
    textlintErrors.forEach((f) => console.log(`       L${f.line} ${f.rule} ${f.message}`));
  }
  console.log(failed ? `${failed}件が期待と違います。` : 'すべて期待どおりです。');
  process.exit(failed ? 1 : 0);
} else if (cmd === 'stats') {
  const s = stats();
  console.log(`実行 ${s.runs} 回`);
  console.log('ルール                発火  ファイル  修正  残存  抑制');
  for (const r of s.rules) {
    console.log(`${r.rule.padEnd(20)} ${String(r.fired).padStart(5)} ${String(r.files).padStart(8)} ${String(r.fixed).padStart(5)} ${String(r.remained).padStart(5)} ${String(r.suppressed).padStart(5)}`);
  }
  if (s.figures.length) {
    console.log('\n図の型の利用（ファイルごとに、最後の実行の内容を数えています）');
    for (const [type, n] of s.figures) console.log(`${type.padEnd(12)} ${String(n).padStart(4)}`);
  }
  if (s.free.length) {
    console.log('\n自由な図の題名（同じ形が増えたら、型にする候補です）');
    for (const f of s.free) console.log(`${f.file}  ${f.title}`);
  }
} else if (cmd === 'icons') {
  // アイコンの名前を探す。例: zukai icons lambda
  const found = searchIcons(files[0] ?? '');
  console.log(found.length ? found.join('\n') : '見つかりません。別の語で探してください。');
} else if (cmd === 'rules') {
  for (const [id, r] of Object.entries(rules)) console.log(`${id}  ${r.severity.padEnd(5)}  ${r.title}  （根拠: ${r.basis}）`);
} else {
  console.log(usage);
  process.exit(cmd ? 1 : 0);
}
