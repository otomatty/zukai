# 障害対応の優先度

この資料は、障害を直す順番を決める基準を説明します。

## 優先度の決め方

対応の優先度は、影響の大きさと発生の頻度の組み合わせで決めます。

```svg figure
<svg viewBox="0 0 720 300">
  <title>対応の優先度を、影響と頻度で4つに分けた図</title>
  <line class="zk-line" x1="150" y1="20" x2="150" y2="250"/>
  <line class="zk-line" x1="150" y1="250" x2="700" y2="250"/>
  <text class="zk-note" x="140" y="76" text-anchor="end">影響が大きい</text>
  <text class="zk-note" x="140" y="196" text-anchor="end">影響が小さい</text>
  <text class="zk-note" x="290" y="274" text-anchor="middle">頻度が低い</text>
  <text class="zk-note" x="560" y="274" text-anchor="middle">頻度が高い</text>
  <rect class="zk-box" x="170" y="30" width="240" height="90" rx="6"/>
  <text class="zk-text" x="290" y="80" text-anchor="middle">手順書を用意する</text>
  <rect class="zk-box-em" x="440" y="30" width="240" height="90" rx="6"/>
  <text class="zk-text zk-em" x="560" y="80" text-anchor="middle">今月中に直す</text>
  <rect class="zk-box" x="170" y="150" width="240" height="90" rx="6"/>
  <text class="zk-text" x="290" y="200" text-anchor="middle">記録だけ残す</text>
  <rect class="zk-box" x="440" y="150" width="240" height="90" rx="6"/>
  <text class="zk-text" x="560" y="200" text-anchor="middle">自動で復旧させる</text>
</svg>
```

影響は、利用者が注文を完了できない場合に大きいと判断します。頻度は、月に2回以上の発生を高いと判断します。
