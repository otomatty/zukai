# デザインのテーマ

パスは、リポジトリの根からの相対パスです。概要は [README](../README.md) にあります。

図と動画の見た目（色、フォント、描き方）は、テーマで好きなものに変えられます。テーマは、AI が資料から作ります。元にできるのは、Claude Design で作ったデザインや、手元のブランドガイド、スライドなどの資料です。

```bash
zukai setup skills                       # zukai-answer と一緒に、zukai-theme スキルも書く
# AI ツールに「このデザインに合わせて」と資料を渡すと、スキルが次を行う
zukai theme init zukai-theme             # テーマのフォルダを作る
zukai theme check zukai-theme            # 値と見た目を確かめる
zukai theme preview zukai-theme          # 見本の HTML を書き出し、元の資料と見比べる
zukai theme compare emphasis.box=fill emphasis.box=tint  # 今のテーマと案を横に並べた HTML を書き出す
zukai config set theme zukai-theme       # テーマを使う（自分だけなら --scope=local）
```

テーマは、AI との対話で決めていけます。スキルは、資料だけでは決まらない値を、黙って決めません。検査と資料の食い違いも同じです。どちらも、案を `zukai theme compare` で並べて見せます。比べられるのは、検査の結果、同じ図の見え方、系列の色の色覚での見え方です。利用者が選んだ値を `tokens.json` に書き、選んだ理由を `rules.md` の `## 決めたこと` に残します。この節と `## 出典` は、AI への指示には入りません。

テーマのフォルダには、次のファイルを置きます。

| ファイル | 内容 | 使われ方 |
|---|---|---|
| `tokens.json` | 色、フォント、グラデーション、強調の描き方、グラフの色の付け方、線の太さ、コードの配色。`contract/tokens.json` と同じ形で、変える値だけを書けばよい | `contract/tokens.json` に重ね、資料（HTML、Confluence の PNG）と動画の図を描く。自由な図に使える色と、Lint の色の検査も、この値になる |
| `rules.md` | 描き方のルール。`## 図`、`## 動画`、`## 出典` の節に分ける | `zukai prompt` が AI への指示に入れる。`## 動画` は動画を作るときだけ入れ、`## 出典` は入れない |
| `types/<名前>/` | テーマの独自の図の型（任意） | 組み込みの型と同じように、指示に出て、検査を通り、資料と動画に描ける |

### グラデーションと強調

`tokens.json` の次の項目で、強調の描き方を変えます。どれも書かなければ、今の見た目のままです。

| 項目 | 値 | 効き方 |
|---|---|---|
| `gradient` | `stops`（2〜5色）と `angle`（CSS の角度。90 は左から右） | 図では `zk-grad`、動画では CSS 変数 `--zk-gradient` として使える |
| `emphasis.box` | `flat`（淡い面と強調の色の枠）、`fill`（グラデーションの面と白抜きの文字）、`tint`（淡いグラデーションの面とグラデーションの枠）、`outline`（グラデーションの枠） | `emphasis: true` を付けた箱。箱を描く型（flow、branch、layers、sequence、tree、state、swimlane、timeline、compare、zones）。gantt と venn の強調は、強調の色のまま |
| `emphasis.chart` | `flat`（強調の色）、`gradient`（グラデーション） | bar、progress、line、stack で `emphasis: true` を付けた棒、系列、内訳 |
| `chart.mode` | `series`（系列ごとに色を変える）、`neutral`（灰色を基本にし、強調するものだけに色を付ける） | bar、progress、line、stack は強調以外を灰色の濃淡に、treemap と heatmap は淡い灰色のマスに本文の色の文字にする |
| `chart.series` | 3〜5色 | 系列を色で分けるときの色 |

`fill` を選んだときは、`zukai theme check` が白抜きの文字を確かめます。グラデーションのどの色の上でも、4.5:1 以上で読める必要があります。

treemap と heatmap は、塗ったマスの上の文字を、白抜きの文字（`color.onAccent`）と本文の色（`color.ink`）のうち、地色とのコントラストが高いほうで書きます。`zukai theme check` は、treemap の上の階層の色（`chart.series` など）と heatmap の最も濃いマスで、どちらかが 4.5:1 以上になるかを確かめます。heatmap は、どちらでも 4.5:1 に届かない中間の濃さのマスには数値を書きません。

### 独自の型

テーマの `types/<名前>/` に、次のファイルを置くと、そのテーマを使うプロジェクトでだけ使える図の型になります。テーマごとに、資料と動画で使う型を足せます。

| ファイル | 内容 |
|---|---|
| `type.json` | `summary`（型の説明）、`when`（使うとき）、`fields`（項目の定義）、`example`（例の仕様） |
| `figure.svg` | 図のひな形。`{{value}}` のように項目を差し込む。`{{#items}}…{{/items}}` で繰り返し、`{{= 40 + @index * 200}}` で位置を計算し、`{{theme.color.accent}}` でテーマの値を使える |
| `motion.js` | 動画で、この図を動かすスクリプト（任意）。無ければ、組み込みの型と同じく部品ごとに現れる |

```json
{
  "summary": "主役の数字を、大きな文字で見せる",
  "when": "1つの数字が、そのセクションの結論になっている",
  "fields": {
    "value": { "type": "string", "max": 5, "required": true, "desc": "数字" },
    "label": { "type": "string", "max": 16, "required": true, "desc": "数字が何を表すか" }
  },
  "example": { "value": "300", "label": "導入企業数" }
}
```

項目の型は `string`、`number`、`boolean`、`list`、`object` です。文字には全角の字数の上限（`max`）、配列には個数の上限が必須です。原稿の仕様は、この定義で確かめます。

ひな形を埋めた SVG は、自由な図と同じ検査を通し、同じ方法で組み立て直します。検査するのは、使える要素と属性、テーマの色、12px 以上の文字、文字の収まりです。テーマの型でも、型のある図と同じ品質を保てます。`zukai theme check` は、各型の例がこの検査を通るかも確かめます。

`motion.js` は、次の `ctx` を受け取ります。

| 名前 | 内容 |
|---|---|
| `ctx.svg` | 図の SVG 要素。SVG がない場合は `null` |
| `ctx.parts` | 図の部品。`el` が要素 |
| `ctx.times`、`ctx.start` | 各部品が現れる秒と、最初の部品が現れる秒。ナレーションが部品の名前を読む時刻に合わせてある |
| `ctx.scene` | 現在の動画シーン |
| `ctx.frame(f)` | 毎コマ `f(t, info)` を呼ぶ。数え上げのような、時刻から計算する動きに使う |
| `ctx.sfx(名前, 秒)` | 効果音を鳴らす |

AI が書くシーンのスクリプトと同じく、ヘッドレスの Chromium の中だけで動き、時刻はエンジンが決めます。Node では動かさず、`zukai theme check` も書き方を確かめるだけです。

取り込みは、スキル（`zukai-theme`）が行います。AI が資料を読んで値とルールを決め、zukai は値を検査するだけです。スキルには、形式ごとの資料の読み方を書いてあります。HTML と CSS は CSS 変数を、PowerPoint はテーマの配色と書体の定義を読み、PDF と画像は見た目から読み取ります。資料そのものはテーマのフォルダにコピーしません。`rules.md` の「出典」には、資料の名前だけを書きます。

| 検査 | 内容 |
|---|---|
| 値（読むときに止める） | 無い項目、色でない値、選択肢に無い値、要素の数の違う配列、`;` や `{` を含むフォント。図の幅と動画の大きさ（`figure.width`、`video.width`、`video.height`、`video.fps`）は、Lint の上限が前提にしているので変えられない |
| 文字（error） | 文字と背景のコントラストが 4.5:1 以上か。図の文字、補足、強調、強調の上の文字、動画の文字と字幕を、資料と動画の両方で確かめる |
| 強調した箱の文字（error） | `fill` の白抜きの文字と、`tint` の淡い面の上の文字が、グラデーションのどの色の上でも 4.5:1 以上か |
| 系列の色（warn） | 背景と 2.5:1 以上か。系列の色が、通常の見え方と、1型、2型の色覚で見分けられるか |
| 独自の型（error） | type.json の形、ひな形の書き方、motion.js の書き方、例が検査を通るか、組み込みの型と名前が重ならないか |
| コードの配色（error） | `codeTheme` が Shiki にある名前か |

`zukai doctor` も、設定したテーマを同じように確かめます。テーマを変えると、自由な図（`svg figure`）に書いた前の色は、Lint の F001 になります。

テーマで変わるのは、zukai が描く部分（図、本文の配色、動画の背景、字幕、図）と、自由な図に使える色と、使える図の型です。動画のシーンの絵は AI が書くので、テーマの配色を CSS 変数として渡し、絵柄は `rules.md` の `## 動画` の指示で寄せます。どこまで従ったかは `zukai frames --sheet` で確かめます。
