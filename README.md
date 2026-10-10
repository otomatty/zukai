# zukai

zukai は、図が主役の日本語資料を AI に書かせ、AI を使わない Lint で検査するハーネスです。対象は、設計書や社内説明資料のような縦長のドキュメントです。

名前は仮のものです。`package.json` の `name` と `skills/zukai` を変えれば改名できます。

## 仕組み

AI は Markdown の原稿だけを書きます。Lint は原稿の構造、図の仕様、文章を検査します。合格した原稿を、テンプレートが HTML に変換します。

| 役割 | 置き場所 | 内容 |
|---|---|---|
| 契約 | `contract/` | 文字数や図の要素数の上限（`limits.json`）、色とフォント（`tokens.json`） |
| 図の型 | `src/figures/` | 型ごとに、仕様の検証と SVG の描画を1ファイルで持つ |
| Lint | `src/lint/` | 自作ルール21個と textlint |
| 指示 | `prompts/` | 書き方の規約と例1つ（`base.md`）、後から足した指示（`model-notes.md`） |
| 評価 | `corpus/` | 良い原稿と悪い原稿、発火を期待するルール |
| 実績 | `logs/` | Lint の実行記録 |

`zukai prompt` と `zukai type` は、`contract/limits.json` と `src/figures/` から指示を組み立てます。型が21種類あるので、最初に渡すのは型の一覧だけにし、書き方の詳細は使う型が決まってから取り出します。上限や図の型を変えると、指示と検査の両方が同時に変わります。

## 使い方

```bash
npm install
node src/cli.js prompt                       # AI に渡す指示を出力する（図の型は一覧だけ）
node src/cli.js prompt --chat                # チャットの返答の書き方を出力する
node src/cli.js type flow bar                # 指定した型の書き方と上限を出力する
node src/cli.js figures --png < 返答.md       # 返答の中の図を描き、JSON で出力する
node src/cli.js icons lambda                 # 図に使えるアイコンの名前を探す
node src/cli.js capture 原稿.md               # screenshot の URL を撮影し、枠の位置を記録する
node src/cli.js lint 原稿.md --model=モデル名  # 検査する。error が1件でもあれば終了コード1
node src/cli.js build 原稿.md                 # 原稿.html を書き出す
node src/cli.js build 原稿.md --format=confluence  # Confluence 用のフォルダを書き出す
node src/cli.js publish 原稿.md --space-id=ID  # Confluence Cloud にページを作る。2回目以降は更新する
node src/cli.js extract 原稿.html             # HTML に埋め込んだ原稿を取り出す
node src/cli.js corpus                       # Lint 自体が期待どおりに動くか確認する
node src/cli.js stats                        # ルールごとの実績を表示する
```

Claude Code から使う場合は、`skills/zukai/SKILL.md` をスキルとして読み込ませます。SKILL.md は手順だけを持ち、書き方は `zukai prompt` の出力に任せています。

## 共有先ごとの出力

原本は Markdown の原稿です。共有する HTML と Confluence のページは、原稿から作る生成物です。原稿を生成物と一緒に運ぶので、Git のリポジトリがなくても、受け取った人が原稿を編集して作り直せます。

| 共有先 | 出力 | 原稿の運び方 |
|---|---|---|
| ファイル | 図を埋め込んだ1枚の HTML。PDF は、ブラウザで開いて印刷する | HTML の中に埋め込む。`extract` で取り出す |
| Confluence | 本文（`body.xhtml`、ストレージ形式）、図の PNG、`meta.json` を入れたフォルダ | 原稿の `.md` をページに添付する |

PNG の日本語フォントは、OS に標準で入っているもの（macOS はヒラギノ角ゴ、Windows は Yu Gothic UI、それ以外は Noto Sans CJK JP）を使います。変えたいときは、環境変数 `ZUKAI_PNG_FONT` にフォント名を指定します。

Confluence のページは、本文に HTML や SVG を直接書けません。図は PNG の添付ファイルにして、本文から参照します。ページの先頭には「このページは生成物で、直接編集すると上書きされる」という注意書きが入ります。

### Confluence Cloud への登録

`publish` は、Lint に合格した原稿だけを登録します。認証には、Atlassian アカウントのメールアドレスと API トークンを使います。API トークンは環境変数にだけ置き、原稿やリポジトリには書きません。

```bash
export CONFLUENCE_BASE=https://example.atlassian.net/wiki
export CONFLUENCE_EMAIL=you@example.com
export CONFLUENCE_TOKEN=APIトークン

node src/cli.js publish 原稿.md --space-id=スペースID --parent-id=親ページID  # 初回
node src/cli.js publish 原稿.md                                              # 2回目以降
```

| 回 | `publish` が行うこと |
|---|---|
| 初回 | ページを作り、原稿の先頭に `<!-- zukai-confluence ページID -->` を書き込み、図と原稿を添付する |
| 2回目以降 | 原稿のページ ID を読み、図と原稿の添付を置き換え、本文を新しい版として更新する |

ページ ID は添付の原稿にも入ります。ページから原稿をダウンロードした人は、`--space-id` を指定せずに同じページを更新できます。

`build --format=confluence` は、登録せずに同じ内容をフォルダへ書き出します。登録前に本文を確認するときに使います。

## チャットの返答

このリポジトリは、Claude Code のプラグインとしても読み込めます。プラグインの mod は、普段のチャットの返答を zukai の書き方にし、返答の中の `yaml figure` と `svg figure` のブロックを図にします。

| 使う場所 | 図の出し方 |
|---|---|
| Desktop アプリの Code タブ | 返答の中に、図を SVG で描く |
| ターミナルの `claude` | 返答の中に、図を PNG で描く。kitty の画像表示に対応しないターミナル（Windows Terminal、VS Code の統合ターミナルなど）では、PNG のパスを出す |
| VS Code 拡張のチャット欄 | 返答が終わったら、図を PNG にしてエディタのタブで開く。チャット欄には mod の描画が出ないため |

返答の書き方は `zukai prompt --chat` の出力で、mod がセッションの開始時にシステムプロンプトへ足します。返答には Lint をかけません。書き方を間違えた図は、YAML のまま表示されます。

mod は Claude Code 2.1.296 以降で動きます。図は Node で描くので、先に `npm install` を実行してから、次のどちらかで読み込みます。

```bash
claude --plugin-dir /path/to/zukai
```

Desktop アプリと VS Code 拡張では、`~/.claude/settings.json` の `env` に `"CLAUDE_CODE_PLUGIN_DIRS": "/path/to/zukai"` を書きます。

VS Code 拡張は、図を `code -r` で開きます。Cursor も `code` コマンドを入れます。別のコマンドで開くときは、環境変数 `ZUKAI_EDITOR` に指定します。PNG は一時フォルダの `zukai-figures` に書き出します。

`zukai figures` は、返答を標準入力から読み、図ごとの行の範囲、SVG、PNG のパスを JSON で返します。mod はこのコマンドだけを呼びます。

## 原稿の形

1つのセクションは、主張文、図、説明文の順に並べます。完全な例は `corpus/good/login.md` にあります。

````markdown
## ログイン要求の経路

ログイン要求は、ゲートウェイ、認証サービス、セッションDBの順に通ります。

```yaml figure
type: flow
steps:
  - label: ゲートウェイ
    note: 要求を受け付ける
  - label: 認証サービス
    emphasis: true
  - label: セッションDB
```

認証サービスは、照合に成功するとセッションIDを発行します。
````

図は、`yaml figure`（型のある図）か `svg figure`（自由な図）のコードブロック、または Markdown の表です。GitHub とエディタのプレビューでは、どちらもコードとして表示されます。図として見るには `build` を実行します。

本文を持たず、直後に `###` が続く `##` は、まとめ役の見出しとして検査から外れます。

## コードブロック

コードブロックには言語名を書きます。HTML では、生成時に Shiki が色を付けて埋め込みます。配色は `contract/tokens.json` の `codeTheme` で変えます。Confluence では、コードマクロが言語名に従って色を付けます。出力やログのように言語がないものは `text` と書きます。

## 図の型

図は、次の順に選びます。この順番は、AI に渡す指示（`zukai prompt`）と、スキルの手順にも入っています。

1. 説明する対象に実物の画面があるときは、`screenshot` で実物を示す。画面を図で描き直さない
2. 実物の画面がない内容は、データの形に合う型を選ぶ
3. どの型にも合わない、または型では伝わらないと AI が判断したときは、`free` で SVG を直接書く

| 型 | 用途 | 上限 |
|---|---|---|
| `screenshot` | 実際の画面への枠と番号 | 枠6個 |
| `flow` | 順番に進む処理や手順 | 6手順 |
| `layers` | 層になった構成 | 4層、1層あたり4要素 |
| `sequence` | 複数の登場者のやり取り | 4登場者、やり取り8本 |
| `branch` | 1つの条件による分岐 | 4通り |
| `timeline` | 日付の決まった出来事の並び | 5個 |
| `swimlane` | 担当別の手順の受け渡し | 4レーン、6手順 |
| `state` | 状態の移り変わり | 5状態、8本 |
| `gantt` | 作業の期間と順番。日、週、月の刻みは自動で決まる | 12作業、4グループ、400日 |
| `gitgraph` | ブランチの分岐と取り込み | 4ブランチ、12コミット |
| `tree` | 部品への分解 | 4部品、1部品あたり4要素 |
| `zones` | 領域の境界と、境界をまたぐ接続。アイコンと入れ子の枠も使える | 5領域、1領域あたり3要素 |
| `compare` | 変更前と変更後の構成 | 3段、1段あたり3個 |
| `venn` | 2つか3つの集合の重なり | 3集合。1つの場所に2〜4項目 |
| `bar` | 項目同士の大小の比較 | 8項目 |
| `line` | 時間による変化 | 3系列、12時点 |
| `stack` | 全体に占める内訳 | 5項目 |
| `progress` | 目標に対する達成度 | 6項目 |
| `scatter` | 2つの量の関係 | 200点 |
| `heatmap` | 2つの軸の組み合わせごとの量 | 横12項目、縦8項目 |
| `sankey` | 量の流れと枝分かれ | 10箱、12本 |
| `boxplot` | 値のばらつき | 6項目 |
| `treemap` | 階層のある内訳 | 3グループ、12項目 |
| `free` | 型のない自由な図。SVG を直接書く | 高さ560、文字30個、文字は12px以上 |

### 自由な図

型に合わない図は、`svg figure` のコードブロックに SVG を直接書きます。マトリクスや格子状の配置のように、位置や重なりに意味がある図に向きます。

````markdown
```svg figure
<svg viewBox="0 0 720 120">
  <title>図が何を示すかを1文で書く</title>
  <rect class="zk-box" x="20" y="30" width="200" height="60" rx="6"/>
  <text class="zk-text" x="120" y="65" text-anchor="middle">箱の名前</text>
</svg>
```
````

自由に書ける代わりに、型が保証していた品質を Lint で確かめます。

| 検査 | 内容 |
|---|---|
| 使える要素と属性（F001） | 図形、文字、グラデーション、矢印の印だけ。script、画像、外部の参照、style は使えない |
| 色（F001） | `contract/tokens.json` にある色だけ。箱と線は `zk-box` や `zk-line` の class で書ける |
| 文字の大きさ（F001） | 12px 以上 |
| 題名（F001） | `title` 要素が必須。読み上げと、利用実績の集計に使う |
| 文字の収まり（F002） | 文字が図の外に出ない、箱からはみ出さない、文字どうしが重ならない |

出力する SVG は、検査を通った要素と属性から組み立て直します。原稿に書かれた文字列を、そのまま HTML に入れません。使える class、色、要素の一覧は `zukai type free` で確認できます。

文字の収まりは、文字数から見積もった幅で確かめます。平行移動以外の transform を付けた文字と、曲線に沿った文字は検査できません。

`stats` は、図の型ごとの利用数と、自由な図の題名を表示します。同じ形の自由な図が増えたら型にする候補、使われない型は削る候補です。

`gitgraph` の見た目は、Mermaid の gitGraph（テーマ redux-color）に合わせています。破線のレーン、左端のブランチ名の札、斜めに書くコミットのラベル、荷札の形のタグ、白抜きの取り込みコミットを同じ形で描きます。色は `contract/tokens.json` の `gitgraph` にあり、Mermaid のほかのテーマの色に差し替えられます。

`bar` から `treemap` までの9種類は Apache ECharts で描きます。割合、四分位数、傾向の直線は、原稿の値から自動で計算します。原稿に ECharts の設定は書かず、型の項目（単位、項目、系列）だけを書きます。配色と線の太さは `contract/tokens.json` の `chart` で決まります。チャートは単位（`unit`）が必須で、棒は必ず0から始めます。系列を見分ける3色は、色覚の違いがあっても見分けられる組み合わせを選んでいます。

### アイコン

`zones` の要素に `icon` を書くと、箱の代わりにアイコンで描きます。AWS のサービスは `aws/AmazonCloudFront` のように書き、名前は `zukai icons` で探します。`sqs` や `alb` のような略称でも探せます。`user`、`browser`、`server`、`database` も使えます。存在しない名前は Lint が error にします。

AWS のアイコンは、AWS が構成図の作成用に配布しているものを、npm の `aws-icons` パッケージ経由で使っています。アイコンの権利は AWS にあります。`aws-icons` は2024年 Q1 版が元なので、新しいサービスのアイコンは無い場合があります。

### 画面の撮影

`screenshot` に `url` を書いて `zukai capture` を実行すると、画面を撮影し、`marks[].selector` の要素の位置を画像の横の `.json` に記録します。撮影には Playwright が必要です。通常の依存には入れていないので、使う場合だけ `npm install playwright` と `npx playwright install chromium` を実行します。

ログインが必要な画面は撮影できません。その場合は、手元で撮った PNG を置き、`marks[].at` に枠の位置を書きます。個人情報が写る要素は `mask` に書くと、撮影の前に塗りつぶします。

型を足すときは、`src/figures/` に1ファイルを追加し、`index.js` に1行を足します。1つの型は、`validate`（仕様の検証）、`fit`（文字が箱に収まるかの検証）、`render`（SVG の描画）を持ちます。

## 根拠

主張の裏付けは、説明文の後ろの `yaml refs` ブロックに書きます。図の箱に `ref: 1` と書くと、番号で対応します。

```yaml refs
- code: app:services/auth/src/session.ts#L8-L12
  note: セッションIDを発行し、有効期間を30分に設定する処理です。
- quote: "Common idle timeouts ranges are 2-5 minutes for high-value applications and 15-30 minutes for low risk applications."
  ja: 一般的なアイドルタイムアウトの範囲は、価値の高いアプリケーションで2〜5分、リスクの低いアプリケーションで15〜30分です。
  source: OWASP Session Management Cheat Sheet「Idle Timeout」
  url: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#idle-timeout
```

| 根拠 | 原稿に書くもの | zukai が行うこと |
|---|---|---|
| コード | リポジトリの別名、パス、行の範囲、1文の説明 | ファイルと行が実在するか検査する。抜粋を取り込み、行へのリンクを作る |
| 引用 | 原文、出典の名前、URL、日本語訳 | 出典の本文を取得し、原文がそのまま含まれるか検査する |

リポジトリの場所は、原稿のフォルダか、その上のフォルダに置く `zukai.config.json` に書きます。CodeCommit と GitHub のどちらのリポジトリも参照でき、1つの資料に両方を混ぜられます。

```json
{
  "repos": {
    "api": { "path": "../order-api" },
    "infra": { "path": "../order-infra" }
  }
}
```

接続先は、クローンのリモート `origin` の URL から読み取ります。読み取れるのは、GitHub（HTTPS、SSH）と CodeCommit（HTTPS、SSH、`codecommit::リージョン://名前`）の URL です。CodeCommit から GitHub へ移したときは、クローンのリモートを付け替えて作り直すと、リンクが GitHub に切り替わります。

| 項目 | 内容 |
|---|---|
| `path` | 手元のクローンの場所。設定ファイルからの相対パス |
| `host`、`org`、`name`、`region` | リモートから読み取れない場合や、読み取った値を変えたい場合に書く。`host` は `github` か `codecommit` |
| `link` | リンクのひな形を自分で書く場合に使う。`{ref}`、`{path}`、`{from}`、`{to}` を置き換える。GitHub Enterprise など、上の2つ以外の置き場所で使う |
| `pin` | `false` にすると、コミットを固定せず、作業中のファイルを読む。リンクは `branch` を指す |

既定では、コードの抜粋とリンクは、クローンの最新のコミットに固定します。コードがその後変わっても、資料のリンク先の行はずれません。資料の根拠には、リポジトリの名前と置き場所（GitHub か CodeCommit か）を表示します。

出典の本文は、初回に取得して `.zukai-cache/` に保存します。ログインが必要なページや PDF は取得できないので、本文を保存したテキストファイルを `snapshot` に指定します。出典に接続できない場合は warn（R004）になり、資料には「原文との一致は未確認」と表示します。

訳が正しいか、引用やコードが主張の根拠として妥当かは、機械で検査できません。人が確認します。

## Lint のルール

`node src/cli.js rules` で、自作ルールの ID、重さ、根拠を表示します。

| 層 | ID | 検査する内容 |
|---|---|---|
| 構造 | S001〜S006 | 主張文が1文60字以内か、図が主張文の直後に1つあるか、説明文が200字以内か |
| 図 | F001〜F003 | 仕様が型の定義に合うか、文字が箱に収まるか、画面の説明に実物の画面を使っているか |
| コード | C001 | コードブロックに、ハイライトできる言語名があるか |
| 根拠 | R001〜R006 | コードの行が実在するか、引用の原文が出典にあるか、日本語訳があるか、引用が300字以内か |
| 文章 | P001〜P006 | 「AではなくB」、遠回しな可能表現、内容のない前置き、比喩的な動詞、抽象語、指示語 |
| 文章 | `T:` で始まる ID | textlint の日本語技術文書プリセットと AI 文章プリセット |

error は修正が必須です。warn は書き直しの候補で、合否には影響しません。F003 は、見出しか主張文が「ボタン」「メニュー」「画面の表示」のように画面の部品や操作に触れていて、図が `screenshot` でない場合に出る warn です。実物の画面があるかどうかは機械では分からないので、合否には影響させていません。

P005（抽象語）と P006（指示語）は、専門用語や自然な用法を誤検出するため warn にしています。P001 は、「AではなくBが送ります」のように読点を挟まず名詞を言い換える形だけを warn にしています。事実の訂正として書く場合があるためです。「Aではなく、Bです」と「Aするのではなく」は error のままです。

図の F002 は、文字が箱に収まるかに加えて、ツリーマップの枠が小さくて名前が表示されない項目と、構成図のアイコンの下の文字が領域の枠からはみ出す場合も検出します。

ルールを外したいセクションには、理由を添えてコメントを書きます。理由のないコメントは無効です。

```markdown
<!-- zukai-ignore S004 用語の定義だけを置くセクションのため -->
```

## 削って改善する手順

`zukai stats` は、ルールごとに発火、修正、残存、抑制の件数を表示します。修正と残存は、同じファイルを続けて検査したときの差から数えます。

| 数字の傾向 | 判断 |
|---|---|
| 発火が0件のまま | モデルがその誤りを起こさなくなった。対応する指示が `model-notes.md` にあれば消す |
| 残存が多い | AI がその指摘を直せていない。ルールの文言か上限を見直す |
| 抑制が多い | ルールが資料の実態に合っていない。ルールを warn に下げるか消す |

`prompts/base.md` には、書き方の規約と例1つだけを書いています。指示を足すのは、同じルールが繰り返し発火し、修正の往復が増えたときだけです。足した指示は `prompts/model-notes.md` に、対象のルール ID とモデル名を添えて書きます。モデルを替えたら、指示を1つ外して生成し直し、発火が増えなければその指示を消します。

## 入れていない検査

| 検査 | 入れていない理由 |
|---|---|
| 同じ文末の3連続 | 説明文は「ます」が続くのが自然で、直すと不自然な言い換えを招く |
| 図のラベルが説明文に登場するか | 「図を見れば分かる内容は書かない」という規約と衝突する |
| 同義反復、比較軸の不一致、後付けの正当化 | 意味の判断が必要で、機械的に検出できない。人が確認する |
| 折れ線で、桁の違う系列を並べていないか | 平らな系列を比較のために並べる使い方と区別できない。型の書き方に注意書きを置き、人が確認する |
| 描画後のコントラストと最小フォントサイズ | 色とフォントは `tokens.json` で固定しているため、原稿ごとの検査は要らない |

## 閾値について

`contract/limits.json` の数値は、すべて初期値の仮説です。実際の題材で3〜5件の資料を作り、`stats` の数字を見て調整してください。
