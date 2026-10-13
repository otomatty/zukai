# README を図で説明し、詳細は docs へ移す

2026-10-13 10:31（JST）の依頼です。依頼は、README.md を図解し、生成した画像をリポジトリで管理し、詳細を docs に分けることです。ツールは Cursor、モデルは Grok 4.7 です。

## 原稿が資料になる経路

AI は Markdown の原稿だけを書き、合格した原稿を HTML にします。

```yaml figure
type: flow
steps:
  - label: 原稿を書く
    note: AI が Markdown を書く
  - label: Lint で検査
    note: 構造と図と文章
    emphasis: true
  - label: HTML へ変換
    note: テンプレートが描く
```

指示と検査は、同じ上限と図の型を使います。型は 21 種類で、最初に渡す指示は一覧だけです。役割の一覧は docs/architecture.md にあります。

## 検査と描画を決める場所

契約と図の型と Lint と指示が、検査と描画の両方を決めます。

```yaml figure
type: tree
root: zukai
children:
  - label: 契約
    items: [上限, 色, 設定項目]
  - label: 図の型
    items: [検証, 描画]
  - label: Lint
    items: [ルール, textlint]
  - label: 指示
    items: [規約, 型一覧]
```

契約のファイルは、contract/limits.json と tokens.json と settings.json です。テーマは色と描き方を契約の値に重ねます。評価用の原稿は corpus/ に置きます。

## 設定が効く順番

同じ項目は下の層が優先し、環境変数はどのファイルよりも優先します。

```yaml figure
type: layers
layers:
  - label: このPC
    items: [全プロジェクト]
  - label: チーム
    items: [共有する値]
  - label: 手元
    items: [このプロジェクト]
  - label: 本人
    items: [APIキー]
```

上の 3 層は、~/.zukai/config.json、zukai.config.json、.zukai/config.json です。下の層は ~/.zukai/credentials.json で、API キーを置きます。

## 共有するときの形

原本は Markdown で、HTML と Confluence のページは原稿から作ります。

```yaml figure
type: branch
condition: 共有先
cases:
  - when: ファイル
    label: 1枚のHTML
    note: 原稿を中に埋め込む
  - when: Confluence
    label: PNGと本文
    note: 原稿をページに添付
    emphasis: true
```

publish は、Lint に合格した原稿だけを登録します。API トークンは credentials.json か環境変数 CONFLUENCE_TOKEN に置きます。

## コマンドとして使い始める

clone して npm link すると、どのプロジェクトからでも zukai を実行できます。

```yaml figure
type: flow
steps:
  - label: clone
    note: リポジトリを取得
  - label: npm install
    note: 依存を入れる
  - label: npm link
    note: コマンドにする
    emphasis: true
  - label: zukai setup
    note: 質問に答える
```

Node.js 24 以上が必要です。npm には公開していないので、リポジトリを clone して使います。setup はスキル、出力、動画、Confluence をまとめて設定します。

## 詳細の置き場所

README は zukai が何をするかを示し、設計の詳細は docs に分けて置きます。

```yaml figure
type: tree
root: README
children:
  - label: 使い方
    items: [コマンド, 設定]
  - label: 出力
    items: [共有先, 動画]
  - label: 設計
    items: [テーマ, 図の型]
  - label: 開発
    items: [検査, 実装]
```

docs は使い方、出力、設計、開発の 4 グループに分けてあります。ファイル名と中身の対応は、README の一覧に書いてあります。
