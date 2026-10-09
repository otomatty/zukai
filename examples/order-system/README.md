# サンプル: 注文管理システム

架空の注文管理システムを題材に、zukai で作った資料の例です。コードも数値も、この例のために作ったものです。

| ファイル | 内容 |
|---|---|
| `architecture.md` | アーキテクチャ説明書の原稿。実物の画面の撮影、型のある図（構成図、層、やり取り、状態、手順、ブランチ）、自由な図（ゾーンへの配置）、コードへの根拠を使う |
| `monthly-report.md` | 月次の運用レポートの原稿。折れ線、ヒートマップ、達成度、箱ひげ図、サンキー図、内訳、時系列、ツリーマップを使う |
| `repos/order-api` | アプリケーションのコード。リモートは CodeCommit |
| `repos/order-infra` | インフラの定義。リモートは GitHub |
| `fixtures/admin-orders.html` | 管理画面の見本。`architecture.md` の画面の図は、このページを撮影したもの |
| `data/` | 1か月分の運用データ（CSV）と、集計のスクリプト |

## 作り直す手順

```sh
./setup.sh                                   # 2つのリポジトリを Git のリポジトリにする（初回だけ）
node data/make.mjs                           # CSV を作る
node data/summarize.mjs                      # 図に入れる数値を集計する
node data/check.mjs                          # 原稿の図の数値が、集計と一致するか確かめる
(cd fixtures && python3 -m http.server 8080) &   # 管理画面の見本を配信する
node ../../src/cli.js capture architecture.md  # 画面を撮影し、枠の位置を記録する（Playwright が必要）
node ../../src/cli.js lint architecture.md monthly-report.md
node ../../src/cli.js build architecture.md
node ../../src/cli.js build monthly-report.md --format=confluence
```

`zukai.config.json` には、2つのリポジトリの場所だけを書いています。CodeCommit か GitHub かは、それぞれのリモートの URL から zukai が読み取ります。
