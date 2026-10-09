# ログイン機能の変更内容

この資料は、ログイン失敗時の応答、認証サービスの部品、移行の日程、保存先の変更を説明します。

## ログイン失敗時の応答

認証サービスは、連続して失敗した回数に応じて3通りに応答します。

```yaml figure
type: branch
condition: 連続して失敗した回数
cases:
  - when: 1〜2回
    label: 再入力を求める
    note: エラーを表示する
  - when: 3〜4回
    label: 画像認証を追加
    note: 自動入力を防ぐ
  - when: 5回以上
    label: 15分間ロック
    note: 管理者に通知する
    emphasis: true
```

失敗した回数は、ログインに成功した時点で0に戻します。

## 認証サービスの部品

認証サービスは、受付、照合、発行の3つの部品に分かれます。

```yaml figure
type: tree
root: 認証サービス
children:
  - label: 受付
    items: [入力の検証, 失敗回数の記録]
  - label: 照合
    items: [ハッシュの計算, 利用者DBの参照]
  - label: 発行
    items: [セッションIDの生成, Cookieの設定]
```

受付は、入力の形式が正しい要求だけを照合へ渡します。

## 移行の日程

セッションDBへの移行は、4週間で段階的に進めます。

```yaml figure
type: timeline
events:
  - date: 10月12日
    label: セッションDB構築
    note: 検証環境で確認する
  - date: 10月19日
    label: 並行書き込み
    note: メモリとDBの両方へ
  - date: 10月26日
    label: 読み取りの切替
    note: セッションDBから読む
    emphasis: true
  - date: 11月2日
    label: メモリ保存の停止
    note: 旧処理を削除する
```

読み取りの切替で不具合が出た場合は、設定を戻してメモリから読みます。

## セッションの保存先の変更

セッションの保存先を、各サーバのメモリからセッションDBへ移します。

```yaml figure
type: compare
before:
  label: 変更前
  rows:
    - [サーバA, サーバB]
    - [メモリ, メモリ]
after:
  label: 変更後
  rows:
    - [サーバA, サーバB]
    - [セッションDB]
  emphasis: セッションDB
```

変更前は、サーバAでログインした利用者の要求がサーバBに届くと、ログインし直す必要がありました。
