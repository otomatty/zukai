# チャートの仕様が崩れた資料

## 単位がない

応答時間は移行後に短くなりました。

```yaml figure
type: bar
items:
  - label: 移行前
    value: 180
  - label: 移行後
    value: -5
```

## 個数が合わない

失敗の件数は減りました。

```yaml figure
type: line
unit: 件
x: [5月, 6月, 7月]
series:
  - label: 失敗
    values: [320, 340]
marker:
  at: 9月
  label: 導入
```

## 目盛りが長い

件数は増えました。

```yaml figure
type: line
unit: 件
x: [2026年5月第1週, 2026年5月第2週, 2026年5月第3週, 2026年5月第4週, 2026年6月第1週, 2026年6月第2週, 2026年6月第3週, 2026年6月第4週]
series:
  - label: 件数
    values: [1, 2, 3, 4, 5, 6, 7, 8]
```

## 元に戻る流れ

要求は成功と失敗に分かれます。

```yaml figure
type: sankey
unit: 件
links:
  - [要求, 成功, 80]
  - [成功, 要求, 20]
```

## 行の個数が合わない

件数は朝に集中します。

```yaml figure
type: heatmap
unit: 件
x: [朝, 昼, 夜]
y: [平日, 休日]
values:
  - [1, 2, 3]
  - [1, 2]
```

## 名前が収まらない小さな枠

費用の大半は実行環境です。

```yaml figure
type: treemap
unit: 万円
groups:
  - label: 実行環境
    items:
      - label: コンテナ
        value: 40
      - label: 関数
        value: 0.5
  - label: データ
    items:
      - label: データベース
        value: 20
      - label: キュー
        value: 0.3
```
