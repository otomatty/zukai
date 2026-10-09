# セッションの有効期間の根拠

この資料は、セッションの有効期間を30分にした根拠と、ログイン画面の変更点を説明します。

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
    ref: 1
  - label: セッションDB
    note: 30分間保存する
    ref: 2
```

認証サービスは、照合に成功するとセッションIDを発行します。セッションDBは、最後の操作から30分が過ぎたセッションIDを削除します。

```yaml refs
- code: sample:services/auth/src/session.ts#L8-L12
  note: セッションIDを発行し、有効期間を30分に設定する処理です。
- quote: "Common idle timeouts ranges are 2-5 minutes for high-value applications and 15-30 minutes for low risk applications."
  ja: 一般的なアイドルタイムアウトの範囲は、価値の高いアプリケーションで2〜5分、リスクの低いアプリケーションで15〜30分です。
  source: OWASP Session Management Cheat Sheet「Idle Timeout」
  url: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#idle-timeout
  license: CC BY-SA 4.0
  snapshot: ../fixtures/sources/owasp-idle-timeout.txt
```

## ログイン画面の変更点

ログイン画面に、ロックの残り時間と再設定の案内を追加します。

```yaml figure
type: screenshot
image: shots/login.png
url: https://admin.example.com/login
viewport: 960
height: 560
mask: [".who"]
marks:
  - selector: ".alert"
    note: ロック中は、解除までの残り時間を分単位で表示します。
  - selector: ".reset"
    note: 再設定の案内は、失敗が3回を超えた時点から表示します。
```

画面右上の前回のログインの表示は、個人情報を含むため塗りつぶしています。
