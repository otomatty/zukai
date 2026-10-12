// 設定とデザインのテーマを読み、確かめるときの文。ja と en を同じキーで持ち、設定の lang に合わせて出す。
// 言語は、コマンドの入口（src/cli.ts）が利用者の設定から決めて setMessageLang で切り替える。決める前と、決められないときは日本語。
// config.ts と theme.ts から読むので、このファイルは型のほかは何も読まない（読み込みが循環しないため）。
import type { Lang } from './locale.ts';

const catalog = {
  'common.didYouMean': { ja: '「{near}」の書き間違いではありませんか。', en: 'Did you mean "{near}"? ' },
  'common.quoted': { ja: '「{text}」', en: '"{text}"' },

  'scope.team': { ja: 'チーム', en: 'team' },
  'scope.local': { ja: '手元', en: 'this project' },
  'scope.user': { ja: 'この PC', en: 'this PC' },
  'scope.credentials': { ja: '本人だけ', en: 'private' },
  'scope.env': { ja: '環境変数', en: 'environment variable' },
  'scope.default': { ja: '既定値', en: 'default' },

  // 設定の値の検査（src/config.ts の invalid）。
  'value.nullDefault': { ja: 'null は書けません。既定値（{default}）に戻すときは、zukai config unset で項目を消します。', en: 'null is not allowed. To go back to the default ({default}), remove the key with zukai config unset.' },
  'value.enum': { ja: '{values} のどれかを書いてください。', en: 'Write one of {values}.' },
  'value.string': { ja: '文字列で書いてください。', en: 'Write a string.' },
  'value.urlQuery': { ja: '? や # を含まない URL を書いてください（例: https://example.atlassian.net/wiki）。', en: 'Write a URL without ? or # (example: https://example.atlassian.net/wiki).' },
  'value.url': { ja: 'http か https で始まり、接続先のホスト名を含む URL を書いてください。', en: 'Write a URL that starts with http or https and includes a host name.' },
  'value.number': { ja: '数値で書いてください。', en: 'Write a number.' },
  'value.range': { ja: '{min}〜{max} の数値で書いてください。', en: 'Write a number from {min} to {max}.' },
  'value.boolean': { ja: 'true か false で書いてください。', en: 'Write true or false.' },
  'value.array': { ja: '配列で書いてください。', en: 'Write an array.' },
  'value.term': { ja: '{n}番目の用語に誤りがあります。use は文字列、avoid、except、examples は文字列の配列、actual は文字列で書いてください。', en: 'Term {n} is invalid. Write use as a string, avoid, except, and examples as arrays of strings, and actual as a string.' },

  // 設定ファイルと環境変数を読むとき（src/config.ts）。
  'config.unknownKey': { ja: '項目「{key}」はありません。{near}項目の一覧は zukai help config で確かめられます。', en: 'There is no setting "{key}". {near}See zukai help config for the list of settings.' },
  'config.secretFile': { ja: '{key} は秘密の値なので、{file} には書けません。zukai login で ~/.zukai/credentials.json に保存するか、環境変数 {env} に置いてください。', en: '{key} is a secret, so it cannot be written in {file}. Save it to ~/.zukai/credentials.json with zukai login, or set the {env} environment variable.' },
  'config.scopeOnly': { ja: '{key} は、{scopes}の設定にだけ書けます。', en: '{key} can only be written in the {scopes} settings.' },
  'config.invalidValue': { ja: '{key} の値が正しくありません。{why}', en: 'The value of {key} is invalid. {why}' },
  'config.notObject': { ja: '{file} は JSON のオブジェクトで書いてください。', en: 'Write {file} as a JSON object.' },
  'config.unreadable': { ja: '{file} を読めません。{error}', en: 'Could not read {file}. {error}' },
  'config.envInvalid': { ja: '環境変数 {env} の値が正しくありません。{why}', en: 'The {env} environment variable has an invalid value. {why}' },
  'config.problems': { ja: '設定に誤りがあります。\n{lines}\nzukai config list で、効いている値と出どころを確かめられます。', en: 'Settings have errors.\n{lines}\nRun zukai config list to see the values in effect and where they come from.' },
  'config.jsonArray': { ja: '{key} は JSON の配列で書いてください。zukai.config.json を直接編集することもできます。', en: 'Write {key} as a JSON array. You can also edit zukai.config.json directly.' },
  // zukai config と zukai setup が、設定の誤りを示すときの文（src/setup.ts）。
  'config.getUnknown': { ja: '項目「{key}」はありません。項目の一覧は zukai help config で表示します。', en: 'There is no setting "{key}". See zukai help config for the list of settings.' },
  'config.listProblems': { ja: '\n設定の誤り', en: '\nSettings errors' },
  'config.emptyFlag': { ja: '--{flag} を空にはできません。既定値に戻すときは zukai config unset {key} を実行します。', en: '--{flag} cannot be empty. To go back to the default, run zukai config unset {key}.' },

  // テーマの tokens.json を読むとき（src/theme.ts）。
  'theme.noKey': { ja: '{key} という項目はありません。使える項目は zukai theme init で作る tokens.json にあります。', en: 'There is no item {key}. The available items are listed in the tokens.json that zukai theme init creates.' },
  'theme.noKeyShort': { ja: '{key} という項目はありません。', en: 'There is no item {key}.' },
  'theme.fixed': { ja: '{key} はテーマでは変えられません。図の幅と動画の大きさは、検査の上限が前提にしています。', en: '{key} cannot be changed by a theme. The check limits depend on the figure width and the video size.' },
  'theme.object': { ja: '{key} は、{ } の中に項目を書きます。', en: 'Write {key} as items inside { }.' },
  'theme.colors': { ja: '{key} は、{counts}個の色（#rrggbb）の配列で書きます。{none}', en: '{key} must be an array of {counts} colors (#rrggbb).{none}' },
  'theme.colorsNone': { ja: '使わないときは [] にします。', en: ' Use [] when it is not used.' },
  'theme.positive': { ja: '{key} は、0より大きい数値で書きます。', en: '{key} must be a number greater than 0.' },
  'theme.atLeast': { ja: '{key} は、{min}以上の数値で書きます。', en: '{key} must be a number of {min} or more.' },
  'theme.range': { ja: '{key} は、{min}〜{max} の数値で書きます。', en: '{key} must be a number from {min} to {max}.' },
  'theme.choice': { ja: '{key} は、{values} のどれかを書きます。', en: '{key} must be one of {values}.' },
  'theme.notColor': { ja: '{key} の「{value}」は色ではありません。#rrggbb か #rgb で書きます。', en: '"{value}" in {key} is not a color. Use #rrggbb or #rgb.' },
  'theme.font': { ja: '{key} は、CSS の font-family の形（"名前", sans-serif のように、引用符で囲んだ名前か英数字の名前をカンマで並べる）で書きます。; { } < > \\ / * と改行は使えません。', en: '{key} must be a CSS font-family value (quoted or alphanumeric names separated by commas, like "Name", sans-serif). ; { } < > \\ / * and line breaks are not allowed.' },
  'theme.name': { ja: '{key} は、英数字とハイフンの名前で書きます。', en: '{key} must be a name of letters, digits, and hyphens.' },
  'theme.uses': { ja: '{key} の {value}', en: '{key}={value}' },
  'theme.gradient': { ja: '{uses}は、グラデーションで描きます。gradient.stops に2〜5個の色を書いてください。', en: 'A gradient is needed for {uses}. Write 2 to 5 colors in gradient.stops.' },
  'theme.noDir': { ja: 'テーマのフォルダ {dir} がありません。zukai theme init {dir} で作るか、設定の theme を直してください。', en: 'Theme folder {dir} does not exist. Create it with zukai theme init {dir}, or fix the theme setting.' },
  'theme.tokensObject': { ja: 'tokens.json は JSON のオブジェクトで書きます。', en: 'Write tokens.json as a JSON object.' },
  'theme.tokensUnreadable': { ja: 'tokens.json を読めません。{error}', en: 'Could not read tokens.json. {error}' },
  'theme.problems': { ja: 'テーマに誤りがあります。\n{lines}\nzukai theme check で確かめられます。', en: 'The theme has errors.\n{lines}\nRun zukai theme check to see them.' },
  'theme.previewProblems': { ja: 'テーマに誤りがあるので、見本を描けません。\n{lines}', en: 'The theme has errors, so the preview cannot be drawn.\n{lines}' },
  'theme.compareProblems': { ja: 'テーマに誤りがあるので、見比べられません。\n{lines}', en: 'The theme has errors, so the variants cannot be compared.\n{lines}' },
  'theme.head': { ja: 'テーマ「{name}」（{dir}）', en: 'Theme "{name}" ({dir})' },
  'theme.none': { ja: 'テーマなし（既定の見た目）', en: 'No theme (default look)' },

  // テーマの独自の型（types/<名前>/）を読むとき（src/theme.ts）。
  'type.fields': { ja: '{at} は、項目の名前と定義の { } で書きます。', en: 'Write {at} as { } of field names and definitions.' },
  'type.fieldName': { ja: '{where}: 項目の名前は英字で始め、type、theme、width 以外にします。', en: '{where}: field names start with a letter and cannot be type, theme, or width.' },
  'type.fieldType': { ja: '{where}: type は {types} のどれかを書きます。', en: '{where}: type must be one of {types}.' },
  'type.unknownKeys': { ja: '{where}: {names} は使えません。{type} の項目に書けるのは {allowed} です。', en: '{where}: {names} cannot be used. A {type} field can have {allowed}.' },
  'type.required': { ja: '{where}.required は true か false で書きます。', en: '{where}.required must be true or false.' },
  'type.desc': { ja: '{where}.desc は文で書きます。', en: '{where}.desc must be a sentence.' },
  'type.limitNumber': { ja: '{where}.{n} は数値で書きます。', en: '{where}.{n} must be a number.' },
  'type.limitInteger': { ja: '{where}.{n} は0以上の整数で書きます。', en: '{where}.{n} must be an integer of 0 or more.' },
  'type.minOverMax': { ja: '{where}: min（{min}）が max（{max}）より大きくなっています。', en: '{where}: min ({min}) is greater than max ({max}).' },
  'type.stringMax': { ja: '{where}: 文字の項目には max（全角の字数の上限）が要ります。図からはみ出さないことを、上限で保証するため。', en: '{where}: a string field needs max (the limit in full-width characters). The limit keeps the text inside the figure.' },
  'type.listMax': { ja: '{where}: 配列の項目には max（個数の上限）が要ります。', en: '{where}: a list field needs max (the maximum number of items).' },
  'type.listOf': { ja: '{where}: 配列の項目には of（要素の定義）が要ります。', en: '{where}: a list field needs of (the item definition).' },
  'type.dirName': { ja: '型の名前（フォルダの名前）は、英小文字で始め、英小文字、数字、ハイフンだけにします。', en: 'The type name (the folder name) must start with a lowercase letter and use only lowercase letters, digits, and hyphens.' },
  'type.noJson': { ja: 'type.json がありません。', en: 'type.json is missing.' },
  'type.jsonUnreadable': { ja: 'type.json を読めません。{error}', en: 'Could not read type.json. {error}' },
  'type.jsonObject': { ja: 'type.json は JSON のオブジェクトで書きます。', en: 'Write type.json as a JSON object.' },
  'type.builtin': { ja: '型の名前 {name} は、組み込みの型か zukai の部品と同じ名前です。別の名前にしてください。', en: 'The type name {name} is the same as a built-in type or a zukai module. Choose another name.' },
  'type.sentence': { ja: 'type.json の {key} を文で書きます。', en: 'Write {key} in type.json as a sentence.' },
  'type.example': { ja: 'type.json の example に、図の仕様の例を { } で書きます（type は書かない）。', en: 'Write example in type.json as an example figure spec in { } (without type).' },
  'type.exampleType': { ja: 'type.json の example に type は書きません。型の名前はフォルダの名前から付きます。', en: 'Do not write type in example in type.json. The type name comes from the folder name.' },
  'type.unknownNames': { ja: 'figure.svg: {names} は、type.json の fields にも、テーマの値（theme.〜）にもありません。', en: 'figure.svg: {names} is not in the fields of type.json or in the theme values (theme.*).' },
  'type.noSvg': { ja: 'figure.svg（図のひな形）がありません。', en: 'figure.svg (the figure template) is missing.' },
  'type.motion': { ja: 'motion.js を読めません。{error}', en: 'Could not read motion.js. {error}' },

  // ひな形（figure.svg）の書き方の誤り（src/template.ts）。
  'template.empty': { ja: '空の {{ }} があります（{pos}文字目）。', en: 'There is an empty {{ }} (at character {pos}).' },
  'template.unmatched': { ja: '{{/{name}}} に対応する {{#{name}}} がありません。', en: '{{/{name}}} has no matching {{#{name}}}.' },
  'template.unclosed': { ja: '{{#{name}}} が閉じていません。', en: '{{#{name}}} is not closed.' },
  'template.stray': { ja: '閉じていない {{ か、対応の無い }} があります。', en: 'There is an unclosed {{ or an unmatched }}.' },
  'template.group': { ja: '{{{name}}} は値ではなく、まとまりです。{{#{name}}} で中を書きます。', en: '{{{name}}} is a group, not a value. Write its contents with {{#{name}}}.' },
  'template.expr': { ja: '{{= {src}}} を読めません。数、名前、+ - * / %、かっこだけを使えます。', en: 'Cannot read {{= {src}}}. Only numbers, names, + - * / %, and parentheses are allowed.' },
  'template.expect': { ja: '{{= {src}}} の「{got}」の前に「{want}」が要ります。', en: '{{= {src}}} needs "{want}" before "{got}".' },
  'template.end': { ja: '終わり', en: 'the end' },
  'template.truncated': { ja: '{{= {src}}} が途中で終わっています。', en: '{{= {src}}} ends too early.' },
  'template.fn': { ja: '{{= {src}}} の関数「{fn}」は使えません。min、max、round、floor、ceil、width を使えます。', en: 'The function "{fn}" in {{= {src}}} is not allowed. Use min, max, round, floor, ceil, or width.' },
  'template.token': { ja: '{{= {src}}} の「{token}」を読めません。', en: 'Cannot read "{token}" in {{= {src}}}.' },
  'template.notNumber': { ja: '{{= }} の「{name}」は数値ではありません。', en: '"{name}" in {{= }} is not a number.' },
  'template.textMath': { ja: '{{= }} で、文字を計算に使っています。文字の幅は width(名前, 大きさ) で求めます。', en: '{{= }} uses text in a calculation. Get the width of text with width(name, size).' },

  // テーマの見た目の検査（src/theme.ts の checkTheme）。
  'check.contrast': { ja: '{kf}（{fg}）と {kb}（{bg}）のコントラストが {ratio}:1 です。{min}:1 以上にしてください。', en: 'The contrast between {kf} ({fg}) and {kb} ({bg}) is {ratio}:1. Make it at least {min}:1.' },
  'check.tint': { ja: 'gradient.stops[{i}] の淡い面', en: 'the light fill of gradient.stops[{i}]' },
  'check.subtitleBand': { ja: 'video.subtitle.band を video.background に重ねた色', en: 'video.subtitle.band over video.background' },
  'check.mutedPaper': { ja: '{key}.muted を紙に寄せた色', en: '{key}.muted blended toward the paper' },
  'check.onFill': { ja: '{where}の地色 {kb}（{bg}）に対して、{at}.onAccent（{onAccent}）も {at}.ink（{ink}）も、コントラストが {min}:1 に届きません（高いほうで {ratio}:1）。どちらかが届く色にしてください。', en: '{where} is filled with {kb} ({bg}). On it, neither {at}.onAccent ({onAccent}) nor {at}.ink ({ink}) reaches a contrast of {min}:1 (the higher one is {ratio}:1). Change one of them so it does.' },
  'check.heatmapCell': { ja: 'ヒートマップの最も濃いマス', en: 'The darkest heatmap cell' },
  'check.treemapGroup': { ja: 'ツリーマップの{n}つ目の階層', en: 'Treemap group {n}' },
  'check.seriesGap': { ja: '{key}.series の {a} と {b} は、{vision}で見分けにくい色です（差 {d}、{gap} 以上にする）。明るさか色相を離してください。', en: '{a} and {b} in {key}.series are hard to tell apart with {vision} (difference {d}; make it {gap} or more). Move their lightness or hue further apart.' },
  'check.codeTheme': { ja: 'codeTheme「{name}」は Shiki にありません。github-light、github-dark、one-light などの名前を書きます。', en: 'codeTheme "{name}" is not in Shiki. Use a name such as github-light, github-dark, or one-light.' },
  'vision.通常': { ja: '通常', en: 'typical color vision' },
  'vision.1型色覚': { ja: '1型色覚', en: 'protan color vision' },
  'vision.2型色覚': { ja: '2型色覚', en: 'deutan color vision' },
} satisfies Record<string, Record<Lang, string>>;

// 文の名前。名前の書き間違いは、型の検査で見つかる。
export type MessageKey = keyof typeof catalog;

// 見た目の検査の分類（ThemeFinding.what）。what は識別子として日本語のまま持ち、表示するときだけ言語に合わせる。
const findingLabels: Record<string, string> = {
  図の文字: 'Figure text',
  図の補足: 'Figure notes',
  強調の文字: 'Accent text',
  強調の上の文字: 'Text on accent',
  強調した箱の文字: 'Text in accented boxes',
  強調した箱の補足: 'Notes in accented boxes',
  グラデーションの色: 'Gradient colors',
  系列の色: 'Series colors',
  灰色の系列: 'Gray series',
  ヒートマップの数値: 'Heatmap values',
  ツリーマップの文字: 'Treemap text',
  残りの系列: 'Remaining series',
  系列の見分け: 'Telling series apart',
  ブランチの名前: 'Branch names',
  ブランチの色: 'Branch colors',
  ページ: 'Page',
  画面の注釈: 'Screenshot notes',
  動画の文字: 'Video text',
  字幕: 'Subtitles',
  コードの配色: 'Code colors',
  値: 'Values',
  独自の型: 'Custom types',
};

let current: Lang = 'ja';

export function setMessageLang(lang: unknown): void {
  current = lang === 'en' ? 'en' : 'ja';
}
export const messageLang = (): Lang => current;

// 文を今の言語で作る。{名前} を vars の値に置き換える。置き換えは1回だけ行い、値の中の { } はそのまま残す。
export function msg(key: MessageKey, vars: Record<string, unknown> = {}): string {
  const row: Record<Lang, string> | undefined = catalog[key];
  if (!row) throw new Error(`文「${key}」はありません。`);
  return (row[current] ?? row.ja).replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? String(vars[k]) : m));
}

// 並べた語をつなぐ。list は「a、b」、or は「aかb」、and は「aとb」。英語では a, b, or c のようにつなぐ。
// listOr は、日本語では「、」で並べ、英語では or でつなぐ（「2、3、4個の色」と「2, 3, or 4 colors」）。
export function joinList(items: readonly unknown[], kind: 'list' | 'or' | 'and' | 'listOr' = 'list'): string {
  const xs = items.map(String);
  if (current === 'ja') return xs.join({ list: '、', or: 'か', and: 'と', listOr: '、' }[kind]);
  if (kind === 'list' || xs.length < 2) return xs.join(', ');
  const word = kind === 'and' ? 'and' : 'or';
  return xs.length === 2 ? `${xs[0]} ${word} ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, ${word} ${xs.at(-1)}`;
}

// 書き間違いの候補を添える文。候補が無ければ空。
export const didYouMean = (near: string | null | undefined): string => (near ? msg('common.didYouMean', { near }) : '');

export function findingLabel(what: string): string {
  return current === 'en' ? findingLabels[what] ?? what : what;
}
export const findingLabelGaps = (whats: Iterable<string>): string[] => [...whats].filter((w) => !Object.hasOwn(findingLabels, w));

// ja か en の欠けた文と、ja と en で {名前} の食い違う文。
export function messageGaps(): string[] {
  const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');
  return Object.entries(catalog as Record<string, Record<Lang, string>>)
    .filter(([, row]) => !row.ja || !row.en || names(row.ja) !== names(row.en))
    .map(([k]) => k);
}
