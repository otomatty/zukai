// zukai setup と zukai doctor の表示文。ja と en を同じキーで持つ。
// 対話の最初の言語選択だけは、選ぶ前なので両方の言葉をそのまま出す。

const catalog = {
  'project.team': { ja: '（zukai.config.json があります。チームの設定を読みました）', en: ' (zukai.config.json is present. Team settings were loaded)' },
  'project.noteam': { ja: '（zukai.config.json はまだありません）', en: ' (zukai.config.json does not exist yet)' },
  project: { ja: 'プロジェクト  {path}{note}', en: 'Project  {path}{note}' },
  'config.problems': { ja: '設定に誤りがあります。最後の確認で表示します。', en: 'Settings have errors. They will be shown in the final check.' },

  'skills.where': { ja: 'スキル（返答を資料にする手順と、資料からデザインのテーマを作る手順）を書く場所', en: 'Where to install the skills (turning answers into documents, and making a design theme from a document)' },
  'skills.project': { ja: 'このプロジェクト（{path}/.claude/skills など）', en: 'This project ({path}/.claude/skills and similar)' },
  'skills.user': { ja: 'この PC の全プロジェクト（~/.claude/skills など）', en: 'All projects on this PC (~/.claude/skills and similar)' },
  'skills.none': { ja: '書かない', en: 'Do not install' },
  'skills.tools': { ja: 'スキルを読ませる AI ツール', en: 'AI tools that should read the skills' },
  'skills.claude': { ja: 'Claude Code（.claude/skills）', en: 'Claude Code (.claude/skills)' },
  'skills.agents': { ja: 'Codex、Cursor、GitHub Copilot、Devin など（.agents/skills）', en: 'Codex, Cursor, GitHub Copilot, Devin, and similar (.agents/skills)' },

  'output.team': { ja: '（チームの設定: {value}）', en: ' (team setting: {value})' },
  output: { ja: '出力{team}', en: 'Output{team}' },
  'video.voice': { ja: '動画の声', en: 'Narration voice' },
  'video.style': { ja: '動画全体の語り口', en: 'Narration style for the whole video' },
  'video.bgm': { ja: 'BGM のファイル', en: 'BGM file' },
  'enum.output.document': { ja: '資料だけ', en: 'Document only' },
  'enum.output.video': { ja: '資料と動画', en: 'Document and video' },
  'hint.defaultMark': { ja: '{value}（既定）', en: '{value} (default)' },
  'hint.other': { ja: 'その他（名前を入力する）', en: 'Other (type a name)' },
  'hint.name': { ja: '{key} の名前', en: 'Name for {key}' },
  'hint.nameRequired': { ja: '名前を入力してください。', en: 'Enter a name.' },
  'hint.pathEmpty': { ja: '（今いるフォルダからのパス。空ならなし）', en: ' (path from the current folder. Empty means none)' },
  'hint.pathDefault': { ja: '（今いるフォルダからのパス。空なら既定値）', en: ' (path from the current folder. Empty means the default)' },
  'hint.empty': { ja: '（空ならなし）', en: ' (empty means none)' },
  'hint.default': { ja: '（空なら既定値）', en: ' (empty means the default)' },

  'gemini.env': { ja: 'Gemini の API キー: 環境変数 GEMINI_API_KEY を使います。', en: 'Gemini API key: using the GEMINI_API_KEY environment variable.' },
  'gemini.note': { ja: 'ナレーションの読み上げに、Gemini の API キーを使います。無料枠のキーでは、地域と利用規約によって、送った文が Google の製品改善に使われることがあります。', en: 'Narration is spoken with a Gemini API key. On the free tier, depending on region and the terms, text you send may be used to improve Google products.' },
  'gemini.keep': { ja: 'Gemini の API キー（Enter で今のキーのまま）', en: 'Gemini API key (Enter keeps the current key)' },
  'gemini.skip': { ja: 'Gemini の API キー（Enter で後回し。無音の動画になります）', en: 'Gemini API key (Enter skips this. The video will be silent)' },

  'share.where': { ja: '資料の共有先', en: 'Where to share the document' },
  'share.file': { ja: 'ファイル（HTML）だけ', en: 'File (HTML) only' },
  'share.confluence': { ja: 'Confluence にも登録する', en: 'Also publish to Confluence' },
  'confluence.base': { ja: 'Confluence の URL（例: https://example.atlassian.net/wiki）', en: 'Confluence URL (example: https://example.atlassian.net/wiki)' },
  'confluence.space': { ja: 'ページを作るスペースの ID', en: 'Space ID where the page is created' },
  'confluence.parent': { ja: '親ページの ID（空ならスペースの直下）', en: 'Parent page ID (empty means the top of the space)' },
  'confluence.email': { ja: 'Atlassian アカウントのメールアドレス', en: 'Atlassian account email' },
  'confluence.tokenKeep': { ja: 'Atlassian の API トークン（Enter で今のトークンのまま）', en: 'Atlassian API token (Enter keeps the current token)' },
  'confluence.tokenSkip': { ja: 'Atlassian の API トークン（Enter で後回し）', en: 'Atlassian API token (Enter skips this)' },

  'scope.where': { ja: '変える値（{keys}）を、どこに書きますか', en: 'Where should these changes ({keys}) be written?' },
  'scope.teamChoice': { ja: 'チームに共有する（zukai.config.json。コミットして共有する）', en: 'Share with the team (zukai.config.json, committed)' },
  'scope.localChoice': { ja: '自分だけ（.zukai/config.json。Git の管理に入らない）', en: 'Just me (.zukai/config.json, not committed)' },
  'scope.team': { ja: 'チーム', en: 'team' },
  'scope.local': { ja: '手元', en: 'this project' },
  'scope.user': { ja: 'この PC', en: 'this PC' },
  'scope.credentials': { ja: '本人だけ', en: 'private' },
  'scope.env': { ja: '環境変数', en: 'environment variable' },
  'scope.default': { ja: '既定値', en: 'default' },

  'plan.title': { ja: '\n書き込む内容', en: '\nWhat will be written' },
  'plan.create': { ja: '作る', en: 'create' },
  'plan.write': { ja: '書く', en: 'write' },
  'plan.update': { ja: '新しくする', en: 'update' },
  'plan.none': { ja: '変更はありません。', en: 'No changes.' },
  'plan.confirm': { ja: 'この内容で書き込みますか', en: 'Write this?' },
  'plan.cancel': { ja: '何も書き込んでいません。', en: 'Nothing was written.' },
  'plan.wrote': { ja: '書き込みました。', en: 'Wrote the settings.' },
  'plan.equiv': { ja: '\n同じ設定を、対話なしで行うコマンド{shell}:\n  {cmd}', en: '\nThe same setup, without questions{shell}:\n  {cmd}' },
  'plan.shell': { ja: '（PowerShell）', en: ' (PowerShell)' },
  'plan.login': { ja: '  キーとトークンは、それぞれ zukai login gemini、zukai login confluence で保存します。', en: '  Save keys and tokens with zukai login gemini and zukai login confluence.' },

  'doctor.head': { ja: '確認  プロジェクト {path}', en: 'Check  project {path}' },
  'doctor.footer': { ja: '✘ の項目は、今の設定で使うのに足りません。→ のコマンドで直せます。', en: 'Items marked ✘ are required for the current settings. The command after → fixes them.' },
  'doctor.node': { ja: 'Node', en: 'Node' },
  'doctor.nodeFix': { ja: 'Node {range} を入れてください。依存パッケージがこの版を求めます。', en: 'Install Node {range}. Dependencies require this version.' },
  'doctor.deps': { ja: '依存パッケージ', en: 'Dependencies' },
  'doctor.depsMissing': { ja: '{names} がありません', en: '{names} missing' },
  'doctor.cmd': { ja: 'zukai コマンド', en: 'zukai command' },
  'doctor.cmdMissing': { ja: 'PATH にありません。スキルには node と CLI の絶対パスを書きます', en: 'Not on PATH. Skills will call node with the CLI path' },
  'doctor.cmdFix': { ja: '{cmd}（そのあと zukai setup skills でスキルを新しくする）', en: '{cmd} (then run zukai setup skills to refresh the skills)' },
  'doctor.settings': { ja: '設定', en: 'Settings' },
  'doctor.settingsFix': { ja: '設定ファイルを直すか、zukai config unset <項目> で消してください。', en: 'Fix the settings file, or remove the key with zukai config unset <key>.' },
  'doctor.skills': { ja: 'スキル', en: 'Skills' },
  'doctor.skillsNone': { ja: 'どこにも書かれていません', en: 'Not installed anywhere' },
  'doctor.stale': { ja: '（古い）', en: ' (out of date)' },
  'doctor.missing': { ja: '（無い）', en: ' (missing)' },
  'doctor.theme': { ja: 'テーマ', en: 'Theme' },
  'doctor.themeSkip': { ja: '設定していません。zukai の既定の見た目で描きます', en: 'Not set. Figures use the default zukai look' },
  'doctor.themeRead': { ja: 'テーマを読めません。{message}', en: 'Could not read the theme. {message}' },
  'doctor.captureNote': { ja: '（撮影と動画で使う）', en: ' (used for screenshots and video)' },
  'doctor.videoNote': { ja: '（動画で使う）', en: ' (used for video)' },
  'doctor.absent': { ja: 'ありません', en: 'Not installed' },
  'doctor.chromiumFix': { ja: '{cmd}（別の Chromium を使うときは zukai config set chromium <パス> --scope=user）', en: '{cmd} (to use another Chromium: zukai config set chromium <path> --scope=user)' },
  'doctor.ffmpegFix': { ja: 'ffmpeg を入れて、コマンドのパスに入れてください（macOS は brew install ffmpeg）。', en: 'Install ffmpeg and put it on PATH (on macOS: brew install ffmpeg).' },
  'doctor.gemini': { ja: 'Gemini の API キー', en: 'Gemini API key' },
  'doctor.geminiMissing': { ja: 'ありません。字幕だけの無音の動画になります{note}', en: 'Missing. The video will be silent, with subtitles only{note}' },
  'doctor.confluenceSkip': { ja: '使わない設定です', en: 'Not in use' },
  'doctor.confluenceMissing': { ja: '{keys} がありません', en: '{keys} missing' },
  'doctor.space': { ja: 'Confluence のスペース ID', en: 'Confluence space ID' },
  'doctor.spaceMissing': { ja: 'ありません。初回の publish でページを作れません', en: 'Missing. The first publish cannot create a page' },
  'doctor.spaceFix': { ja: 'zukai config set confluence.spaceId スペースID（publish に --space-id=スペースID を付けてもよい）', en: 'zukai config set confluence.spaceId <id> (or pass --space-id=<id> to publish)' },
};

export function hasPhrase(key) {
  return Object.hasOwn(catalog, key);
}

export function t(lang, key, vars = {}) {
  const row = catalog[key];
  if (!row) throw new Error(`表示文「${key}」はありません。`);
  let s = row[lang] ?? row.ja;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function phraseGaps() {
  return Object.entries(catalog).filter(([, row]) => !row.ja || !row.en).map(([k]) => k);
}

// 保存済みならその言語。無ければ OS のロケール。どちらでもなければ日本語。
export function suggestedLang(cfg) {
  if (cfg.origins.lang && cfg.origins.lang !== 'default') return cfg.values.lang;
  const loc = (process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
  if (loc.startsWith('en')) return 'en';
  return 'ja';
}
