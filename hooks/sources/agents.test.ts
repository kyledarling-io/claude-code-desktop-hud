import type { On, Register, RenderSurface } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

import type { HudHeld, HudRun } from '../../types'
import { inOrder } from '../board'
import { MODES } from '../modes'
import * as agents from './agents'
import { accept } from './contract'

// ---- the pure source

const start = (s: agents.AgentsState, id: string, name = `Agent ${id}`) => agents.observe(s, { k: 'start', id, name })
const end = (s: agents.AgentsState, id: string, failed = false) => agents.observe(s, { k: 'end', id, failed })
const slot = (o: ReturnType<typeof agents.observe>, id: string) => o.push.find(p => p.id === id)

test('the source says what it can access and declares a checklist and a stat', async () => {
  expect(agents.declaration).toEqual({
    v: 1, name: 'Agents',
    access: 'Reads when Claude starts a subagent and when it finishes: its description and whether it failed. Nothing else.',
    slots: [{ id: 'agents', pattern: 'checklist', title: 'Agents' }, { id: 'agents-running', pattern: 'stat', title: 'Agents running' }],
  })
})

test('an agent starts now and ends done or failed; the stat counts those now', async () => {
  let o = start(agents.init, 'a1', 'Map the tables')
  expect(o.state.list).toEqual([{ id: 'a1', name: 'Map the tables', state: 'now' }])
  expect(slot(o, 'agents')).toMatchObject({ v: 1, pattern: 'checklist', title: 'Agents', items: [{ label: 'Map the tables', state: 'now' }] })
  expect(slot(o, 'agents-running')).toMatchObject({ v: 1, pattern: 'stat', title: 'Agents running', value: 1 })
  o = start(o.state, 'a2', 'Write the migration')
  expect(slot(o, 'agents-running')?.value).toBe(2)
  o = end(o.state, 'a1')
  expect(o.state.list.map(a => [a.id, a.state])).toEqual([['a1', 'done'], ['a2', 'now']])
  expect(slot(o, 'agents')?.items).toEqual([{ label: 'Map the tables', state: 'done' }, { label: 'Write the migration', state: 'now' }])
  expect(slot(o, 'agents-running')).toMatchObject({ value: 1, note: '1 done' })
  o = end(o.state, 'a2', true)
  expect(o.state.list.map(a => [a.id, a.state])).toEqual([['a1', 'done'], ['a2', 'failed']])
  expect(slot(o, 'agents')?.items?.map(i => i.state)).toEqual(['done', 'failed'])
  expect(slot(o, 'agents-running')).toMatchObject({ value: 0, note: '1 done, 1 failed', tone: 'warn' })
  expect(o.clear).toEqual([])
})

test('an end that names nothing running changes nothing; a finished agent stays finished', async () => {
  const one = start(agents.init, 'a1').state
  expect(end(one, 'nope').state).toBe(one)
  const done = end(one, 'a1').state
  expect(end(done, 'a1', true).state).toBe(done) // a late failure does not undo a finish
  expect(end(done, 'a1', true).state.list[0]?.state).toBe('done')
  // and with no agent ever run, both slots are cleared, not drawn at 0
  const none = end(agents.init, 'x')
  expect([none.state, none.push, none.clear]).toEqual([agents.init, [], ['agents', 'agents-running']])
})

test('the list keeps the 12 newest, and the stat counts those now', async () => {
  let s = agents.init
  for (let n = 1; n <= 15; n++) s = start(s, `a${n}`, `Agent ${n}`).state
  expect(s.list.map(a => a.id)).toEqual(Array.from({ length: 12 }, (_, i) => `a${i + 4}`))
  s = end(s, 'a5').state
  const o = end(s, 'a15', true)
  expect(slot(o, 'agents')?.items).toHaveLength(12)
  expect(slot(o, 'agents-running')?.value).toBe(10)
  // one that fell off the list cannot end
  expect(end(o.state, 'a1').state).toBe(o.state)
})

test('an agent that began in the foreground and went to the background keeps its place under its own id', async () => {
  let o = start(agents.init, 'toolu_1', 'Map the tables')
  o = start(o.state, 'a2', 'Other')
  const moved = agents.observe(o.state, { k: 'rekey', id: 'toolu_1', as: 'a1' })
  expect(moved.state.list).toEqual([{ id: 'a1', name: 'Map the tables', state: 'now' }, { id: 'a2', name: 'Other', state: 'now' }])
  expect(slot(moved, 'agents-running')?.value).toBe(2)
  expect(agents.observe(moved.state, { k: 'rekey', id: 'zzz', as: 'a9' }).state).toBe(moved.state)
  expect(end(moved.state, 'a1').state.list[0]?.state).toBe('done')
})

test('a drop takes an agent off the list, at work or not, and the slots go with the last one', async () => {
  const two = start(start(agents.init, 'a1', 'One').state, 'a2', 'Two').state
  const dropped = agents.observe(two, { k: 'drop', id: 'a1' })
  expect(dropped.state.list.map(a => a.id)).toEqual(['a2'])
  expect(slot(dropped, 'agents')?.items).toEqual([{ label: 'Two', state: 'now' }])
  expect(slot(dropped, 'agents-running')?.value).toBe(1)
  const last = agents.observe(end(dropped.state, 'a2').state, { k: 'drop', id: 'a2' })
  expect([last.state.list, last.push, last.clear]).toEqual([[], [], ['agents', 'agents-running']])
  expect(agents.observe(two, { k: 'drop', id: 'zzz' }).state).toBe(two)
  expect(agents.said(two, { k: 'drop', id: 'a1' })).toBeUndefined() // nothing to say of what was never one
})

test('only a completed record is a finished agent', async () => {
  expect(agents.completed({ status: 'completed', agentId: 'a1', content: [] })).toBe(true)
  for (const r of [{ status: 'teammate_spawned', agent_id: 'a1' }, { status: 'remote_launched', taskId: 't' }, { status: 'async_launched', agentId: 'a1' }, { agentId: 'a1' }, 'ok', null, undefined])
    expect(agents.completed(r)).toBe(false)
})

test('starting an id again makes it newest and now', async () => {
  let s = start(agents.init, 'a1', 'First').state
  s = start(s, 'a2', 'Second').state
  s = end(s, 'a1').state
  s = start(s, 'a1', 'First again').state
  expect(s.list).toEqual([{ id: 'a2', name: 'Second', state: 'now' }, { id: 'a1', name: 'First again', state: 'now' }])
})

test("its slots are drawn after the failing runs, and the mode that plans puts them first", async () => {
  const held = Object.fromEntries(['context', 'agents-running', 'edited', 'agents', 'failing', 'tests'].map(id => [`hud/${id}`, { v: 1 as const, id, pattern: 'stat' as const, title: id, from: 'hud', at: 0 }]))
  expect(inOrder(held, {}).map(s => s.id)).toEqual(['tests', 'failing', 'agents', 'agents-running', 'context', 'edited'])
  expect(MODES.plan.slots.filter(k => k.includes('agents'))).toEqual(['hud/agents-running', 'hud/agents'])
})

test('its slots pass the gate, names fitted to the label, and the name is cleaned', async () => {
  const o = start(agents.init, 'a1', `  ${'Investigate the flaky ledger reconciliation test '.repeat(4)}\n\u001b[31mred\u0007 `)
  expect(o.state.list[0]?.name.length).toBeLessThanOrEqual(80)
  expect(o.state.list[0]?.name).not.toMatch(/[\u0000-\u001f]/)
  for (const p of o.push) {
    const held = accept(p, 'hud', agents.declaration, 0)
    expect(typeof held).toBe('object')
    for (const i of (held as HudHeld).items ?? []) expect(i.label.length).toBeLessThanOrEqual(40)
  }
  expect(agents.observe(agents.init, { k: 'start', id: 'a1', name: '   ' }).state.list[0]?.name).toBe('agent')
  // a description is cut before it is tidied: plain() is quadratic over a long run of '[' (this would not come back)
  expect(agents.call({ description: '['.repeat(200_000) }).name.length).toBeLessThanOrEqual(80)
  expect(agents.observe(agents.init, { k: 'start', id: 'a1', name: '['.repeat(200_000) }).state.list[0]?.name.length).toBeLessThanOrEqual(80)
  expect(agents.launched({ status: 'async_launched', agentId: 'a1', description: '['.repeat(200_000) })?.name?.length).toBeLessThanOrEqual(80)
})

test('an Agent call is read for its name and whether it may be a foreground one', async () => {
  expect(agents.call({ description: 'Map the tables', prompt: 'p' })).toEqual({ name: 'Map the tables', foreground: true })
  expect(agents.call({ description: 'Map the tables', prompt: 'p', run_in_background: false }).foreground).toBe(true)
  expect(agents.call({ description: 'x', prompt: 'p', run_in_background: true }).foreground).toBe(false)
  expect(agents.call({ description: 'x', prompt: 'p', isolation: 'remote' }).foreground).toBe(false) // remote agents run in the cloud
  expect(agents.call({ subagent_type: 'Explore', prompt: 'p' }).name).toBe('Explore')
  expect(agents.call({ prompt: 'p' }).name).toBe('agent')
  expect(agents.call({ description: 42 }).name).toBe('agent')
})

test('a result that started an agent in the background names its id', async () => {
  expect(agents.launched({ status: 'async_launched', agentId: 'a1', description: 'x', prompt: 'p', outputFile: 'o' })).toEqual({ id: 'a1', name: 'x' })
  expect(agents.launched({ status: 'async_launched', agentId: 'a1' })).toEqual({ id: 'a1', name: undefined })
  expect(agents.launched({ status: 'completed', agentId: 'a1' })).toBeUndefined()
  expect(agents.launched({ status: 'async_launched' })).toBeUndefined()
  expect(agents.launched({ status: 'async_launched', agentId: '' })).toBeUndefined()
  expect(agents.launched({ status: 'remote_launched', taskId: 't' })).toBeUndefined()
  expect(agents.launched('done')).toBeUndefined()
  expect(agents.launched(null)).toBeUndefined()
  expect(agents.launched(undefined)).toBeUndefined()
})

test("the auto-log's words for each event", async () => {
  const s = start(start(agents.init, 'a1', 'Map the tables').state, 'a2', 'Write it').state
  expect(agents.said(agents.init, { k: 'start', id: 'a1', name: 'Map the tables' })).toEqual({ name: 'Map the tables', state: 'started' })
  expect(agents.said(s, { k: 'end', id: 'a1', failed: false })).toEqual({ name: 'Map the tables', state: 'finished' })
  expect(agents.said(s, { k: 'end', id: 'a2', failed: true })).toEqual({ name: 'Write it', state: 'failed' })
  expect(agents.said(s, { k: 'end', id: 'nope', failed: false })).toBeUndefined()
  expect(agents.said(end(s, 'a1').state, { k: 'end', id: 'a1', failed: true })).toBeUndefined() // already done
  expect(agents.said(s, { k: 'rekey', id: 'a1', as: 'x' })).toBeUndefined() // not a new thing to say
})

test('the session starting again leaves an agent at work lost: failed until a sign of its life, and its end ends it as it says', async () => {
  const s = end(start(start(agents.init, 'a1', 'Map').state, 'a2', 'Write').state, 'a2').state
  const lost = agents.observe(s, { k: 'lose', id: 'a1' }).state
  expect(lost.list).toEqual([{ id: 'a1', name: 'Map', state: 'failed', lost: true }, { id: 'a2', name: 'Write', state: 'done' }])
  expect(agents.observe(s, { k: 'lose', id: 'a2' }).state).toBe(s) // only one at work is lost
  expect(agents.said(s, { k: 'lose', id: 'a1' })).toEqual({ name: 'Map', state: 'lost' })
  // back at work, or ended as its own end says; nothing else revives it
  expect(agents.observe(lost, { k: 'live', id: 'a1' }).state.list[0]).toEqual({ id: 'a1', name: 'Map', state: 'now' })
  expect(end(lost, 'a1').state.list[0]).toEqual({ id: 'a1', name: 'Map', state: 'done' })
  expect(agents.said(lost, { k: 'end', id: 'a1', failed: false })).toEqual({ name: 'Map', state: 'finished' })
  expect(agents.said(lost, { k: 'live', id: 'a1' })).toBeUndefined()
  expect(agents.observe(s, { k: 'live', id: 'a2' }).state).toBe(s) // a finished one is not lost
})

// ---- through the hooks

type Loose = (i: object) => Promise<{ result?: unknown; context?: readonly string[]; text?: string }>
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (n: unknown): Node[] => (typeof n === 'object' && n !== null ? [n as Node, ...((n as Node).children ?? []).flatMap(nodes)] : [])
const text = (n: unknown): string => (typeof n === 'string' ? n : typeof n === 'object' && n !== null ? ((n as Node).children ?? []).map(text).join('') : '')
const SURFACES = ['terminal', 'desktop'] as const
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }

// Reads the HUD's own state from above it (a test's own $ has no state): /peek <key>. A read names its key as a literal.
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async ($, e) => {
    const got = e.args === 'agents' ? await $.state.get({ plugin: 'hud', key: 'agents' })
      : e.args === 'jobs' ? await $.state.get({ plugin: 'hud', key: 'jobs' })
        : e.args === 'slots' ? await $.state.get({ plugin: 'hud', key: 'slots' })
          : await $.state.get({ plugin: 'hud', key: 'run' })
    return { text: JSON.stringify(got.value ?? null) }
  })
}
const PEEK = { plugins: [{ name: 'peek', register: peek }] }

// A fault under the HUD: with /break on, the read of the tool signals' state throws (the HUD reads it after every call).
const breaker: Register = on => {
  let armed = false
  on('command.run', { command: 'break' }, ($, e) => ((armed = e.args === 'on'), { text: 'ok' }))
  // (a hook that throws is skipped, not the caller's fault; a deny rejects the caller's promise)
  on('state.get', ($, e, next) => {
    const w = e as unknown as { plugin: string; key: string }
    return armed && w.plugin === 'hud' && w.key === 'toolSignals' ? { deny: 'state down' } : next(e)
  })
}

// The engine beneath: someone watching on the surfaces in hand, each call answered as it says (else ok) once the gate
// opens, a message entering as sent, a turn ending, and the dock empty.
const beneath = (on: On, surfaces: () => RenderSurface[], gate: () => Promise<void> = () => Promise.resolve()) => {
  const clock = mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: surfaces() }))
  on('tool.call', async ($, e) => { await gate(); return (e as unknown as { answer?: { result: unknown } }).answer ?? { result: 'ok' } })
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__hud__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  return clock
}

const launch = (id: string, description: string) => ({ result: { status: 'async_launched', agentId: id, description, prompt: 'p', outputFile: `/tmp/${id}.out` } })
const finish = (id: string) => ({ result: { status: 'completed', agentId: id, content: [{ type: 'text', text: 'done' }], prompt: 'p' } })

const kit = ($: Engine) => {
  const call = $.tool.call as unknown as Loose
  const peekAt = async <T,>(key: string) => JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: key })).text)) as T
  const mount = (surface: RenderSurface, component: 'AbovePrompt' | 'Pane') =>
    ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component, ...(component === 'Pane' ? { requestId: 'hud', props: pane } : { props: band }) })
  const hud = (args: string) => ($.command.run as unknown as Loose)({ command: 'hud', args }).then(o => String(o.text))
  return {
    call, peekAt, mount, hud,
    tool: (i: object) => call({ tool: 'mcp__hud__hud', ...i }),
    // the main loop's Agent call, answered as the Agent tool does
    agent: (description: string, answer: object, extra: object = {}) => call({ tool: 'Agent', description, prompt: 'Do it.', answer, ...extra }),
    background: (id: string, description: string) => call({ tool: 'Agent', description, prompt: 'Do it.', run_in_background: true, answer: launch(id, description) }),
    notify: (id: string, status = 'completed') => ($.prompt.submit as unknown as Loose)({
      text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>Agent "x" ${status}</summary>\n</task-notification>`,
      wait: false, origin: { kind: 'task-notification' },
    }),
    turn: (agentId?: string, reason = 'answer') => ($.turn.complete as unknown as Loose)({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', reason, ...(agentId ? { agentId } : {}) }),
    start: () => ($.session.start as unknown as Loose)({ cwd: '/', surface: 'desktop', isInteractive: false }),
    // nothing written yet reads as null
    list: async (prefix = '') => ((await peekAt<agents.AgentsState | null>('agents'))?.list ?? []).map(a => `${a.id}:${a.name}:${a.state}`).filter(l => l.startsWith(prefix)),
    held: async () => (await peekAt<Record<string, HudHeld> | null>('slots')) ?? {},
    jobs: async () => (await peekAt<Record<string, string> | null>('jobs')) ?? {},
    run: () => peekAt<HudRun | null>('run'),
    log: async () => ((await peekAt<HudRun | null>('run'))?.log ?? []).map(l => l.text),
    drawn: async (surface: RenderSurface, component: 'AbovePrompt' | 'Pane') => {
      const ui = await mount(surface, component)
      const all = nodes(await ui.drawn())
      await ui.unmount()
      return { raw: JSON.stringify(all), words: all.filter(n => n.type === 'Text').map(text).join(' | ') }
    },
  }
}

test('through the hooks: a background subagent shows as running until its turn ends', PEEK, async ($, on) => {
  let surfaces: RenderSurface[] = ['terminal']
  beneath(on, () => surfaces)
  const k = kit($)
  for (const [i, s] of SURFACES.entries()) {
    surfaces = [s]
    await k.tool({ start: `Ship it on ${s}` })
    const launched = await k.background(`${s}-1`, 'Map the tables')
    expect(launched.context).toBeUndefined() // it adds no note for Claude
    expect(await k.list(s)).toEqual([`${s}-1:Map the tables:now`])
    let held = await k.held()
    expect(held['hud/agents-running']).toMatchObject({ value: 1, from: 'hud' })
    expect(held['hud/agents']?.items?.at(-1)).toEqual({ label: 'Map the tables', state: 'now' })
    // it is a background job of the main loop, so the header says so
    expect((await k.drawn(s, 'AbovePrompt')).words).toContain('1 job running')
    for (const component of s === 'desktop' ? (['AbovePrompt', 'Pane'] as const) : (['Pane'] as const)) expect((await k.drawn(s, component)).raw).toContain('Map the tables')
    // a shell beside it makes two jobs
    await k.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true, answer: { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `${s}-sh` } } })
    expect((await k.drawn(s, 'AbovePrompt')).words).toContain('2 jobs running')
    // another agent's turn ending, and the main loop's own, are not this one's
    await k.turn('someone-else')
    await k.turn()
    expect(await k.list(s)).toEqual([`${s}-1:Map the tables:now`])
    // its own turn ending is
    await k.turn(`${s}-1`)
    expect(await k.list(s)).toEqual([`${s}-1:Map the tables:done`])
    held = await k.held()
    expect(held['hud/agents-running']).toMatchObject({ value: 0, note: `${i + 1} done` })
    expect(held['hud/agents']?.items?.at(-1)).toEqual({ label: 'Map the tables', state: 'done' })
    expect((await k.drawn(s, 'AbovePrompt')).words).toContain('1 job running')
    expect(await k.jobs()).toEqual({ [`${s}-sh`]: 'shell' })
    expect((await k.run())!.log.map(l => l.text)).toEqual(['agent started: Map the tables', 'agent finished: Map the tables'])
    await k.tool({ done: 'ok' })
    await k.call({ tool: 'TaskStop', task_id: `${s}-sh` })
  }
})

test('a task notification ends the agent it names: completed is done, failed and killed are failed', PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  for (const [id, name] of [['n1', 'Map'], ['n2', 'Write'], ['n3', 'Test'], ['n4', 'Doc']] as const) await k.background(id, name)
  await k.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true, answer: { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'sh1' } } })
  expect((await k.drawn('desktop', 'AbovePrompt')).words).toContain('5 jobs running')
  expect((await k.notify('n1')).context).toBeUndefined()
  await k.notify('n2', 'failed')
  await k.notify('n3', 'killed')
  await k.notify('sh1') // a shell's is not an agent's
  await k.notify('never-heard-of') // nor is one the HUD never saw
  expect(await k.list()).toEqual(['n1:Map:done', 'n2:Write:failed', 'n3:Test:failed', 'n4:Doc:now'])
  expect((await k.drawn('desktop', 'AbovePrompt')).words).toContain('1 job running')
  expect(await k.jobs()).toEqual({ n4: 'agent' })
  expect((await k.held())['hud/agents-running']).toMatchObject({ value: 1, note: '1 done, 2 failed', tone: 'warn' })
  expect((await k.run())!.log.map(l => l.text)).toEqual([
    'agent started: Map', 'agent started: Write', 'agent started: Test', 'agent started: Doc', 'agent finished: Map', 'agent failed: Write', 'agent failed: Test',
  ])
  // an aborted or errored turn of the agent's own is a failure; one that answered is a finish. (Built against the types:
  // a turn.complete carrying the agent's id is not yet seen in the app.)
  await k.background('t1', 'Check')
  await k.background('t2', 'Review')
  await k.turn('t1', 'aborted')
  await k.turn('t2', 'answer')
  await k.turn('n4', 'error')
  expect(await k.list()).toEqual(['n1:Map:done', 'n2:Write:failed', 'n3:Test:failed', 'n4:Doc:failed', 't1:Check:failed', 't2:Review:done'])
  expect(await k.jobs()).toEqual({})
})

test('a foreground subagent starts before its call returns and ends with its result', PEEK, async ($, on) => {
  let open = () => {}
  let gate: Promise<void> = Promise.resolve()
  const surfaces: RenderSurface[] = ['desktop']
  beneath(on, () => surfaces, () => gate)
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  gate = new Promise<void>(r => (open = r))
  const running = k.agent('Map the tables', finish('f1'), { run_in_background: false })
  for (let n = 0; n < 500 && (await k.held())['hud/agents-running'] === undefined; n++); // each look is a round trip through the engine, so the call gets on
  expect((await k.list())[0]).toMatch(/^toolu_\w+:Map the tables:now$/) // under its call's id: the agent's own is not known yet
  expect((await k.held())['hud/agents-running']).toMatchObject({ value: 1 })
  expect((await k.drawn('desktop', 'AbovePrompt')).words).not.toMatch(/jobs? running/) // it holds the main loop; it is no background job
  open()
  await running
  expect((await k.list())[0]).toMatch(/^toolu_\w+:Map the tables:done$/)
  expect((await k.held())['hud/agents-running']).toMatchObject({ value: 0, note: '1 done' })
  expect((await k.run())!.log.map(l => l.text)).toEqual(['agent started: Map the tables', 'agent finished: Map the tables'])
  // the agent's own turn ending, as it comes after, finds nothing running
  await k.turn('f1')
  expect((await k.list()).length).toBe(1)
})

test('a foreground subagent whose call failed is failed; one refused is too', PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  await k.agent('Write it', { result: 'Agent crashed', isError: true }, { run_in_background: false })
  await k.agent('Test it', finish('f2'), { run_in_background: false })
  expect((await k.list()).map(l => l.split(':').slice(1).join(':'))).toEqual(['Write it:failed', 'Test it:done'])
  expect((await k.run())!.log.map(l => l.text)).toEqual(['agent started: Write it', 'agent failed: Write it', 'agent started: Test it', 'agent finished: Test it'])
  expect((await k.held())['hud/agents-running']).toMatchObject({ value: 0, note: '1 done, 1 failed' })
})

test('a call that does not say it is a foreground one starts when it comes back; one that moved to the background keeps its place', PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  // asked for the background, or left to the build's default: it comes back launched
  await k.agent('Map the tables', launch('b1', 'Map the tables'))
  expect(await k.list()).toEqual(['b1:Map the tables:now'])
  // asked for the foreground, then sent to the background while it ran: the call comes back launched, under the agent's id
  await k.agent('Write it', launch('b2', 'Write it'), { run_in_background: false })
  expect(await k.list()).toEqual(['b1:Map the tables:now', 'b2:Write it:now'])
  expect(await k.jobs()).toEqual({ b1: 'agent', b2: 'agent' })
  await k.notify('b2')
  expect(await k.list()).toEqual(['b1:Map the tables:now', 'b2:Write it:done'])
  expect((await k.run())!.log.map(l => l.text)).toEqual(['agent started: Map the tables', 'agent started: Write it', 'agent finished: Write it'])
})

const remote = { result: { status: 'remote_launched', taskId: 't1', sessionUrl: 'u', description: 'Cloud', prompt: 'p', outputFile: 'o' } }
const teammate = { result: { status: 'teammate_spawned', agentId: 'tm1', agent_id: 'tm1', teammate_id: 'scout@team', name: 'scout', prompt: 'p' } }

test("a subagent's own Agent call, and a cloud launch that said so, are not the main loop's subagents", PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  await k.agent('Nested', launch('x1', 'Nested'), { agentId: 'a1' })
  await k.agent('Cloud', remote, { run_in_background: true })
  expect(await k.list()).toEqual([])
  expect(await k.held()).toEqual({}) // and with no agent ever run, nothing is drawn for them
  expect(await k.jobs()).toEqual({})
})

test('a call that starts a teammate, or comes back launched in the cloud, is no subagent finished: its entry is dropped', PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  // not asked for the background (an agent definition can force the cloud, and a named agent can join the team), so each
  // was at work from its call; its result says it is not a subagent that finishes there
  await k.agent('Scout', teammate)
  await k.agent('Cloud', remote)
  await k.agent('Plain', { result: 'ok' }, { run_in_background: false }) // nor is a result that is no Agent record
  expect(await k.list()).toEqual([])
  expect(await k.held()).toEqual({}) // the slots went with the last entry
  expect(await k.jobs()).toEqual({})
  expect((await k.run())!.log.map(l => l.text).some(t => t.startsWith('agent finished'))).toBe(false)
  // and beside a real one, the real one stands alone
  await k.background('b1', 'Real one')
  await k.agent('Scout again', teammate)
  expect(await k.list()).toEqual(['b1:Real one:now'])
  expect(await k.jobs()).toEqual({ b1: 'agent' })
  const held = await k.held()
  expect(held['hud/agents']?.items).toEqual([{ label: 'Real one', state: 'now' }])
  expect(held['hud/agents-running']).toMatchObject({ value: 1 })
})

test("a foreground agent's end is not lost to a fault later in the same call", { plugins: [...PEEK.plugins, { name: 'breaker', register: breaker }] }, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  // the tool signals' state fails to read, after the call has run: the HUD's hook faults, and the result still stands
  await ($.command.run as unknown as Loose)({ command: 'break', args: 'on' })
  const out = await k.agent('Map the tables', finish('f1'), { run_in_background: false })
  expect((out.result as { status?: string }).status).toBe('completed')
  await ($.command.run as unknown as Loose)({ command: 'break', args: 'off' })
  expect((await k.list())[0]).toMatch(/^toolu_\w+:Map the tables:done$/)
  // (that the fault was real: the call's other observers did not run)
  expect((await k.run())!.calls).toBe(0)
})

test('a foreground agent whose call never came back does not outlive the turn; a background one does', PEEK, async ($, on) => {
  let open = () => {}
  let gate: Promise<void> = Promise.resolve()
  beneath(on, () => ['desktop'], () => gate)
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  await k.background('b1', 'Real one')
  gate = new Promise<void>(r => (open = r))
  const stuck = k.agent('Stuck one', finish('f1'), { run_in_background: false })
  for (let n = 0; n < 500 && (await k.list()).length < 2; n++);
  expect((await k.list()).map(l => l.split(':').slice(1).join(':'))).toEqual(['Real one:now', 'Stuck one:now'])
  await k.turn() // the main loop's turn ends with the call still out: an interrupted call, say
  expect((await k.list()).map(l => l.split(':').slice(1).join(':'))).toEqual(['Real one:now', 'Stuck one:failed'])
  expect((await k.held())['hud/agents-running']).toMatchObject({ value: 1 })
  expect((await k.run())!.status).toBe('running') // the background agent still keeps it running
  open()
  await stuck
  expect((await k.list()).map(l => l.split(':').slice(1).join(':'))).toEqual(['Real one:now', 'Stuck one:failed']) // a late result changes nothing
  expect((await k.run())!.log.map(l => l.text)).toEqual(['agent started: Real one', 'agent started: Stuck one', 'agent failed: Stuck one'])
})

test('the agents source reads whether or not a run is live, and nobody watches', PEEK, async ($, on) => {
  beneath(on, () => [])
  const k = kit($)
  const launched = await k.background('a1', 'Map the tables')
  expect(launched.context).toBeUndefined()
  expect(await k.run()).toBeNull()
  expect(await k.list()).toEqual(['a1:Map the tables:now'])
  expect((await k.held())['hud/agents-running']).toMatchObject({ value: 1 })
  await k.turn('a1')
  expect(await k.list()).toEqual(['a1:Map the tables:done'])
  expect(await k.run()).toBeNull() // and it started no run, wrote no line
})

test('muted, its slots leave the drawing', PEEK, async ($, on) => {
  const kept: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: kept[e.key] }))
  on('store.set', ($, e) => (kept[e.key] = e.value, { value: undefined }))
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  await k.background('a1', 'Map the tables')
  await k.turn() // a boundary: the terminal's band takes the strip's slots at one, as the desktop's strip does
  for (const s of SURFACES) {
    const where = ['AbovePrompt', 'Pane'] as const
    // the checklist as each surface says it: the desktop in words for the alt, the terminal by its items. (The log
    // line "agent started: Map the tables" is the observer's, not the source's slot: muting leaves it.)
    const figure = s === 'desktop' ? 'now Map the tables' : '▸ Map the tables'
    for (const component of where) expect((await k.drawn(s, component)).raw).toContain(figure)
    expect(await k.hud('sources')).toContain('Agents · HUD\n  Reads when Claude starts a subagent and when it finishes: its description and whether it failed. Nothing else.\n  Agents, Agents running')
    expect(await k.hud('mute agents')).toBe('Agents is muted: its figures are hidden until /hud unmute agents.')
    expect(kept.muted).toEqual(['hud:agents'])
    for (const component of where) expect((await k.drawn(s, component)).raw).not.toContain(figure)
    expect((await k.drawn(s, 'Pane')).words).toContain('muted') // still listed, so it can come back
    expect(await k.hud('unmute agents')).toBe('Agents is back.')
    for (const component of where) expect((await k.drawn(s, component)).raw).toContain(figure)
  }
})

test('subagent tool calls still count on the board', PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  await k.background('a1', 'Map the tables')
  const before = (await k.run())!
  await k.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'a1' })
  await k.call({ tool: 'Bash', command: 'npm test', agentId: 'a1', answer: { result: 'boom', isError: true } })
  await k.call({ tool: 'Edit', file_path: '/w/a.ts', agentId: 'a1' })
  const after = (await k.run())!
  expect([after.calls - before.calls, after.errors - before.errors]).toEqual([3, 1])
  // they age nothing, tick nothing and write no line: they are the subagent's, not the run's
  expect([after.ticks, after.sinceUpdate, after.log.map(l => l.text)]).toEqual([before.ticks, before.sinceUpdate, ['agent started: Map the tables']])
  expect(await k.list()).toEqual(['a1:Map the tables:now'])
})

test('a resumed session has none of the last process\'s agents running', PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  await k.background('a1', 'Map the tables')
  await k.background('a2', 'Write it')
  await k.notify('a2')
  expect((await k.drawn('desktop', 'AbovePrompt')).words).toContain('1 job running')
  await k.start()
  expect(await k.list()).toEqual(['a1:Map the tables:failed', 'a2:Write it:done'])
  expect((await k.held())['hud/agents-running']).toMatchObject({ value: 0 })
  expect((await k.drawn('desktop', 'AbovePrompt')).words).not.toMatch(/jobs? running/)
  // the log says what the HUD knows: lost when the session started again, not failed
  expect((await k.log()).at(-1)).toBe('agent lost at reload: Map the tables')
  // nothing of it comes back (a real resume): the sweep's result stands through the turn
  await k.turn()
  expect(await k.list()).toEqual(['a1:Map the tables:failed', 'a2:Write it:done'])
})

// session.start says nothing of why (a reload, an enable or a respawn keeps the process and its agents; a resume does not),
// so what it ended is ended for now: any later sign of the agent's life brings it back.
test('a reload ends no agent for good: its call brings it back at work with its job, and its notification or its own turn ends it as they say', PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  for (const [id, name] of [['a1', 'Map the tables'], ['a2', 'Write it'], ['a3', 'Test it']] as const) await k.background(id, name)
  await k.start()
  expect(await k.list()).toEqual(['a1:Map the tables:failed', 'a2:Write it:failed', 'a3:Test it:failed'])
  expect(await k.jobs()).toEqual({})
  // a1 is at work after all: a call of its own brings it back, a job again
  await k.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'a1' })
  expect(await k.list('a1')).toEqual(['a1:Map the tables:now'])
  expect(await k.jobs()).toEqual({ a1: 'agent' })
  // a2's notification and a3's own turn end them as they say, over the reload's failed
  await k.notify('a2')
  await k.turn('a3', 'answer')
  expect(await k.list()).toEqual(['a1:Map the tables:now', 'a2:Write it:done', 'a3:Test it:done'])
  expect((await k.held())['hud/agents-running']).toMatchObject({ value: 1, note: '2 done' })
  expect((await k.log()).slice(-5)).toEqual([
    'agent lost at reload: Map the tables', 'agent lost at reload: Write it', 'agent lost at reload: Test it', 'agent finished: Write it', 'agent finished: Test it',
  ])
  // the main loop's turn ends while a1 works: its job keeps the run running, never a false "waiting for you"
  await k.turn()
  expect((await k.run())!.status).toBe('running')
  for (const s of SURFACES) {
    expect((await k.drawn(s, 'AbovePrompt')).words, s).toContain('1 job running')
    expect((await k.drawn(s, 'Pane')).raw, s).toContain('Map the tables')
  }
})

test('stopping a background agent with TaskStop ends it', PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.tool({ start: 'Ship it' })
  await k.background('a1', 'Map the tables')
  await k.call({ tool: 'TaskStop', task_id: 'a1' })
  expect(await k.list()).toEqual(['a1:Map the tables:failed'])
  expect(await k.jobs()).toEqual({})
  expect((await k.run())!.log.map(l => l.text)).toEqual(['agent started: Map the tables', 'agent failed: Map the tables'])
})
