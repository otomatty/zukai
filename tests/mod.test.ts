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

test('CLI の出力が切れたときは、図を描かずに文章のまま表示する', async ($, on) => {
  on('process.run', () => ({ value: { ...fakeCli, stdout: '[{"alt":', isStdoutTruncated: true } }))
  const text = TEXT.replace('受付', '切れる')
  const ui = await $.ui.mount({ plugin: 'zukai', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.findAll({ type: 'Markdown' })).toHaveLength(3)
})

test('screenshot の図は、同じターンの中では描き直さず、ターンが終わったら描き直す', async ($, on) => {
  let calls = 0
  const shot = { ...fakeCli, stdout: JSON.stringify([{ type: 'screenshot', alt: '画面', svg: '<svg viewBox="0 0 720 56"></svg>' }]) }
  on('process.run', () => (calls++, { value: shot }))
  on('turn.complete', () => ({ text: '' }))
  const text = '```yaml figure\ntype: "screenshot"\nimage: shots/a.png\n```'
  const show = async () => {
    const ui = await $.ui.mount({ plugin: 'zukai', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
  }
  await show()
  await show()
  expect(calls).toBe(1)
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })
  await show()
  expect(calls).toBe(2)
})

test('ターミナルの図（PNG）も、ターンが終わったら描き直す', async ($, on) => {
  let calls = 0
  on('process.run', () => (calls++, { value: fakeCli }))
  on('turn.complete', () => ({ text: '' }))
  const text = TEXT.replace('受付', 'ターミナル')
  const show = () => $.ui.mount({ plugin: 'zukai', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: { columns: 82, rows: 40 } })
  await show()
  await show()
  expect(calls).toBe(1)
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't2', reason: 'answer' })
  await show()
  expect(calls).toBe(2)
})

test('書いている途中の外側のブロックの中の図は、図として数えない', () => {
  const open = '````markdown\n' + FIG + '\n説明の続き'
  expect(split(open).every(p => !p.isFigure)).toBe(true)
  expect(split(open).map(p => p.text).join('\n')).toBe(open)
})

test('~~~ で囲んだ図のブロックも図として数える', () => {
  const tilde = '~~~yaml figure\ntype: flow\nsteps:\n  - label: 受付\n~~~'
  expect(split(`前\n\n${tilde}`).map(p => p.isFigure)).toEqual([false, true])
})
