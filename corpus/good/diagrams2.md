# アカウントの運用

この資料は、アカウントの状態、退職時の手続き、ブランチの運用、通信の経路、本番環境の構成を説明します。

## アカウントの状態

アカウントは、仮登録、有効、ロック中、停止の4つの状態を移ります。

```yaml figure
type: state
states: [仮登録, 有効, ロック中, 停止]
transitions:
  - [仮登録, 有効, メール確認]
  - [有効, ロック中, 5回失敗]
  - [ロック中, 有効, 15分経過]
  - [ロック中, 停止, 管理者が停止]
  - [仮登録, 停止, 期限切れ]
  - [有効, 停止, 退職]
emphasis: 有効
```

停止したアカウントは、管理者が再登録するまでログインできません。

## 退職者のアカウントの停止

退職者のアカウントは、人事、管理者、認証サービスの順に処理します。

```yaml figure
type: swimlane
lanes: [人事, 管理者, 認証サービス]
steps:
  - lane: 人事
    label: 退職日を登録
  - lane: 管理者
    label: 停止を承認
  - lane: 認証サービス
    label: アカウントを停止
    emphasis: true
  - lane: 認証サービス
    label: セッションを削除
```

認証サービスは、退職日の翌日0時にアカウントを停止します。

## ブランチの運用

機能はfeatureブランチで作り、developを経由してmainへ取り込みます。

```yaml figure
type: gitgraph
branches: [main, develop, feature/login]
commits:
  - branch: main
    label: 初期構成
  - branch: develop
    from: main
    label: 認証の土台
  - branch: feature/login
    from: develop
    label: 画面を追加
  - branch: feature/login
    label: 照合を追加
  - branch: develop
    merge: feature/login
    label: 機能を取り込み
  - branch: develop
    label: 設定を整理
  - branch: main
    merge: develop
    tag: v1.2.0
```

mainへ取り込んだ時点で、バージョンのタグを付けます。

## 通信の経路

外部からの通信は、公開領域のゲートウェイだけが受け付けます。

```yaml figure
type: zones
zones:
  - label: 外部
    nodes: [ブラウザ]
  - label: 公開領域
    nodes: [ゲートウェイ]
  - label: 社内領域
    nodes: [認証サービス, セッションDB]
links:
  - [ブラウザ, ゲートウェイ, HTTPS]
  - [ゲートウェイ, 認証サービス, 社内通信]
  - [認証サービス, セッションDB]
emphasis: ゲートウェイ
```

社内領域の認証サービスとセッションDBには、外部から直接接続できません。

## 本番環境の構成

認証サービスは、非公開サブネットのECS Fargateで動かします。

```yaml figure
type: zones
zones:
  - nodes: [{label: 利用者, icon: user}]
  - nodes: [{label: CloudFront, note: 配信, icon: aws/AmazonCloudFront}]
  - label: 公開サブネット
    nodes: [{label: ALB, note: 振り分け, icon: aws/ElasticLoadBalancing}]
  - nodes: [{label: ECS Fargate, note: 認証サービス, icon: aws/AWSFargate}]
  - nodes:
      - {label: Aurora, note: 利用者DB, icon: aws/AmazonAurora}
      - {label: ElastiCache, note: セッションDB, icon: aws/AmazonElastiCache}
groups:
  - {label: AWS クラウド, from: 2, to: 5}
  - {label: VPC, from: 3, to: 5}
  - {label: 非公開サブネット, from: 4, to: 5}
links:
  - [利用者, CloudFront]
  - [CloudFront, ALB]
  - [ALB, ECS Fargate]
  - [ECS Fargate, Aurora]
  - [ECS Fargate, ElastiCache]
```

公開サブネットに置くのはALBだけです。
