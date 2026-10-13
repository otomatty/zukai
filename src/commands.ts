// コマンドの定義。help、引数の検査、README の表は、この定義から作る。
// 各コマンドの処理は、必要になってから依存を読み込む。help、setup、doctor が、依存の欠けた環境でも動くようにするため。
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { LintResult } from './lint/index.ts';
import type { SceneResult } from './video/encode.ts';

export const groups = ['はじめる', '設定', '書く', '検査と出力', '動画', '開発'] as const;
export type Group = (typeof groups)[number];

// 引数の定義。many は残りの引数をすべて受け取る。
export interface ArgDef {
  name: string;
  desc: string;
  required?: boolean;
  many?: boolean;
}
// フラグの定義。value があれば --名前=値 の形で値を取り、無ければ真偽のフラグ。hidden は help に出さない。
export interface FlagDef {
  name: string;
  desc: string;
  value?: string;
  hidden?: boolean;
}
// 各コマンドの処理に渡すもの。opt は値を取るフラグの値、has は真偽のフラグ。
export interface RunContext {
  args: string[];
  opt(name: string): string | undefined;
  has(name: string): boolean;
}
// コマンドの定義。run は終了コードを返す。返さなければ 0。
export interface Command {
  name: string;
  group: Group;
  summary: string;
  args?: ArgDef[];
  flags?: FlagDef[];
  examples?: string[];
  settings?: string[];
  related?: string[];
  run(ctx: RunContext): Promise<number | void>;
}

// 動画のガードレールの結果。シーンごとに、error と warn を出す。
function printChecks(results: SceneResult[]) {
  const all = results.flatMap((r) => r.findings.map((f) => ({ ...f, r })));
  console.log(`動画の検査  error ${all.filter((f) => f.severity === 'error').length} / warn ${all.filter((f) => f.severity === 'warn').length}`);
  for (const f of all) console.log(`  シーン${f.r.id}「${f.r.heading}」  ${f.severity.padEnd(5)}  ${f.rule}  ${f.message}`);
}

function printLint(result: LintResult) {
  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const warns = result.findings.length - errors;
  console.log(`${result.file}  ${result.ok ? 'PASS' : 'FAIL'}  error ${errors} / warn ${warns} / 抑制 ${result.suppressed.length}`);
  for (const f of result.findings) console.log(`  L${f.line}  ${f.severity.padEnd(5)}  ${f.rule}  ${f.message}`);
}

const textlintFlag: FlagDef = { name: 'no-textlint', desc: 'textlint を動かさず、自作ルールだけで検査する' };

export const commands: Command[] = [
  {
    name: 'setup',
    group: 'はじめる',
    summary: '初期設定を対話で行う。何度実行しても同じ結果になり、設定を変えるときにも使う',
    args: [{ name: 'セクション', many: true, desc: 'skills、output、video、confluence のどれか。省略するとすべて' }],
    flags: [
      { name: 'dir', value: 'フォルダ', desc: 'プロジェクトの根。省略すると、今いるフォルダから探す' },
      { name: 'yes', desc: '質問せずに、フラグと今の値だけで設定する。AI ツールから実行したとき（端末でないとき）も、質問しない' },
      { name: 'skills', value: 'project|user|none', desc: 'スキルを書く場所。user はこの PC の全プロジェクト（~/.claude/skills など）' },
      { name: 'tools', value: 'claude,agents', desc: 'スキルを書く AI ツール。claude は .claude/skills、agents は .agents/skills（Codex、Cursor など）' },
      { name: 'output', value: 'document|video', desc: '出力。video にすると動画も作る' },
      { name: 'voice', value: '名前', desc: '動画の声' },
      { name: 'style', value: '文', desc: '動画全体の語り口' },
      { name: 'bgm', value: 'ファイル', desc: 'BGM の曲のファイル' },
      { name: 'confluence-base', value: 'URL', desc: 'Confluence の URL' },
      { name: 'confluence-space', value: 'ID', desc: '初回の publish でページを作るスペースの ID' },
      { name: 'confluence-parent', value: 'ID', desc: '初回の publish でページを置く親ページの ID' },
      { name: 'scope', value: 'team|local', desc: 'チームの設定を変えるとき、チームに共有するか（team）、自分だけにするか（local）。省略すると team' },
      { name: 'lang', value: 'ja|en', desc: 'setup と doctor の表示言語。対話では最初に選ぶ。この PC の設定に書く' },
    ],
    examples: ['zukai setup', 'zukai setup video', 'zukai setup --output=video --voice=Puck --yes'],
    settings: ['output', 'video.voice', 'video.style', 'video.bgm', 'confluence.base', 'confluence.spaceId', 'confluence.parentId'],
    related: ['doctor', 'config', 'login'],
    async run({ args, opt, has }) {
      const { setup } = await import('./setup.ts');
      return setup({ sections: args, opt, has });
    },
  },
  {
    name: 'doctor',
    group: 'はじめる',
    summary: '必要なものがそろっているかを確かめ、足りないものと直すコマンドを示す',
    flags: [
      { name: 'dir', value: 'フォルダ', desc: 'プロジェクトの根。省略すると、今いるフォルダから探す' },
      { name: 'json', desc: '結果を JSON で出力する' },
    ],
    examples: ['zukai doctor'],
    related: ['setup', 'config'],
    async run({ opt, has }) {
      const { doctor, printDoctor } = await import('./doctor.ts');
      const { projectOf } = await import('./config.ts');
      // --dir で書いたフォルダはそのまま使う。上へたどるのは、--dir が無いときだけ。
      const r = await doctor(opt('dir') ? path.resolve(opt('dir')!) : projectOf(process.cwd()));
      if (has('json')) console.log(JSON.stringify(r, null, 2));
      else printDoctor(r);
      return r.ok ? 0 : 1;
    },
  },
  {
    name: 'help',
    group: 'はじめる',
    summary: 'コマンドの使い方と、設定の項目を表示する',
    args: [{ name: 'コマンド', desc: '使い方を見るコマンド' }, { name: '項目', desc: 'help config のあとに書くと、その設定の項目の詳細を表示する' }],
    examples: ['zukai help lint', 'zukai help config', 'zukai help config video.voice'],
    async run({ args }) {
      const { help } = await import('./help.ts');
      return help(args);
    },
  },
  {
    name: 'config',
    group: '設定',
    summary: '設定を表示し、変える。端末で引数なしに実行すると、対話で変えられる',
    args: [
      { name: '操作', desc: 'list（一覧）、get（1項目）、set（変える）、unset（消して既定値に戻す）' },
      { name: '項目', desc: 'video.voice のような名前。zukai help config で一覧を表示する' },
      { name: '値', desc: 'set で書く値' },
    ],
    flags: [
      { name: 'scope', value: 'team|local|user', desc: '書く場所。team は zukai.config.json（チームで共有）、local は .zukai/config.json（手元だけ）、user は ~/.zukai/config.json（この PC の全プロジェクト）。省略すると項目ごとの既定の場所' },
      { name: 'origin', desc: 'list で、値の出どころ（どのファイルか、環境変数か、既定値か）も表示する' },
      { name: 'json', desc: 'list と get の結果を JSON で出力する' },
      { name: 'dir', value: 'フォルダ', desc: 'プロジェクトの根。省略すると、今いるフォルダから探す' },
    ],
    examples: ['zukai config', 'zukai config list --origin', 'zukai config set output video', 'zukai config set output document --scope=local', 'zukai config set repos.api.path ../order-api --scope=local', 'zukai config unset video.voice'],
    related: ['setup', 'login', 'help config'],
    async run({ args, opt, has }) {
      const { config } = await import('./setup.ts');
      return config({ args, opt, has });
    },
  },
  {
    name: 'login',
    group: '設定',
    summary: 'API キーやトークンを、画面に出さずに入力させ、~/.zukai/credentials.json に保存する',
    args: [{ name: 'サービス', required: true, desc: 'gemini（動画の読み上げ）か confluence（ページの登録）' }],
    flags: [{ name: 'email', value: 'アドレス', desc: 'confluence のメールアドレス。省略すると質問する' }],
    examples: ['zukai login gemini', 'zukai login confluence'],
    settings: ['gemini.apiKey', 'confluence.email', 'confluence.token'],
    related: ['logout', 'doctor'],
    async run({ args, opt }) {
      const { login } = await import('./setup.ts');
      return login(args[0], { email: opt('email') });
    },
  },
  {
    name: 'logout',
    group: '設定',
    summary: '保存した API キーやトークンを消す',
    args: [{ name: 'サービス', required: true, desc: 'gemini か confluence' }],
    examples: ['zukai logout gemini'],
    related: ['login'],
    async run({ args }) {
      const { logout } = await import('./setup.ts');
      return logout(args[0]);
    },
  },
  {
    name: 'theme',
    group: '設定',
    summary: 'デザインのテーマ（色、フォント、描き方のルール）のフォルダを作り、確かめ、見本を描き、案を見比べる。資料からの取り込みは zukai-theme スキルが行う',
    args: [
      { name: '操作', required: true, desc: 'init（フォルダを作る）、check（値と見た目を確かめる）、preview（見本の HTML を書き出す）、compare（案を横に並べた HTML を書き出す）' },
      { name: 'フォルダと案', many: true, desc: 'テーマのフォルダ。省略すると、init はプロジェクトの根の zukai-theme、ほかは設定の theme。compare では、続けて案（emphasis.box=tint のように項目=値。複数の値は + でつなぐ）を書く' },
    ],
    flags: [
      { name: 'out', value: 'ファイル', desc: 'preview と compare の書き出す先。既定は .zukai/theme-preview.html と .zukai/theme-compare.html' },
      { name: 'types', value: '型,型...', desc: 'compare で並べる図の型。既定は flow、timeline、bar、line、stack、treemap と、テーマの独自の型' },
      { name: 'json', desc: 'check の結果を JSON で出力する' },
    ],
    examples: ['zukai theme init zukai-theme', 'zukai theme check zukai-theme', 'zukai theme preview zukai-theme', 'zukai theme compare emphasis.box=fill emphasis.box=tint', "zukai theme compare 'chart.mode=series+emphasis.chart=flat' --types=bar,stack", 'zukai config set theme zukai-theme'],
    settings: ['theme'],
    related: ['config', 'prompt'],
    async run({ args, opt, has }) {
      const { initTheme, themeReport } = await import('./theme.ts');
      const { settingsFor, projectOf, stateDir } = await import('./config.ts');
      const [action, ...rest] = args;
      // = を含むものは案、それ以外はフォルダ。
      const variants = rest.filter((a) => a.includes('='));
      const folder = rest.find((a) => !a.includes('='));
      if (variants.length && action !== 'compare') throw new Error(`案（${variants[0]}）を書けるのは compare だけです。`);
      const project = projectOf(process.cwd());
      const dir = folder ? path.resolve(folder) : action === 'init' ? path.join(project, 'zukai-theme') : settingsFor(process.cwd()).settings.theme ?? null;
      switch (action) {
        case 'init': {
          // init では、フォルダを書かなくてもプロジェクトの根の zukai-theme に決まる。
          const written = initTheme(dir!);
          if (!written.length) console.log(`${dir} には、tokens.json と rules.md がすでにあります。何も書いていません。`);
          written.forEach((f) => console.log(`${f} を書きました。`));
          console.log(`値を変えたら zukai theme check ${path.relative(process.cwd(), dir!) || '.'} で確かめ、zukai config set theme ${path.relative(process.cwd(), dir!) || '.'} で使います。`);
          return 0;
        }
        case 'check': {
          const r = await themeReport(dir);
          if (has('json')) console.log(JSON.stringify({ dir: r.dir, name: r.name, ok: r.ok, findings: r.findings }, null, 2));
          else {
            const errors = r.findings.filter((f) => f.severity === 'error').length;
            const { msg, findingLabel } = await import('./messages.ts');
            console.log(`${r.dir ? msg('theme.head', { name: r.name, dir: r.dir }) : msg('theme.none')}  ${r.ok ? 'PASS' : 'FAIL'}  error ${errors} / warn ${r.findings.length - errors}`);
            for (const f of r.findings) console.log(`  ${f.severity.padEnd(5)}  ${findingLabel(f.what)}  ${f.message}`);
          }
          return r.ok ? 0 : 1;
        }
        case 'preview': {
          const { previewTheme } = await import('./preview.ts');
          const { html, findings } = await previewTheme(dir);
          const out = opt('out') ?? path.join(stateDir(project), 'theme-preview.html');
          fs.writeFileSync(out, html);
          console.log(`${out} を書き出しました。ブラウザで開いて、元の資料と見比べます。`);
          if (findings.length) console.log(`確かめた結果  error ${findings.filter((f) => f.severity === 'error').length} / warn ${findings.filter((f) => f.severity === 'warn').length}（詳しくは zukai theme check）`);
          return 0;
        }
        case 'compare': {
          if (!variants.length) throw new Error('見比べる案を書いてください。例: zukai theme compare emphasis.box=fill emphasis.box=tint');
          const { compareThemes } = await import('./preview.ts');
          const html = await compareThemes(dir, variants, { only: opt('types')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null });
          const out = opt('out') ?? path.join(stateDir(project), 'theme-compare.html');
          fs.writeFileSync(out, html);
          console.log(`${out} を書き出しました。今のテーマと、案 ${variants.length} 個を横に並べています。`);
          return 0;
        }
        default: {
          const { closest } = await import('./config.ts');
          const near = closest(action, ['init', 'check', 'preview', 'compare']);
          throw new Error(`theme の操作「${action}」はありません。${near ? `「${near}」の書き間違いではありませんか。` : ''}init、check、preview、compare のどれかを書きます。`);
        }
      }
    },
  },
  {
    name: 'prompt',
    group: '書く',
    summary: 'AI に渡す指示を出力する。図の型は一覧だけを含む',
    flags: [
      { name: 'full', desc: 'すべての図の型の書き方を含める' },
      { name: 'video', desc: '設定の output によらず、動画の書き方を含める' },
      { name: 'type-command', value: 'コマンド', desc: '指示の中で案内する、型の書き方を取り出すコマンド。既定は zukai type' },
    ],
    examples: ['zukai prompt', 'zukai prompt --full'],
    settings: ['output', 'terms', 'theme'],
    related: ['type', 'lint', 'theme'],
    async run({ opt, has }) {
      const { settingsFor } = await import('./config.ts');
      const { buildPrompt } = await import('./prompt.ts');
      const { themeFor } = await import('./theme.ts');
      const { settings } = settingsFor(process.cwd());
      const video = has('video') || settings.output === 'video';
      process.stdout.write(buildPrompt({ full: has('full'), type: opt('type-command'), video, terms: settings.terms, voice: Boolean(settings.gemini?.apiKey), theme: themeFor(process.cwd()) }));
    },
  },
  {
    name: 'type',
    group: '書く',
    summary: '指定した図の型の書き方と上限を出力する',
    args: [{ name: '型', required: true, many: true, desc: 'flow、bar などの型の名前。zukai prompt の一覧にある' }],
    examples: ['zukai type flow bar'],
    related: ['prompt', 'icons'],
    settings: ['theme'],
    async run({ args }) {
      const { buildPrompt } = await import('./prompt.ts');
      const { themeFor } = await import('./theme.ts');
      process.stdout.write(buildPrompt({ only: args, theme: themeFor(process.cwd()) }));
    },
  },
  {
    name: 'icons',
    group: '書く',
    summary: '図に使えるアイコンの名前を探す',
    args: [{ name: '語', desc: '探す語。例: lambda' }],
    examples: ['zukai icons lambda'],
    async run({ args }) {
      const { searchIcons } = await import('./figures/icons.ts');
      const found = searchIcons(args[0] ?? '');
      console.log(found.length ? found.join('\n') : '見つかりません。別の語で探してください。');
    },
  },
  {
    name: 'capture',
    group: '書く',
    summary: '原稿の screenshot に書いた URL を撮影し、枠の位置を記録する',
    args: [{ name: 'file.md', required: true, desc: '原稿' }],
    examples: ['zukai capture 原稿.md'],
    settings: ['chromium'],
    async run({ args }) {
      const { capture } = await import('./capture.ts');
      const done = await capture(args[0]);
      if (!done.length) console.log('url のある screenshot が原稿にありません。');
      for (const r of done) {
        console.log(`${r.image} を撮影しました。`);
        for (const sel of r.missing) console.log(`  セレクタ「${sel}」の要素が画面にありません。`);
      }
      return done.some((r) => r.missing.length) ? 1 : 0;
    },
  },
  {
    name: 'lint',
    group: '検査と出力',
    summary: '原稿を検査する。error が1件でもあれば終了コード 1',
    args: [{ name: 'file.md', required: true, many: true, desc: '検査する原稿' }],
    flags: [
      { name: 'json', desc: '結果を JSON で出力する' },
      { name: 'model', value: '名前', desc: '原稿を書いたモデルの名前。実績（zukai stats）に記録する' },
      { name: 'no-log', desc: '実績に記録しない' },
      textlintFlag,
      { name: 'no-server', desc: '常駐する検査のプロセスを使わず、このプロセスだけで検査する' },
    ],
    examples: ['zukai lint 原稿.md --model=モデル名'],
    settings: ['terms', 'repos.*.path'],
    related: ['build', 'stats', 'rules'],
    async run({ args, opt, has }) {
      const { record } = await import('./log.ts');
      // 2回目からは、常駐するプロセスで検査する。textlint の辞書を読み込み直さずに済むため。使えなければ、このプロセスで検査する。
      const { lintOnServer } = await import('./lint/server.ts');
      const check = async (source: string, file: string, options: { textlint: boolean }) =>
        (has('no-server') ? null : await lintOnServer(source, file, options)) ?? (await import('./lint/index.ts')).lint(source, file, options);
      let ok = true;
      const results: LintResult[] = [];
      for (const file of args) {
        const result = await check(fs.readFileSync(file, 'utf8'), file, { textlint: !has('no-textlint') });
        if (!has('no-log')) record(result, opt('model'));
        results.push(result);
        ok &&= result.ok;
      }
      if (has('json')) console.log(JSON.stringify(results, null, 2));
      else results.forEach(printLint);
      return ok ? 0 : 1;
    },
  },
  {
    name: 'build',
    group: '検査と出力',
    summary: '原稿から、原稿を埋め込んだ1枚の HTML か、Confluence 用のフォルダを書き出す',
    args: [{ name: 'file.md', required: true, desc: '原稿' }],
    flags: [
      { name: 'out', value: 'パス', desc: '書き出す先。既定は、原稿と同じ名前の .html か .confluence フォルダ' },
      { name: 'format', value: 'confluence', desc: 'Confluence 用の本文（body.xhtml）、図の PNG、原稿をフォルダに書き出す' },
    ],
    examples: ['zukai build 原稿.md', 'zukai build 原稿.md --format=confluence'],
    settings: ['png.font'],
    related: ['publish', 'extract'],
    async run({ args, opt }) {
      const source = fs.readFileSync(args[0], 'utf8');
      const stem = args[0].replace(/\.md$/, '');
      if (opt('format') === 'confluence') {
        const { bundle } = await import('./confluence.ts');
        const dir = opt('out') ?? `${stem}.confluence`;
        const page = await bundle(source, args[0]);
        fs.mkdirSync(dir, { recursive: true });
        for (const f of page.files) fs.writeFileSync(path.join(dir, f.name), f.data);
        fs.writeFileSync(path.join(dir, 'body.xhtml'), page.body);
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ title: page.title, representation: 'storage', attachments: page.files.map((f) => f.name) }, null, 2) + '\n');
        console.log(`${dir} に、本文（body.xhtml）、図 ${page.files.length - 1} 枚、原稿を書き出しました。`);
      } else if (opt('format') !== undefined) {
        throw new Error(`--format に書けるのは confluence だけです。HTML を書き出すときは --format を付けません。`);
      } else {
        const { render } = await import('./render.ts');
        const out = opt('out') ?? `${stem}.html`;
        fs.writeFileSync(out, await render(source, args[0]));
        console.log(`${out} を書き出しました。`);
      }
    },
  },
  {
    name: 'publish',
    group: '検査と出力',
    summary: 'Lint に合格した原稿で、Confluence Cloud のページを作る。2回目以降は同じページを更新する',
    args: [{ name: 'file.md', required: true, desc: '原稿' }],
    flags: [
      { name: 'space-id', value: 'ID', desc: '初回にページを作るスペースの ID。設定の confluence.spaceId より優先する' },
      { name: 'parent-id', value: 'ID', desc: '初回にページを置く親ページの ID。設定の confluence.parentId より優先する' },
      textlintFlag,
    ],
    examples: ['zukai publish 原稿.md', 'zukai publish 原稿.md --space-id=12345'],
    settings: ['confluence.base', 'confluence.spaceId', 'confluence.parentId', 'confluence.email', 'confluence.token'],
    related: ['build', 'login'],
    // 登録できたときは何も返さず、終了コードを 0 にする。
    async run({ args, opt, has }): Promise<number | void> {
      const { lint } = await import('./lint/index.ts');
      const { publish } = await import('./confluence.ts');
      const result = await lint(fs.readFileSync(args[0], 'utf8'), args[0], { textlint: !has('no-textlint') });
      if (!result.ok) {
        printLint(result);
        console.error('error が残っているため、登録を中止しました。');
        return 1;
      }
      const r = await publish(args[0], { spaceId: opt('space-id'), parentId: opt('parent-id') });
      console.log(`ページを${r.created ? '作成' : '更新'}し、添付 ${r.attachments} 件を登録しました。`);
      if (r.created) console.log(`${args[0]} の先頭に、ページ ID ${r.pageId} を書き込みました。`);
      console.log(r.url);
    },
  },
  {
    name: 'extract',
    group: '検査と出力',
    summary: 'HTML に埋め込んだ原稿を取り出す',
    args: [{ name: 'file.html', required: true, desc: 'build で書き出した HTML' }],
    flags: [{ name: 'out', value: 'ファイル', desc: '書き出す先。既定は、HTML と同じ名前の .md' }],
    examples: ['zukai extract 資料.html'],
    related: ['build'],
    async run({ args, opt }) {
      const { extract } = await import('./render.ts');
      const source = extract(fs.readFileSync(args[0], 'utf8'));
      if (source === null) throw new Error('この HTML には原稿が埋め込まれていません。');
      const out = opt('out') ?? args[0].replace(/\.html$/, '') + '.md';
      fs.writeFileSync(out, source);
      console.log(`${out} に原稿を取り出しました。`);
    },
  },
  {
    name: 'view',
    group: '検査と出力',
    summary: '.zukai/answers の資料を読むページを起動し、URL を出力する。動いていれば URL だけを出力する',
    flags: [
      { name: 'no-open', desc: '初回にブラウザを開かない' },
      { name: 'serve', hidden: true, desc: 'ページの本体を、このプロセスで動かす' },
    ],
    examples: ['zukai view'],
    async run({ has }) {
      const view = await import('./view.ts');
      const { projectOf } = await import('./config.ts');
      const project = projectOf(process.cwd());
      if (has('serve')) {
        // ensure が切り離したプロセスで起動する本体。直接実行すると、起動のエラーを確かめられる。
        const server = await view.serve(project);
        // 127.0.0.1 のポートで待ち受けるので、address() は AddressInfo を返す。
        console.log(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      } else console.log(await view.ensure(project, { open: !has('no-open') }));
    },
  },
  {
    name: 'gui',
    group: 'はじめる',
    summary: '資料の確認と書き出し、設定、テーマ、Confluence への公開をブラウザで操作する画面を起動し、URL を出力する',
    flags: [
      { name: 'no-open', desc: 'ブラウザを開かない' },
      { name: 'serve', hidden: true, desc: '画面の本体を、このプロセスで動かす' },
    ],
    examples: ['zukai gui'],
    related: ['view', 'config', 'theme', 'publish'],
    async run({ has }) {
      const gui = await import('./gui.ts');
      const { projectOf } = await import('./config.ts');
      const project = projectOf(process.cwd());
      if (has('serve')) {
        // ensure が切り離したプロセスで起動する本体。直接実行すると、起動のエラーを確かめられる。
        const server = await gui.serve(project);
        console.log(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      } else console.log(await gui.ensure(project, { open: !has('no-open') }));
    },
  },
  {
    name: 'video',
    group: '動画',
    summary: '原稿から解説動画（MP4）を作る',
    args: [{ name: 'file.md', required: true, desc: 'ナレーションとシーンを書いた原稿' }],
    flags: [
      { name: 'out', value: 'ファイル', desc: '書き出す先。既定は、原稿と同じ名前の .mp4' },
      { name: 'draft', desc: '960×540、15fps で早く作る' },
    ],
    examples: ['zukai video 原稿.md --draft'],
    settings: ['video.model', 'video.voice', 'video.style', 'video.bgm', 'video.bgmVolume', 'video.sfx.enabled', 'video.sfx.volume', 'gemini.apiKey', 'chromium'],
    related: ['frames', 'login'],
    async run({ args, opt, has }) {
      const { makeVideo } = await import('./video/encode.ts');
      const r = await makeVideo(args[0], { out: opt('out'), draft: has('draft'), onProgress: (d, n) => process.stderr.write(`\r${d}/${n} コマ`) });
      process.stderr.write('\n');
      if (r.silentReason) console.log(`音声なしで作りました。${r.silentReason}`);
      printChecks(r.results);
      console.log(`${r.file} を書き出しました。${r.duration.toFixed(1)}秒、${r.frames}コマ、効果音のきっかけ ${r.cues} 件。`);
    },
  },
  {
    name: 'frames',
    group: '動画',
    summary: '動画のガードレールで検査し、指定した時刻のコマか、シーンごとのコマの一覧を PNG に書き出す',
    args: [{ name: 'file.md', required: true, desc: '原稿' }],
    flags: [
      { name: 'at', value: '秒,秒...', desc: 'コマを書き出す時刻' },
      { name: 'sheet', desc: 'シーンごとに6つの時刻のコマを並べた画像を書き出す' },
      { name: 'scene', value: '番号', desc: '--sheet で書き出すシーンを1つに絞る' },
    ],
    examples: ['zukai frames 原稿.md --sheet', 'zukai frames 原稿.md --at=1.5,3'],
    related: ['video'],
    async run({ args, opt, has }) {
      if (!opt('at') && !has('sheet')) throw new Error('--at=秒,秒... か --sheet のどちらかを付けてください。');
      const { frames } = await import('./video/encode.ts');
      const scene = opt('scene') === undefined ? null : Number(opt('scene'));
      const r = await frames(args[0], { times: opt('at') ? opt('at')!.split(',').map(Number) : [], sheet: has('sheet'), scene });
      if (r.silentReason) console.log(`音声なしの時間割です。${r.silentReason}`);
      console.log(`動画の長さ ${r.duration.toFixed(1)}秒`);
      for (const s of r.scenes) console.log(`  シーン${s.id}  ${s.kind.padEnd(5)}  ${s.start.toFixed(1)}〜${s.end.toFixed(1)}秒  ${s.heading}${Object.keys(s.markers).length ? `  目印 ${Object.entries(s.markers).map(([k, v]) => `${k}=${v.toFixed(2)}秒`).join(' ')}` : ''}`);
      printChecks(r.results);
      r.files.forEach((f) => console.log(f));
      return r.results.some((x) => x.findings.some((f) => f.severity === 'error')) ? 1 : 0;
    },
  },
  {
    name: 'corpus',
    group: '開発',
    summary: 'corpus/ の原稿で、期待したルールが発火するか確かめる',
    examples: ['zukai corpus'],
    async run() {
      const { lint, root } = await import('./lint/index.ts');
      const expected: Record<string, { own: string[]; textlintClean?: boolean }> = JSON.parse(fs.readFileSync(path.join(root, 'corpus/expected.json'), 'utf8'));
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
      return failed ? 1 : 0;
    },
  },
  {
    name: 'stats',
    group: '開発',
    summary: 'ルールごとの発火、修正、抑制の実績を表示する。記録は ~/.zukai/logs にある',
    examples: ['zukai stats'],
    async run() {
      const { stats } = await import('./log.ts');
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
    },
  },
  {
    name: 'rules',
    group: '開発',
    summary: '自作ルールの一覧を表示する',
    examples: ['zukai rules'],
    async run() {
      const { rules } = await import('./lint/rules.ts');
      for (const [id, r] of Object.entries(rules)) console.log(`${id}  ${r.severity.padEnd(5)}  ${r.title}  （根拠: ${r.basis}）`);
    },
  },
];

export const commandOf = (name: string): Command | null => commands.find((c) => c.name === name) ?? null;
