# 注文管理システムのアーキテクチャ

この資料は、新しく参加したエンジニアに、注文管理システムの構成と、注文1件が処理される流れを説明します。数値と設定は、2026年10月1日時点のコードから引用しています。

## 全体の構成

注文APIは VPC の中で動き、注文DBとキューだけに接続します。

```yaml figure
type: zones
zones:
  - nodes:
      - label: ブラウザ
        icon: browser
  - label: 配信
    nodes:
      - label: CloudFront
        icon: aws/AmazonCloudFront
      - label: 画面のファイル
        icon: aws/AmazonSimpleStorageService
  - label: アプリ
    nodes:
      - label: ALB
        icon: aws/ElasticLoadBalancing
      - label: 注文API
        note: Fargate
        icon: aws/AWSFargate
  - label: データ
    nodes:
      - label: 注文DB
        note: Aurora
        icon: aws/AmazonAurora
      - label: 通知キュー
        note: SQS
        icon: aws/AmazonSimpleQueueService
  - label: 通知
    nodes:
      - label: 通知処理
        note: Lambda
        icon: aws/AWSLambda
      - label: メール送信
        note: SES
        icon: aws/AmazonSimpleEmailService
links:
  - [ブラウザ, CloudFront, HTTPS]
  - [CloudFront, 画面のファイル]
  - [CloudFront, ALB, /api]
  - [ALB, 注文API]
  - [注文API, 注文DB]
  - [注文API, 通知キュー]
  - [通知キュー, 通知処理]
  - [通知処理, メール送信]
groups:
  - label: VPC
    from: 3
    to: 4
```

サブネットは公開、アプリ、データの3種類で、2つのアベイラビリティゾーンに作ります。注文DBのサブネットは、インターネットへの経路を持ちません。注文APIは、CPU 使用率が60%を超えると6タスクまで増えます。

```yaml refs
- code: infra:lib/network-stack.ts#L12-L20
  note: 3種類のサブネットを、2つのアベイラビリティゾーンに作る定義です。
- code: infra:lib/api-stack.ts#L38-L40
  note: 注文APIのタスク数を、CPU 使用率に応じて2〜6の間で増減させる設定です。
```

## アベイラビリティゾーンへの配置

注文APIと注文DBは、2つのアベイラビリティゾーンに1つずつ置きます。

```svg figure
<svg viewBox="0 0 720 326">
  <title>2つのアベイラビリティゾーンと3種類のサブネットへの、ALB、注文API、注文DBの配置</title>
  <rect class="zk-band" x="140" y="40" width="260" height="276" rx="8"/>
  <rect class="zk-band" x="450" y="40" width="260" height="276" rx="8"/>
  <text class="zk-text" x="270" y="26" text-anchor="middle">ゾーン a</text>
  <text class="zk-text" x="580" y="26" text-anchor="middle">ゾーン c</text>
  <text class="zk-note" x="128" y="89" text-anchor="end">公開サブネット</text>
  <text class="zk-note" x="128" y="181" text-anchor="end">アプリ用サブネット</text>
  <text class="zk-note" x="128" y="273" text-anchor="end">データ用サブネット</text>
  <rect class="zk-box" x="156" y="56" width="110" height="58" rx="6"/>
  <text class="zk-text" x="211" y="90" text-anchor="middle">ALB</text>
  <rect class="zk-box" x="274" y="56" width="110" height="58" rx="6"/>
  <text class="zk-text" x="329" y="90" text-anchor="middle">NAT Gateway</text>
  <rect class="zk-box" x="466" y="56" width="110" height="58" rx="6"/>
  <text class="zk-text" x="521" y="90" text-anchor="middle">ALB</text>
  <rect class="zk-box" x="156" y="148" width="228" height="58" rx="6"/>
  <text class="zk-text" x="270" y="182" text-anchor="middle">注文APIのタスク</text>
  <rect class="zk-box" x="466" y="148" width="228" height="58" rx="6"/>
  <text class="zk-text" x="580" y="182" text-anchor="middle">注文APIのタスク</text>
  <rect class="zk-box-em" x="156" y="240" width="228" height="58" rx="6"/>
  <text class="zk-text zk-em" x="270" y="274" text-anchor="middle">注文DB（書き込み用）</text>
  <rect class="zk-box" x="466" y="240" width="228" height="58" rx="6"/>
  <text class="zk-text" x="580" y="274" text-anchor="middle">注文DB（読み取り用）</text>
  <line class="zk-line" x1="386" y1="269" x2="462" y2="269" marker-end="url(#zk-arrow)"/>
  <text class="zk-note" x="425" y="260" text-anchor="middle">複製</text>
</svg>
```

片方のゾーンが止まっても、もう片方の注文APIが要求を受け付けます。書き込み用の注文DBが止まると、読み取り用が書き込み用に切り替わります。NAT Gateway は1つだけなので、ゾーン a が止まると、決済サービスへの通信ができません。

```yaml refs
- code: infra:lib/network-stack.ts#L13-L14
  note: アベイラビリティゾーンを2つ、NAT Gateway を1つにしている設定です。
- code: infra:lib/api-stack.ts#L19-L24
  note: 注文APIのタスクを2つ起動する設定です。
- code: infra:lib/data-stack.ts#L24-L25
  note: 注文DBを、書き込み用と読み取り用の1台ずつにしている設定です。
```

## 注文APIの層

注文APIは、受付、業務ルール、外部接続の3層に分かれ、上の層だけが下の層を呼びます。

```yaml figure
type: layers
layers:
  - label: 受付
    items: [注文の作成, 注文の照会, 注文の取消]
  - label: 業務ルール
    items: [入力の検証, 状態の移り変わり]
  - label: 外部接続
    items: [注文DB, 決済サービス, 通知キュー]
```

層ごとにフォルダを分けていて、受付は `src/api`、業務ルールは `src/domain`、外部接続は `src/infra` にあります。業務ルールの層は AWS や DB のライブラリを読み込まないので、単体テストは外部への接続なしで動きます。

## 注文1件の処理

注文の作成は、在庫の引き当て、決済、状態の更新の順に進み、決済だけをトランザクションの外で行います。

```yaml figure
type: sequence
actors: [ブラウザ, 注文API, 注文DB, 決済サービス]
messages:
  - from: ブラウザ
    to: 注文API
    label: 商品と数量
  - from: 注文API
    to: 注文DB
    label: 在庫の引き当てと保存
  - from: 注文API
    to: 決済サービス
    label: 与信の依頼
  - from: 決済サービス
    to: 注文API
    label: 与信の結果
    reply: true
  - from: 注文API
    to: 注文DB
    label: 状態を決済済みに
  - from: 注文API
    to: ブラウザ
    label: 注文番号
    reply: true
```

決済サービスの応答は最大3秒待ちます。この間 DB の接続を持ったままにすると、接続プールが埋まるため、決済の前にトランザクションを閉じています。与信に失敗した注文は、在庫を戻して取消にします。

```yaml refs
- code: api:src/api/orders.ts#L14-L20
  note: 在庫の引き当てと注文の保存を1つのトランザクションで行い、その後に与信を依頼する処理です。
- code: api:src/api/orders.ts#L21-L28
  note: 与信に失敗したときに、在庫を戻して注文を取消にする処理です。
```

## 注文の状態

注文は受付済み、決済済み、出荷済みの順に進み、出荷の前だけ取消にできます。

```yaml figure
type: state
states: [受付済み, 決済済み, 出荷済み, 取消]
transitions:
  - [受付済み, 決済済み, 与信に成功]
  - [決済済み, 出荷済み, 倉庫が出荷]
  - [受付済み, 取消, 与信に失敗]
  - [決済済み, 取消, 利用者が取消]
emphasis: 決済済み
```

出荷済みと取消からは、どの状態にも移りません。返品は、この注文の状態を変えずに、別の返品の記録として扱います。コードの中の名前は、順に accepted、paid、shipped、cancelled です。

```yaml refs
- code: api:src/domain/order-status.ts#L4-L9
  note: 移ることのできる状態の一覧です。ここにない移り変わりは拒否します。
```

## 管理画面での注文の確認

注文の状態は管理画面の注文一覧に表示され、出荷前の注文だけ取消ボタンを押せます。

```yaml figure
type: screenshot
image: shots/admin-orders.png
url: http://localhost:8080/admin-orders.html
viewport: 960
height: 470
mask: [".customer", ".me"]
marks:
  - selector: ".status-filter"
    note: 状態を選ぶと、その状態の注文だけを一覧に表示します。
  - selector: ".row-paid .status"
    note: 状態は、受付済み、決済済み、出荷済み、取消の4つを色で区別します。
  - selector: ".row-shipped .cancel"
    note: 出荷済みと取消の注文は、取消ボタンを押せません。
```

顧客の名前と担当者のメールアドレスは、個人情報なので塗りつぶしています。画面は開発環境で撮影したもので、注文は検証用のデータです。

## 通知メールの送信

通知メールは、キューを介して通知処理が送り、失敗した通知は5回まで再配信します。

```yaml figure
type: flow
steps:
  - label: 注文API
    note: 依頼をキューに入れる
    ref: 1
  - label: 通知キュー
    note: 5回まで再配信する
    ref: 2
  - label: 通知処理
    note: 10件ずつ受け取る
    emphasis: true
    ref: 3
  - label: メール送信
    note: SES が配信する
```

注文APIは依頼をキューに入れた時点で応答を返すので、メールの送信に時間がかかっても注文の応答は遅くなりません。5回受信しても送れなかった通知は調査用のキューに移り、14日間残ります。通知処理は、失敗した通知だけを再配信の対象として返します。

```yaml refs
- code: api:src/infra/queue.ts#L12-L19
  note: 注文APIが、通知の依頼をキューに入れる処理です。
- code: infra:lib/data-stack.ts#L31-L37
  note: 通知キューの再配信の回数と、調査用のキューの保存期間を決める定義です。
- code: api:src/worker/notify.ts#L10-L11
  note: 通知処理の入口です。失敗した通知を記録する配列を用意します。
```

## リポジトリの分担

アプリケーションとインフラは別のリポジトリで管理し、置き場所も異なります。

| リポジトリ | 置き場所 | 内容 | 変更を反映する方法 |
|---|---|---|---|
| order-api | CodeCommit | 注文APIと通知処理のコード | main への取り込みで自動デプロイ |
| order-infra | GitHub | CDK によるインフラの定義 | 承認の後に `cdk deploy` を実行 |

order-api は、レビュー1件の承認で main に取り込めます。order-infra の変更は、基盤チームが差分を確認してから本番へ反映します。

## 両方のリポジトリに関わる変更

通知処理と DB 接続の上限は、2つのリポジトリの両方に関わります。

```yaml figure
type: venn
sets:
  - label: order-api
    items: [注文の処理, 状態の規則, 入力の検証]
  - label: order-infra
    items: [ネットワーク, 注文DBの容量, タスク数]
overlaps:
  - sets: [order-api, order-infra]
    items: [通知処理, DB接続の上限]
    emphasis: true
```

通知処理のコードは order-api、Lambda の定義は order-infra で管理しています。DB 接続の本数は、order-api の接続の上限と、order-infra のタスク数の掛け算で決まります。どちらかを変えるときは、もう片方のリポジトリも確認します。

```yaml refs
- code: infra:lib/notify-stack.ts#L12-L16
  note: order-infra の Lambda の定義が、order-api にある通知処理のコードを指定しています。
- code: api:src/infra/db.ts#L8-L8
  note: order-api にある、1タスクあたりの DB 接続の上限です。
```

## デプロイの流れ

main に取り込んだ変更は、テスト、イメージの作成、タスクの入れ替えを経て本番に出ます。

```yaml figure
type: swimlane
lanes: [開発者, CodeCommit, CodeBuild, ECS]
steps:
  - lane: 開発者
    label: 変更を取り込む
  - lane: CodeCommit
    label: main を更新
  - lane: CodeBuild
    label: テストを実行
  - lane: CodeBuild
    label: イメージを作成
  - lane: ECS
    label: タスクを入れ替え
    emphasis: true
```

テストに失敗すると、イメージは作られません。新しいタスクがヘルスチェックに通らない場合、ECS は入れ替えを中止して、前のイメージに戻します。イメージには、コミットの ID をタグとして付けます。

```yaml refs
- code: api:buildspec.yml#L9-L15
  note: イメージを作成し、コミットの ID をタグにして登録する手順です。
- code: infra:lib/api-stack.ts#L33-L36
  note: 入れ替えに失敗したときに前のイメージへ戻す設定と、ヘルスチェックの設定です。
```

## ブランチの使い方

作業は機能ごとのブランチで行い、main に取り込んだ時点で本番に出ます。

```yaml figure
type: gitgraph
branches: [main, feature/cancel, fix/timeout]
commits:
  - branch: main
    label: 注文の作成
    tag: v2.3.0
  - branch: feature/cancel
    from: main
    label: 取消のAPI
  - branch: feature/cancel
    label: 在庫を戻す
  - branch: fix/timeout
    from: main
    label: 決済の待ち時間
  - branch: main
    merge: fix/timeout
    tag: v2.3.1
  - branch: main
    merge: feature/cancel
    tag: v2.4.0
```

develop のような中間のブランチは置きません。機能のブランチは3日以内に取り込み、長くなる場合は機能を分けます。取り込みにはレビュー1件の承認が必要です。

## 主な設定値

障害の調査でよく参照する設定値は、次の5つです。

| 設定 | 値 | 定義している場所 |
|---|---|---|
| 注文APIのタスク数 | 2〜6 | order-infra の `lib/api-stack.ts` |
| DB 接続の上限（1タスク） | 20本 | order-api の `src/infra/db.ts` |
| 決済の待ち時間 | 3秒 | order-api の `src/api/orders.ts` |
| 通知の再配信 | 5回まで | order-infra の `lib/data-stack.ts` |
| 注文DBの容量 | 0.5〜4 ACU | order-infra の `lib/data-stack.ts` |

タスク数が上限の6になると、DB 接続は最大で120本になります。タスク数か接続の上限を変えるときは、注文DBが受け付ける接続数を超えないことを確認します。

```yaml refs
- code: api:src/infra/db.ts#L5-L11
  note: 接続プールの設定です。1タスクあたりの上限を20本にしています。
- code: infra:lib/data-stack.ts#L26-L27
  note: 注文DBの容量の下限と上限です。
```
