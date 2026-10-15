// 書き出す HTML で、原稿に書かれたスクリプトやフォームを動かさない。保存したファイルを開いたときも効くように meta で入れる。
// view と gui も使う。描画の重い依存を読まずに使えるよう、別のファイルに置く。
export const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
