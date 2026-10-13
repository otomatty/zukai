# zukai

zukai は、図が主役の日本語資料を AI に書かせ、AI を使わない Lint で検査するハーネスです。対象は、設計書や社内説明資料のような縦長のドキュメントです。

## 仕組み

AI は Markdown の原稿だけを書きます。Lint は原稿の構造、図の仕様、文章を検査します。合格した原稿を、テンプレートが HTML に変換します。

![原稿を書き、Lint で検査し、HTML に変換する](docs/images/pipeline.png)

上限と図の型は、指示と検査の両方に使います。型は 21 種類で、最初に渡す指示は型の一覧だけです。

![契約、図の型、Lint、指示](docs/images/parts.png)

契約、テーマ、図の型、Lint、指示、評価、実績の置き場所は [docs/architecture.md](docs/architecture.md) にあります。

## 設定

同じ項目は下の層が優先し、環境変数はどのファイルよりも優先します。

![この PC、チーム、手元、本人の順に設定が重なる](docs/images/settings.png)

項目の意味と書き方は [docs/configuration.md](docs/configuration.md) にあります。

## 共有

原本は Markdown です。HTML と Confluence のページは、原稿から作ります。

![ファイルは 1 枚の HTML、Confluence は PNG と本文](docs/images/share.png)

登録の手順と、チャットの外に資料を出す仕組みは [docs/output.md](docs/output.md) にあります。

## はじめ方

zukai は npm に公開していません。リポジトリを clone し、`npm link` で `zukai` コマンドとして使います。Node.js 24 以上が必要です。

![clone、npm install、npm link、zukai setup](docs/images/setup.png)

```bash
git clone <このリポジトリ> && cd zukai
npm install
npm link            # zukai コマンドを使えるようにする。フォルダを動かしたら、やり直す

cd /path/to/project
zukai setup         # 質問に答えて、スキル、出力、動画、Confluence をまとめて設定する
```

コマンドの一覧、Lint の速さ、スキルの読み込ませ方は [docs/setup.md](docs/setup.md) にあります。`zukai` を使えない環境では、`node /path/to/zukai/src/cli.ts` で同じように動きます。

## ドキュメント

README は zukai が何をするかを説明します。設計の詳細は `docs/` に分けてあります。

![使い方、出力、設計、開発](docs/images/docs-map.png)


| ファイル                                           | 内容                       |
| ---------------------------------------------- | ------------------------ |
| [docs/architecture.md](docs/architecture.md)   | 契約、図の型、Lint、指示の置き場所      |
| [docs/setup.md](docs/setup.md)                 | はじめ方とコマンド                |
| [docs/configuration.md](docs/configuration.md) | 設定の置き場所と項目               |
| [docs/output.md](docs/output.md)               | HTML、Confluence、返答を資料にする |
| [docs/video.md](docs/video.md)                 | 解説動画                     |
| [docs/theme.md](docs/theme.md)                 | 色、フォント、独自の型              |
| [docs/manuscript.md](docs/manuscript.md)       | 原稿の形と図の型                 |
| [docs/lint.md](docs/lint.md)                   | 用語、根拠、Lint               |
| [docs/development.md](docs/development.md)     | プラグインと開発                 |


上の図は `docs/diagrams/overview.md` から書き出したものです。`zukai build docs/diagrams/overview.md --format=confluence` は `fig-01.png` から順に、経路、役割、設定、共有先、はじめ方、ドキュメントの PNG を出します。このリポジトリでは、その 6 枚を `docs/images/` に置いています。