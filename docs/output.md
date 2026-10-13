# 共有先と、返答を資料にする

パスは、リポジトリの根からの相対パスです。概要は [README](../README.md) にあります。

## 共有先ごとの出力

原本は Markdown の原稿です。共有する HTML と Confluence のページは、原稿から作る生成物です。原稿を生成物と一緒に運ぶので、Git のリポジトリがなくても、受け取った人が原稿を編集して作り直せます。

| 共有先 | 出力 | 原稿の運び方 |
|---|---|---|
| HTML | 図を埋め込んだ1枚の HTML。形式を省略したときの既定値 | HTML の中に埋め込む。`extract` で取り出す |
| Confluence | 本文（`body.xhtml`、ストレージ形式）、図の PNG、`meta.json` を入れたフォルダ | 原稿の `.md` をページに添付する |
| Markdown | `README.md` と `assets/` の画像を入れたフォルダ | `source/` に原稿のコピーを入れる |
| PDF | A4 の PDF。本文を文字、図を画像として埋め込む | 編集するときは元の原稿から作り直す |
| Word | `.docx`。本文と表は編集でき、図は画像として埋め込む | 編集するときは元の原稿から作り直す |
| PowerPoint | `.pptx`。見出しごとにスライドを分け、長文と長い表は続きのスライドへ送る | 編集するときは元の原稿から作り直す |
| SVG・PNG | 図だけを `fig-01.svg`、`fig-02.svg` などの連番で保存したフォルダ | 本文は含まない |

### 形式を指定する

先に `zukai lint 原稿.md` で検査し、共有先に合う形式で書き出します。`build` 自体は文章全体の Lint を実行しません。知らない形式や、その形式で使えないオプションを指定すると、出力せずにエラーを返します。

```bash
zukai build 原稿.md                      # 原稿.html
zukai build 原稿.md --format=html        # 同じ HTML を明示的に指定
zukai build 原稿.md --format=markdown    # 原稿.markdown/README.md と画像
zukai build 原稿.md --format=pdf         # 原稿.pdf
zukai build 原稿.md --format=docx        # 原稿.docx
zukai build 原稿.md --format=pptx        # 原稿.pptx
zukai build 原稿.md --format=svg         # 原稿.svg/fig-01.svg など
zukai build 原稿.md --format=png         # 原稿.png/fig-01.png など
zukai build 原稿.md --format=markdown --out=dist/guide
```

`--out` は、Markdown・Confluence・SVG・PNG ではフォルダ、それ以外ではファイルです。元の原稿と重なるパスには出力できません。シンボリックリンクやハードリンクで原稿とつながった保存先も、書き込み前に検査します。同じ保存先へ再出力すると、同名の生成物を上書きします。以前の出力で作った余分な画像は自動削除しません。

SVG・PNGの出力は `figure` ブロックだけを処理します。本文のMarkdown画像や `refs` の参照先がなくても、図は書き出せます。図の定義の誤りや、screenshotなどの図が必要とする画像の欠落はエラーになります。

### Markdown の図を選ぶ

図の形式は `--image-format` で指定します。このオプションは `--format=markdown` のときだけ使えます。

| 指定 | 図の扱い |
|---|---|
| `--image-format=png` | 既定値。生成時の配色とフォントを画像に固定する |
| `--image-format=svg` | SVG を保存する。閲覧先の SVG 対応とフォントに依存する |
| `--image-format=mermaid` | 組み込みの flow、branch、sequence、state を Mermaid に変換する。それ以外は PNG を残し、注意を表示する |

```bash
zukai build 原稿.md --format=markdown --image-format=svg
zukai build 原稿.md --format=markdown --image-format=mermaid
```

本文の主張と説明、表、リスト、通常のコードを残します。図の定義は画像参照または Mermaid に置き換え、根拠はコードの抜粋・引用・出典リンクとして出力します。ナレーションと動画のシーンは閲覧用の本文から外します。Mermaid の配置と配色は表示側が決めるため、zukai のテーマと同じ見た目にはなりません。

GitHubで共有するときは `README.md` と `assets/` を一緒にコミットしてください。既存の相対画像も `assets/` へコピーし、文書への相対リンクは出力先からのパスに直します。Markdownだけを別の場所へ移す場合は、画像とリンクのパスも合わせて変更する必要があります。`source/` は原稿のコピーで、テーマ・設定・原稿が参照する外部ファイルの一式は含みません。

### PDF・Word・PowerPoint の条件

PDFの生成にはChromiumが必要です。`npx playwright-core install chromium` で用意するか、`zukai config set chromium <実行ファイル> --scope=user` で使うブラウザを指定してください。生成時にWebサイトへアクセスせず、画像は文書に埋め込みます。

Word・PowerPointはブラウザなしで生成できます。本文と表は編集可能ですが、図はPNG画像です。日本語フォントは `png.font` の設定を使うため、受け手のPCでも同じフォントがあると見た目がそろいます。PowerPointでは9列以上の表を行ごとの文章として出力し、注意を表示します。表の中の画像は表の後ろに配置します。

PDF・Word・PowerPointで通常のMarkdown画像を使う場合は、画像をローカルに保存して相対パスで参照してください。PNG・JPEG・GIF・BMP・SVGに対応します。外部URLの画像は取りに行かず、エラーで知らせます。通常のHTMLブロックは実行せず、コードの文字列として残します。独自の図の型が後続の説明を出す場合は、`after` の `markdown` にも説明を書くと、これらの形式で本文として扱えます。

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
| 2回目以降 | 原稿のページ ID を読み、同じ名前の添付を新しい版にし、本文を新しい版として更新する。原稿からなくなった添付はページに残る |

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
