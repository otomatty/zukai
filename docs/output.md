# 共有先と、返答を資料にする

パスは、リポジトリの根からの相対パスです。概要は [README](../README.md) にあります。

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
