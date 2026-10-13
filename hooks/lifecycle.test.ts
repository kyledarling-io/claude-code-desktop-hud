import type { Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'
import type { HudRun } from '../types'
import { AGING, life, STALE } from './lifecycle'

// The run as $.state holds it, read by an inline plugin (a test's own $ has no state): /peek answers with it.
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async $ => ({ text: JSON.stringify((await $.state.get({ plugin: 'hud', key: 'run' })).value ?? null) }))
}
const PEEK = { plugins: [{ name: 'peek', register: peek }] }

// simplification: loose calls; the kit's overloads over every tool and event are too deep for tsc
type Loose = (i: object) => Promise<{ context?: readonly string[]; text?: string }>
const kit = ($: Engine) => ({
  hud: (i: object) => ($.tool.call as unknown as Loose)({ tool: 'mcp__hud__hud', ...i }),
  bash: async (n: number, extra: object = {}) => {
    const said: (readonly string[] | undefined)[] = []
    for (let k = 0; k < n; k++) said.push((await ($.tool.call as unknown as Loose)({ tool: 'Bash', command: 'true', ...extra })).context)
    return said
  },
  turn: (agentId?: string) => ($.turn.complete as unknown as Loose)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) }),
  run: async () => JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: '' })).text)) as HudRun,
})
const widget = (r: HudRun, id: string) => r.widgets.find(w => w.id === id)

// The pane's image never ticks (DEVELOPING: ticking text stays native): "ago" is measured to the run's last main-loop
// call, so it moves when a call does, as the clocks themselves do.
type Pane = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (n: unknown): Node[] => (typeof n === 'object' && n !== null ? [n as Node, ...((n as Node).children ?? []).flatMap(nodes)] : [])
const text = (n: unknown): string => (typeof n === 'string' ? n : typeof n === 'object' && n !== null ? ((n as Node).children ?? []).map(text).join('') : '')
test("an aging block is dim and its \"ago\" moves with calls, not the clock: the pane is the same five minutes on", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'done' }))
  const { hud, bash } = kit($)
  for (const surface of ['terminal', 'desktop'] as const) {
    // what of the pane should hold still: the desktop's image; the terminal's widget line and tile (its clock ticks
    // as native text, as ever)
    const still = async () => {
      const pane = await ($.ui.mount as unknown as (t: object) => Promise<Pane>)({ plugin: 'hud', surface, component: 'Pane', requestId: 'hud', props: { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
      const all = nodes(await pane.drawn())
      await pane.unmount()
      if (surface === 'desktop') return String(all.find(n => n.type === 'Svg')?.props?.source)
      const line = all.find(n => n.type === 'Box' && n.props?.flexDirection === 'row' && text(n).startsWith('Heap: ')) // the block's first line
      const tile = all.find(n => n.type === 'Text' && n.props?.bold === true && text(n) === '3')
      return `${text(line)} ${JSON.stringify({ line, tile })}`
    }
    await hud({ start: 'Tune the index', widget: { id: 'heap', type: 'meter', title: 'Heap', value: 5, max: 8 }, set: { rps: 3 } })
    await clock.advance(3 * 60_000)
    await bash(AGING)
    const before = await still()
    if (surface === 'desktop') expect(before).toContain('<g class="dim"')
    else expect(before.match(/"dimColor":true/g)?.length).toBe(4) // the widget's label, value and "ago", and the tile's value
    expect(before).toContain('3m ago')
    await clock.advance(5 * 60_000)
    expect(await still()).toBe(before)
    // the next call moves it
    await bash(1)
    expect(await still()).toContain('8m ago')
  }
})

test('a Claude widget ages with main-loop calls: fresh, aging at 12, stale at 24', PEEK, async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'done' }))
  const { hud, bash, run } = kit($)
  await hud({ start: 'Tune the index', widget: { id: 'loss', type: 'line', points: [1, 2] }, set: { rps: 3 } })
  let r = await run()
  expect(widget(r, 'loss')).toMatchObject({ at: 0, by: 'claude', tick: 0 })
  expect(r.tileClock?.rps).toEqual({ at: 0, by: 'claude', tick: 0 })
  const lives = (r: HudRun) => [life(widget(r, 'loss')!, r), life(r.tileClock!.rps!, r)]
  await bash(AGING - 1)
  expect(lives(await run())).toEqual(['fresh', 'fresh'])
  await bash(1)
  expect(lives(await run())).toEqual(['aging', 'aging'])
  await bash(STALE - AGING - 1)
  expect(lives(await run())).toEqual(['aging', 'aging'])
  await bash(1)
  r = await run()
  expect(r.ticks).toBe(STALE)
  expect(lives(r)).toEqual(['stale', 'stale'])
})

test('a quiet session ages nothing: no calls, no aging, however long', PEEK, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: [] }))
  const { hud, run } = kit($)
  await hud({ start: 'Wait for the deploy', widget: { id: 'loss', type: 'line', points: [1, 2] }, set: { rps: 3 } })
  await clock.advance(2 * 60 * 60_000)
  const r = await run()
  expect([life(widget(r, 'loss')!, r), life(r.tileClock!.rps!, r)]).toEqual(['fresh', 'fresh'])
})

test('a subagent call ages nothing', PEEK, async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  const { hud, bash, run } = kit($)
  await hud({ start: 'Survey the repo', widget: { id: 'found', type: 'stat', value: 2 } })
  await bash(STALE * 2, { agentId: 'a1' })
  const r = await run()
  expect(r.ticks).toBe(0)
  expect(r.calls).toBe(STALE * 2) // they count on the board all the same
  expect(life(widget(r, 'found')!, r)).toBe('fresh')
})

test('any update returns a widget to fresh', PEEK, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'done' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const { hud, bash, turn, run } = kit($)
  await hud({ start: 'Tune the index', widget: { id: 'loss', type: 'line', points: [1, 2] }, set: { rps: 3 } })
  await bash(STALE)
  await turn() // a boundary marks them stale
  let r = await run()
  expect(widget(r, 'loss')?.staleAt).toBe(0)
  expect(r.tileClock?.rps?.staleAt).toBe(0)
  await clock.advance(60_000)
  await hud({ widget: { id: 'loss', push: 3 }, set: { rps: 4 } })
  r = await run()
  expect(widget(r, 'loss')).toMatchObject({ at: 60_000, by: 'claude', tick: STALE, points: [1, 2, 3] })
  expect(widget(r, 'loss')?.staleAt).toBeUndefined()
  expect(r.tileClock?.rps).toEqual({ at: 60_000, by: 'claude', tick: STALE })
  expect([life(widget(r, 'loss')!, r), life(r.tileClock!.rps!, r)]).toEqual(['fresh', 'fresh'])
})

test('a widget stale across 2 boundaries retires, and the log says it went', PEEK, async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'done' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const { hud, bash, turn, run } = kit($)
  await hud({ start: 'Tune the index', widget: { id: 'loss', type: 'line', title: 'Training loss', points: [1, 2] }, set: { rps: 3 } })
  await bash(STALE)
  await hud({ widget: { id: 'acc', type: 'stat', value: 0.9 } }) // changed just now: it stays
  // a subagent's turn ending is no boundary
  await turn('a1')
  expect((await run()).boundaries ?? 0).toBe(0)
  // the main loop's is: the stale ones are marked, and stay through this one
  await turn()
  let r = await run()
  expect(r.boundaries).toBe(1)
  expect(r.widgets.map(w => w.id)).toEqual(['loss', 'acc'])
  // a phase change is the second: they go, and the log says so, as the observer's lines
  await hud({ phase: { name: 'Query', state: 'now' } })
  r = await run()
  expect(r.boundaries).toBe(2)
  expect(r.widgets.map(w => w.id)).toEqual(['acc'])
  expect(r.tiles).toEqual({})
  expect(r.tileClock).toEqual({})
  expect(r.log.filter(l => l.text.startsWith('Retired')).map(l => [l.text, l.by])).toEqual([['Retired Training loss', 'observer'], ['Retired rps', 'observer']])
  // a rebuild is one too
  await hud({ rebuild: true })
  expect((await run()).boundaries).toBe(3)
})

test('a widget that turns stale is named once in a HUD check, which keeps the back-off', { ...PEEK, timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  const { hud, bash, run } = kit($)
  await hud({ start: 'Tune the index', widget: { id: 'loss', type: 'line', points: [1, 2] } })
  const said = await bash(STALE + 12)
  // the HUD check at 12 as ever; unanswered, the next waits 24 calls, so the widget stale at 24 is named at 36
  expect(said[11]?.join('\n')).toContain('HUD check: 12 tool calls')
  expect(said.slice(12, STALE + 11).every(c => c === undefined)).toBe(true)
  const note = said[STALE + 11]?.join('\n') ?? ''
  expect(note).toBe(`HUD check: your loss line hasn't changed in ${STALE + 12} calls while you ran ${STALE + 12} true commands. Update, bind or remove it.`)
  expect(note.length).toBeLessThanOrEqual(160)
  expect(said.filter(Boolean).length).toBe(2)
  expect((await run()).named).toEqual(['loss'])
  // named once: the calls after say nothing, and the next HUD check (48 on, after two unanswered) doesn't name it again
  const after = await bash(48)
  expect(after.slice(0, 47).every(c => c === undefined)).toBe(true)
  expect(after[47]?.join('\n')).toContain(`HUD check: ${STALE + 12 + 48} tool calls`)
  // an update clears the name, so going stale again names it again
  await hud({ widget: { id: 'loss', push: 3 } })
  expect((await run()).named).toEqual([])
  expect((await bash(STALE + 12)).at(-1)?.join('\n')).toContain('your loss line')
})

test('a pointed HUD check stays within 160 characters however many widgets went stale', { ...PEEK, timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  const { hud, bash, run } = kit($)
  const ids = Array.from({ length: 8 }, (_, i) => `throughput-of-shard-${i}`)
  await hud({ start: 'Tune the index', widgets: ids.map(id => ({ id, type: 'stat', value: 1 })) })
  // Claude answers the HUD (a log line every 11 calls) and leaves the widgets alone: no check waits, so the note
  // comes on the call they go stale
  await bash(11)
  await hud({ log: 'shard 1 rebuilt' })
  await bash(11)
  await hud({ log: 'shard 2 rebuilt' })
  const note = (await bash(STALE - 22)).at(-1)?.join('\n') ?? ''
  expect(note.length).toBeLessThanOrEqual(160)
  const named = (await run()).named ?? []
  expect(named.length).toBeGreaterThan(0)
  expect(named.every(id => note.includes(id))).toBe(true)
  // the rest are named at the next check (24 calls on, as this one goes unanswered), not dropped
  expect((await bash(24)).at(-1)?.join('\n')).toContain(ids.find(id => !named.includes(id))!)
})
