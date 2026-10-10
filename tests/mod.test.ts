import { test, expect } from 'claude-code/testing'
import { split } from '../hooks/register.ts'

const FIG = '```yaml figure\ntype: flow\nsteps:\n  - label: 受付\n```'
const TEXT = `結論です。\n\n${FIG}\n\n説明です。`

// zukai の CLI の代わりに答える。図は1つで、SVG と PNG の両方を返す。
const fakeCli = { exitCode: 0, stdout: JSON.stringify([{ alt: '受付', svg: '<svg viewBox="0 0 720 56"></svg>', png: '/tmp/a.png', width: 1440, height: 112 }]), stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

test('返答を、文章と、閉じた図のブロックに分ける', () => {
  expect(split(TEXT).map(p => p.isFigure)).toEqual([false, true, false])
  expect(split(TEXT)[1]?.text).toBe(FIG)
  // 書いている途中の図は、文章のまま残す。
  expect(split('前\n```yaml figure\ntype: flow').every(p => !p.isFigure)).toBe(true)
  // ```` で囲んだ書き方の例の中の図は、図として数えない。
  const example = `\`\`\`\`markdown\n${FIG}\n\`\`\`\``
  expect(split(`${example}\n\n${FIG}`).map(p => p.isFigure)).toEqual([false, true])
  expect(split(`${example}\n\n${FIG}`)[0]?.text).toBe(`${example}\n`)
})

test('Desktop は図を SVG で、ターミナルは画像で描く', async ($, on) => {
  on('process.run', () => ({ value: fakeCli }))
  const desktop = await $.ui.mount({ plugin: 'zukai', surface: 'desktop', component: 'AssistantMessage', props: { text: TEXT, isFirstOfReply: true } })
  expect(await desktop.find({ type: 'Svg' })).toBeDefined()
  expect(await desktop.findAll({ type: 'Markdown' })).toHaveLength(2)

  const terminal = await $.ui.mount({ plugin: 'zukai', surface: 'terminal', component: 'AssistantMessage', props: { text: TEXT, isFirstOfReply: true }, viewport: { columns: 82, rows: 40 } })
  expect(await terminal.find({ type: 'Image' })).toBeDefined()
})
