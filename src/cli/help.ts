// help の表示。コマンドの定義（commands.ts）と、設定の仕様（contract/settings.json）から作る。
import { commands, commandOf, groups } from './commands.ts';
import { spec, specOf, scopeNames, loadConfig, projectOf, display, closest, pad } from '../config.ts';
import type { Config } from '../config.ts';
import type { Command } from './commands.ts';
import type { SettingSpec } from '../types.ts';


export const usageLine = (c: Command): string => {
  const args = (c.args ?? []).map((a) => {
    const name = `<${a.name}${a.many ? '...' : ''}>`;
    return a.required ? name : `[${name}]`;
  });
  return ['zukai', c.name, ...args, ...((c.flags ?? []).some((f) => !f.hidden) ? ['[オプション]'] : [])].join(' ');
};

export function overview(): string {
  const lines = ['zukai  図が主役の日本語資料を AI に書かせ、AI を使わない Lint で検査する', ''];
  for (const g of groups) {
    lines.push(g);
    for (const c of commands.filter((x) => x.group === g)) lines.push(`  ${pad(c.name, 10)}${c.summary}`);
    lines.push('');
  }
  lines.push('最初は zukai setup を実行します。', 'コマンドの詳しい使い方は zukai help <コマンド>、設定の項目は zukai help config で表示します。');
  return lines.join('\n');
}

// 関係する設定の今の値。プロジェクトの設定を読めないとき（誤りがあるときなど）は、値を出さない。
function currentValues(keys: string[]): string[] {
  let cfg: Config | null = null;
  try {
    cfg = loadConfig(projectOf(process.cwd()));
  } catch {
    // 値を出せないだけなので、help は続ける。
  }
  return keys.map((k) => {
    const s = specOf(k) ?? spec[k];
    const now = cfg && !k.includes('*') ? `  今の値: ${display(k, cfg.values[k])}（${scopeNames[cfg.origins[k]] ?? '未設定'}）` : '';
    return `  ${pad(k, 22)}${s?.description ?? ''}${now}`;
  });
}

export function commandHelp(c: Command): string {
  const lines = [usageLine(c), '', c.summary];
  if (c.args?.length) {
    lines.push('', '引数');
    for (const a of c.args) lines.push(`  ${pad(`<${a.name}${a.many ? '...' : ''}>`, 26)}${a.desc}${a.required ? '' : '（省略できる）'}`);
  }
  const flags = (c.flags ?? []).filter((f) => !f.hidden);
  if (flags.length) {
    lines.push('', 'オプション');
    for (const f of flags) lines.push(`  ${pad(`--${f.name}${f.value ? `=${f.value}` : ''}`, 26)}${f.desc}`);
  }
  if (c.examples?.length) lines.push('', '例', ...c.examples.map((e) => `  ${e}`));
  if (c.settings?.length) lines.push('', '関係する設定（zukai help config <項目> で詳細）', ...currentValues(c.settings));
  if (c.related?.length) lines.push('', `関係するコマンド  ${c.related.join('、')}`);
  return lines.join('\n');
}

const typeLabel = (s: SettingSpec) =>
  ({
    enum: s.values?.join(' | '),
    string: '文字列',
    path: 'ファイルのパス',
    url: 'URL',
    number: s.min !== undefined ? `数値（${s.min}〜${s.max}）` : '数値',
    boolean: 'true | false',
    terms: '用語の配列（JSON）',
  })[s.type] ?? s.type;

export function configHelp(): string {
  const lines = [
    '設定の置き場所（下ほど優先する）',
    `  ${pad('この PC', 10)}${pad('~/.zukai/config.json', 28)}この PC の全プロジェクト`,
    `  ${pad('チーム', 10)}${pad('zukai.config.json', 28)}コミットしてチームで共有する`,
    `  ${pad('手元', 10)}${pad('.zukai/config.json', 28)}この PC のこのプロジェクトだけ。Git の管理に入らない`,
    `  ${pad('本人だけ', 10)}${pad('~/.zukai/credentials.json', 28)}キーとトークン。zukai login で保存する`,
    `  ${pad('環境変数', 10)}${pad('項目ごとに決まった名前', 28)}zukai help config <項目> で確かめる`,
    '',
    '設定ファイルには変えた値だけを書きます。書いていない項目は既定値になります。',
    '値の変え方: zukai config set <項目> <値> [--scope=team|local|user]。対話で変えるときは zukai config。',
  ];
  for (const g of [...new Set(Object.values(spec).map((s) => s.group))]) {
    lines.push('', g);
    for (const [name, s] of Object.entries(spec).filter(([, s]) => s.group === g)) lines.push(`  ${pad(name, 22)}${s.description}`);
  }
  lines.push('', '項目の詳細（型、既定値、書ける場所、環境変数、今の値）は zukai help config <項目> で表示します。');
  return lines.join('\n');
}

export function itemHelp(key: string): { ok: boolean; text: string } {
  const s = specOf(key);
  if (!s) {
    const near = closest(key, Object.keys(spec));
    return { ok: false, text: `項目「${key}」はありません。${near ? `「${near}」の書き間違いではありませんか。` : ''}項目の一覧は zukai help config で表示します。` };
  }
  const lines = [key, '', s.description, '', `  ${pad('型', 12)}${typeLabel(s)}`];
  if (s.labels) lines.push(`  ${pad('値の意味', 12)}${Object.entries(s.labels).map(([k, v]) => `${k}=${v}`).join('、')}`);
  if (s.suggest) lines.push(`  ${pad('候補', 12)}${s.suggest.join('、')}`);
  if ('default' in s) lines.push(`  ${pad('既定値', 12)}${display(key, s.default)}`);
  lines.push(`  ${pad('書ける場所', 12)}${s.scopes.map((x) => scopeNames[x]).join('、')}（省略したときは${scopeNames[s.scopes[0]]}）`);
  if (s.env) lines.push(`  ${pad('環境変数', 12)}${s.env}`);
  if (s.type === 'path') lines.push(`  ${pad('相対パス', 12)}チームと手元はプロジェクトの根から、この PC は ~/.zukai から解決する`);
  try {
    const cfg = loadConfig(projectOf(process.cwd()));
    if (!key.includes('*')) lines.push(`  ${pad('今の値', 12)}${display(key, cfg.values[key])}（${scopeNames[cfg.origins[key]] ?? '未設定'}）`);
  } catch {
    // 今の値を出せないだけなので、続ける。
  }
  if (s.secret) lines.push('', `秘密の値です。zukai login ${key.split('.')[0]} で保存します。設定ファイルには書けません。`);
  else lines.push('', `例: zukai config set ${key.replace('*', '名前')} ${s.type === 'enum' ? s.values!.at(-1) : s.suggest?.[1] ?? '値'}`);
  return { ok: true, text: lines.join('\n') };
}

// zukai help [コマンド] [項目]
export function help(args: string[]): number {
  const [name, item] = args;
  if (!name) return console.log(overview()), 0;
  if (name === 'config' && item) {
    const r = itemHelp(item);
    (r.ok ? console.log : console.error)(r.text);
    return r.ok ? 0 : 1;
  }
  const c = commandOf(name);
  if (!c) {
    console.error(unknownCommand(name));
    return 1;
  }
  console.log(commandHelp(c));
  if (name === 'config') console.log(`\n${configHelp()}`);
  return 0;
}

export function unknownCommand(name: string): string {
  const near = closest(name, commands.map((c) => c.name));
  return `コマンド「${name}」はありません。${near ? `「${near}」の書き間違いではありませんか。` : ''}コマンドの一覧は zukai help で表示します。`;
}
