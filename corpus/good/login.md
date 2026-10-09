# ログイン機能の設計

この資料は、社内向け管理画面のログイン機能について、要求の経路、やり取りの順序、構成、方式の選定理由を説明します。

## ログイン要求の経路

ログイン要求は、ゲートウェイ、認証サービス、セッションDBの順に通ります。

```yaml figure
type: flow
steps:
  - label: ゲートウェイ
    note: 要求を受け付ける
  - label: 認証サービス
    note: パスワードを照合する
    emphasis: true
  - label: セッションDB
    note: 30分間保存する
```

認証サービスは、照合に成功するとセッションIDを発行します。セッションDBは、最後の操作から30分が過ぎたセッションIDを削除します。

```ts
export async function issueSession(userId: string) {
  const sessionId = randomBytes(32).toString("hex");
  await sessionDb.set(sessionId, userId, { ttlMinutes: 30 });
  return sessionId;
}
```

## ログイン時のやり取り

ブラウザは、認証サービスから「ログインしました。」という応答とCookieを受け取った時点でログイン済みになります。

```yaml figure
type: sequence
actors: [ブラウザ, 認証サービス, セッションDB]
messages:
  - from: ブラウザ
    to: 認証サービス
    label: IDとパスワード
  - from: 認証サービス
    to: セッションDB
    label: セッションID
  - from: 認証サービス
    to: ブラウザ
    label: Cookie
    reply: true
```

認証サービスは、IDとパスワードの照合に5回続けて失敗した利用者を15分間ロックします。Cookieには、セッションIDだけを入れます。

## 構成

ログイン機能は、画面、API、保存先の3層（上の層が下の層を呼びます。）で構成します。

```yaml figure
type: layers
layers:
  - label: 画面
    items: [ログイン画面, 設定画面]
  - label: API
    items: [認証API, 利用者API]
  - label: 保存先
    items: [利用者DB, セッションDB]
```

ログイン画面と設定画面は、認証APIと利用者APIだけを呼び出します。利用者DBとセッションDBを読み書きするのは、認証APIと利用者APIです。

## セッションの保存方式

セッションIDをサーバ側のセッションDBに保存する方式を採用します。

| 比較項目 | セッションDBに保存 | トークンに署名 |
|---|---|---|
| 強制ログアウト | セッションIDを削除する | 有効期限まで待つ |
| 要求ごとの処理 | セッションDBを1回読む | 署名を検証する |
| 追加する設備 | セッションDB | なし |

管理画面では、退職者のアカウントを即時に無効化する必要があります。トークンに署名する方式は、有効期限が切れるまでトークンを無効化できません。
