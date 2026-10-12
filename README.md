# zukai

zukai は、図が主役の日本語資料を AI に書かせ、AI を使わない Lint で検査するハーネスです。対象は、設計書や社内説明資料のような縦長のドキュメントです。

名前は仮のものです。`package.json` の `name` と `skills/zukai` を変えれば改名できます。

## 仕組み

AI は Markdown の原稿だけを書きます。Lint は原稿の構造、図の仕様、文章を検査します。合格した原稿を、テンプレートが HTML に変換します。

| 役割 | 置き場所 | 内容 |
|---|---|---|
| 契約 | `contract/` | 文字数や図の要素数の上限（`limits.json`）、色とフォント（`tokens.json`）、設定の項目（`settings.json`） |
| テーマ | 設定の `theme` が指すフォルダ | `tokens.json` に重ねる色とフォント、描き方のルール（`rules.md`）。資料から `zukai-theme` スキルが作る |
| 図の型 | `src/figures/` | 型ごとに、仕様の検証と SVG の描画を1ファイルで持つ |
| Lint | `src/lint/` | 自作ルール21個と textlint |
| 指示 | `prompts/` | 書き方の規約と例1つ（`base.md`）、後から足した指示（`model-notes.md`） |
| 評価 | `corpus/` | 良い原稿と悪い原稿、発火を期待するルール |
| 実績 | `~/.zukai/logs/` | Lint の実行記録。どのプロジェクトの原稿も、同じ記録に集まる |

`zukai prompt` と `zukai type` は、`contract/limits.json` と `src/figures/` から指示を組み立てます。型が21種類あるので、最初に渡すのは型の一覧だけにし、書き方の詳細は使う型が決まってから取り出します。上限や図の型を変えると、指示と検査の両方が同時に変わります。

## はじめ方

zukai は npm に公開していません。リポジトリを clone し、`npm link` で `zukai` コマンドとして使えるようにします。Node.js 24 以上が必要です。

```bash
git clone <このリポジトリ> && cd zukai
npm install
npm link            # zukai コマンドを使えるようにする。フォルダを動かしたら、やり直す

cd /path/to/project
zukai setup         # 質問に答えて、スキル、出力、動画、Confluence をまとめて設定する
```

`zukai setup` は端末で実行すると、質問に答えるだけで必要な設定がそろいます。今の値が既定の答えになるので、もう一度実行すると設定を変える画面としても使えます。書き込む前に、どのファイルに何を書くかを表示して確認します。最後に `zukai doctor` の結果と、同じ設定を対話なしで行うコマンドを表示します。

| セクション | 質問すること |
|---|---|
| `skills` | スキルを書く場所（このプロジェクトか、この PC の全プロジェクトか）、読ませる AI ツール |
| `output` | 出力（資料だけか、資料と動画か）。動画にしたときは、`video` の質問も続ける |
| `video` | 声、語り口、BGM、Gemini の API キー |
| `confluence` | 共有先。Confluence にも登録するときは、URL、スペース ID、親ページ ID、メールアドレス、API トークン |

`zukai setup video` のようにセクションを書くと、その質問だけに答えられます。AI ツールから実行したとき（端末でないとき）と `--yes` を付けたときは、質問せずにフラグと今の値だけで設定します。

```bash
zukai setup --output=video --voice=Puck --yes   # 対話なしで設定する
zukai doctor                                    # 足りないものと、直すコマンドを表示する
zukai help                                      # コマンドの一覧
zukai help lint                                 # コマンドの使い方（zukai lint --help と同じ）
zukai help config                               # 設定の項目の一覧
```

## 使い方

```bash
zukai prompt                       # AI に渡す指示を出力する（図の型は一覧だけ）
zukai type flow bar                # 指定した型の書き方と上限を出力する
zukai icons lambda                 # 図に使えるアイコンの名前を探す
zukai capture 原稿.md               # screenshot の URL を撮影し、枠の位置を記録する
zukai lint 原稿.md --model=モデル名  # 検査する。error が1件でもあれば終了コード1
zukai build 原稿.md                 # 原稿.html を書き出す
zukai build 原稿.md --format=confluence  # Confluence 用のフォルダを書き出す
zukai publish 原稿.md               # Confluence Cloud にページを作る。2回目以降は更新する
zukai extract 原稿.html             # HTML に埋め込んだ原稿を取り出す
zukai view                         # .zukai/answers の資料を読むページを起動し、URL を出力する
zukai theme check                  # デザインのテーマの値と見た目（文字のコントラストなど）を確かめる
zukai theme preview                # テーマで描いた図の見本を、1枚の HTML に書き出す
zukai theme compare 案 案...        # 今のテーマと案（emphasis.box=tint など）を、同じ図で横に並べる
zukai corpus                       # Lint 自体が期待どおりに動くか確認する
zukai stats                        # ルールごとの実績を表示する
```

コマンドは、`src/commands.ts` の定義から引数を検査し、help を作ります。書き間違えたコマンドやオプションには、候補を示します。`zukai` を使えない環境では、`node /path/to/zukai/src/cli.ts` で同じように動きます。

Claude Code から使う場合は、`skills/zukai/SKILL.md` をスキルとして読み込ませます。SKILL.md は手順だけを持ち、書き方は `zukai prompt` の出力に任せています。

## 設定

設定の置き場所は、だれと共有するかで分けます。設定ファイルには変えた値だけを書き、書いていない項目は既定値になります。あとで zukai の既定値を変えたときに、全員へ届くようにするためです。

| 置き場所 | ファイル | 共有の範囲 |
|---|---|---|
| この PC | `~/.zukai/config.json` | この PC の全プロジェクト |
| チーム | `zukai.config.json` | コミットしてチームで共有する |
| 手元 | `.zukai/config.json` | この PC のこのプロジェクトだけ。Git の管理に入らない |
| 本人だけ | `~/.zukai/credentials.json` | API キーとトークン。本人だけが読める権限で置く。Windows ではこの権限が効かないので、ホームのフォルダの権限で守る |

表の下ほど優先し、環境変数はさらに優先します。たとえば、チームで `output` を `video` にしていても、手元で `document` にすれば、自分だけ資料だけになります。

```bash
zukai config                                   # 対話で、項目を選んで変える
zukai config list --origin                     # 効いている値と、その出どころ
zukai config set output video                  # チームの設定に書く（項目ごとの既定の書き先）
zukai config set output document --scope=local # 自分だけ変える
zukai config set repos.api.path ../order-api --scope=local  # 手元のクローンの場所だけ変える
zukai config unset output --scope=local        # 消して、チームの値に戻す
zukai login gemini                             # API キーを、画面に出さずに入力させて保存する
zukai login confluence                         # メールアドレスと API トークンを保存する
```

| 項目 | 内容 | 既定の書き先 |
|---|---|---|
| `output` | `document`（資料だけ）か `video`（資料と動画） | チーム |
| `theme` | デザインのテーマのフォルダ。無ければ zukai の既定の見た目 | チーム |
| `video.*` | 声、語り口、BGM、効果音、TTS のモデル | チーム |
| `confluence.base`、`spaceId`、`parentId` | Confluence の URL と、初回にページを作る場所 | チーム |
| `terms` | 用語集 | チーム |
| `repos.*` | コード参照に使うリポジトリ | チーム |
| `png.font`、`chromium` | 図の PNG のフォント、Chromium の場所 | この PC だけに書ける |
| `gemini.apiKey`、`confluence.email`、`confluence.token` | キーとトークン | 本人だけに書ける。`zukai login` で保存する |

項目の型、既定値、書ける場所、対応する環境変数は、`contract/settings.json` に書いてあります。`zukai help config <項目>` で表示できます。知らない項目、型の誤り、秘密の値を設定ファイルに書いた場合は、黙って無視せずに止めます。

パスの値は、チームと手元の設定ではプロジェクトの根から、この PC の設定では `~/.zukai` から解決します。`config set` で書くパスは、今いるフォルダからのパスで書けます。

プロジェクトの根は、`zukai.config.json` か `.zukai/` が最初に見つかったフォルダです。探し始めるのは原稿のフォルダで、原稿を受け取らないコマンドは今いるフォルダです。そこから上へたどり、どちらも無ければ Git のリポジトリの根にします。`.zukai/` には、資料、キャッシュ、手元の設定を置きます。中に `.gitignore` を置くので、Git の管理には入りません。

## 共有先ごとの出力

原本は Markdown の原稿です。共有する HTML と Confluence のページは、原稿から作る生成物です。原稿を生成物と一緒に運ぶので、Git のリポジトリがなくても、受け取った人が原稿を編集して作り直せます。

| 共有先 | 出力 | 原稿の運び方 |
|---|---|---|
| ファイル | 図を埋め込んだ1枚の HTML。PDF は、ブラウザで開いて印刷する | HTML の中に埋め込む。`extract` で取り出す |
| Confluence | 本文（`body.xhtml`、ストレージ形式）、図の PNG、`meta.json` を入れたフォルダ | 原稿の `.md` をページに添付する |

PNG の日本語フォントは、OS に標準で入っているもの（macOS はヒラギノ角ゴ、Windows は Yu Gothic UI、それ以外は Noto Sans CJK JP）を使います。変えたいときは、`zukai config set png.font フォント名 --scope=user` を実行します。環境変数 `ZUKAI_PNG_FONT` でも指定できます。

Confluence のページは、本文に HTML や SVG を直接書けません。図は PNG の添付ファイルにして、本文から参照します。ページの先頭には「このページは生成物で、直接編集すると上書きされる」という注意書きが入ります。

### Confluence Cloud への登録

`publish` は、Lint に合格した原稿だけを登録します。認証には、Atlassian アカウントのメールアドレスと API トークンを使います。API トークンは、原稿やリポジトリには書きません。`~/.zukai/credentials.json` か環境変数（`CONFLUENCE_TOKEN`）にだけ置きます。

```bash
zukai setup confluence   # URL、スペース ID、親ページ ID をチームの設定に、メールアドレスと API トークンを本人だけの設定に書く
zukai publish 原稿.md     # 初回はページを作り、2回目以降は更新する
zukai publish 原稿.md --space-id=スペースID --parent-id=親ページID  # 設定とは別の場所に作る
```

| 回 | `publish` が行うこと |
|---|---|
| 初回 | ページを作り、原稿の先頭に `<!-- zukai-confluence ページID -->` を書き込み、図と原稿を添付する |
| 2回目以降 | 原稿のページ ID を読み、図と原稿の添付を置き換え、本文を新しい版として更新する |

ページ ID は添付の原稿にも入ります。ページから原稿をダウンロードした人は、`--space-id` を指定せずに同じページを更新できます。

`build --format=confluence` は、登録せずに同じ内容をフォルダへ書き出します。登録前に本文を確認するときに使います。

## 返答を資料にする

Claude Code、Codex、Cursor などの AI ツールで、説明が必要な返答をチャットの外に図解の資料として出します。mod もフックも使わないので、シェルを実行できるツールならどれでも動きます。

| 出力先 | 書く内容 |
|---|---|
| チャット | 結論1文、資料の URL、原稿のパス |
| 資料（`.zukai/answers/*.md`） | 主張文、図、説明文のセクション。Lint を通した zukai の原稿 |

手順は、スキル（`zukai-answer`）に書いてあります。モデルは、説明、設計、比較、手順を求められたときと、図解を頼まれたときに資料を書きます。短い質問の答えと、コードを直す作業の途中は、チャットだけで答えます。

```bash
zukai setup skills                                  # 対話で、書く場所と AI ツールを選ぶ
zukai setup skills --skills=user --tools=claude --yes  # この PC の全プロジェクトの ~/.claude/skills に書く
```

`setup skills` は、資料からデザインのテーマを作るスキル（`zukai-theme`）も同じ場所に書きます。`.claude/skills` は Claude Code、`.agents/skills` は Codex、Cursor、GitHub Copilot、Devin などが読みます。スキルは `zukai` コマンドを呼びます。`zukai` が PATH に無いときだけ、CLI の絶対パスを書きます。zukai を新しくするとスキルの中身が変わることがあります。そのときは `zukai doctor` が知らせるので、`zukai setup skills` で書き直します。

スキルは、zukai が設定の誤りや足りないもので止まったときに `zukai doctor` の結果を利用者に伝えます。API キーはチャットで尋ねず、利用者に `zukai login` の実行を頼みます。

`zukai view` は、プロジェクトごとのポートで表示用のページを起動し、初回はブラウザで開きます。すでに動いていれば URL だけを出力して終わります。

- 左に資料の一覧、右に本文を出す。新しい資料を保存すると、自動で切り替える
- 古い資料を読んでいる間は切り替えず、一覧に「新着」の印を付ける
- ヘッダーの左のアイコンで一覧を開閉する。たたんだ状態はブラウザに覚え、たたんでいる間に新着があればアイコンに点を付ける
- 2回直しても残った Lint の error は、本文の上に出す
- ヘッダーの右のアイコンで、`build` と同じ1枚の HTML をダウンロードする
- 127.0.0.1 だけで待ち受け、`.zukai/answers` の原稿だけを読む。ページへの要求が30分なければ終了する

資料は `.zukai/answers` に置くので、Git の管理に入りません。

## 動画

同じ原稿から、解説動画（MP4、1920×1080、30fps）も作れます。動画の絵と動きは、AI が1シーンずつ HTML、SVG、CSS、JS で自由に書きます。zukai は背景もキャラクターも描かず、時刻の制御、ナレーション、字幕、シーンの切り替え、効果音、書き出しと、壊れた動画を出さないための検査（ガードレール）だけを受け持ちます。動画の品質は、AI の書くものでそのまま決まります。

```bash
zukai setup output                  # 出力を「資料と動画」にし、声、語り口、BGM、API キーを設定する
zukai config set output video       # 対話なしで、チームの出力を動画にする
zukai login gemini                  # Gemini の API キーを保存する
zukai prompt --video                # 動画の書き方を含めた指示を出力する
zukai frames 原稿.md --sheet          # 検査し、シーンごとに6つの時刻のコマを並べた画像を書き出す
zukai video 原稿.md [--draft]         # MP4 を書き出す（--draft は 960×540、15fps）
```

| 原稿のブロック | 内容 |
|---|---|
| `yaml narration` | 話し言葉のナレーション。1要素が字幕1枚。行ごとの語り口（`style`）、例の印（`example: true`）、読み上げの指示のタグ（`<short pause>`）、時刻の目印（`{#名前}`）を書ける。資料には出ない |
| `yaml narration ending`、`html motion ending` | 動画の最後のまとめのシーン。資料には出ない |
| `yaml narration question` と `html motion question` など | セクションを、役割（`question` 疑問、`answer` 答え、`example` 例、`term` 用語）ごとの短いショットに分ける。同じ役割の名前で組にする |
| `html motion` | シーンの絵と動き。目印の時刻は CSS 変数で、`zk.scene((t, root) => …)` で毎コマの JS を書ける。資料には出ない |

台本は、1人の語り手がていねいに説明する形にします。オープニングでテーマと答える疑問を示し、各セクションでは疑問、答え、例、用語の補足をそれぞれ短いショットにし、エンディングで要点をまとめます。答えは原稿の根拠だけで組み立てます。シーンは `zk.refs()` で、Lint と同じ方法で確かめた根拠（コードの抜粋と引用）を読み、画面に出典を示せます。検査は、例ではない行の数値が原稿に無いとき（V013）、疑問から始まらないとき（V014）、同じ書き出しが続くとき（V016）、ショットが長いとき（V107）に知らせます。書き方の全体は `prompts/video.md` にあります。完全な例は `examples/video/login.md` です。

| ガードレール | 内容 |
|---|---|
| サンドボックス | AI のコードは、ヘッドレスの Chromium の中だけで動かす。ネットワークの要求はすべて拒否し、Node では動かさない |
| 時刻と乱数 | `Date`、タイマー、`requestAnimationFrame`、`Math.random` を、エンジンの時刻と種を固定した乱数に置き換える |
| 暴走と例外 | 読み込みと1コマの時間に上限を設ける。超えたシーンと、読み込みで例外を出したシーンは、主張文と図だけの簡素な動きに差し替える |
| 見た目 | 文字のはみ出し、字幕の帯との重なり、文字の大きさ、要素の数、シーンより長いアニメーション、同じ時刻のコマが一致するか、音割れを調べる |

効果音は ZzFX（MIT、`src/video/vendor/`）で作ります。AI は、名前の付いた12個の音（`appear`、`whoosh`、`chime` など）を選ぶか、ZzFX の数値を書いて新しい音を作ります。音の選び方は `spikes/sfx/` で聞き比べました。

ID と上限は `zukai frames` の出力と `contract/limits.json` の `video` にあります。ナレーションは Gemini TTS（既定は `gemini-3.8-flash-tts`、声は `Kore`。`video.model` と `video.voice` で変える）で読み上げ、`.zukai/cache/tts` に保存します。API キーは `zukai login gemini` で `~/.zukai/credentials.json` に保存するか、環境変数 `GEMINI_API_KEY` に置きます。キーが無いときは、字幕だけの無音の動画になります。そのことは `zukai doctor` が知らせ、`zukai prompt` の指示にも書くので、AI がチャットで利用者に伝えます。無料枠のキーでは、地域と利用規約によって、送った文が Google の製品改善に使われることがあります。条件は Gemini API の利用規約で確かめます。

動画を作るには、Playwright と Chromium（`npm install playwright`、`npx playwright install chromium`）と、コマンドのパスに入った ffmpeg が必要です。足りないものは `zukai doctor` が、直すコマンドと一緒に表示します。

## デザインのテーマ

図と動画の見た目（色、フォント、描き方）は、テーマで好きなものに変えられます。テーマは、AI が資料から作ります。元にできるのは、Claude Design で作ったデザインや、手元のブランドガイド、スライドなどの資料です。

```bash
zukai setup skills                       # zukai-answer と一緒に、zukai-theme スキルも書く
# AI ツールに「このデザインに合わせて」と資料を渡すと、スキルが次を行う
zukai theme init zukai-theme             # テーマのフォルダを作る
zukai theme check zukai-theme            # 値と見た目を確かめる
zukai theme preview zukai-theme          # 見本の HTML を書き出し、元の資料と見比べる
zukai theme compare emphasis.box=fill emphasis.box=tint  # 今のテーマと案を横に並べた HTML を書き出す
zukai config set theme zukai-theme       # テーマを使う（自分だけなら --scope=local）
```

テーマは、AI との対話で決めていけます。スキルは、資料だけでは決まらない値を、黙って決めません。検査と資料の食い違いも同じです。どちらも、案を `zukai theme compare` で並べて見せます。比べられるのは、検査の結果、同じ図の見え方、系列の色の色覚での見え方です。利用者が選んだ値を `tokens.json` に書き、選んだ理由を `rules.md` の `## 決めたこと` に残します。この節と `## 出典` は、AI への指示には入りません。

テーマのフォルダには、次のファイルを置きます。

| ファイル | 内容 | 使われ方 |
|---|---|---|
| `tokens.json` | 色、フォント、グラデーション、強調の描き方、グラフの色の付け方、線の太さ、コードの配色。`contract/tokens.json` と同じ形で、変える値だけを書けばよい | `contract/tokens.json` に重ね、資料（HTML、Confluence の PNG）と動画の図を描く。自由な図に使える色と、Lint の色の検査も、この値になる |
| `rules.md` | 描き方のルール。`## 図`、`## 動画`、`## 出典` の節に分ける | `zukai prompt` が AI への指示に入れる。`## 動画` は動画を作るときだけ入れ、`## 出典` は入れない |
| `types/<名前>/` | テーマの独自の図の型（任意） | 組み込みの型と同じように、指示に出て、検査を通り、資料と動画に描ける |

### グラデーションと強調

`tokens.json` の次の項目で、強調の描き方を変えます。どれも書かなければ、今の見た目のままです。

| 項目 | 値 | 効き方 |
|---|---|---|
| `gradient` | `stops`（2〜5色）と `angle`（CSS の角度。90 は左から右） | 図では `zk-grad`、動画では CSS 変数 `--zk-gradient` として使える |
| `emphasis.box` | `flat`（淡い面と強調の色の枠）、`fill`（グラデーションの面と白抜きの文字）、`tint`（淡いグラデーションの面とグラデーションの枠）、`outline`（グラデーションの枠） | `emphasis: true` を付けた箱。箱を描く型（flow、branch、layers、sequence、tree、state、swimlane、timeline、compare、zones）。gantt と venn の強調は、強調の色のまま |
| `emphasis.chart` | `flat`（強調の色）、`gradient`（グラデーション） | bar、progress、line、stack で `emphasis: true` を付けた棒、系列、内訳 |
| `chart.mode` | `series`（系列ごとに色を変える）、`neutral`（灰色を基本にし、強調するものだけに色を付ける） | bar、progress、line、stack は強調以外を灰色の濃淡に、treemap と heatmap は淡い灰色のマスに本文の色の文字にする |
| `chart.series` | 3〜5色 | 系列を色で分けるときの色 |

`fill` を選んだときは、`zukai theme check` が白抜きの文字を確かめます。グラデーションのどの色の上でも、4.5:1 以上で読める必要があります。

### 独自の型

テーマの `types/<名前>/` に、次のファイルを置くと、そのテーマを使うプロジェクトでだけ使える図の型になります。テーマごとに、資料と動画で使う型を足せます。

| ファイル | 内容 |
|---|---|
| `type.json` | `summary`（型の説明）、`when`（使うとき）、`fields`（項目の定義）、`example`（例の仕様） |
| `figure.svg` | 図のひな形。`{{value}}` のように項目を差し込む。`{{#items}}…{{/items}}` で繰り返し、`{{= 40 + @index * 200}}` で位置を計算し、`{{theme.color.accent}}` でテーマの値を使える |
| `motion.js` | 動画で、この図を動かすスクリプト（任意）。無ければ、組み込みの型と同じく部品ごとに現れる |

```json
{
  "summary": "主役の数字を、大きな文字で見せる",
  "when": "1つの数字が、そのセクションの結論になっている",
  "fields": {
    "value": { "type": "string", "max": 5, "required": true, "desc": "数字" },
    "label": { "type": "string", "max": 16, "required": true, "desc": "数字が何を表すか" }
  },
  "example": { "value": "300", "label": "導入企業数" }
}
```

項目の型は `string`、`number`、`boolean`、`list`、`object` です。文字には全角の字数の上限（`max`）、配列には個数の上限が必須です。原稿の仕様は、この定義で確かめます。

ひな形を埋めた SVG は、自由な図と同じ検査を通し、同じ方法で組み立て直します。検査するのは、使える要素と属性、テーマの色、12px 以上の文字、文字の収まりです。テーマの型でも、型のある図と同じ品質を保てます。`zukai theme check` は、各型の例がこの検査を通るかも確かめます。

`motion.js` は、次の `ctx` を受け取ります。

| 名前 | 内容 |
|---|---|
| `ctx.parts` | 図の部品。`el` が要素 |
| `ctx.times`、`ctx.start` | 各部品が現れる秒と、最初の部品が現れる秒。ナレーションが部品の名前を読む時刻に合わせてある |
| `ctx.frame(f)` | 毎コマ `f(t, info)` を呼ぶ。数え上げのような、時刻から計算する動きに使う |
| `ctx.sfx(名前, 秒)` | 効果音を鳴らす |

AI が書くシーンのスクリプトと同じく、ヘッドレスの Chromium の中だけで動き、時刻はエンジンが決めます。Node では動かさず、`zukai theme check` も書き方を確かめるだけです。

取り込みは、スキル（`zukai-theme`）が行います。AI が資料を読んで値とルールを決め、zukai は値を検査するだけです。スキルには、形式ごとの資料の読み方を書いてあります。HTML と CSS は CSS 変数を、PowerPoint はテーマの配色と書体の定義を読み、PDF と画像は見た目から読み取ります。資料そのものはテーマのフォルダにコピーしません。`rules.md` の「出典」には、資料の名前だけを書きます。

| 検査 | 内容 |
|---|---|
| 値（読むときに止める） | 無い項目、色でない値、選択肢に無い値、要素の数の違う配列、`;` や `{` を含むフォント。図の幅と動画の大きさ（`figure.width`、`video.width`、`video.height`、`video.fps`）は、Lint の上限が前提にしているので変えられない |
| 文字（error） | 文字と背景のコントラストが 4.5:1 以上か。図の文字、補足、強調、強調の上の文字、動画の文字と字幕を、資料と動画の両方で確かめる |
| 強調した箱の文字（error） | `fill` の白抜きの文字と、`tint` の淡い面の上の文字が、グラデーションのどの色の上でも 4.5:1 以上か |
| 系列の色（warn） | 背景と 2.5:1 以上か。系列の色が、通常の見え方と、1型、2型の色覚で見分けられるか |
| 独自の型（error） | type.json の形、ひな形の書き方、motion.js の書き方、例が検査を通るか、組み込みの型と名前が重ならないか |
| コードの配色（error） | `codeTheme` が Shiki にある名前か |

`zukai doctor` も、設定したテーマを同じように確かめます。テーマを変えると、自由な図（`svg figure`）に書いた前の色は、Lint の F001 になります。

テーマで変わるのは、zukai が描く部分（図、本文の配色、動画の背景、字幕、図）と、自由な図に使える色と、使える図の型です。動画のシーンの絵は AI が書くので、テーマの配色を CSS 変数として渡し、絵柄は `rules.md` の `## 動画` の指示で寄せます。どこまで従ったかは `zukai frames --sheet` で確かめます。

## Claude Code のプラグイン

このリポジトリは、Claude Code のプラグインとしても読み込めます。読み込むと、資料を作る `zukai` スキルが使えます。

```bash
claude --plugin-dir /path/to/zukai
```

Desktop アプリと VS Code 拡張では、`~/.claude/settings.json` の `env` に `"CLAUDE_CODE_PLUGIN_DIRS": "/path/to/zukai"` を書きます。

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

コードブロックには言語名を書きます。HTML では、生成時に Shiki が色を付けて埋め込みます。配色は `contract/tokens.json` の `codeTheme` で決まり、テーマの `tokens.json` で変えられます。Confluence では、コードマクロが言語名に従って色を付けます。出力やログのように言語がないものは `text` と書きます。

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

`gitgraph` の見た目は、Mermaid の gitGraph（テーマ redux-color）に合わせています。破線のレーン、左端のブランチ名の札、斜めに書くコミットのラベル、荷札の形のタグ、白抜きの取り込みコミットを同じ形で描きます。色は `contract/tokens.json` の `gitgraph` にあります。テーマの `tokens.json` で、Mermaid のほかのテーマの色に差し替えられます。

`bar` から `treemap` までの9種類は Apache ECharts で描きます。割合、四分位数、傾向の直線は、原稿の値から自動で計算します。原稿に ECharts の設定は書かず、型の項目（単位、項目、系列）だけを書きます。配色と線の太さは `contract/tokens.json` の `chart` で決まり、テーマで変えられます。チャートは単位（`unit`）が必須で、棒は必ず0から始めます。系列を見分ける3色は、色覚の違いがあっても見分けられる組み合わせを選んでいます。

### アイコン

`zones` の要素に `icon` を書くと、箱の代わりにアイコンで描きます。AWS のサービスは `aws/AmazonCloudFront` のように書き、名前は `zukai icons` で探します。`sqs` や `alb` のような略称でも探せます。`user`、`browser`、`server`、`database` も使えます。存在しない名前は Lint が error にします。

AWS のアイコンは、AWS が構成図の作成用に配布しているものを、npm の `aws-icons` パッケージ経由で使っています。アイコンの権利は AWS にあります。`aws-icons` は2024年 Q1 版が元なので、新しいサービスのアイコンは無い場合があります。

### 画面の撮影

`screenshot` に `url` を書いて `zukai capture` を実行すると、画面を撮影し、`marks[].selector` の要素の位置を画像の横の `.json` に記録します。撮影には Playwright が必要です。通常の依存には入れていないので、使う場合だけ `npm install playwright` と `npx playwright install chromium` を実行します。

ログインが必要な画面は撮影できません。その場合は、手元で撮った PNG を置き、`marks[].at` に枠の位置を書きます。個人情報が写る要素は `mask` に書くと、撮影の前に塗りつぶします。

型を足すときは、`src/figures/` に1ファイルを追加し、`index.ts` に1行を足します。1つの型は、`validate`（仕様の検証）、`fit`（文字が箱に収まるかの検証）、`render`（SVG の描画）を持ちます。

## 用語の表記

チームで表記をそろえたい用語は、チームの設定（`zukai.config.json`）の `terms` に書きます。モデルによっては、「バージョン」を「版」、「トークン」を「印」のように言い換えるためです。

```json
{
  "terms": [
    { "use": "トークン", "avoid": ["印"], "except": ["矢印", "目印", "印刷"] },
    { "use": "バージョン", "avoid": ["版"], "except": ["初版", "改訂版"] }
  ]
}
```

| 項目 | 内容 |
|---|---|
| `use` | 使う表記 |
| `avoid` | 避ける表記。見出し、本文、図のラベルと補足、ナレーションに出てきたら、Lint が P007 の error を返す |
| `except` | 避ける表記を含むが、正しい語。「印」を避けても「矢印」は知らせない |

`zukai prompt` は、用語集の表を AI に渡す指示に入れます。

用語集には、用語を説明するときの具体例も書けます。動画の台本で「ブラウザ、たとえば Chrome のような」と身近な例を添えるときに使います。

```json
{ "use": "認証サービス", "examples": ["Amazon Cognito", "Auth0"], "actual": "Amazon Cognito" }
```

| 項目 | 内容 |
|---|---|
| `examples` | 一般的な例。AI は「たとえば〜のような」と、例であることを言葉で示して使う |
| `actual` | このシステムが実際に使っているもの。AI は「このシステムでは〜」と実物の名前で説明する |

一般的な例と実物を分けるのは、例に挙げた製品を、視聴者がこのシステムで使っているものと取り違えないようにするためです。

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

リポジトリの場所は、プロジェクトの根の `zukai.config.json` の `repos` に書きます。CodeCommit と GitHub のどちらのリポジトリも参照でき、1つの資料に両方を混ぜられます。

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
| `path` | 手元のクローンの場所。プロジェクトの根からの相対パス。人によって場所が違うときは、`zukai config set repos.別名.path パス --scope=local` で自分の場所だけを書く |
| `host`、`org`、`name`、`region` | リモートから読み取れない場合や、読み取った値を変えたい場合に書く。`host` は `github` か `codecommit` |
| `link` | リンクのひな形を自分で書く場合に使う。`{ref}`、`{path}`、`{from}`、`{to}` を置き換える。GitHub Enterprise など、上の2つ以外の置き場所で使う |
| `pin` | `false` にすると、コミットを固定せず、作業中のファイルを読む。リンクは `branch` を指す |

既定では、コードの抜粋とリンクは、クローンの最新のコミットに固定します。コードがその後変わっても、資料のリンク先の行はずれません。資料の根拠には、リポジトリの名前と置き場所（GitHub か CodeCommit か）を表示します。

出典の本文は、初回に取得して `.zukai/cache/sources` に保存します。ログインが必要なページや PDF は取得できないので、本文を保存したテキストファイルを `snapshot` に指定します。出典に接続できない場合は warn（R004）になり、資料には「原文との一致は未確認」と表示します。

訳が正しいか、引用やコードが主張の根拠として妥当かは、機械で検査できません。人が確認します。

## Lint のルール

`zukai rules` で、自作ルールの ID、重さ、根拠を表示します。

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

## 開発

zukai は TypeScript で書いています。Node.js 24 は `.ts` のファイルから型を取り除いてそのまま実行するので、ビルドの手順はありません。`tsc` は型を検査するだけで、JavaScript を書き出しません。

```bash
npm run typecheck   # 型を検査する（tsc）
npm test            # テストを動かす
npm run check       # 型の検査とテストを続けて行う
```

| 決まり | 理由 |
|---|---|
| enum、namespace、引数のプロパティを使わない（`erasableSyntaxOnly`） | Node は型を取り除くだけで、変換はしないため |
| 型だけを読むときは `import type` と書く（`verbatimModuleSyntax`） | 型を取り除いたあとに、実在しない値の import が残らないようにするため |
| 相対パスの import には `.ts` を付ける | Node が、書いたパスのファイルをそのまま読むため |
| 図の型は `satisfies FigureType<仕様の型>` で書く | `validate` は検証前の値（`UncheckedSpec`）を、`render` などは検証済みの値を受け取るため |
| ブラウザで動く `src/video/runtime.browser.js` は JavaScript のまま置き、JSDoc の型で検査する | Chromium に、変換せずにそのまま渡すため |

zukai を `node_modules` の中に置くと、Node は `.ts` のファイルを実行しません。`npm install` で依存として入れずに、clone して `npm link` で使います。
