// zukai の mod。チャットの返答を zukai の書き方にし、返答の中の図を描く。
// - すべての場所: システムプロンプトに、返答の書き方（zukai prompt --chat）を足す
// - Desktop アプリ: 返答の中の図のブロックを SVG で描く
// - ターミナル: 図を PNG にして Image で描く。kitty の画像表示に対応しないターミナルでは、PNG のパスを出す
// - VS Code 拡張: チャット欄には描けないので、返答が終わったら図を PNG にしてエディタのタブで開く
// 図の描画は Node で動く zukai の CLI に任せる。mod の実行環境には Node がないため。
import type { Register, EngineInterface } from 'claude-code'

type Figure = { type?: string; alt?: string; svg?: string; png?: string; width?: number; height?: number; error?: string }
type Part = { text: string; isFigure: boolean }

// 返答を、Markdown の部分と図のブロックに分ける。閉じていないブロック（書いている途中）は Markdown のまま残す。
// ほかのコードブロック（```` で囲んだ書き方の例など）の中は読み飛ばす。図として数えるのは、行頭から始まる図のブロックだけ。
export function split(text: string): Part[] {
  const lines = text.split('\n')
  const parts: Part[] = []
  let buf: string[] = []
  const flush = () => {
    if (buf.length) parts.push({ text: buf.join('\n'), isFigure: false })
    buf = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const open = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    // 閉じる行は、開いた記号と同じ文字で、同じ数以上並んだ行。
    const end = open ? lines.findIndex((l, j) => j > i && new RegExp(`^ {0,3}${open[2]![0]}{${open[2]!.length},}\\s*$`).test(l)) : -1
    if (!open) {
      buf.push(line)
      continue
    }
    // 閉じていないコードブロックは、返答の終わりまで続く（書いている途中の外側のブロックの中を、図として数えない）。
    if (end < 0) {
      buf.push(...lines.slice(i))
      break
    }
    const isFigure = open[1] === '' && open[2]![0] === '`' && /^\s*(ya?ml|svg)\s+figure\b/.test(open[3]!)
    if (isFigure) {
      flush()
      parts.push({ text: lines.slice(i, end + 1).join('\n'), isFigure: true })
    } else {
      buf.push(...lines.slice(i, end + 1))
    }
    i = end
  }
  flush()
  return parts
}

const cliOf = ($: EngineInterface) => `${$.plugin.root.replaceAll('\\', '/')}/src/cli.js`

// 同じブロックを描き直さない。返答を書いている間は、同じ図で何度も描画が起きる。
const cache = new Map<string, Promise<Figure>>()
// screenshot の図は、画像ファイルが撮り直されることがあるので、ターンが終わったらキャッシュから捨てる。
const perTurn = new Set<string>()

// Desktop の Svg 要素が受け付ける SVG の長さの上限。これより長い図は描かずに、YAML のまま表示する。
const SVG_MAX = 131072

// まだ描いていない図をまとめて1回の CLI 呼び出しで描く。結果は、図のブロックの順に返る。
async function draw($: EngineInterface, blocks: string[], png: boolean): Promise<Figure[]> {
  const key = (b: string) => `${png}:${b}`
  const todo = [...new Set(blocks.filter(b => !cache.has(key(b))))]
  if (todo.length) {
    // CLI の失敗、時間切れ、長すぎて切れた出力は、どれも図の error にする。error の図は YAML のまま表示される。
    const fail = (message: string) => todo.map(() => ({ error: message }))
    const run = $.process
      .run(['node', cliOf($), 'figures', png ? '--png' : `--max-svg=${SVG_MAX}`], { stdin: todo.join('\n\n') })
      .then(r => {
        if (r.exitCode !== 0) return fail(r.stderr)
        if (r.isStdoutTruncated) return fail('図の出力が長すぎます。')
        return JSON.parse(r.stdout) as Figure[]
      })
      .catch((err: unknown) => fail(String(err)))
    todo.forEach((b, i) => {
      const one: Promise<Figure> = run.then(list => list[i] ?? { error: '図を描けませんでした。' })
      cache.set(key(b), one)
      // 失敗した図は、次の描画でもう一度試す。
      // screenshot かどうかは、CLI が YAML を読んだ結果で判定する（type: "screenshot" のような書き方も同じに扱うため）。
      one.then(f => (f.error ? cache.delete(key(b)) : f.type === 'screenshot' && perTurn.add(key(b))))
    })
  }
  return Promise.all(blocks.map(b => cache.get(key(b))!))
}

export const register: Register = on => {
  let chatPrompt = ''

  on('session.start', async ($, e, next) => {
    const cli = cliOf($)
    try {
      const r = await $.process.run(['node', cli, 'prompt', '--chat', `--type-command=node "${cli}" type`])
      chatPrompt = r.exitCode === 0 ? r.stdout : ''
      if (!chatPrompt) $.ui.log(`zukai: 返答の書き方を読めませんでした。${r.stderr.slice(0, 200)}`)
    } catch (err) {
      $.ui.log(`zukai: 返答の書き方を読めませんでした。${String(err).slice(0, 200)}`)
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!chatPrompt) return composed
    return { sections: [...composed.sections, { id: 'zukai:chat', text: chatPrompt, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'terminal') return next(e)
    const parts = split(e.props.text)
    const blocks = parts.filter(p => p.isFigure).map(p => p.text)
    if (!blocks.length) return next(e)
    const figures = await draw($, blocks, e.surface === 'terminal')
    let n = 0
    const tagged = parts.map(p => ({ ...p, figure: p.isFigure ? figures[n++] : undefined }))

    if (e.surface === 'desktop') {
      const { Box, Markdown, Svg } = $.ui.resolve(e)
      return Box({
        flexDirection: 'column',
        children: tagged.map(p =>
          p.figure?.svg ? Svg({ source: p.figure.svg, alt: p.figure.alt ?? '図' }) : Markdown({ text: p.text }),
        ),
      })
    }

    const { Box, Markdown, Image } = $.ui.resolve(e)
    // 端末の文字は縦長なので、行数は幅の半分の比率で決める。
    const columns = Math.min(Math.max((e.viewport?.columns ?? 82) - 2, 20), 120)
    return Box({
      flexDirection: 'column',
      children: tagged.map(p => {
        const f = p.figure
        if (!f?.png || !f.width || !f.height) return Markdown({ text: p.text })
        const rows = Math.min(Math.max(Math.round((columns * f.height) / f.width / 2), 1), 255)
        return Image({ source: { file: f.png, format: 'png' }, columns, rows, alt: `図: ${f.alt}（${f.png}）` })
      }),
    })
  })

  // VS Code 拡張のチャット欄には mod の描画が出ない。返答が終わったら、図をエディタのタブで開く。
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      for (const k of perTurn) cache.delete(k)
      perTurn.clear()
    }
    if (e.agentId || e.reason !== 'answer') return done
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-vscode') return done
    const blocks = split(e.answer).filter(p => p.isFigure).map(p => p.text)
    if (!blocks.length) return done
    try {
      const r = await $.process.run(['node', cliOf($), 'figures', '--open'], { stdin: blocks.join('\n\n') })
      if (r.exitCode !== 0) $.ui.log(`zukai: 図を開けませんでした。${r.stderr.slice(0, 200)}`)
    } catch (err) {
      $.ui.log(`zukai: 図を開けませんでした。${String(err).slice(0, 200)}`)
    }
    return done
  })
}
