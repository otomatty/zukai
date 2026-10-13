# 仕組み

パスは、リポジトリの根からの相対パスです。概要は [README](../README.md) にあります。

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
