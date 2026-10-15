## 動画の検査

`{{cli}} frames` は、次の項目を機械的に検査します。V001、V002（読み込み）、V105 の error になったシーンは、代わりの簡素な動きに差し替わります。

| ID | 内容 | 重さ |
|---|---|---|
| V001 | 読み込みが{{loadSec}}秒、1コマが{{frameSec}}秒で終わらない。無限ループを疑う | error |
| V002 | スクリプトが例外を出した。読み込みの例外は error、`zk.scene` の中の例外は warn | error / warn |
| V003 | シーンの html motion がない | error |
| V004 | オープニングのナレーションがない | error |
| V005 | エンディング（`yaml narration ending`）がない | error |
| V010 | `<zk-options>` に使えない値がある | warn |
| V012 | yaml narration を YAML として読めない | error |
| V013 | 例ではない行の数値が、原稿の主張文、図、説明文、根拠にない | warn |
| V014 | セクションの最初のショットの最初の行が疑問の形ではない。オープニングに疑問の形の行がない | warn |
| V016 | 読点までの書き出しが同じ行が、動画全体で{{sameLead}}回を超える | warn |
| V017 | 使えない役割の名前がある。役割が組になっていない | warn |
| V018 | 1つのセクションに、役割の無い yaml narration が2つ以上ある | error |
| V101 | シーンの最後のコマで、文字が画面の外にはみ出す | warn |
| V102 | シーンの最後のコマで、文字が字幕の帯に重なる | warn |
| V103 | 文字が{{minFont}}px より小さい | warn |
| V104 | アニメーションがシーンの長さを超えて続く | warn |
| V105 | シーンの要素が{{maxElements}}個を超える | error |
| V106 | シーンが{{maxScene}}秒、動画全体が{{maxTotal}}秒を超える | warn |
| V107 | 1ショットのナレーションが{{shotLines}}行、またはショットが{{shotSec}}秒を超える | warn |
| V201 | 同じ時刻のコマが、撮るたびに変わる | warn |
| V301 | `zk.sound` の音が割れる | warn |
| V302 | 効果音の名前が無い。ZzFX の数値が正しくない | warn |
