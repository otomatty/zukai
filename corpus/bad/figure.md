# 図の仕様が崩れた資料

## 型の名前が違う

注文は、受付、決済、発送の順に進みます。

```yaml figure
type: flowchart
steps:
  - label: 受付
  - label: 決済
```

決済に失敗した注文は、受付の状態に戻します。

## ラベルが長い

注文は、受付、決済、発送の順に進みます。

```yaml figure
type: flow
steps:
  - label: 注文を受け付けて在庫を確認する処理
  - label: 決済
  - label: 発送
```

決済に失敗した注文は、受付の状態に戻します。

## 存在しない登場者

店舗は、倉庫へ発送を依頼します。

```yaml figure
type: sequence
actors: [店舗, 倉庫]
messages:
  - from: 店舗
    to: 配送会社
    label: 発送依頼
```

倉庫は、依頼を受けた当日に商品を発送します。

## 段の数が合わない

構成を2台から3台に変えます。

```yaml figure
type: compare
before:
  label: 変更前
  rows:
    - [A, B]
    - [X, Y, Z]
after:
  label: 変更後
  rows:
    - [A]
  emphasis: B
```

## 行き先が多すぎる

種別ごとに5通りに分かれます。

```yaml figure
type: branch
condition: 種別
cases:
  - {when: 1, label: 甲}
  - {when: 2, label: 乙}
  - {when: 3, label: 丙}
  - {when: 4, label: 丁}
  - {when: 5, label: 戊}
```

## 重なりのないベン図

2つのチームは別の作業を担当します。

```yaml figure
type: venn
sets:
  - label: 開発チーム
    items: [設計, 実装]
  - label: 運用チーム
    items: [監視]
```

## 重なりに収まらない項目

2つのチームは一部の作業を共同で担当します。

```yaml figure
type: venn
sets:
  - label: 開発チーム
    items: [設計]
  - label: 運用チーム
    items: [監視]
overlaps:
  - sets: [開発チーム, 運用チーム]
    items: [性能の改善と見直し]
```

## 終了日が開始日より前

設計は1週間で終えます。

```yaml figure
type: gantt
tasks:
  - label: 設計
    start: 2026-10-09
    end: 2026-10-05
  - label: 実装
    start: 2026-10-12
    end: 2026-13-01
```

