# プラグインと開発

パスは、リポジトリの根からの相対パスです。概要は [README](../README.md) にあります。

## Claude Code のプラグイン

このリポジトリは、Claude Code のプラグインとしても読み込めます。読み込むと、資料を作る `zukai` スキルが使えます。

```bash
claude --plugin-dir /path/to/zukai
```

Desktop アプリと VS Code 拡張では、`~/.claude/settings.json` の `env` に `"CLAUDE_CODE_PLUGIN_DIRS": "/path/to/zukai"` を書きます。

## 開発

zukai は TypeScript で書いています。Node.js 24 は `.ts` のファイルから型を取り除いてそのまま実行するので、ビルドの手順はありません。`tsc` は型を検査するだけで、JavaScript を書き出しません。

```bash
npm run typecheck   # 型を検査する（tsc）
npm test            # テストを動かす
npm run check       # 型の検査とテストを続けて行う
```

プルリクエストと main への push では、GitHub Actions（`.github/workflows/ci.yml`）が同じ検査を行います。CI では Playwright と Chromium も入れるので、動画と撮影のテストも飛ばさずに動きます。

| 決まり | 理由 |
|---|---|
| enum、namespace、引数のプロパティを使わない（`erasableSyntaxOnly`） | Node は型を取り除くだけで、変換はしないため |
| 型だけを読むときは `import type` と書く（`verbatimModuleSyntax`） | 型を取り除いたあとに、実在しない値の import が残らないようにするため |
| 相対パスの import には `.ts` を付ける | Node が、書いたパスのファイルをそのまま読むため |
| 図の型は `satisfies FigureType<仕様の型>` で書く | `validate` は検証前の値（`UncheckedSpec`）を、`render` などは検証済みの値を受け取るため |
| ブラウザで動く `src/video/runtime.browser.js` は JavaScript のまま置き、JSDoc の型で検査する | Chromium に、変換せずにそのまま渡すため |

zukai を `node_modules` の中に置くと、Node は `.ts` のファイルを実行しません。`npm install` で依存として入れずに、clone して `npm link` で使います。
