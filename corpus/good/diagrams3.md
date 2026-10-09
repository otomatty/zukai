# チームの分担と移行の日程

この資料は、3つのチームの分担と、セッションDBへの移行の日程を説明します。

## 開発と運用の分担

デプロイと性能の改善は、開発チームと運用チームが共同で担当します。

```yaml figure
type: venn
sets:
  - label: 開発チーム
    items: [設計, 実装]
  - label: 運用チーム
    items: [監視, 保守作業]
overlaps:
  - sets: [開発チーム, 運用チーム]
    items: [デプロイ, 性能の改善]
    emphasis: true
```

共同で担当する作業は、両方のチームから1人ずつ担当者を決めます。

## 3つのチームの分担

3つのチームがそろって担当するのは、障害の調査だけです。

```yaml figure
type: venn
sets:
  - label: 開発チーム
    items: [設計, 実装]
  - label: 運用チーム
    items: [監視, 保守作業]
  - label: 品質チーム
    items: [受け入れ試験, 品質の報告]
overlaps:
  - sets: [開発チーム, 運用チーム]
    items: [デプロイ]
  - sets: [開発チーム, 品質チーム]
    items: [自動試験]
  - sets: [運用チーム, 品質チーム]
    items: [負荷試験]
  - sets: [開発チーム, 運用チーム, 品質チーム]
    items: [障害の調査]
    emphasis: true
```

障害の調査には、3つのチームから1人ずつ参加します。

## 移行の日程

移行は10月5日に始め、10月30日に本番を切り替えます。

```yaml figure
type: gantt
tasks:
  - label: 設計
    start: 2026-10-05
    end: 2026-10-09
    group: 準備
  - label: レビュー
    start: 2026-10-12
    end: 2026-10-14
    group: 準備
  - label: 実装
    start: 2026-10-13
    end: 2026-10-27
    group: 開発
    emphasis: true
  - label: 本番の切替
    at: 2026-10-30
    group: 開発
marker:
  at: 2026-10-16
  label: 今日
```

実装は、レビューの指摘を受けながら進めるため、レビューの期間と2日重なります。
