import type { Register } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import type { HudRun } from '../types'

// A run as 1.4.0 left it in $.state, live mid-session: none of the fields later releases add (no ticks, boundaries,
// tileClock or named; progress with no progressBy; a widget with no clock or n; log lines with no by; not provisional,
// never told), in a state with no prompt, turn, lastTurnAt, jobs, calls or arrangement (so the strip takes its default
// pick until the first boundary). A plugin writes only its own state, so the seeder rewrites the HUD's own write of a
// run started as "1.4.0" into that literal (as "1.4.0 bare", into one with no progress, phases or plan of its own,
// which the plan mirror may lead); /peek reads the run back.
// Inline plugins load as standalone source, so the literal lives inside. Later tasks add their fields' absence here.
const seeder: Register = on => {
  // 1.4.0 kept no arrangement: from the seeded run until the HUD next decides the strip, the arrangement reads as
  // absent, and the write that follows the seeded run (its start's own boundary) is dropped
  let none = false, drop = false
  on('state.get', async ($, e, next) => {
    const read = await next(e), w = e as unknown as { plugin: string; key: string }
    return none && w.plugin === 'hud' && w.key === 'arrangement' && read.value ? { value: { ...read.value, value: undefined } } : read
  })
  on('state.set', ($, e, next) => {
    const w = e as unknown as { plugin: string; key: string; value: { title?: string } | null }
    if (none && w.plugin === 'hud' && w.key === 'arrangement') {
      if (drop) return (drop = false, { value: { isSet: true as const, version: 0 } })
      none = false
      return next(e)
    }
    if (w.plugin !== 'hud' || w.key !== 'run' || !['1.4.0', '1.4.0 bare', '1.4.0 nudged'].includes(String(w.value?.title))) return next(e)
    none = true
    drop = true
    const old = {
      title: 'Deploy v2.4', goal: 'Roll out with a canary', startedAt: 0, updatedAt: 0, sinceUpdate: 3, status: 'running',
      tiles: { rps: 1840 }, progress: { n: 3, total: 12, label: 'hosts' }, phases: [{ name: 'Build', state: 'done' }, { name: 'Rollout', state: 'now' }],
      cells: [{ name: 'web-01', state: 'hit' }], points: [1, 3, 2], counts: { timeout: 2 }, fun: ['web-08 runs an older kernel.'],
      log: [{ at: 0, text: 'Starting rollout', level: 'info' }, { at: 1000, text: 'Canary healthy', level: 'ok' }],
      widgets: [{ id: 'old', type: 'stat', title: 'p95 latency', value: 212, unit: 'ms' }, { id: 'plan', type: 'checklist', items: [{ label: 'Canary', state: 'done' }, { label: 'Rest', state: 'now' }] }],
      calls: 3, errors: 0,
    }
    const bare = { ...old, progress: undefined, phases: [], widgets: old.widgets.filter(x => x.id !== 'plan') }
    // a HUD check 1.4.0 already sent, 12 calls in, unanswered: its nudged has no n (the back-off's count)
    const nudged = { ...old, sinceUpdate: 12, nudged: { at: 0, calls: 12 } }
    const title = w.value?.title
    return next({ ...e, value: title === '1.4.0' ? old : title === '1.4.0 bare' ? bare : nudged } as typeof e)
  })
  on('command.run', { command: 'peek' }, async ($, e) => ({
    text: JSON.stringify((e.args === 'agents' ? await $.state.get({ plugin: 'hud', key: 'agents' }) : e.args === 'arrangement' ? await $.state.get({ plugin: 'hud', key: 'arrangement' }) : await $.state.get({ plugin: 'hud', key: 'run' })).value ?? null),
  }))
}

type Loose = (i: object) => Promise<{ text?: string; result?: unknown }>
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }

// a long test (three runs, both surfaces, every render): room under a loaded machine, as the auto-run tests have
test('a 1.4.0 run live mid-session renders and updates', { plugins: [{ name: 'seeder', register: seeder }], timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on, { now: 5000 })
  mock.store(on)
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', (_$, e) => (e as unknown as { answer?: { result: unknown } }).answer ?? { result: 'done' })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('ui.panes', () => ({ value: [] }))
  const call = $.tool.call as unknown as Loose
  const submit = (text: string, kind = 'composer') => ($.prompt.submit as unknown as Loose)({ text, wait: false, origin: { kind } })
  const mount = (surface: string, component: string, props: object) =>
    ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component, ...(component === 'Pane' ? { requestId: 'hud' } : {}), props })
  for (const surface of ['terminal', 'desktop'] as const) {
    await call({ tool: 'mcp__hud__hud', start: '1.4.0' })
    const seeded = JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: '' })).text)) as HudRun
    expect([seeded.title, seeded.ticks, seeded.widgets[0]?.tick]).toEqual(['Deploy v2.4', undefined, undefined])
    const arrangement = async () => JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: 'arrangement' })).text)) as unknown
    for (const [component, props] of [['AbovePrompt', band], ['Pane', pane]] as const) {
      const ui = await mount(surface, component, props)
      expect(JSON.stringify(await ui.drawn())).toContain('Deploy v2.4')
      await ui.unmount()
    }
    expect(await arrangement()).toBeNull() // drawn with none, the strip's default pick
    // none of mode, focus and prefs is in its state: they read as build, none and none, and the commands and the tool's
    // fields work on it, naming only the keys it holds
    const hud = async (args: string) => String((await ($.command.run as unknown as Loose)({ command: 'hud', args })).text)
    expect(await hud('')).toContain('Mode: Build')
    // (after the first pass the Agents source's two slots are held too: slots outlive the run)
    const agentSlots = surface === 'terminal' ? '' : 'hud/agents, hud/agents-running, '
    expect((await call({ tool: 'mcp__hud__hud', mode: 'debug', focus: ['claude/old', 'hud/x'] })).result).toBe(`ok\nfocus: unknown hud/x (known: ${agentSlots}claude/old, claude/plan)`)
    expect(await hud('pin claude/old')).toBe('Pinned claude/old: it stays first.')
    expect(await hud('')).toContain("Mode: Debug (Claude's pick)\nPinned: claude/old")
    for (const [component, props] of [['AbovePrompt', band], ['Pane', pane]] as const) {
      const ui = await mount(surface, component, props)
      expect(JSON.stringify(await ui.drawn())).toContain(component === 'Pane' ? 'Pinned: claude/old' : 'Deploy v2.4')
      await ui.unmount()
    }
    await hud('unpin claude/old')
    // a message, a notification and a turn's end, with none of the state auto-run keeps written yet
    await submit('carry on')
    await submit('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>', 'task-notification')
    expect((await call({ tool: 'mcp__hud__hud', log: 'x', widget: { id: 'w', value: 3 } })).result).toBe('ok')
    expect((await call({ tool: 'Bash', command: 'true' })).result).toBe('done')
    await ($.turn.complete as unknown as Loose)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    const r = JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: '' })).text)) as HudRun
    expect([r.status, r.provisional, r.told]).toEqual(['waiting for you', undefined, undefined])
    expect(r.title).toBe('Deploy v2.4') // Claude's run: a call never renames it
    expect(r.ticks).toBe(1)
    // the hud call with mode and focus, the pin, the unpin and the turn's end: each a boundary, counted once
    expect(r.boundaries).toBe(4)
    expect(await arrangement()).not.toBeNull() // the boundaries since decided the strip
    expect(r.widgets.find(w => w.id === 'w')).toMatchObject({ value: 3, at: 5000, by: 'claude', tick: 0 })
    expect(r.widgets.find(w => w.id === 'old')).toMatchObject({ title: 'p95 latency', value: 212 })
    expect(r.log.at(-1)?.text).toBe('x')
    // and it still draws, with the new fields beside the old; the turn's end decided the strip, and a widget with no n
    // reads as changed just now
    for (const [component, props] of [['AbovePrompt', band], ['Pane', pane]] as const) {
      const ui = await mount(surface, component, props)
      expect(JSON.stringify(await ui.drawn())).toContain('Deploy v2.4')
      if (component === 'Pane') expect(JSON.stringify(await ui.drawn())).toContain('Changed just now · no tone')
      await ui.unmount()
    }
    // a task list's call on it: the progress and the plan it holds are Claude's (no progressBy, no by), so the mirror
    // leaves both, and hides
    const todos = [{ content: 'Mirror step', status: 'completed', activeForm: 'x' }, { content: 'Next step', status: 'in_progress', activeForm: 'y' }]
    await call({ tool: 'TodoWrite', todos })
    const own = JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: '' })).text)) as HudRun
    expect(own.progress).toEqual({ n: 3, total: 12, label: 'hosts' })
    expect(own.progressBy).toBeUndefined()
    expect(own.widgets.map(x => [x.id, x.by])).toEqual([['old', undefined], ['plan', undefined], ['w', 'claude']])
    // a run with no progress, phases or plan of its own: the mirror leads, on both surfaces
    await call({ tool: 'mcp__hud__hud', start: '1.4.0 bare' })
    await call({ tool: 'TodoWrite', todos })
    const bare = JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: '' })).text)) as HudRun
    expect([bare.progress, bare.progressBy, bare.widgets.map(x => [x.id, x.by])]).toEqual([{ n: 1, total: 2, label: 'steps' }, 'observer', [['old', undefined], ['plan', 'observer']]])
    for (const [component, props] of [['AbovePrompt', band], ['Pane', pane]] as const) {
      const ui = await mount(surface, component, props)
      expect(JSON.stringify(await ui.drawn())).toContain('Next step')
      await ui.unmount()
    }
    // a subagent, in a state with no `agents` of its own (the first pass): launched, drawn, and ended by its notification
    const id = `ag-${surface}`, agents = async () => JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: 'agents' })).text)) as { list: { id: string; state: string }[] }
    await call({ tool: 'Agent', description: 'Map the tables', prompt: 'p', answer: { result: { status: 'async_launched', agentId: id, description: 'Map the tables', prompt: 'p', outputFile: 'o' } } })
    expect((await agents()).list.find(a => a.id === id)?.state).toBe('now')
    // the pane has it on both at once; the band, a new slot waits for the next boundary (the desktop's alt, which says all the
    // board holds, has it already; the terminal's band lists only the strip)
    for (const [component, props] of surface === 'desktop' ? ([['AbovePrompt', band], ['Pane', pane]] as const) : ([['Pane', pane]] as const)) {
      const ui = await mount(surface, component, props)
      expect(JSON.stringify(await ui.drawn())).toContain('Map the tables')
      await ui.unmount()
    }
    await submit(`<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`, 'task-notification')
    expect((await agents()).list.find(a => a.id === id)?.state).toBe('done')
    for (const [component, props] of [['AbovePrompt', band], ['Pane', pane]] as const) {
      const ui = await mount(surface, component, props)
      expect(JSON.stringify(await ui.drawn())).toContain('Next step') // the plan is as it was
      await ui.unmount()
    }
    // no widget of it has a bind or a bound (bindings came later): it draws as Claude's, and Claude can bind one, which a
    // matching call fills, drawn on both surfaces
    expect((await call({ tool: 'mcp__hud__hud', widget: { id: 'old', bind: { on: 'shell', match: 'bench', extract: 'last_number' } } })).result).toBe('ok')
    await call({ tool: 'Bash', command: 'npm run bench', answer: { result: '', text: 'p95: 187ms' } })
    const bound = JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: '' })).text)) as HudRun
    expect(bound.widgets.find(x => x.id === 'old')).toMatchObject({ title: 'p95 latency', value: 187, unit: 'ms', by: 'observer', bound: { hits: 1, misses: 0, seen: 1 } })
    const ui = await mount(surface, 'Pane', pane)
    expect(JSON.stringify(await ui.drawn())).toContain('187')
    await ui.unmount()
    // and a recipe: a rebuild lays it over a run with no recipe, strip or binding of its own, and it draws, unbound and with
    // no figure (recipes came later; the run keeps no field for one). It guesses no command: the one build that runs fills
    // nothing until Claude binds the widget to it
    expect(String((await call({ tool: 'mcp__hud__hud', rebuild: true, recipe: 'build' })).result)).toContain('Recipe build: bind build exit, build-time duration to your exact shell command')
    const peeked = async () => JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: '' })).text)) as HudRun
    const laid = await peeked()
    expect([laid.title, laid.widgets.map(x => [x.id, x.value, x.bind])]).toEqual(['Deploy v2.4', [['build', undefined, undefined], ['build-time', undefined, undefined]]])
    expect(laid.strip).toEqual(['progress', 'build', 'errors', 'trend'])
    for (const [component, props] of [['AbovePrompt', band], ['Pane', pane]] as const) {
      const shown = await mount(surface, component, props)
      expect(JSON.stringify(await shown.drawn())).toContain(component === 'Pane' ? 'Build exit (1 = failed)' : 'Deploy v2.4')
      await shown.unmount()
    }
    await call({ tool: 'Bash', command: 'npm run build', answer: { result: '', text: 'built in 2.5s' } })
    expect((await peeked()).widgets.find(x => x.id === 'build-time')?.points).toBeUndefined()
    expect((await call({ tool: 'mcp__hud__hud', widget: { id: 'build-time', bind: { on: 'shell', match: 'npm run build', extract: 'duration' } } })).result).toBe('ok')
    await call({ tool: 'Bash', command: 'npm run build', answer: { result: '', text: 'built in 3.5s' } })
    expect((await peeked()).widgets.find(x => x.id === 'build-time')?.points).toEqual([3.5])
  }
  // no `urgent` in that state (the urgency place came later; slots outlive the loop above, so this goes after it): a figure
  // past a rule raises it over the old run, and the desktop strip leads with it, as the terminal band does with a line
  await ($.session.measure as unknown as Loose)({ context: { percent: 90, tokens: 900_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [component, props] of [['AbovePrompt', band], ['Pane', pane]] as const) {
      if (surface === 'desktop' && component === 'Pane') continue // the dashboard says it as the slot's why, not a line of its own
      const ui = await mount(surface, component, props)
      const drawn = JSON.stringify(await ui.drawn())
      expect(drawn).toContain('Context 90%; compaction is near')
      expect(drawn).toContain('Deploy v2.4') // the old run, as it was
      if (surface === 'terminal') expect(drawn).toContain('⚠ Context 90%; compaction is near')
      await ui.unmount()
    }
  }
})

test('a 1.4.0 run with a HUD check already sent gets the next 12 calls on, as 1.4.0 did', { plugins: [{ name: 'seeder', register: seeder }] }, async ($, on) => {
  mock.clock(on, { now: 5000 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  const call = $.tool.call as unknown as (i: object) => Promise<{ context?: readonly string[] }>
  await call({ tool: 'mcp__hud__hud', start: '1.4.0 nudged' })
  const said: (readonly string[] | undefined)[] = []
  for (let n = 0; n < 12; n++) said.push((await call({ tool: 'Bash', command: 'true' })).context)
  expect(said.slice(0, 11).every(c => c === undefined)).toBe(true)
  expect(said[11]?.join('\n')).toContain('HUD check: 24 tool calls')
})

// A state the strip has not been decided in (a 1.4.0 session, resumed): the HUD's write of its arrangement goes nowhere,
// so `arrangement` stays absent whatever boundaries come.
const noArrangement: Register = on => {
  on('state.set', ($, e, next) => {
    const w = e as unknown as { plugin: string; key: string }
    return w.plugin === 'hud' && w.key === 'arrangement' ? { value: { isSet: true as const, version: 1 } } : next(e)
  })
  on('command.run', { command: 'arrangement' }, async $ => ({ text: JSON.stringify((await $.state.get({ plugin: 'hud', key: 'arrangement' })).value ?? null) }))
}

test('a 1.4.0 run in a state with no arrangement is steered by its goal, with no ids', { plugins: [{ name: 'seeder', register: seeder }, { name: 'bare', register: noArrangement }] }, async ($, on) => {
  mock.clock(on, { now: 5000 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  const call = $.tool.call as unknown as (i: object) => Promise<{ context?: readonly string[] }>
  const submit = (text: string, kind = 'composer') => ($.prompt.submit as unknown as (i: object) => Promise<{ context?: readonly string[] }>)({ text, wait: false, origin: { kind } })
  await call({ tool: 'mcp__hud__hud', start: '1.4.0' })
  expect((await ($.command.run as unknown as (i: object) => Promise<{ text?: string }>)({ command: 'arrangement', args: '' })).text).toBe('null')
  expect((await submit('carry on')).context).toEqual(['HUD: "Roll out with a canary".'])
  // and a notification gets no note
  expect((await submit('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>', 'task-notification')).context).toBeUndefined()
})
