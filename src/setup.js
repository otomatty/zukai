// 初期設定（setup）、設定の表示と変更（config）、キーの保存（login、logout）。
// 端末で実行したときは対話で質問する。AI ツールから実行したとき（端末でないとき）と --yes のときは質問せず、フラグと今の値だけで動く。
// AI は質問に答えられないため。秘密の値は、対話か標準入力でだけ受け取る。フラグで受け取ると、シェルの履歴に残るため。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root, loadConfig, projectOf, filesOf, specOf, spec, setValue, unsetValue, coerce, ensureTeamFile, stateDir, scopeNames, display, listedKeys, closest, pad, widthOf, invalid } from './config.js';

const SECTIONS = ['skills', 'output', 'video', 'confluence'];
// セクションを書かずに setup を実行したときに質問するセクション。
const DEFAULT_SECTIONS = ['skills', 'output', 'confluence'];
const interactive = (has) => Boolean(process.stdin.isTTY && process.stdout.isTTY) && !has('yes');
const ui = () => import('@inquirer/prompts');
const home = os.homedir();
// 表示用のパス。今いるフォルダからの相対パスにし、ホームの下は ~ で書く。
export const shown = (p) => {
  const rel = path.relative(process.cwd(), p);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel || '.';
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
};

// --- スキル ---------------------------------------------------------------

// スキルから zukai を呼ぶコマンド。npm link などで zukai がコマンドとして使えれば zukai、使えなければ node と CLI の絶対パス。
export function zukaiCommand() {
  const cli = fs.realpathSync(path.join(root, 'src/cli.js'));
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of process.platform === 'win32' ? ['zukai.cmd', 'zukai.ps1'] : ['zukai']) {
      const p = path.join(dir, name);
      try {
        // Windows の npm のシムは実体へのリンクではないので、置いてあれば使えるものとする。
        if (process.platform === 'win32' ? fs.existsSync(p) : fs.realpathSync(p) === cli) return 'zukai';
      } catch {
        // このフォルダには無い。
      }
    }
  }
  return `node "${cli.replaceAll('\\', '/')}"`;
}

export const skillDirs = { claude: '.claude/skills', agents: '.agents/skills' };
export const skillText = (cmd = zukaiCommand()) => fs.readFileSync(path.join(root, 'prompts/answer-skill.md'), 'utf8').replaceAll('{{zukai}}', cmd);
export const skillFile = (base, tool) => path.join(base, skillDirs[tool], 'zukai-answer', 'SKILL.md');

// スキルの状態。場所（project、user）とツールごとに、無い（missing）、古い（stale）、最新（ok）のどれか。
export function skillStatus(project, text = skillText()) {
  const out = [];
  for (const [where, base] of [['project', project], ['user', home]]) {
    for (const tool of Object.keys(skillDirs)) {
      const file = skillFile(base, tool);
      const state = !fs.existsSync(file) ? 'missing' : fs.readFileSync(file, 'utf8') === text ? 'ok' : 'stale';
      out.push({ where, tool, file, state });
    }
  }
  return out;
}

// --- 質問 -----------------------------------------------------------------

const flagKeys = { output: 'output', voice: 'video.voice', style: 'video.style', bgm: 'video.bgm', 'confluence-base': 'confluence.base', 'confluence-space': 'confluence.spaceId', 'confluence-parent': 'confluence.parentId' };

// 1項目の値を質問する。今の値を既定の答えにするので、Enter だけで今の値のまま進める。
async function askValue(key, cfg, message) {
  const p = await ui();
  const s = specOf(key);
  const cur = cfg.values[key];
  const msg = message ?? `${key}（${s.description}）`;
  if (s.type === 'enum') return p.select({ message: msg, default: cur ?? undefined, choices: s.values.map((v) => ({ name: s.labels?.[v] ? `${s.labels[v]}（${v}）` : v, value: v })) });
  if (s.type === 'boolean') return p.confirm({ message: msg, default: cur ?? true });
  if (s.suggest) {
    const choices = [...new Set([...(cur ? [cur] : []), ...s.suggest])].map((v) => ({ name: v === s.default ? `${v}（既定）` : v, value: v }));
    const v = await p.select({ message: msg, default: cur ?? undefined, choices: [...choices, { name: 'その他（名前を入力する）', value: '\u0000' }] });
    return v === '\u0000' ? p.input({ message: `${key} の名前`, validate: (x) => Boolean(x.trim()) || '名前を入力してください。' }) : v;
  }
  // 文字列、数値、パス、URL。空にすると既定値（既定値が無い項目は「なし」）にする。パスは今いるフォルダから解決する。
  const raw = cfg.raw[key] ?? cur;
  const answer = await p.input({
    message: `${msg}${s.type === 'path' ? '（今いるフォルダからのパス。' : '（'}${s.default === null || s.default === undefined ? '空ならなし）' : '空なら既定値）'}`,
    default: raw === null || raw === undefined ? '' : String(raw),
    validate: (x) => {
      if (!x.trim()) return true;
      try {
        coerce(key, x.trim(), s.scopes[0], cfg.project);
        return true;
      } catch (e) {
        return e.message;
      }
    },
  });
  if (!answer.trim()) return s.default ?? null;
  if (raw !== null && raw !== undefined && answer.trim() === String(raw)) return cur;
  return s.type === 'path' ? path.resolve(answer.trim()) : coerce(key, answer.trim(), s.scopes[0], cfg.project);
}

// 秘密の値を、画面に出さずに読む。端末でないとき（パイプ）は、標準入力の1行目を読む。
export async function readSecret(message) {
  if (process.stdin.isTTY) return (await (await ui()).password({ message, mask: '*' })).trim();
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const line = await new Promise((ok) => rl.once('line', ok).once('close', () => ok('')));
  rl.close();
  return line.trim();
}

// --- setup ----------------------------------------------------------------

// setup の流れ。質問して答えを集め（ask か flags）、書き込む内容を作り（plan）、見せてから書く（apply）。
export async function setup({ sections, opt, has }) {
  for (const s of sections) {
    if (!SECTIONS.includes(s)) {
      const near = closest(s, SECTIONS);
      throw new Error(`セクション「${s}」はありません。${near ? `「${near}」の書き間違いではありませんか。` : ''}${SECTIONS.join('、')} のどれかを書きます。`);
    }
  }
  const want = new Set(sections.length ? sections : DEFAULT_SECTIONS);
  const project = path.resolve(opt('dir') ?? projectOf(process.cwd()));
  const cfg = loadConfig(project);
  const ask = interactive(has);
  const teamExists = fs.existsSync(cfg.files.team);
  console.log(`プロジェクト  ${project}${teamExists ? '（zukai.config.json があります。チームの設定を読みました）' : '（zukai.config.json はまだありません）'}`);
  if (cfg.problems.length) console.log(`設定に誤りがあります。最後の確認で表示します。`);

  const scopeFlag = opt('scope');
  if (scopeFlag && !['team', 'local'].includes(scopeFlag)) throw new Error('--scope に書けるのは team か local です。');
  const answers = ask ? await askAll(want, cfg, opt) : fromFlags(want, cfg, opt);

  // チームの設定を変える値は、チームに共有するか、自分だけにするかを1回だけ聞く。1人目の初回は聞かずにチームに書く。
  // 対話では、今効いている値から変えたものだけを候補にする。フラグで渡した値は、すべて候補にする。
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const candidates = Object.entries(answers.values).filter(([k, v]) => !ask || !same(v, cfg.values[k]));
  let scope = scopeFlag ?? 'team';
  if (candidates.length && !scopeFlag && ask && teamExists) {
    scope = await (await ui()).select({
      message: `変える値（${candidates.map(([k]) => k).join('、')}）を、どこに書きますか`,
      choices: [
        { name: 'チームに共有する（zukai.config.json。コミットして共有する）', value: 'team' },
        { name: '自分だけ（.zukai/config.json。Git の管理に入らない）', value: 'local' },
      ],
    });
  }
  // 書く置き場所までを重ねた値と比べる。手元の設定や環境変数で同じ値になっていても、チームに書くときはチームの値を変える。
  const atScope = loadConfig(project, { upTo: scope }).values;
  const changed = candidates.filter(([k, v]) => !same(v, atScope[k]));

  const plan = planOf(project, cfg, answers, changed, scope, want);
  printPlan(plan);
  if (!plan.items.length) console.log('変更はありません。');
  else if (ask && !(await (await ui()).confirm({ message: 'この内容で書き込みますか', default: true }))) {
    console.log('何も書き込んでいません。');
    return 0;
  } else apply(plan);

  const { doctor, printDoctor } = await import('./doctor.js');
  console.log('');
  printDoctor(await doctor(project));
  if (ask) {
    const cmd = equivalent(project, answers, changed, scope, want);
    console.log(`\n同じ設定を、対話なしで行うコマンド:\n  ${cmd}`);
    if (Object.keys(answers.credentials).length) console.log('  キーとトークンは、それぞれ zukai login gemini、zukai login confluence で保存します。');
  }
  return 0;
}

async function askAll(want, cfg, opt) {
  const p = await ui();
  const answers = { values: {}, credentials: {}, skills: null };

  if (want.has('skills')) {
    const st = skillStatus(cfg.project);
    const installed = (where) => st.some((s) => s.where === where && s.state !== 'missing');
    const where = await p.select({
      message: 'スキル（返答を資料にする手順）を書く場所',
      default: !installed('project') && installed('user') ? 'user' : 'project',
      choices: [
        { name: `このプロジェクト（${shown(cfg.project)}/.claude/skills など）`, value: 'project' },
        { name: 'この PC の全プロジェクト（~/.claude/skills など）', value: 'user' },
        { name: '書かない', value: 'none' },
      ],
    });
    const tools = where === 'none' ? [] : await p.checkbox({
      message: 'スキルを読ませる AI ツール',
      required: true,
      choices: [
        { name: 'Claude Code（.claude/skills）', value: 'claude', checked: true },
        { name: 'Codex、Cursor、GitHub Copilot、Devin など（.agents/skills）', value: 'agents', checked: true },
      ],
    });
    answers.skills = { where, tools };
  }

  if (want.has('output')) {
    const team = cfg.origins.output === 'team' ? `（チームの設定: ${cfg.values.output}）` : '';
    answers.values.output = await askValue('output', cfg, `出力${team}`);
  }
  if (want.has('video') || answers.values.output === 'video') {
    answers.values['video.voice'] = await askValue('video.voice', cfg, '動画の声');
    answers.values['video.style'] = await askValue('video.style', cfg, '動画全体の語り口');
    answers.values['video.bgm'] = await askValue('video.bgm', cfg, 'BGM のファイル');
    if (process.env.GEMINI_API_KEY) console.log('Gemini の API キー: 環境変数 GEMINI_API_KEY を使います。');
    else {
      const has = Boolean(cfg.values['gemini.apiKey']);
      console.log('ナレーションの読み上げに、Gemini の API キーを使います。無料枠のキーでは、地域と利用規約によって、送った文が Google の製品改善に使われることがあります。');
      const key = await readSecret(`Gemini の API キー（Enter で${has ? '今のキーのまま' : '後回し。無音の動画になります'}）`);
      if (key) answers.credentials['gemini.apiKey'] = key;
    }
  }

  if (want.has('confluence')) {
    const on = await p.select({
      message: '資料の共有先',
      default: cfg.values['confluence.base'] ? 'confluence' : 'file',
      choices: [
        { name: 'ファイル（HTML）だけ', value: 'file' },
        { name: 'Confluence にも登録する', value: 'confluence' },
      ],
    });
    if (on === 'file') {
      // ファイルだけにしたときは、接続先を「なし」にする。doctor が、使わない Confluence の認証を求めないようにするため。
      for (const k of ['confluence.base', 'confluence.spaceId', 'confluence.parentId']) if (cfg.values[k] !== null) answers.values[k] = null;
    } else {
      answers.values['confluence.base'] = await askValue('confluence.base', cfg, 'Confluence の URL（例: https://example.atlassian.net/wiki）');
      answers.values['confluence.spaceId'] = await askValue('confluence.spaceId', cfg, 'ページを作るスペースの ID');
      answers.values['confluence.parentId'] = await askValue('confluence.parentId', cfg, '親ページの ID（空ならスペースの直下）');
      const email = await p.input({ message: 'Atlassian アカウントのメールアドレス', default: cfg.values['confluence.email'] ?? '' });
      if (email.trim() && email.trim() !== cfg.values['confluence.email']) answers.credentials['confluence.email'] = email.trim();
      const token = await readSecret(`Atlassian の API トークン（Enter で${cfg.values['confluence.token'] ? '今のトークンのまま' : '後回し'}）`);
      if (token) answers.credentials['confluence.token'] = token;
    }
  }
  return answers;
}

function fromFlags(want, cfg, opt) {
  const answers = { values: {}, credentials: {}, skills: null };
  for (const [flag, key] of Object.entries(flagKeys)) {
    const v = opt(flag);
    if (v === undefined) continue;
    // 空の値は「なし」。既定値がある項目（output など）は「なし」にできないので止める。
    if (v === '' && invalid(specOf(key), null)) throw new Error(`--${flag} を空にはできません。既定値に戻すときは zukai config unset ${key} を実行します。`);
    answers.values[key] = v === '' ? null : specOf(key).type === 'path' ? path.resolve(v) : coerce(key, v, 'team', cfg.project);
  }
  if (want.has('skills') && opt('skills') !== 'none') {
    const where = opt('skills') ?? 'project';
    if (!['project', 'user'].includes(where)) throw new Error('--skills に書けるのは project、user、none のどれかです。');
    const tools = (opt('tools') ?? 'claude,agents').split(',').map((t) => t.trim()).filter(Boolean);
    const bad = tools.find((t) => !skillDirs[t]);
    if (bad) throw new Error(`--tools の「${bad}」はありません。claude と agents を、カンマで区切って書きます。`);
    answers.skills = { where, tools };
  }
  return answers;
}

// 書き込む内容。設定は、今の値と違うものだけを書く。パスは、書く置き場所から見た相対パスにする。
function planOf(project, cfg, answers, changed, scope, want) {
  const files = filesOf(project);
  const items = [];
  const createTeam = !fs.existsSync(files.team) && (scope === 'team' && changed.length > 0 || want.has('skills') && want.has('output'));
  if (createTeam) items.push({ kind: 'create', file: files.team, label: 'チーム' });
  for (const [key, v] of changed) {
    const stored = specOf(key).type === 'path' && v !== null ? coerce(key, path.relative(process.cwd(), v) || '.', scope, project) : v;
    items.push({ kind: 'set', file: files[scope], label: scopeNames[scope], scope, key, value: stored });
  }
  for (const [key, v] of Object.entries(answers.credentials)) items.push({ kind: 'set', file: files.credentials, label: scopeNames.credentials, scope: 'credentials', key, value: v });
  if (answers.skills && answers.skills.where !== 'none') {
    const text = skillText();
    const base = answers.skills.where === 'user' ? home : project;
    for (const tool of answers.skills.tools) {
      const file = skillFile(base, tool);
      const state = !fs.existsSync(file) ? 'missing' : fs.readFileSync(file, 'utf8') === text ? 'ok' : 'stale';
      if (state !== 'ok') items.push({ kind: 'skill', file, text, state });
    }
  }
  return { project, items };
}

function printPlan(plan) {
  if (!plan.items.length) return;
  console.log('\n書き込む内容');
  const byFile = new Map();
  for (const it of plan.items) {
    const list = byFile.get(it.file) ?? [];
    list.push(it);
    byFile.set(it.file, list);
  }
  for (const [file, list] of byFile) {
    const what = list.map((it) =>
      it.kind === 'create' ? '作る' : it.kind === 'skill' ? (it.state === 'missing' ? '書く' : '新しくする') : `${it.key}=${display(it.key, it.value)}`,
    );
    const label = list.find((it) => it.label)?.label;
    console.log(`  ${shown(file)}${label ? `（${label}）` : ''}  ${what.join('、')}`);
  }
}

function apply(plan) {
  stateDir(plan.project);
  for (const it of plan.items) {
    if (it.kind === 'create') ensureTeamFile(plan.project);
    else if (it.kind === 'set') setValue(plan.project, it.key, it.value, it.scope);
    else if (it.kind === 'skill') {
      fs.mkdirSync(path.dirname(it.file), { recursive: true });
      fs.writeFileSync(it.file, it.text);
    }
  }
  console.log('書き込みました。');
}

// 対話の答えと同じ設定を、対話なしで行うコマンド。チームの手順書や、AI への指示にそのまま使える。
export function equivalent(project, answers, changed, scope, want) {
  const q = (v) => (/^[\w./:@,-]+$/.test(v) ? v : `'${String(v).replaceAll("'", "'\\''")}'`);
  const parts = ['zukai', 'setup'];
  // 既定のセクションと同じ組み合わせのときだけ、セクションを省く。
  if (want.size !== DEFAULT_SECTIONS.length || DEFAULT_SECTIONS.some((s) => !want.has(s))) parts.push(...want);
  if (path.resolve(project) !== path.resolve(projectOf(process.cwd()))) parts.push(`--dir=${q(project)}`);
  if (answers.skills) parts.push(`--skills=${answers.skills.where}`, ...(answers.skills.tools.length ? [`--tools=${answers.skills.tools.join(',')}`] : []));
  const flagOf = Object.fromEntries(Object.entries(flagKeys).map(([f, k]) => [k, f]));
  for (const [key, v] of changed) parts.push(`--${flagOf[key]}=${v === null ? "''" : q(specOf(key).type === 'path' ? path.relative(process.cwd(), v) || '.' : v)}`);
  if (changed.length && scope !== 'team') parts.push(`--scope=${scope}`);
  parts.push('--yes');
  return parts.join(' ');
}

// --- config ---------------------------------------------------------------


export async function config({ args, opt, has }) {
  const project = path.resolve(opt('dir') ?? projectOf(process.cwd()));
  const [action, key, value] = args;
  const scope = opt('scope');
  if (scope && !['team', 'local', 'user'].includes(scope)) throw new Error('--scope に書けるのは team、local、user のどれかです。');
  if (!action) return process.stdin.isTTY && process.stdout.isTTY ? configInteractive(project) : list(project, { origin: true });
  switch (action) {
    case 'list':
      return list(project, { origin: has('origin'), json: has('json') });
    case 'get': {
      if (!key) throw new Error('項目の名前を書いてください。例: zukai config get output');
      const s = specOf(key);
      if (!s) throw new Error(`項目「${key}」はありません。項目の一覧は zukai help config で表示します。`);
      const cfg = loadConfig(project);
      const v = cfg.values[key] ?? null;
      if (has('json')) console.log(JSON.stringify({ key, value: s.secret && v ? '********' : v, origin: cfg.origins[key] ?? null }));
      else console.log(display(key, v));
      return 0;
    }
    case 'set': {
      if (!key || value === undefined) throw new Error('項目と値を書いてください。例: zukai config set output video');
      const s = specOf(key);
      if (s?.scopes[0] === 'credentials') throw new Error(`${key} は zukai login ${key.split('.')[0]} で保存します。`);
      const v = coerce(key, value, scope ?? s?.scopes[0], project);
      const r = setValue(project, key, v, scope);
      console.log(`${shown(r.file)}（${scopeNames[r.scope]}）の ${key} を ${display(key, v)} にしました。`);
      warnShadowed(project, key, r.scope);
      return 0;
    }
    case 'unset': {
      if (!key) throw new Error('項目の名前を書いてください。例: zukai config unset video.voice');
      const r = unsetValue(project, key, scope);
      if (!r) console.log(`${key} は${scope ? `${scopeNames[scope]}の設定に` : 'どの設定ファイルにも'}書かれていません。`);
      else {
        const cfg = loadConfig(project);
        console.log(`${shown(r.file)}（${scopeNames[r.scope]}）から ${key} を消しました。今の値は ${display(key, cfg.values[key])}（${scopeNames[cfg.origins[key]] ?? '未設定'}）です。`);
      }
      return 0;
    }
    default: {
      const near = closest(action, ['list', 'get', 'set', 'unset']);
      throw new Error(`config の操作「${action}」はありません。${near ? `「${near}」の書き間違いではありませんか。` : ''}list、get、set、unset のどれかを書きます。`);
    }
  }
}

// 書いた値より優先する置き場所に、同じ項目が書かれていれば知らせる。
function warnShadowed(project, key, scope) {
  const cfg = loadConfig(project);
  const o = cfg.origins[key];
  if (o && o !== scope) console.log(`ただし、${scopeNames[o]}${o === 'env' ? `（${specOf(key).env}）` : `の設定（${shown(cfg.files[o])}）`}の値 ${display(key, cfg.values[key])} が優先されます。`);
}

function list(project, { origin = false, json = false } = {}) {
  const cfg = loadConfig(project);
  const keys = listedKeys(cfg);
  if (json) {
    const out = {};
    for (const k of keys) out[k] = { value: specOf(k)?.secret && cfg.values[k] ? '********' : cfg.values[k] ?? null, origin: cfg.origins[k] ?? null };
    console.log(JSON.stringify({ project, files: cfg.files, values: out, problems: cfg.problems }, null, 2));
    return cfg.problems.length ? 1 : 0;
  }
  console.log(`プロジェクト  ${project}`);
  if (origin) for (const sc of ['user', 'team', 'local', 'credentials']) console.log(`  ${pad(scopeNames[sc], 10)}${shown(cfg.files[sc])}${fs.existsSync(cfg.files[sc]) ? '' : '（まだ無い）'}`);
  console.log('');
  const width = Math.max(...keys.map(widthOf)) + 2;
  for (const k of keys) {
    const o = cfg.origins[k];
    console.log(`${pad(k, width)}${display(k, cfg.values[k])}${origin ? `  ← ${scopeNames[o] ?? '未設定'}${o === 'env' ? `（${specOf(k).env}）` : ''}` : ''}`);
  }
  if (cfg.problems.length) {
    console.log('\n設定の誤り');
    for (const p of cfg.problems) console.log(`  ${p.file ? `${shown(p.file)}: ` : ''}${p.message}`);
  }
  return cfg.problems.length ? 1 : 0;
}

async function configInteractive(project) {
  const p = await ui();
  const cfg = loadConfig(project);
  const editable = listedKeys(cfg).filter((k) => !specOf(k).scopes.includes('credentials') && specOf(k).type !== 'terms');
  const width = Math.max(...editable.map(widthOf)) + 2;
  let key = await p.select({
    message: '変える項目',
    pageSize: 15,
    choices: [
      ...editable.map((k) => ({ name: `${pad(k, width)}${display(k, cfg.values[k])}  ← ${scopeNames[cfg.origins[k]] ?? '未設定'}`, value: k, description: specOf(k).description })),
      { name: '名前を入力する（repos.api.path など）', value: '\u0000' },
      { name: 'キーとトークン（zukai login で保存する）', value: '\u0001' },
    ],
  });
  if (key === '\u0001') {
    console.log('キーとトークンは、zukai login gemini か zukai login confluence で保存します。');
    return 0;
  }
  if (key === '\u0000') key = await p.input({ message: '項目の名前', validate: (x) => (specOf(x.trim()) ? true : `項目「${x}」はありません。zukai help config で一覧を表示します。`) }).then((x) => x.trim());
  const s = specOf(key);
  const action = await p.select({ message: `${key}（今の値: ${display(key, cfg.values[key])}、${scopeNames[cfg.origins[key]] ?? '未設定'}）`, choices: [{ name: '値を変える', value: 'set' }, { name: '設定ファイルから消して、既定値に戻す', value: 'unset' }] });
  const scopeChoices = s.scopes.map((sc) => ({ name: `${scopeNames[sc]}（${shown(cfg.files[sc])}）`, value: sc }));
  if (action === 'unset') {
    const r = unsetValue(project, key, cfg.origins[key] in cfg.files ? cfg.origins[key] : undefined);
    console.log(r ? `${shown(r.file)} から ${key} を消しました。` : `${key} はどの設定ファイルにも書かれていません。`);
    return 0;
  }
  const v = await askValue(key, cfg, `${key} の新しい値`);
  const sc = scopeChoices.length > 1 ? await p.select({ message: '書く場所', choices: scopeChoices }) : s.scopes[0];
  const stored = s.type === 'path' && v !== null ? coerce(key, path.relative(process.cwd(), v) || '.', sc, project) : v;
  const r = setValue(project, key, stored, sc);
  console.log(`${shown(r.file)}（${scopeNames[sc]}）の ${key} を ${display(key, stored)} にしました。`);
  warnShadowed(project, key, sc);
  return 0;
}

// --- login、logout ----------------------------------------------------------

const services = {
  gemini: { keys: ['gemini.apiKey'], name: 'Gemini' },
  confluence: { keys: ['confluence.email', 'confluence.token'], name: 'Confluence' },
};
const serviceOf = (name) => {
  if (services[name]) return services[name];
  const near = closest(name ?? '', Object.keys(services));
  throw new Error(`サービス「${name}」はありません。${near ? `「${near}」の書き間違いではありませんか。` : ''}gemini か confluence を書きます。`);
};

export async function login(name, { email } = {}) {
  serviceOf(name);
  const project = process.cwd();
  const cfg = loadConfig(null);
  if (name === 'gemini') {
    const key = await readSecret('Gemini の API キー: ');
    if (!key) throw new Error('キーが空です。保存しませんでした。');
    const r = setValue(project, 'gemini.apiKey', key, 'credentials');
    console.log(`${shown(r.file)} に Gemini の API キーを保存しました。`);
  } else {
    if (!email) {
      if (!process.stdin.isTTY) throw new Error('端末でないときは、--email=アドレス でメールアドレスを渡し、トークンを標準入力に流します。');
      email = (await (await ui()).input({ message: 'Atlassian アカウントのメールアドレス', default: cfg.values['confluence.email'] ?? '' })).trim();
    }
    const token = await readSecret('Atlassian の API トークン: ');
    if (!email || !token) throw new Error('メールアドレスかトークンが空です。保存しませんでした。');
    setValue(project, 'confluence.email', email, 'credentials');
    const r = setValue(project, 'confluence.token', token, 'credentials');
    console.log(`${shown(r.file)} に Confluence のメールアドレスと API トークンを保存しました。`);
  }
  for (const k of services[name].keys) {
    const env = spec[k].env;
    if (process.env[env]) console.log(`環境変数 ${env} が設定されているので、${k} はそちらが優先されます。`);
  }
  return 0;
}

export async function logout(name) {
  const s = serviceOf(name);
  const removed = s.keys.filter((k) => unsetValue(process.cwd(), k, 'credentials'));
  console.log(removed.length ? `${s.name} の ${removed.join('、')} を消しました。` : `${s.name} の値は保存されていません。`);
  return 0;
}
