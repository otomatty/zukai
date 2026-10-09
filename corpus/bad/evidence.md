# 根拠が崩れた資料

## 架空の引用

セッションの有効期間は30分にします。

```yaml figure
type: flow
steps:
  - label: 認証サービス
    ref: 3
  - label: セッションDB
```

```yaml refs
- quote: "Sessions must always expire after exactly 30 minutes of inactivity."
  ja: セッションは、操作がない状態が30分続いたら必ず失効させます。
  source: OWASP Session Management Cheat Sheet「Idle Timeout」
  url: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#idle-timeout
  snapshot: ../fixtures/sources/owasp-idle-timeout.txt
- quote: "All sessions should implement an idle or inactivity timeout."
  source: OWASP Session Management Cheat Sheet「Idle Timeout」
  url: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#idle-timeout
  snapshot: ../fixtures/sources/owasp-idle-timeout.txt
```

## 存在しない行

認証サービスはセッションIDを発行します。

```yaml figure
type: flow
steps:
  - label: 認証サービス
  - label: セッションDB
```

```yaml refs
- code: sample:services/auth/src/session.ts#L40-L60
  note: セッションIDを発行する処理です。
- code: unknown:src/a.ts#L1-L2
  note: 存在しないリポジトリの処理です。
```
