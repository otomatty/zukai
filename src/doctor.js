// 必要なものがそろっているかを確かめる。足りないものには、直すためのコマンドを添える。
// 依存が欠けていても動くよう、確かめる対象は必要になってから読み込む。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, loadConfig } from './config.js';
import { zukaiCommand, skillStatus, shown } from './setup.js';
import { themeReport } from './theme.js';
import { t } from './locale.js';

// package.json の engines.node（「^20.19.0 || >=23.5.0」の形）を、今の Node が満たすか。
export function satisfies(version, range) {
  const v = version.split('.').map(Number);
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return range.split('||').some((part) => {
    const m = part.trim().match(/^(\^|>=)(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const min = m.slice(2).map(Number);
    return cmp(v, min) >= 0 && (m[1] === '>=' || v[0] === min[0]);
  });
}

// status は ok（そろっている）、ng（今の設定で使うのに足りない）、warn（動くが直したほうがよい）、skip（今の設定では使わない）。
export async function doctor(project) {
  const checks = [];
  const add = (label, status, detail = '', fix = '') => checks.push({ label, status, detail, fix });
  const cfg = loadConfig(project);
  const lang = cfg.values.lang === 'en' ? 'en' : 'ja';
  const tr = (key, vars) => t(lang, key, vars);
  const sep = lang === 'en' ? ', ' : '、';
  const inRoot = (cmd) => `cd ${JSON.stringify(root)} && ${cmd}`;

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const nodeOk = satisfies(process.versions.node, pkg.engines.node);
  add(tr('doctor.node'), nodeOk ? 'ok' : 'ng', process.versions.node, nodeOk ? '' : tr('doctor.nodeFix', { range: pkg.engines.node }));

  const missing = Object.keys(pkg.dependencies).filter((d) => !fs.existsSync(path.join(root, 'node_modules', d, 'package.json')));
  add(tr('doctor.deps'), missing.length ? 'ng' : 'ok', missing.length ? tr('doctor.depsMissing', { names: missing.join(sep) }) : '', missing.length ? inRoot('npm install') : '');

  const cmd = zukaiCommand();
  add(tr('doctor.cmd'), cmd === 'zukai' ? 'ok' : 'warn', cmd === 'zukai' ? '' : tr('doctor.cmdMissing'), cmd === 'zukai' ? '' : tr('doctor.cmdFix', { cmd: inRoot('npm link') }));

  add(tr('doctor.settings'), cfg.problems.length ? 'ng' : 'ok', cfg.problems.map((p) => `${p.file ? `${shown(p.file)}: ` : ''}${p.message}`).join('\n'), cfg.problems.length ? tr('doctor.settingsFix') : '');

  const skills = skillStatus(project);
  const installed = skills.filter((s) => s.state !== 'missing');
  if (!installed.length) add(tr('doctor.skills'), 'warn', tr('doctor.skillsNone'), 'zukai setup skills');
  else {
    // スキルを書いた場所に、あとから足したスキルが無ければ、古いものと同じく書き直しを勧める。
    const used = new Set(installed.map((s) => `${s.where}/${s.tool}`));
    const todo = skills.filter((s) => s.state === 'stale' || (s.state === 'missing' && used.has(`${s.where}/${s.tool}`)));
    const mark = { stale: tr('doctor.stale'), missing: tr('doctor.missing'), ok: '' };
    add(tr('doctor.skills'), todo.length ? 'warn' : 'ok', (todo.length ? todo : installed).map((s) => `${shown(s.file)}${mark[s.state]}`).join('\n'), todo.length ? 'zukai setup skills' : '');
  }

  // テーマは、設定の theme があるときだけ確かめる。無ければ、zukai の既定の見た目で描く。
  if (!cfg.values.theme) add(tr('doctor.theme'), 'skip', tr('doctor.themeSkip'));
  else {
    // テーマを読めない場合も、残りの確認を続ける。doctor は、壊れた環境を調べるためのコマンドなので。
    let r;
    try {
      r = await themeReport(cfg.values.theme);
    } catch (e) {
      r = { name: shown(cfg.values.theme), findings: [{ severity: 'error', message: tr('doctor.themeRead', { message: e.message }) }] };
    }
    const errors = r.findings.filter((f) => f.severity === 'error');
    const where = lang === 'en' ? ` (${shown(cfg.values.theme)})` : `（${shown(cfg.values.theme)}）`;
    add(tr('doctor.theme'), errors.length ? 'ng' : r.findings.length ? 'warn' : 'ok', [`${r.name}${where}`, ...r.findings.map((f) => `${f.severity} ${f.message}`)].join('\n'), r.findings.length ? `zukai theme check ${shown(cfg.values.theme)}` : '');
  }

  // 動画は output が video のときに必要。撮影（capture）も同じ Playwright と Chromium を使う。
  const video = cfg.values.output === 'video';
  // capture は出力によらず Playwright と Chromium を使うので、動画を作らない設定でも、足りなければ ! で直し方を示す。
  const need = (ok) => (ok ? 'ok' : video ? 'ng' : 'warn');
  const note = video ? '' : tr('doctor.captureNote');
  let chromiumPath = cfg.values.chromium;
  const hasPlaywright = fs.existsSync(path.join(root, 'node_modules', 'playwright', 'package.json'));
  add('Playwright', need(hasPlaywright), hasPlaywright ? '' : `${tr('doctor.absent')}${note}`, hasPlaywright ? '' : inRoot('npm install playwright'));
  if (hasPlaywright && !chromiumPath) {
    try {
      chromiumPath = (await import('playwright')).chromium.executablePath();
    } catch {
      chromiumPath = null;
    }
  }
  const hasChromium = Boolean(chromiumPath && fs.existsSync(chromiumPath));
  add('Chromium', need(hasChromium), hasChromium ? chromiumPath : `${tr('doctor.absent')}${note}`, hasChromium ? '' : tr('doctor.chromiumFix', { cmd: inRoot('npx playwright install chromium') }));
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  const hasFfmpeg = ffmpeg.status === 0;
  add('ffmpeg', need(hasFfmpeg), hasFfmpeg ? ffmpeg.stdout.split('\n')[0] : `${tr('doctor.absent')}${video ? '' : tr('doctor.videoNote')}`, hasFfmpeg ? '' : tr('doctor.ffmpegFix'));
  const key = cfg.values['gemini.apiKey'];
  add(tr('doctor.gemini'), key ? 'ok' : video ? 'warn' : 'skip', key ? tr(`scope.${cfg.origins['gemini.apiKey']}`) : tr('doctor.geminiMissing', { note: video ? '' : tr('doctor.videoNote') }), key ? '' : 'zukai login gemini');

  // Confluence は、URL かスペース ID が設定されているときに必要。
  const conf = cfg.values['confluence.base'] || cfg.values['confluence.spaceId'];
  const lack = ['confluence.base', 'confluence.email', 'confluence.token'].filter((k) => !cfg.values[k]);
  add('Confluence', !conf ? 'skip' : lack.length ? 'ng' : 'ok', !conf ? tr('doctor.confluenceSkip') : lack.length ? tr('doctor.confluenceMissing', { keys: lack.join(sep) }) : cfg.values['confluence.base'], !conf ? '' : lack.includes('confluence.base') ? 'zukai setup confluence' : lack.length ? 'zukai login confluence' : '');
  // スペース ID は、初回の publish でページを作るときに要る。--space-id でも渡せるので、足りなくても warn にする。
  if (conf && !lack.length && !cfg.values['confluence.spaceId']) add(tr('doctor.space'), 'warn', tr('doctor.spaceMissing'), tr('doctor.spaceFix'));

  return { project, lang, ok: !checks.some((c) => c.status === 'ng'), checks };
}

const marks = { ok: '✔', ng: '✘', warn: '!', skip: '-' };
export function printDoctor(r) {
  const lang = r.lang === 'en' ? 'en' : 'ja';
  console.log(t(lang, 'doctor.head', { path: r.project }));
  for (const c of r.checks) {
    const [first, ...more] = c.detail ? c.detail.split('\n') : [''];
    console.log(`  ${marks[c.status]} ${c.label}${first ? `  ${first}` : ''}`);
    for (const m of more) console.log(`      ${m}`);
    if (c.fix && c.status !== 'skip') console.log(`      → ${c.fix}`);
  }
  if (!r.ok) console.log(t(lang, 'doctor.footer'));
}
