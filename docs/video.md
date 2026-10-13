# 動画

パスは、リポジトリの根からの相対パスです。概要は [README](../README.md) にあります。

同じ原稿から、解説動画（MP4、1920×1080、30fps）も作れます。動画の絵と動きは、AI が1シーンずつ HTML、SVG、CSS、JS で自由に書きます。zukai は背景もキャラクターも描かず、時刻の制御、ナレーション、字幕、シーンの切り替え、効果音、書き出しと、壊れた動画を出さないための検査（ガードレール）だけを受け持ちます。動画の品質は、AI の書くものでそのまま決まります。

```bash
zukai setup output                  # 出力を「資料と動画」にし、声、語り口、BGM、API キーを設定する
zukai config set output video       # 対話なしで、チームの出力を動画にする
zukai login gemini                  # Gemini の API キーを保存する
zukai prompt --video                # 動画の書き方を含めた指示を出力する
zukai frames 原稿.md --sheet          # 検査し、シーンごとに6つの時刻のコマを並べた画像を書き出す
zukai video 原稿.md [--draft]         # MP4 を書き出す（--draft は 960×540、15fps）
```

| 原稿のブロック | 内容 |
|---|---|
| `yaml narration` | 話し言葉のナレーション。1要素が字幕1枚。行ごとの語り口（`style`）、例の印（`example: true`）、読み上げの指示のタグ（`<short pause>`）、時刻の目印（`{#名前}`）を書ける。資料には出ない |
| `yaml narration ending`、`html motion ending` | 動画の最後のまとめのシーン。資料には出ない |
| `yaml narration question` と `html motion question` など | セクションを、役割（`question` 疑問、`answer` 答え、`example` 例、`term` 用語）ごとの短いショットに分ける。同じ役割の名前で組にする |
| `html motion` | シーンの絵と動き。目印の時刻は CSS 変数で、`zk.scene((t, root) => …)` で毎コマの JS を書ける。資料には出ない |

台本は、1人の語り手がていねいに説明する形にします。オープニングでテーマと答える疑問を示し、各セクションでは疑問、答え、例、用語の補足をそれぞれ短いショットにし、エンディングで要点をまとめます。答えは原稿の根拠だけで組み立てます。シーンは `zk.refs()` で、Lint と同じ方法で確かめた根拠（コードの抜粋と引用）を読み、画面に出典を示せます。検査は、例ではない行の数値が原稿に無いとき（V013）、疑問から始まらないとき（V014）、同じ書き出しが続くとき（V016）、ショットが長いとき（V107）に知らせます。書き方の全体は `prompts/video.md` にあります。完全な例は `examples/video/login.md` です。

| ガードレール | 内容 |
|---|---|
| サンドボックス | AI のコードは、ヘッドレスの Chromium の中だけで動かす。ネットワークの要求はすべて拒否し、Node では動かさない |
| 時刻と乱数 | `Date`、タイマー、`requestAnimationFrame`、`Math.random` を、エンジンの時刻と種を固定した乱数に置き換える |
| 暴走と例外 | 読み込みと1コマの時間に上限を設ける。超えたシーンと、読み込みで例外を出したシーンは、主張文と図だけの簡素な動きに差し替える |
| 見た目 | 文字のはみ出し、字幕の帯との重なり、文字の大きさ、要素の数、シーンより長いアニメーション、同じ時刻のコマが一致するか、音割れを調べる |

効果音は ZzFX（MIT、`src/video/vendor/`）で作ります。AI は、名前の付いた12個の音（`appear`、`whoosh`、`chime` など）を選ぶか、ZzFX の数値を書いて新しい音を作ります。音の選び方は `spikes/sfx/` で聞き比べました。

ID と上限は `zukai frames` の出力と `contract/limits.json` の `video` にあります。ナレーションは Gemini TTS（既定は `gemini-3.8-flash-tts`、声は `Kore`。`video.model` と `video.voice` で変える）で読み上げ、`.zukai/cache/tts` に保存します。API キーは `zukai login gemini` で `~/.zukai/credentials.json` に保存するか、環境変数 `GEMINI_API_KEY` に置きます。キーが無いときは、字幕だけの無音の動画になります。そのことは `zukai doctor` が知らせ、`zukai prompt` の指示にも書くので、AI がチャットで利用者に伝えます。無料枠のキーでは、地域と利用規約によって、送った文が Google の製品改善に使われることがあります。条件は Gemini API の利用規約で確かめます。

動画を作るには、Playwright と Chromium（`npm install playwright`、`npx playwright install chromium`）と、コマンドのパスに入った ffmpeg が必要です。足りないものは `zukai doctor` が、直すコマンドと一緒に表示します。
