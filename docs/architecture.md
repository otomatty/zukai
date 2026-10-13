# 仕組み

パスは、リポジトリの根からの相対パスです。概要は [README](../README.md) にあります。

AI は Markdown の原稿だけを書きます。Lint は原稿の構造、図の仕様、文章を検査します。合格した原稿を、共有先に合う形式へ変換します。既定の出力は HTML です。

| 役割 | 置き場所 | 内容 |
|---|---|---|
| 契約 | `contract/` | 文字数や図の要素数の上限（`limits.json`）、色とフォント（`tokens.json`）、設定の項目（`settings.json`） |
| テーマ | 設定の `theme` が指すフォルダ | `tokens.json` に重ねる色とフォント、描き方のルール（`rules.md`）。資料から `zukai-theme` スキルが作る |
| 図の型 | `src/figures/` | 型ごとに、仕様の検証と SVG の描画を1ファイルで持つ |
| 出力 | `src/output-formats.ts`、`src/output.ts`、`src/export/` | 対応形式の一覧、保存先と引数の検査、形式ごとの生成処理。Markdown・PDF・Word・PowerPoint は本文と図の読み取りを共通に使う |
| Lint | `src/lint/` | 自作ルール21個と textlint |
| 指示 | `prompts/` | 書き方の規約と例1つ（`base.md`）、後から足した指示（`model-notes.md`） |
| 評価 | `corpus/` | 良い原稿と悪い原稿、発火を期待するルール |
| 実績 | `~/.zukai/logs/` | Lint の実行記録。どのプロジェクトの原稿も、同じ記録に集まる |

`zukai prompt` と `zukai type` は、`contract/limits.json` と `src/figures/` から指示を組み立てます。組み込みの型は24種類あり、テーマに独自の型があれば一覧に追加されます。最初に渡すのは型の一覧だけにし、書き方の詳細は使う型が決まってから取り出します。上限や図の型を変えると、指示と検査の両方が同時に変わります。

出力形式を増やすときは `output-formats.ts` と `output.ts` の処理一覧に登録します。共通の変換は `export/document.ts` です。Markdown の構文木を使うため、コード例の中にある画像記法を誤って書き換えません。HTML と Confluence は従来の `render.ts` と `confluence.ts` の生成処理を使います。
