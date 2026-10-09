# 自由な図の悪い例

この資料は、自由な図の検査が発火することを確かめます。

## 使えない要素と色

配置は2つの領域に分かれます。

```svg figure
<svg viewBox="0 0 720 200">
  <title>2つの領域の配置</title>
  <rect x="20" y="20" width="120" height="60" fill="#ff0000" style="opacity:.5"/>
  <text x="80" y="55" text-anchor="middle" font-size="10">領域</text>
  <image href="https://example.com/a.png" x="0" y="0" width="10" height="10"/>
  <script>alert(1)</script>
</svg>
```

2つの領域は別々に管理します。

## はみ出しと重なり

配置は2つの領域に分かれます。

```svg figure
<svg viewBox="0 0 720 200">
  <title>2つの領域の配置</title>
  <rect class="zk-box" x="20" y="20" width="120" height="60"/>
  <text class="zk-text" x="80" y="55" text-anchor="middle">とても長い名前の領域</text>
  <text class="zk-note" x="300" y="58">重なる文字その1</text>
  <text class="zk-note" x="330" y="62">重なる文字その2</text>
  <text class="zk-note" x="660" y="100">図の外に出る文字</text>
</svg>
```

2つの領域は別々に管理します。

## 画面を図で描いている

注文の取消は、管理画面で注文を選び、取消ボタンを押して行います。

```yaml figure
type: flow
steps:
  - label: 注文を選ぶ
  - label: 取消を押す
  - label: 理由を入力
```

取消の理由は、返金の処理に使います。
