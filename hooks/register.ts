// zukai の mod。チャットの返答を zukai の書き方にし、返答の中の図を描く。
// - すべての場所: システムプロンプトに、返答の書き方（zukai prompt --chat）を足す
// - Desktop アプリ: 返答の中の図のブロックを SVG で描く
// - ターミナル: 図を PNG にして Image で描く。kitty の画像表示に対応しないターミナルでは、PNG のパスを出す
// - VS Code 拡張: チャット欄には描けないので、返答が終わったら図を PNG にしてエディタのタブで開く
// 図の描画は Node で動く zukai の CLI に任せる。mod の実行環境には Node がないため。
import type { Register, EngineInterface } from 'claude-code'

type Figure = { alt?: string; svg?: string; png?: string; width?: number; height?: number; error?: string }
type Part = { text: string; isFigure: boolean }

// 返答を、Markdown の部分と図のブロックに分ける。閉じていないブロック（書いている途中）は Markdown のまま残す。
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
    const end = /^```\s*(ya?ml|svg)\s+figure\b/.test(line) ? lines.findIndex((l, j) => j > i && /^```\s*$/.test(l)) : -1
    if (end < 0) {
      buf.push(line)
      continue
    }
    flush()
    parts.push({ text: lines.slice(i, end + 1).join('\n'), isFigure: true })
    i = end
  }
  flush()
  return parts
}

const cliOf = ($: EngineInterface) => `${$.plugin.root.replaceAll('\\', '/')}/src/cli.js`

// 同じブロックを描き直さない。返答を書いている間は、同じ図で何度も描画が起きる。
const cache = new Map<string, Promise<Figure>>()

// まだ描いていない図をまとめて1回の CLI 呼び出しで描く。結果は、図のブロックの順に返る。
async function draw($: EngineInterface, blocks: string[], png: boolean): Promise<Figure[]> {
  const key = (b: string) => `${png}:${b}`
  const todo = [...new Set(blocks.filter(b => !cache.has(key(b))))]
  if (todo.length) {
    const run = $.process
      .run(['node', cliOf($), 'figures', ...(png ? ['--png'] : [])], { stdin: todo.join('\n\n') })
      .then(r => (r.exitCode === 0 ? (JSON.parse(r.stdout) as Figure[]) : todo.map(() => ({ error: r.stderr }))))
    todo.forEach((b, i) => {
      const one = run.then(list => list[i] ?? { error: '図を描けませんでした。' })
      cache.set(key(b), one)
      // 失敗した図は、次の描画でもう一度試す。
      one.then(f => f.error && cache.delete(key(b)), () => cache.delete(key(b)))
    })
  }
  return Promise.all(blocks.map(b => cache.get(key(b))!))
}

export const register: Register = on => {
  let chatPrompt = ''

  on('session.start', async ($, e, next) => {
    const cli = cliOf($)
    const r = await $.process.run(['node', cli, 'prompt', '--chat', `--type-command=node "${cli}" type`])
    chatPrompt = r.exitCode === 0 ? r.stdout : ''
    if (!chatPrompt) $.ui.log(`zukai: 返答の書き方を読めませんでした。${r.stderr.slice(0, 200)}`)
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
    if (e.agentId || e.reason !== 'answer') return done
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-vscode') return done
    const blocks = split(e.answer).filter(p => p.isFigure).map(p => p.text)
    if (!blocks.length) return done
    const r = await $.process.run(['node', cliOf($), 'figures', '--open'], { stdin: blocks.join('\n\n') })
    if (r.exitCode !== 0) $.ui.log(`zukai: 図を開けませんでした。${r.stderr.slice(0, 200)}`)
    return done
  })
}
