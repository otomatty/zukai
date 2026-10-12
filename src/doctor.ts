// 必要なものがそろっているかを確かめる。足りないものには、直すためのコマンドを添える。
// 依存が欠けていても動くよう、確かめる対象は必要になってから読み込む。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, loadConfig } from './config.ts';
import { zukaiCommand, skillStatus, shown } from './setup.ts';
import type { SkillState } from './setup.ts';
import { themeReport } from './theme.ts';
import type { Severity } from './types.ts';
import { t } from './locale.ts';
import type { Lang, PhraseKey } from './locale.ts';

// Playwright の型。playwright は入れていない環境もあるので、型は同じ API を持つ playwright-core から取る。
type Playwright = typeof import('playwright-core');
// 名前を変数にして、型の検査で playwright を探させない。読み込む名前は変わらない。
const PLAYWRIGHT: string = 'playwright';

export type Status = 'ok' | 'ng' | 'warn' | 'skip';
export interface Check {
  // 項目を見分ける名前。表示の言語によらず同じなので、--json の出力を読むときはこれで見分ける。
  id: string;
  label: string;
  status: Status;
  detail: string;
  fix: string;
}
export interface DoctorReport {
  project: string;
  lang: Lang;
  ok: boolean;
  checks: Check[];
}

// package.json の engines.node（「>=24」や「^20.19.0 || >=23.5.0」の形）を、今の Node が満たすか。省いた版の数は 0 とみなす。
export function satisfies(version: string, range: string): boolean {
  const v = version.split('.').map(Number);
  const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return range.split('||').some((part) => {
    const m = part.trim().match(/^(\^|>=)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!m) return false;
    const min = m.slice(2).map((x) => Number(x ?? 0));
    return cmp(v, min) >= 0 && (m[1] === '>=' || v[0] === min[0]);
  });
}

// status は ok（そろっている）、ng（今の設定で使うのに足りない）、warn（動くが直したほうがよい）、skip（今の設定では使わない）。
export async function doctor(project: string): Promise<DoctorReport> {
  const checks: Check[] = [];
  const add = (id: string, label: string, status: Status, detail = '', fix = '') => checks.push({ id, label, status, detail, fix });
  const cfg = loadConfig(project);
  const lang: Lang = cfg.values.lang === 'en' ? 'en' : 'ja';
  const tr = (key: PhraseKey, vars?: Record<string, unknown>) => t(lang, key, vars);
  const sep = lang === 'en' ? ', ' : '、';
  const inRoot = (cmd: string) => `cd ${JSON.stringify(root)} && ${cmd}`;

  const pkg: { engines: { node: string }; dependencies: Record<string, string> } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const nodeOk = satisfies(process.versions.node, pkg.engines.node);
  add('node', tr('doctor.node'), nodeOk ? 'ok' : 'ng', process.versions.node, nodeOk ? '' : tr('doctor.nodeFix', { range: pkg.engines.node }));

  const missing = Object.keys(pkg.dependencies).filter((d) => !fs.existsSync(path.join(root, 'node_modules', d, 'package.json')));
  add('deps', tr('doctor.deps'), missing.length ? 'ng' : 'ok', missing.length ? tr('doctor.depsMissing', { names: missing.join(sep) }) : '', missing.length ? inRoot('npm install') : '');

  const cmd = zukaiCommand();
  add('command', tr('doctor.cmd'), cmd === 'zukai' ? 'ok' : 'warn', cmd === 'zukai' ? '' : tr('doctor.cmdMissing'), cmd === 'zukai' ? '' : tr('doctor.cmdFix', { cmd: inRoot('npm link') }));

  add('settings', tr('doctor.settings'), cfg.problems.length ? 'ng' : 'ok', cfg.problems.map((p) => `${p.file ? `${shown(p.file)}: ` : ''}${p.message}`).join('\n'), cfg.problems.length ? tr('doctor.settingsFix') : '');

  const skills = skillStatus(project);
  const installed = skills.filter((s) => s.state !== 'missing');
  if (!installed.length) add('skills', tr('doctor.skills'), 'warn', tr('doctor.skillsNone'), 'zukai setup skills');
  else {
    // スキルを書いた場所に、あとから足したスキルが無ければ、古いものと同じく書き直しを勧める。
    const used = new Set(installed.map((s) => `${s.where}/${s.tool}`));
    const todo = skills.filter((s) => s.state === 'stale' || (s.state === 'missing' && used.has(`${s.where}/${s.tool}`)));
    const mark: Record<SkillState, string> = { stale: tr('doctor.stale'), missing: tr('doctor.missing'), ok: '' };
    add('skills', tr('doctor.skills'), todo.length ? 'warn' : 'ok', (todo.length ? todo : installed).map((s) => `${shown(s.file)}${mark[s.state]}`).join('\n'), todo.length ? 'zukai setup skills' : '');
  }

  // テーマは、設定の theme があるときだけ確かめる。無ければ、zukai の既定の見た目で描く。
  const theme = cfg.settings.theme;
  if (!theme) add('theme', tr('doctor.theme'), 'skip', tr('doctor.themeSkip'));
  else {
    // テーマを読めない場合も、残りの確認を続ける。doctor は、壊れた環境を調べるためのコマンドなので。
    let r: { name: string | null; findings: { severity: Severity; message: string }[] };
    try {
      r = await themeReport(theme);
    } catch (e) {
      r = { name: shown(theme), findings: [{ severity: 'error', message: tr('doctor.themeRead', { message: (e as Error).message }) }] };
    }
    const errors = r.findings.filter((f) => f.severity === 'error');
    const where = lang === 'en' ? ` (${shown(theme)})` : `（${shown(theme)}）`;
    add('theme', tr('doctor.theme'), errors.length ? 'ng' : r.findings.length ? 'warn' : 'ok', [`${r.name}${where}`, ...r.findings.map((f) => `${f.severity} ${f.message}`)].join('\n'), r.findings.length ? `zukai theme check ${shown(theme)}` : '');
  }

  // 動画は output が video のときに必要。撮影（capture）も同じ Playwright と Chromium を使う。
  const video = cfg.values.output === 'video';
  // capture は出力によらず Playwright と Chromium を使うので、動画を作らない設定でも、足りなければ ! で直し方を示す。
  const need = (ok: boolean): Status => (ok ? 'ok' : video ? 'ng' : 'warn');
  const note = video ? '' : tr('doctor.captureNote');
  let chromiumPath = cfg.settings.chromium;
  const hasPlaywright = fs.existsSync(path.join(root, 'node_modules', 'playwright', 'package.json'));
  add('playwright', 'Playwright', need(hasPlaywright), hasPlaywright ? '' : `${tr('doctor.absent')}${note}`, hasPlaywright ? '' : inRoot('npm install playwright'));
  if (hasPlaywright && !chromiumPath) {
    try {
      chromiumPath = ((await import(PLAYWRIGHT)) as Playwright).chromium.executablePath();
    } catch {
      chromiumPath = null;
    }
  }
  const hasChromium = Boolean(chromiumPath && fs.existsSync(chromiumPath));
  add('chromium', 'Chromium', need(hasChromium), hasChromium ? chromiumPath! : `${tr('doctor.absent')}${note}`, hasChromium ? '' : tr('doctor.chromiumFix', { cmd: inRoot('npx playwright install chromium') }));
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  const hasFfmpeg = ffmpeg.status === 0;
  add('ffmpeg', 'ffmpeg', need(hasFfmpeg), hasFfmpeg ? ffmpeg.stdout.split('\n')[0] : `${tr('doctor.absent')}${video ? '' : tr('doctor.videoNote')}`, hasFfmpeg ? '' : tr('doctor.ffmpegFix'));
  const key = cfg.values['gemini.apiKey'];
  add('gemini', tr('doctor.gemini'), key ? 'ok' : video ? 'warn' : 'skip', key ? tr(`scope.${cfg.origins['gemini.apiKey']}`) : tr('doctor.geminiMissing', { note: video ? '' : tr('doctor.videoNote') }), key ? '' : 'zukai login gemini');

  // Confluence は、URL かスペース ID が設定されているときに必要。
  const conf = cfg.values['confluence.base'] || cfg.values['confluence.spaceId'];
  const lack = ['confluence.base', 'confluence.email', 'confluence.token'].filter((k) => !cfg.values[k]);
  add('confluence', 'Confluence', !conf ? 'skip' : lack.length ? 'ng' : 'ok', !conf ? tr('doctor.confluenceSkip') : lack.length ? tr('doctor.confluenceMissing', { keys: lack.join(sep) }) : cfg.settings.confluence.base!, !conf ? '' : lack.includes('confluence.base') ? 'zukai setup confluence' : lack.length ? 'zukai login confluence' : '');
  // スペース ID は、初回の publish でページを作るときに要る。--space-id でも渡せるので、足りなくても warn にする。
  if (conf && !lack.length && !cfg.values['confluence.spaceId']) add('confluence.space', tr('doctor.space'), 'warn', tr('doctor.spaceMissing'), tr('doctor.spaceFix'));

  return { project, lang, ok: !checks.some((c) => c.status === 'ng'), checks };
}

const marks: Record<Status, string> = { ok: '✔', ng: '✘', warn: '!', skip: '-' };
export function printDoctor(r: DoctorReport): void {
  console.log(t(r.lang, 'doctor.head', { path: r.project }));
  for (const c of r.checks) {
    const [first, ...more] = c.detail ? c.detail.split('\n') : [''];
    console.log(`  ${marks[c.status]} ${c.label}${first ? `  ${first}` : ''}`);
    for (const m of more) console.log(`      ${m}`);
    if (c.fix && c.status !== 'skip') console.log(`      → ${c.fix}`);
  }
  if (!r.ok) console.log(t(r.lang, 'doctor.footer'));
}
