// 必要なものがそろっているかを確かめる。足りないものには、直すためのコマンドを添える。
// 依存が欠けていても動くよう、確かめる対象は必要になってから読み込む。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, loadConfig, scopeNames } from './config.js';
import { zukaiCommand, skillStatus, shown } from './setup.js';

// status は ok（そろっている）、ng（今の設定で使うのに足りない）、warn（動くが直したほうがよい）、skip（今の設定では使わない）。
export async function doctor(project) {
  const checks = [];
  const add = (label, status, detail = '', fix = '') => checks.push({ label, status, detail, fix });
  const cfg = loadConfig(project);
  const inRoot = (cmd) => `cd ${JSON.stringify(root)} && ${cmd}`;

  const major = Number(process.versions.node.split('.')[0]);
  add('Node', major >= 20 ? 'ok' : 'ng', process.versions.node, major >= 20 ? '' : 'Node 20 以上を入れてください。');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const missing = Object.keys(pkg.dependencies).filter((d) => !fs.existsSync(path.join(root, 'node_modules', d, 'package.json')));
  add('依存パッケージ', missing.length ? 'ng' : 'ok', missing.length ? `${missing.join('、')} がありません` : '', missing.length ? inRoot('npm install') : '');

  const cmd = zukaiCommand();
  add('zukai コマンド', cmd === 'zukai' ? 'ok' : 'warn', cmd === 'zukai' ? '' : 'PATH にありません。スキルには node と CLI の絶対パスを書きます', cmd === 'zukai' ? '' : `${inRoot('npm link')}（そのあと zukai setup skills でスキルを新しくする）`);

  add('設定', cfg.problems.length ? 'ng' : 'ok', cfg.problems.map((p) => `${p.file ? `${shown(p.file)}: ` : ''}${p.message}`).join('\n'), cfg.problems.length ? '設定ファイルを直すか、zukai config unset <項目> で消してください。' : '');

  const skills = skillStatus(project);
  const installed = skills.filter((s) => s.state !== 'missing');
  if (!installed.length) add('スキル', 'warn', 'どこにも書かれていません', 'zukai setup skills');
  else {
    const stale = installed.filter((s) => s.state === 'stale');
    add('スキル', stale.length ? 'warn' : 'ok', (stale.length ? stale : installed).map((s) => `${shown(s.file)}${s.state === 'stale' ? '（古い）' : ''}`).join('\n'), stale.length ? 'zukai setup skills' : '');
  }

  // 動画は output が video のときに必要。撮影（capture）も同じ Playwright と Chromium を使う。
  const video = cfg.values.output === 'video';
  const need = (ok) => (ok ? 'ok' : video ? 'ng' : 'skip');
  const note = video ? '' : '（動画と撮影で使う）';
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
