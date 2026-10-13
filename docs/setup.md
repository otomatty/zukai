# はじめ方と使い方

パスは、リポジトリの根からの相対パスです。概要は [README](../README.md) にあります。

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
zukai build 原稿.md --format=markdown    # 本文と画像をフォルダに書き出す
zukai build 原稿.md --format=pdf         # PDF。Chromium が必要
zukai build 原稿.md --format=docx        # Word
zukai build 原稿.md --format=pptx        # PowerPoint
zukai publish 原稿.md               # Confluence Cloud にページを作る。2回目以降は更新する
zukai extract 原稿.html             # HTML に埋め込んだ原稿を取り出す
zukai view                         # .zukai/answers の資料を読むページを起動し、URL を出力する
zukai gui                          # 資料の確認と書き出し、設定、テーマ、Confluence への公開をブラウザで操作する
zukai theme check                  # デザインのテーマの値と見た目（文字のコントラストなど）を確かめる
zukai theme preview                # テーマで描いた図の見本を、1枚の HTML に書き出す
zukai theme compare 案 案...        # 今のテーマと案（emphasis.box=tint など）を、同じ図で横に並べる
zukai corpus                       # Lint 自体が期待どおりに動くか確認する
zukai stats                        # ルールごとの実績を表示する
```

コマンドは、`src/commands.ts` の定義から引数を検査し、help を作ります。書き間違えたコマンドやオプションには、候補を示します。`zukai` を使えない環境では、`node /path/to/zukai/src/cli.ts` で同じように動きます。

`zukai lint` は、2回目から速く終わります（約0.8秒から約0.1秒）。最初の実行で、textlint の辞書を読み込んだプロセスを裏で起動し、次からはそのプロセスで検査するためです。結果は、そのプロセスを使わないときと同じです。このプロセスは、今いるフォルダごとに起動し、10分使われないと終わります。zukai や依存を更新したときは、新しいプロセスに替わります。使わないときは、`--no-server` を付けるか、環境変数 `ZUKAI_LINT_SERVER=off` を設定します。Windows では、このプロセスを使わず、毎回その場で検査します。

Claude Code から使う場合は、`skills/zukai/SKILL.md` をスキルとして読み込ませます。SKILL.md は手順だけを持ち、書き方は `zukai prompt` の出力に任せています。
