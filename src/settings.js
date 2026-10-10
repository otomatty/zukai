// 設定。プロジェクトの .zukai/settings.json と、ホームの ~/.zukai/settings.json を読む。
// API キーはホームの設定か環境変数にだけ置く。プロジェクトのフォルダを人に渡しても、キーが一緒に渡らないようにするため。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const projectSettingsPath = (project) => path.join(project, '.zukai', 'settings.json');
export const homeSettingsPath = () => path.join(os.homedir(), '.zukai', 'settings.json');

export const defaults = () => ({
  output: 'document',
  video: {
    model: 'gemini-3.8-flash-tts',
    voice: 'Kore',
    style: '落ち着いた声で、好奇心をくすぐるように語る',
    bgm: null,
    sfx: { enabled: true, volume: 0.5, files: { pop: null, whoosh: null, draw: null, chime: null } },
  },
});

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`${file} を読めません。${e.message}`);
  }
};

// 既定値に、ホーム、プロジェクトの順で重ねる。sfx.files のような入れ子も1段ずつ重ねる。
const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
};

export function loadSettings(project) {
  const home = readJson(homeSettingsPath());
  const { gemini, ...proj } = readJson(projectSettingsPath(project));
  const warnings = [];
  if (gemini?.apiKey) warnings.push(`${projectSettingsPath(project)} の gemini.apiKey は読みません。キーは環境変数 GEMINI_API_KEY か ${homeSettingsPath()} に置いてください。`);
  const { gemini: homeGemini, ...homeRest } = home;
  const settings = merge(merge(defaults(), homeRest), proj);
  settings.apiKey = process.env.GEMINI_API_KEY || homeGemini?.apiKey || null;
  // 相対パスは .zukai のフォルダから解決する。ホームの設定に書くときは絶対パスで書く。
  const base = path.join(project, '.zukai');
  if (settings.video.bgm) settings.video.bgm = path.resolve(base, settings.video.bgm);
  for (const [k, v] of Object.entries(settings.video.sfx.files)) if (v) settings.video.sfx.files[k] = path.resolve(base, v);
  return { settings, warnings };
}

// init が書くプロジェクトの設定。すでにあれば上書きしない。
export function writeProjectSettings(project, output) {
  const file = projectSettingsPath(project);
  if (fs.existsSync(file)) return { file, written: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ignore = path.join(project, '.zukai', '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  fs.writeFileSync(file, JSON.stringify({ output, video: defaults().video }, null, 2) + '\n');
  return { file, written: true };
}

// ホームの設定に API キーを書く。ほかの項目は残す。
export function writeApiKey(key) {
  const file = homeSettingsPath();
  const cur = readJson(file);
  cur.gemini = { ...cur.gemini, apiKey: key };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // ponytail: Windows では mode が効かない。共有の PC で使うなら、ホームのフォルダの権限で守る。
  fs.writeFileSync(file, JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
  return file;
}
