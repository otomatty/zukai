// 必要なものがそろっているかを確かめる。足りないものには、直すためのコマンドを添える。
// 依存が欠けていても動くよう、確かめる対象は必要になってから読み込む。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, loadConfig, scopeNames } from './config.js';
import { zukaiCommand, skillStatus, shown } from './setup.js';
import { themeReport } from './theme.js';

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
  const inRoot = (cmd) => `cd ${JSON.stringify(root)} && ${cmd}`;

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const nodeOk = satisfies(process.versions.node, pkg.engines.node);
  add('Node', nodeOk ? 'ok' : 'ng', process.versions.node, nodeOk ? '' : `Node ${pkg.engines.node} を入れてください。依存パッケージがこの版を求めます。`);

  const missing = Object.keys(pkg.dependencies).filter((d) => !fs.existsSync(path.join(root, 'node_modules', d, 'package.json')));
  add('依存パッケージ', missing.length ? 'ng' : 'ok', missing.length ? `${missing.join('、')} がありません` : '', missing.length ? inRoot('npm install') : '');

  const cmd = zukaiCommand();
  add('zukai コマンド', cmd === 'zukai' ? 'ok' : 'warn', cmd === 'zukai' ? '' : 'PATH にありません。スキルには node と CLI の絶対パスを書きます', cmd === 'zukai' ? '' : `${inRoot('npm link')}（そのあと zukai setup skills でスキルを新しくする）`);

  add('設定', cfg.problems.length ? 'ng' : 'ok', cfg.problems.map((p) => `${p.file ? `${shown(p.file)}: ` : ''}${p.message}`).join('\n'), cfg.problems.length ? '設定ファイルを直すか、zukai config unset <項目> で消してください。' : '');

  const skills = skillStatus(project);
  const installed = skills.filter((s) => s.state !== 'missing');
  if (!installed.length) add('スキル', 'warn', 'どこにも書かれていません', 'zukai setup skills');
  else {
    // スキルを書いた場所に、あとから足したスキルが無ければ、古いものと同じく書き直しを勧める。
    const used = new Set(installed.map((s) => `${s.where}/${s.tool}`));
    const todo = skills.filter((s) => s.state === 'stale' || (s.state === 'missing' && used.has(`${s.where}/${s.tool}`)));
    const mark = { stale: '（古い）', missing: '（無い）', ok: '' };
    add('スキル', todo.length ? 'warn' : 'ok', (todo.length ? todo : installed).map((s) => `${shown(s.file)}${mark[s.state]}`).join('\n'), todo.length ? 'zukai setup skills' : '');
  }

  // テーマは、設定の theme があるときだけ確かめる。無ければ、zukai の既定の見た目で描く。
  if (!cfg.values.theme) add('テーマ', 'skip', '設定していません。zukai の既定の見た目で描きます');
  else {
    // テーマを読めない場合も、残りの確認を続ける。doctor は、壊れた環境を調べるためのコマンドなので。
    let r;
    try {
      r = await themeReport(cfg.values.theme);
    } catch (e) {
      r = { name: shown(cfg.values.theme), findings: [{ severity: 'error', message: `テーマを読めません。${e.message}` }] };
    }
    const errors = r.findings.filter((f) => f.severity === 'error');
    add('テーマ', errors.length ? 'ng' : r.findings.length ? 'warn' : 'ok', [`${r.name}（${shown(cfg.values.theme)}）`, ...r.findings.map((f) => `${f.severity} ${f.message}`)].join('\n'), r.findings.length ? `zukai theme check ${shown(cfg.values.theme)}` : '');
  }

  // 動画は output が video のときに必要。撮影（capture）も同じ Playwright と Chromium を使う。
  const video = cfg.values.output === 'video';
  // capture は出力によらず Playwright と Chromium を使うので、動画を作らない設定でも、足りなければ ! で直し方を示す。
  const need = (ok) => (ok ? 'ok' : video ? 'ng' : 'warn');
  const note = video ? '' : '（撮影と動画で使う）';
  let chromiumPath = cfg.values.chromium;
  const hasPlaywright = fs.existsSync(path.join(root, 'node_modules', 'playwright', 'package.json'));
  add('Playwright', need(hasPlaywright), hasPlaywright ? '' : `ありません${note}`, hasPlaywright ? '' : inRoot('npm install playwright'));
  if (hasPlaywright && !chromiumPath) {
    try {
      chromiumPath = (await import('playwright')).chromium.executablePath();
    } catch {
      chromiumPath = null;
    }
  }
  const hasChromium = Boolean(chromiumPath && fs.existsSync(chromiumPath));
  add('Chromium', need(hasChromium), hasChromium ? chromiumPath : `ありません${note}`, hasChromium ? '' : `${inRoot('npx playwright install chromium')}（別の Chromium を使うときは zukai config set chromium <パス> --scope=user）`);
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  const hasFfmpeg = ffmpeg.status === 0;
  add('ffmpeg', need(hasFfmpeg), hasFfmpeg ? ffmpeg.stdout.split('\n')[0] : `ありません${video ? '' : '（動画で使う）'}`, hasFfmpeg ? '' : 'ffmpeg を入れて、コマンドのパスに入れてください（macOS は brew install ffmpeg）。');
  const key = cfg.values['gemini.apiKey'];
  add('Gemini の API キー', key ? 'ok' : video ? 'warn' : 'skip', key ? `${scopeNames[cfg.origins['gemini.apiKey']]}` : `ありません。字幕だけの無音の動画になります${video ? '' : '（動画で使う）'}`, key ? '' : 'zukai login gemini');

  // Confluence は、URL かスペース ID が設定されているときに必要。
  const conf = cfg.values['confluence.base'] || cfg.values['confluence.spaceId'];
  const lack = ['confluence.base', 'confluence.email', 'confluence.token'].filter((k) => !cfg.values[k]);
  add('Confluence', !conf ? 'skip' : lack.length ? 'ng' : 'ok', !conf ? '使わない設定です' : lack.length ? `${lack.join('、')} がありません` : cfg.values['confluence.base'], !conf ? '' : lack.includes('confluence.base') ? 'zukai setup confluence' : lack.length ? 'zukai login confluence' : '');
  // スペース ID は、初回の publish でページを作るときに要る。--space-id でも渡せるので、足りなくても warn にする。
  if (conf && !lack.length && !cfg.values['confluence.spaceId']) add('Confluence のスペース ID', 'warn', 'ありません。初回の publish でページを作れません', 'zukai config set confluence.spaceId スペースID（publish に --space-id=スペースID を付けてもよい）');

  return { project, ok: !checks.some((c) => c.status === 'ng'), checks };
}

const marks = { ok: '✔', ng: '✘', warn: '!', skip: '-' };
export function printDoctor(r) {
  console.log(`確認  プロジェクト ${r.project}`);
  for (const c of r.checks) {
    const [first, ...more] = c.detail ? c.detail.split('\n') : [''];
    console.log(`  ${marks[c.status]} ${c.label}${first ? `  ${first}` : ''}`);
    for (const m of more) console.log(`      ${m}`);
    if (c.fix && c.status !== 'skip') console.log(`      → ${c.fix}`);
  }
  if (!r.ok) console.log('✘ の項目は、今の設定で使うのに足りません。→ のコマンドで直せます。');
}
