# 設定

パスは、リポジトリの根からの相対パスです。概要は [README](../README.md) にあります。

設定の置き場所は、だれと共有するかで分けます。設定ファイルには変えた値だけを書き、書いていない項目は既定値になります。あとで zukai の既定値を変えたときに、全員へ届くようにするためです。

| 置き場所 | ファイル | 共有の範囲 |
|---|---|---|
| この PC | `~/.zukai/config.json` | この PC の全プロジェクト |
| チーム | `zukai.config.json` | コミットしてチームで共有する |
| 手元 | `.zukai/config.json` | この PC のこのプロジェクトだけ。Git の管理に入らない |
| 本人だけ | `~/.zukai/credentials.json` | API キーとトークン。本人だけが読める権限で置く。Windows ではこの権限が効かないので、ホームのフォルダの権限で守る |

表の下ほど優先し、環境変数はさらに優先します。たとえば、チームで `output` を `video` にしていても、手元で `document` にすれば、自分だけ資料だけになります。

```bash
zukai config                                   # 対話で、項目を選んで変える
zukai config list --origin                     # 効いている値と、その出どころ
zukai config set output video                  # チームの設定に書く（項目ごとの既定の書き先）
zukai config set output document --scope=local # 自分だけ変える
zukai config set repos.api.path ../order-api --scope=local  # 手元のクローンの場所だけ変える
zukai config unset output --scope=local        # 消して、チームの値に戻す
zukai login gemini                             # API キーを、画面に出さずに入力させて保存する
zukai login confluence                         # メールアドレスと API トークンを保存する
```

| 項目 | 内容 | 既定の書き先 |
|---|---|---|
| `output` | `document`（資料だけ）か `video`（資料と動画） | チーム |
| `theme` | デザインのテーマのフォルダ。無ければ zukai の既定の見た目 | チーム |
| `video.*` | 声、語り口、BGM、効果音、TTS のモデル | チーム |
| `confluence.base`、`spaceId`、`parentId` | Confluence の URL と、初回にページを作る場所 | チーム |
| `terms` | 用語集 | チーム |
| `repos.*` | コード参照に使うリポジトリ | チーム |
| `png.font`、`chromium` | 図の PNG のフォント、Chromium の場所 | この PC だけに書ける |
| `gemini.apiKey`、`confluence.email`、`confluence.token` | キーとトークン | 本人だけに書ける。`zukai login` で保存する |

項目の型、既定値、書ける場所、対応する環境変数は、`contract/settings.json` に書いてあります。`zukai help config <項目>` で表示できます。知らない項目、型の誤り、秘密の値を設定ファイルに書いた場合は、黙って無視せずに止めます。

パスの値は、チームと手元の設定ではプロジェクトの根から、この PC の設定では `~/.zukai` から解決します。`config set` で書くパスは、今いるフォルダからのパスで書けます。

プロジェクトの根は、`zukai.config.json` か `.zukai/` が最初に見つかったフォルダです。探し始めるのは原稿のフォルダで、原稿を受け取らないコマンドは今いるフォルダです。そこから上へたどり、どちらも無ければ Git のリポジトリの根にします。`.zukai/` には、資料、キャッシュ、手元の設定を置きます。中に `.gitignore` を置くので、Git の管理には入りません。
