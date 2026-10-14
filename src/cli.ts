#!/usr/bin/env node
// コマンドの入口。引数を定義（commands.ts）で検査してから、各コマンドの処理を呼ぶ。
// ここでは重い依存を読み込まない。help、setup、doctor が、依存の欠けた環境でも動くようにするため。
import { enableCompileCache } from 'node:module';
import { commandOf } from './commands.ts';
import type { Command } from './commands.ts';
import { closest } from './config.ts';

// 読み込んだコードのコンパイル結果を、OS の一時フォルダに保存して使い回す。2回目からの起動が速くなる。
// 重い依存は、各コマンドが後から読むので、ここで有効にすれば間に合う。場所は環境変数 NODE_COMPILE_CACHE で変えられる。
enableCompileCache();

// --名前=値 はオプション、--名前 は真偽のフラグ、それ以外は引数。-h は --help と同じ。
interface Parsed {
  opts: Map<string, string>;
  bools: Set<string>;
  args: string[];
}
function parseArgs(argv: string[]): Parsed {
  const opts = new Map<string, string>();
  const bools = new Set<string>();
  const args: string[] = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const i = a.indexOf('=');
      if (i > 0) opts.set(a.slice(2, i), a.slice(i + 1));
      else bools.add(a.slice(2));
    } else if (a === '-h') bools.add('help');
    else args.push(a);
  }
  return { opts, bools, args };
}

// 定義に無いフラグ、値の要るフラグに値が無いもの、引数の過不足を知らせる。
function checkArgs(c: Command, { opts, bools, args }: Parsed): string | null {
  const flags = c.flags ?? [];
  const names = flags.map((f) => f.name);
  const see = `使い方は zukai help ${c.name} で表示します。`;
  for (const name of [...opts.keys(), ...bools]) {
    const f = flags.find((x) => x.name === name);
    if (!f) {
      const near = closest(name, names);
      return `${c.name} に --${name} はありません。${near ? `--${near} の書き間違いではありませんか。` : ''}${see}`;
    }
    if (f.value && !opts.has(name)) return `--${name} には値が必要です。--${name}=${f.value} の形で書きます。${see}`;
    if (!f.value && opts.has(name)) return `--${name} は値を取りません。--${name} とだけ書きます。${see}`;
  }
  const spec = c.args ?? [];
  const required = spec.filter((a) => a.required).length;
  const max = spec.some((a) => a.many) ? Infinity : spec.length;
  if (args.length < required) return `${c.name} には <${spec.filter((a) => a.required).map((a) => a.name).join('> <')}> が必要です。${see}`;
  if (args.length > max) return `${c.name} の引数が多すぎます（${args.slice(max).join(' ')}）。${see}`;
  return null;
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h') return (await import('./help.ts')).help([]);
  if (name === '--version' || name === '-v') {
    const { root } = await import('./config.ts');
    const fs = await import('node:fs');
    console.log(JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8')).version);
    return 0;
  }
  const c = commandOf(name);
  if (!c) {
    console.error((await import('./help.ts')).unknownCommand(name));
    return 1;
  }
  const parsed = parseArgs(rest);
  if (parsed.bools.has('help')) return (await import('./help.ts')).help([name]);
  const bad = checkArgs(c, parsed);
  if (bad) {
    console.error(bad);
    return 1;
  }
  const code = await c.run({ args: parsed.args, opt: (n) => parsed.opts.get(n), has: (n) => parsed.bools.has(n) });
  return code ?? 0;
}

// 想定したエラーは、スタックトレースを出さずに文だけを出す。ZUKAI_DEBUG=1 のときはスタックトレースも出す。
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (caught) {
  // 投げられるのは Error だけとみなす。
  const e = caught as NodeJS.ErrnoException;
  if (e?.name === 'ExitPromptError') {
    console.error('\n中断しました。何も書き込んでいません。');
    process.exitCode = 130;
  } else if (e?.code === 'ERR_MODULE_NOT_FOUND' && !process.env.ZUKAI_DEBUG) {
    // 依存パッケージが足りない。doctor は依存なしで動くので、そちらへ案内する。
    console.error(`${e.message}\n依存パッケージが足りません。zukai doctor で足りないものと直し方を確かめられます。`);
    process.exitCode = 1;
  } else {
    console.error(process.env.ZUKAI_DEBUG ? e.stack : e.message);
    process.exitCode = 1;
  }
}
