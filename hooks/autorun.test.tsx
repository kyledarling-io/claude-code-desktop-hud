import type { On, Register, RenderSurface } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

import type { HudRun } from '../types'
import { AUTO_CALLS, AUTO_MS, isLive, notification, PAUSE_MS, shouldStart, titleOf } from './lifecycle'
import { autoNote } from './notes'

// ---- the pure decisions

test('a run starts with no live run, while someone watches, at 8 calls or 60 seconds into the turn', async () => {
  expect([AUTO_CALLS, AUTO_MS, PAUSE_MS]).toEqual([8, 60_000, 30 * 60_000])
  const turn = (calls: number) => ({ startedAt: 0, calls })
  expect(shouldStart(false, true, turn(8), 0)).toBe(true)
  expect(shouldStart(false, true, turn(7), 0)).toBe(false)
  expect(shouldStart(false, true, turn(2), 60_000)).toBe(true)
  expect(shouldStart(false, true, turn(2), 59_999)).toBe(false)
  expect(shouldStart(true, true, turn(20), 0)).toBe(false) // a run is live: it has one
  expect(shouldStart(false, false, turn(20), 0)).toBe(false) // nobody watches
  expect(shouldStart(false, true, undefined, 10 * 60_000)).toBe(false) // no turn in hand
})

test("the title is the prompt's first line, plain, fitted to 60 characters", async () => {
  expect(titleOf(undefined)).toBe('Task')
  expect(titleOf('')).toBe('Task')
  expect(titleOf('  \n\n  ')).toBe('Task')
  expect(titleOf('**Migrate** the `auth` tables and fix whatever breaks\nthen tell me')).toBe('Migrate the auth tables and fix whatever breaks')
  expect(titleOf('\n\n  Rename the column  \nsecond line')).toBe('Rename the column')
  const long = titleOf('Move every invoice and payment record into the append-only ledger and verify the balances per customer account')
  expect(long.endsWith('…')).toBe(true)
  expect(long.length).toBeLessThanOrEqual(60)
  expect(long.startsWith('Move every invoice and payment record')).toBe(true)
})

// plain() is quadratic on a long run of "[" (a pasted log, JSON): the title reads the first line, and 2,000 characters of it
test('the title reads only the first line, and 2,000 characters of it, so a long prompt costs nothing', async () => {
  for (const [prompt, want] of [['Fix the parser\n' + '['.repeat(40_000), 'Fix the parser'], ['['.repeat(40_000), undefined]] as const) {
    const t = performance.now(), title = titleOf(prompt)
    expect(performance.now() - t, prompt.slice(0, 20)).toBeLessThan(100)
    if (want) expect(title).toBe(want)
    expect(title.length).toBeLessThanOrEqual(61)
  }
})

test('a task notification names its job and how it ended', async () => {
  const block = '<task-notification>\n<task-id>b7x2</task-id>\n<status>completed</status>\n<summary>Background command "npm run dev" completed (exit code 0)</summary>\n</task-notification>'
  expect(notification(block)).toEqual({ id: 'b7x2', status: 'completed' })
  expect(notification(`Read the output.\n${block.replace('completed', 'killed')}`)).toEqual({ id: 'b7x2', status: 'killed' })
  expect(notification('<task-id>b7x2</task-id> <status>failed</status>')).toBeUndefined() // not in a notification block
  expect(notification('fix the build')).toBeUndefined()
  expect(notification('<task-notification><status>failed</status></task-notification>')).toBeUndefined()
})

// ---- through the hooks

type Loose = (i: object) => Promise<{ result?: unknown; context?: readonly string[]; text?: string }>
type Handle = { drawn: () => Promise<unknown>; press: (t: { key: string }) => Promise<unknown>; unmount: () => Promise<void> }
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (n: unknown): Node[] => (typeof n === 'object' && n !== null ? [n as Node, ...((n as Node).children ?? []).flatMap(nodes)] : [])
const text = (n: unknown): string => (typeof n === 'string' ? n : typeof n === 'object' && n !== null ? ((n as Node).children ?? []).map(text).join('') : '')
const SURFACES = ['terminal', 'desktop'] as const
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }

// Reads the HUD's own state from above it (a test's own $ has no state): /peek run, prompt or stripHidden. A read
// names its key as a literal.
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async ($, e) => {
    const got = e.args === 'prompt' ? await $.state.get({ plugin: 'hud', key: 'prompt' })
      : e.args === 'stripHidden' ? await $.state.get({ plugin: 'hud', key: 'stripHidden' })
        : e.args === 'turn' ? await $.state.get({ plugin: 'hud', key: 'turn' })
          : await $.state.get({ plugin: 'hud', key: 'run' })
    return { text: JSON.stringify(got.value ?? null) }
  })
}
const PEEK = { plugins: [{ name: 'peek', register: peek }] }
// for a test that makes many calls in a row or steps the clock: room on a loaded machine, as wired.test.ts has
const LONG = { ...PEEK, timeoutMs: 30_000 }

// The engine beneath: someone watching on the surfaces in hand, each call answered as it says (else ok), a message
// entering as sent (or refused, when it says so), a turn ending, the dock empty, and the engine's own band an empty drawing.
const beneath = (on: On, surfaces: () => RenderSurface[]) => {
  const clock = mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: surfaces() }))
  on('tool.call', ($, e) => (e as unknown as { answer?: { result: unknown } }).answer ?? { result: 'ok' })
  on('prompt.submit', ($, e) => {
    const refuse = (e as unknown as { refuse?: string }).refuse
    return refuse ? { drop: refuse } : { text: e.text, context: e.context }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__hud__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  return clock
}

const PROMPT = 'Migrate the auth tables and fix whatever breaks\nThe old ones are in db/legacy.'
const TITLE = 'Migrate the auth tables and fix whatever breaks'

const kit = ($: Engine) => {
  const call = $.tool.call as unknown as Loose
  const peekAt = async <T,>(key: string) => JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: key })).text)) as T
  const mount = (surface: RenderSurface, component: 'AbovePrompt' | 'Pane') =>
    ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component, ...(component === 'Pane' ? { requestId: 'hud', props: pane } : { props: band }) })
  return {
    call,
    hud: (i: object) => call({ tool: 'mcp__hud__hud', ...i }),
    bash: async (n: number, extra: object = {}) => {
      const said: (readonly string[] | undefined)[] = []
      for (let k = 0; k < n; k++) said.push((await call({ tool: 'Bash', command: 'true', ...extra })).context)
      return said
    },
    say: (text: string) => ($.prompt.submit as unknown as Loose)({ text, wait: false, origin: { kind: 'composer' } }),
    // a background task's notification, as the app delivers it: a prompt of its own
    notify: (id: string, status = 'completed') => ($.prompt.submit as unknown as Loose)({
      text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>Background command "npm run dev" ${status}</summary>\n</task-notification>`,
      wait: false, origin: { kind: 'task-notification' },
    }),
    turn: (agentId?: string) => ($.turn.complete as unknown as Loose)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) }),
    start: () => ($.session.start as unknown as Loose)({ cwd: '/', surface: 'desktop', isInteractive: false }),
    peekAt,
    run: () => peekAt<HudRun | null>('run'),
    mount,
    // what the band and the pane draw, as text, and whether the title is drawn dim in each
    drawn: async (surface: RenderSurface, component: 'AbovePrompt' | 'Pane') => {
      const ui = await mount(surface, component)
      const all = nodes(await ui.drawn())
      await ui.unmount()
      return { all, words: all.filter(n => n.type === 'Text').map(text).join(' | ') }
    },
  }
}
const dimTitle = (all: Node[], title: string) => all.some(n => n.type === 'Text' && n.props?.dimColor === true && text(n).includes(title))

test('a long turn starts a run on its own at 8 calls, titled from the prompt, drawn dim', LONG, async ($, on) => {
  let surfaces: RenderSurface[] = ['terminal']
  beneath(on, () => surfaces)
  const k = kit($)
  for (const s of SURFACES) {
    surfaces = [s]
    await k.say(PROMPT)
    await k.bash(AUTO_CALLS - 1)
    expect(isLive(await k.run())).toBe(false) // none yet (the last surface's run stands finished)
    await k.bash(1)
    const r = (await k.run())!
    expect([r.title, r.status, r.provisional, r.goal]).toEqual([TITLE, 'running', true, undefined])
    // dim in the band and the pane, on both surfaces
    for (const component of ['AbovePrompt', 'Pane'] as const) {
      const { all, words } = await k.drawn(s, component)
      expect(words).toContain(TITLE)
      expect(dimTitle(all, TITLE)).toBe(true)
    }
    // Claude's own finish ends it, and in the same turn no other starts; the next turn may
    await k.hud({ done: 'migrated' })
    await k.bash(AUTO_CALLS)
    expect((await k.run())!.status).toBe('done')
    await k.turn()
  }
})

test('calls that finish together each count toward the turn', LONG, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  const read = () => k.call({ tool: 'Read', file_path: '/w/db/legacy.sql' })
  await Promise.all([read(), read(), read(), read()])
  expect((await k.peekAt<{ calls: number }>('turn')).calls).toBe(4)
  await Promise.all([read(), read(), read(), read()])
  const r = (await k.run())!
  expect([r.title, r.provisional]).toEqual([TITLE, true])
})

test('a plan held before the run reaches it the moment it starts on its own', LONG, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  await k.call({ tool: 'TodoWrite', todos: [{ content: 'Map the tables', status: 'completed', activeForm: 'Mapping' }, { content: 'Write the migration', status: 'in_progress', activeForm: 'Writing' }] })
  expect(await k.run()).toBeNull() // held, with no run to show it
  await k.bash(AUTO_CALLS - 1)
  const r = (await k.run())!
  expect(r.provisional).toBe(true)
  expect(r.widgets.find(w => w.id === 'plan')).toMatchObject({ by: 'observer', items: [{ label: 'Map the tables', state: 'done' }, { label: 'Write the migration', state: 'now' }] })
  expect(r.progress).toEqual({ n: 1, total: 2, label: 'steps' })
})

test('or at 60 seconds into the turn', PEEK, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  await k.bash(1)
  await clock.advance(AUTO_MS + 1000)
  expect(await k.run()).toBeNull() // time alone starts nothing: a call does
  await k.bash(1)
  const r = (await k.run())!
  expect([r.title, r.provisional, r.startedAt]).toEqual([TITLE, true, AUTO_MS + 1000])
})

test('never while nobody watches', LONG, async ($, on) => {
  beneath(on, () => [])
  const k = kit($)
  expect((await k.say(PROMPT)).context).toBeUndefined()
  const said = await k.bash(20)
  expect(said.every(c => c === undefined)).toBe(true)
  expect(await k.run()).toBeNull()
})

test('Claude is told once, in 40 tokens or fewer', LONG, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  const said = await k.bash(AUTO_CALLS + 12)
  // the call that starts it says nothing; the next result carries the note, once
  expect(said[AUTO_CALLS - 1]).toBeUndefined()
  const note = said[AUTO_CALLS]?.join('\n') ?? ''
  expect(note).toBe(autoNote(TITLE))
  expect(note).toContain(`"${TITLE}"`)
  expect(note.length).toBeLessThanOrEqual(160)
  expect(said.filter(c => c?.join('\n').includes('on its own')).length).toBe(1)
  expect((await k.run())!.told).toBe(true)
  // 40 tokens (160 characters) for any title of 60
  for (const t of ['W'.repeat(60), 'x'.repeat(60), titleOf('a '.repeat(200))]) expect(autoNote(t).length).toBeLessThanOrEqual(160)
})

test('a run that started on its own gets no HUD check, generic or pointed; once adopted it does', LONG, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  const said = await k.bash(AUTO_CALLS + 1) // the start, then the note that tells Claude, once
  // a widget of Claude's, sent without naming the run: it stays provisional, and the widget goes stale
  await k.hud({ widget: { id: 'rows', type: 'stat', title: 'Rows copied', value: 3 } })
  said.push(...(await k.bash(30)))
  await clock.advance(10 * 60_000) // a long quiet spell too
  said.push(...(await k.bash(30)))
  expect((await k.run())!.provisional).toBe(true)
  expect(said.filter(Boolean).map(c => c!.join('\n'))).toEqual([autoNote(TITLE)])
  // adopted, it is Claude's run: checked as any, here at once for the widget gone stale
  await k.hud({ start: 'Migrate auth tables' })
  expect((await k.run())!.provisional).toBeUndefined()
  expect((await k.bash(1))[0]?.join('\n')).toContain('HUD check: your rows stat')
})

test("a message beside a run that started on its own carries the note that names it, not the steer; once adopted, the steer", PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  await k.bash(AUTO_CALLS)
  await k.turn()
  // the run keeps the first task's title until Claude names it: each of the person's messages says so, in 160 at most, so a
  // later task can be named (a title adopts it whatever its age), and never the steer, which would call it Claude's
  expect((await k.run())!.provisional).toBe(true)
  for (const next of ['now the docs for it', 'and then the changelog']) {
    const note = (await k.say(next)).context?.join('\n') ?? ''
    expect(note).toBe(autoNote(TITLE))
    expect(note.length).toBeLessThanOrEqual(160)
  }
  // a notification or a hand-back is not the person's: no note
  expect((await k.notify('b1')).context).toBeUndefined()
  // adopted, it is Claude's run: a message carries its title (no goal was sent)
  await k.hud({ title: 'Auth tables' })
  expect((await k.say('now the docs')).context?.join('\n')).toBe('HUD: "Auth tables".')
})

test("the person's message refused on its way in changes nothing: no title kept, no turn begun, no resume", PEEK, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  const submit = $.prompt.submit as unknown as Loose
  await k.say(PROMPT)
  await k.hud({ start: 'Auth tables' })
  await k.turn()
  const before = [await k.peekAt('prompt'), await k.peekAt('turn'), (await k.run())!.status]
  expect(before.slice(1)).toEqual([null, 'waiting for you'])
  // refused by a hook beneath the HUD: it never reached Claude
  await submit({ text: 'Something else entirely', wait: false, origin: { kind: 'composer' }, refuse: 'blocked' })
  expect([await k.peekAt('prompt'), await k.peekAt('turn'), (await k.run())!.status]).toEqual(before)
  for (const s of SURFACES) expect((await k.drawn(s, 'AbovePrompt')).words, s).toMatch(/Waiting.for.you/)
  // the next message that goes through does all three
  await k.say('Carry on')
  expect([(await k.peekAt<{ text: string }>('prompt')).text, (await k.peekAt<{ calls: number }>('turn')).calls, (await k.run())!.status]).toEqual(['Carry on', 0, 'running'])
})

test("a peer's message (a subagent handing back) is not the person's: no note, the same turn and prompt, no resume", LONG, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  const submit = $.prompt.submit as unknown as Loose
  // as the app delivers a subagent's hand-back (proved on desktop 2.1.295)
  const peer = (text: string) => submit({ text: `<agent-message from="worker">${text}</agent-message>`, wait: false, origin: { kind: 'peer' } })
  await k.say(PROMPT)
  await k.bash(3)
  expect((await peer('found the legacy tables')).context).toBeUndefined()
  await k.bash(AUTO_CALLS - 3) // the turn is still the person's: its calls count on to 8
  expect([(await k.run())!.title, (await k.run())!.provisional]).toEqual([TITLE, true]) // titled from the person's message
  await k.hud({ title: 'Auth tables' }) // adopted: the person's messages are steered again
  await k.turn()
  expect((await k.run())!.status).toBe('waiting for you')
  expect((await peer('all done')).context).toBeUndefined()
  expect((await k.run())!.status).toBe('waiting for you') // a peer doesn't pick it up
  // the person's message does, and is steered
  expect((await k.say('thanks, now the docs')).context?.join('\n')).toBe('HUD: "Auth tables".')
  expect((await k.run())!.status).toBe('running')
  // a prompt with no origin (old tests, other hosts) counts as the person's
  expect((await submit({ text: 'and the README', wait: false })).context?.join('\n')).toBe('HUD: "Auth tables".')
})

test('a start adopts the provisional run: new title and goal, same log, counts and clock', LONG, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  await clock.advance(5000)
  await k.bash(AUTO_CALLS)
  for (const f of ['a', 'a', 'b']) await k.call({ tool: 'Edit', file_path: `/w/db/${f}.ts` })
  await k.call({ tool: 'Bash', command: 'npm test', answer: { result: 'boom', isError: true } })
  const before = (await k.run())!
  expect(before.log.map(l => l.text)).toEqual(['edited a.ts ×2', 'edited b.ts', 'npm test failed'])
  await clock.advance(5000)
  await k.hud({ start: 'Migrate auth tables', goal: 'Green auth tests on the new schema' })
  const r = (await k.run())!
  expect([r.title, r.goal, r.provisional]).toEqual(['Migrate auth tables', 'Green auth tests on the new schema', undefined])
  expect([r.startedAt, r.calls, r.errors]).toEqual([before.startedAt, before.calls, before.errors])
  expect([r.calls, r.errors]).toEqual([4, 1])
  expect(r.log.map(l => l.text)).toEqual([...before.log.map(l => l.text), 'Goal: Green auth tests on the new schema'])
  // no longer dim, on both surfaces
  for (const s of SURFACES) for (const component of ['AbovePrompt', 'Pane'] as const) {
    const { all, words } = await k.drawn(s, component)
    expect(words).toContain('Migrate auth tables')
    expect(dimTitle(all, 'Migrate auth tables')).toBe(false)
  }
  // a title alone names it too
  await k.hud({ done: 'ok' })
  await k.turn()
  await k.say(PROMPT)
  await k.bash(AUTO_CALLS)
  await k.hud({ title: 'Auth tables, part two' })
  expect([(await k.run())!.title, (await k.run())!.provisional]).toEqual(['Auth tables, part two', undefined])
})

test('a provisional run from an earlier message is not adopted: a start begins a fresh one', LONG, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  await k.bash(AUTO_CALLS) // started on its own; Claude never names it in this turn
  await k.call({ tool: 'Edit', file_path: '/w/db/a.ts' })
  await k.turn()
  await clock.advance(5000)
  await k.say('Now update the docs for it')
  // a start begins a fresh run, as steer() tells Claude for a new task: none of the old log or clock
  await k.hud({ start: 'Update the auth docs', goal: 'Docs match the new schema' })
  const r = (await k.run())!
  expect([r.title, r.startedAt, r.provisional, r.log.map(l => l.text)]).toEqual(['Update the auth docs', 5000, undefined, ['Goal: Docs match the new schema']])
})

test('a title adopts a provisional run whatever its age: Claude claims the run it is looking at', LONG, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  await k.bash(AUTO_CALLS) // started on its own; Claude never names it in this turn
  await k.call({ tool: 'Edit', file_path: '/w/db/a.ts' })
  await k.turn()
  await clock.advance(5000)
  await k.say('Carry on with the auth tables')
  await k.hud({ title: 'Auth tables' })
  const r = (await k.run())!
  expect([r.title, r.provisional, r.startedAt, r.log.map(l => l.text)]).toEqual(['Auth tables', undefined, 0, ['edited a.ts']])
})

test("a start on Claude's own run starts fresh, as today", LONG, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  await k.hud({ start: 'Deploy v2', log: 'building' })
  await k.bash(AUTO_CALLS + 4)
  await clock.advance(5000)
  await k.hud({ start: 'Roll back v2' })
  const r = (await k.run())!
  expect([r.title, r.startedAt, r.calls, r.log, r.provisional]).toEqual(['Roll back v2', 5000, 0, [], undefined])
  // and once adopted, a provisional run is Claude's: a second start starts fresh too
  await k.hud({ done: 'ok' })
  await k.turn()
  await k.say(PROMPT)
  await k.bash(AUTO_CALLS)
  await k.hud({ start: 'Adopted', log: 'kept' })
  await k.hud({ start: 'Fresh' })
  expect((await k.run())!.log).toEqual([])
})

test('a turn that ends without done or fail reads waiting for you, with the last log line', LONG, async ($, on) => {
  let surfaces: RenderSurface[] = ['terminal']
  beneath(on, () => surfaces)
  const k = kit($)
  for (const s of SURFACES) {
    surfaces = [s]
    await k.say(PROMPT)
    await k.bash(AUTO_CALLS)
    await k.call({ tool: 'Edit', file_path: `/w/db/schema-${s}.ts` })
    await k.turn('a1') // a subagent's turn ending is not the person's to answer
    expect((await k.run())!.status).toBe('running')
    await k.turn()
    expect((await k.run())!.status).toBe('waiting for you')
    // the band's last line says what happened last; the status says whose move it is (the desktop band's header,
    // the terminal pane's status line)
    expect((await k.drawn(s, 'AbovePrompt')).words).toContain(`edited schema-${s}.ts`)
    expect((await k.drawn(s, s === 'desktop' ? 'AbovePrompt' : 'Pane')).words).toMatch(/waiting[\s ]for[\s ]you/i)
    // the person's next message picks it up again
    await k.say('go on')
    expect((await k.run())!.status).toBe('running')
    await k.hud({ done: 'ok' })
    await k.turn()
  }
})

test("a run waiting for you runs again on Claude's next main-loop call, whatever began the turn", LONG, async ($, on) => {
  let surfaces: RenderSurface[] = ['terminal']
  beneath(on, () => surfaces)
  const k = kit($)
  const waits = /waiting[\s ]for[\s ]you/i
  for (const s of SURFACES) {
    surfaces = [s]
    const where = s === 'desktop' ? 'AbovePrompt' : 'Pane' // where each surface says the status
    await k.say(PROMPT)
    await k.bash(AUTO_CALLS)
    await k.turn()
    expect((await k.run())!.status).toBe('waiting for you')
    // a task notification begins the next turn: on its own it changes nothing, nor does a subagent's call
    expect((await k.notify(`${s}-1`)).context).toBeUndefined()
    await k.bash(1, { agentId: 'a1' })
    expect((await k.run())!.status).toBe('waiting for you')
    expect((await k.drawn(s, where)).words).toMatch(waits)
    // Claude's own call: Claude is working, so the run is running from it
    await k.bash(1)
    expect((await k.run())!.status).toBe('running')
    expect((await k.drawn(s, where)).words).not.toMatch(waits)
    await k.turn()
    expect((await k.run())!.status).toBe('waiting for you')
    // the hud tool is one of Claude's calls too: an update sets it running, and a status Claude sends stands
    await k.hud({ log: 'checking the tables' })
    expect((await k.run())!.status).toBe('running')
    await k.turn()
    await k.hud({ status: 'blocked on review' })
    expect((await k.run())!.status).toBe('blocked on review')
    await k.hud({ done: 'ok' })
    await k.turn()
  }
})

test("a long turn a notification or a hand-back began starts a run too, titled from the person's last message; a short one starts nothing", LONG, async ($, on) => {
  let surfaces: RenderSurface[] = ['terminal']
  beneath(on, () => surfaces)
  const k = kit($)
  const peer = (text: string) => ($.prompt.submit as unknown as Loose)({ text: `<agent-message from="worker">${text}</agent-message>`, wait: false, origin: { kind: 'peer' } })
  // with no message of the person's yet, the run takes the generic title
  await k.notify('first')
  await k.bash(AUTO_CALLS)
  expect([(await k.run())!.title, (await k.run())!.provisional]).toEqual(['Task', true])
  await k.hud({ done: 'ok' })
  await k.turn()
  for (const s of SURFACES) {
    surfaces = [s]
    await k.say(PROMPT)
    await k.bash(5) // the person's turn is short: nothing
    await k.turn()
    await k.notify(`${s}-short`)
    await k.bash(5) // and so is this one
    await k.turn()
    expect(isLive(await k.run())).toBe(false)
    // phase-1's shape: a turn a notification began runs 24 calls while someone watches and no run is live
    expect((await k.notify(`${s}-long`)).context).toBeUndefined() // no note beside it
    const said = await k.bash(AUTO_CALLS - 1)
    expect(isLive(await k.run())).toBe(false)
    said.push(...(await k.bash(24 - (AUTO_CALLS - 1))))
    const r = (await k.run())!
    // started at the 8th call (it counts from the next), titled from the person's message, dim on both components
    expect([r.title, r.provisional, r.calls]).toEqual([TITLE, true, 24 - AUTO_CALLS])
    for (const component of ['AbovePrompt', 'Pane'] as const) expect(dimTitle((await k.drawn(s, component)).all, TITLE)).toBe(true)
    // unadopted: Claude is told once and never checked, and the person's next message carries the note that names it,
    // never the steer
    expect(said.filter(Boolean).map(c => c!.join('\n'))).toEqual([autoNote(TITLE)])
    await k.turn()
    expect((await k.say('carry on')).context).toEqual([autoNote(TITLE)])
    // Claude finishes it in this turn: a hand-back mid-turn begins no second run in it
    await k.hud({ done: 'ok' })
    await peer('found the legacy tables')
    await k.bash(AUTO_CALLS)
    expect((await k.run())!.status).toBe('done')
    await k.turn()
    // a turn a hand-back began is a turn too, titled from the person's last message
    await peer('all done')
    await k.bash(AUTO_CALLS)
    expect([(await k.run())!.title, (await k.run())!.provisional]).toEqual(['carry on', true])
    await k.hud({ done: 'ok' })
    await k.turn()
  }
})

test("a paused run runs again on Claude's next main-loop call, whatever began the turn", { ...PEEK, timeoutMs: 60_000 }, async ($, on) => {
  let surfaces: RenderSurface[] = ['terminal']
  const clock = beneath(on, () => surfaces)
  const k = kit($)
  await k.start() // the 1-second clock
  const pausedFor = async () => {
    await k.turn()
    await clock.advance(PAUSE_MS + 1000) // half an hour idle, second by second
    expect((await k.run())!.status).toBe('paused')
  }
  for (const s of SURFACES) {
    surfaces = [s]
    const where = s === 'desktop' ? 'AbovePrompt' : 'Pane' // where each surface says the status
    await k.say(PROMPT)
    await k.bash(AUTO_CALLS)
    await pausedFor()
    // a task notification begins the next turn: on its own it resumes nothing
    expect((await k.notify(`${s}-1`)).context).toBeUndefined()
    expect((await k.run())!.status).toBe('paused')
    expect((await k.drawn(s, where)).words).toMatch(/paused/i)
    // Claude's own call: at work, so running
    await k.bash(1)
    expect((await k.run())!.status).toBe('running')
    expect((await k.drawn(s, where)).words).not.toMatch(/paused/i)
    await k.hud({ done: 'ok' })
    await k.turn()
  }
  // the hud tool is one of Claude's calls too
  await k.say(PROMPT)
  await k.bash(AUTO_CALLS)
  await pausedFor()
  await k.hud({ log: 'back on it' })
  expect((await k.run())!.status).toBe('running')
})

test('a notification refused on its way in begins no turn: a later one counts from its own time', PEEK, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  const notice = '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>'
  await k.say(PROMPT)
  await k.bash(1)
  await k.turn()
  expect(await k.peekAt('turn')).toBeNull()
  await clock.advance(5000)
  const refused = await ($.prompt.submit as unknown as (i: object) => Promise<{ drop?: string }>)({ text: notice, wait: false, origin: { kind: 'task-notification' }, refuse: 'blocked' })
  expect(refused.drop).toBe('blocked')
  expect(await k.peekAt('turn')).toBeNull() // as it was: no turn with the refused one's time
  await clock.advance(5000)
  await k.notify('b2')
  expect(await k.peekAt('turn')).toEqual({ startedAt: 10_000, calls: 0 })
})

test('or 60 seconds after the notification that began the turn', PEEK, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  await k.bash(1)
  await k.turn()
  await clock.advance(5000)
  await k.notify('b1')
  await clock.advance(AUTO_MS - 1000)
  await k.bash(1)
  expect(await k.run()).toBeNull() // 59 seconds into the turn
  await clock.advance(2000)
  await k.bash(1)
  const r = (await k.run())!
  expect([r.title, r.provisional, r.startedAt]).toEqual([TITLE, true, 5000 + AUTO_MS + 1000])
})

test('jobs still running keep it running: 2 jobs running', LONG, async ($, on) => {
  let surfaces: RenderSurface[] = ['terminal']
  beneath(on, () => surfaces)
  const k = kit($)
  const background = (id: string) => k.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true, answer: { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id } } })
  for (const s of SURFACES) {
    surfaces = [s]
    await k.say(PROMPT)
    await k.bash(3)
    await k.notify('earlier') // a notification mid-turn keeps the person's turn: its calls still count to 8
    await k.bash(AUTO_CALLS - 4)
    expect(isLive(await k.run())).toBe(false)
    await k.bash(1)
    expect((await k.run())!.provisional).toBe(true)
    await background(`${s}-1`)
    await background(`${s}-2`)
    await background(`${s}-3`)
    // a subagent's background shell is the subagent's to hear about
    await k.call({ tool: 'Bash', command: 'npm run watch', agentId: 'a1', answer: { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `${s}-sub` } } })
    await k.call({ tool: 'TaskStop', task_id: `${s}-3` })
    await k.turn()
    expect((await k.run())!.status).toBe('running')
    expect((await k.drawn(s, 'AbovePrompt')).words).toContain('2 jobs running')
    // a notification ends the job it names: it is no message of the person's, so it brings no note, keeps the
    // prompt (its first line, all the HUD keeps of it), and leaves the status
    const heard = await k.notify(`${s}-1`)
    expect(heard.context).toBeUndefined()
    expect((await k.peekAt<{ text: string }>('prompt')).text).toBe(TITLE)
    expect((await k.drawn(s, 'AbovePrompt')).words).toContain('1 job running')
    await k.turn()
    expect((await k.run())!.status).toBe('running')
    await k.notify(`${s}-2`, 'failed')
    expect((await k.drawn(s, 'AbovePrompt')).words).not.toMatch(/jobs? running/)
    await k.turn()
    expect((await k.run())!.status).toBe('waiting for you')
    // a session that starts again (a resume) has none of the last process's shells
    await background(`${s}-4`)
    expect((await k.drawn(s, 'AbovePrompt')).words).toContain('1 job running')
    await k.start()
    expect((await k.drawn(s, 'AbovePrompt')).words).not.toMatch(/jobs? running/)
    await k.hud({ done: 'ok' })
  }
})

// The clock is stepped second by second through the 30 minutes, as the app runs it: a test of its own, with room.
// simplification: one idle stretch; the pause is the same run's on any surface, so each surface is asked what it draws
test('30 minutes without a turn reads paused; the next turn resumes it', LONG, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.start() // the 1-second clock
  await k.say(PROMPT)
  await k.bash(AUTO_CALLS)
  await k.turn()
  expect((await k.run())!.status).toBe('waiting for you')
  await clock.advance(PAUSE_MS - 2000)
  expect((await k.run())!.status).toBe('waiting for you')
  await clock.advance(3000)
  expect((await k.run())!.status).toBe('paused')
  // the desktop band's header says it; the terminal's pane does (its band shows the status by colour alone)
  for (const s of SURFACES) expect((await k.drawn(s, s === 'desktop' ? 'AbovePrompt' : 'Pane')).words).toMatch(/paused/i)
  // a background task's notification is not a turn of the person's: still paused
  await k.notify('b1')
  expect((await k.run())!.status).toBe('paused')
  await k.say('still there?')
  expect((await k.run())!.status).toBe('running')
  for (const s of SURFACES) expect((await k.drawn(s, s === 'desktop' ? 'AbovePrompt' : 'Pane')).words).not.toMatch(/paused/i)
})

// Stands in for a clock tick whose read of lastTurnAt came before a message's write: armed with a time, the HUD's next
// read of lastTurnAt answers that older time. /arm <ms>.
const stale: Register = on => {
  let armed: number | undefined
  on('command.run', { command: 'arm' }, ($, e) => ((armed = Number(e.args)), { text: 'armed' }))
  on('state.get', async ($, e, next) => {
    const got = await next(e)
    const at = e as unknown as { plugin: string; key: string }
    if (armed === undefined || at.plugin !== 'hud' || at.key !== 'lastTurnAt') return got
    const was = armed
    armed = undefined
    const read = got as unknown as { value: { value: unknown; version: number } }
    return { ...read, value: { ...read.value, value: was } } as unknown as typeof got
  })
}

test("a message that lands between the clock's read and its pause is not overwritten", { plugins: [...PEEK.plugins, { name: 'stale', register: stale }], timeoutMs: LONG.timeoutMs }, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.start()
  await k.say(PROMPT)
  await k.bash(AUTO_CALLS)
  await k.turn()
  // The person's message lands: the run is running again. The clock's next tick (one second on) reads lastTurnAt as it
  // stood before that message, 30 minutes and more past (the armed stale read), so it decides to pause after the
  // message has written; the message must win.
  await k.say('back again')
  expect((await k.run())!.status).toBe('running')
  await ($.command.run as unknown as Loose)({ command: 'arm', args: String(-PAUSE_MS) })
  await clock.advance(1000)
  expect((await k.run())!.status).toBe('running')
})

test('a run auto-started in the turn the person pressed ✕ stays hidden', LONG, async ($, on) => {
  beneath(on, () => ['desktop'])
  const k = kit($)
  for (const s of SURFACES) {
    // the strip of a finished run, which the person hides in this turn
    await k.hud({ start: 'Earlier', done: 'ok' })
    await k.turn()
    await k.say(PROMPT)
    const ui = await k.mount(s, 'AbovePrompt')
    await ui.press({ key: 'hide' })
    await k.bash(AUTO_CALLS)
    expect((await k.run())!.provisional).toBe(true)
    expect(await k.peekAt<boolean>('stripHidden')).toBe(true)
    expect(JSON.stringify(await ui.drawn())).not.toContain(TITLE)
    // in a turn with no ✕, a new run shows the strip, as today
    await k.hud({ done: 'ok' })
    await k.turn()
    await k.say(PROMPT)
    await k.bash(AUTO_CALLS)
    expect(await k.peekAt<boolean>('stripHidden')).toBe(false)
    expect(JSON.stringify(await ui.drawn())).toContain(TITLE)
    await ui.unmount()
    await k.hud({ done: 'ok' })
    await k.turn()
  }
})

test("a subagent's calls never start a run", LONG, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.say(PROMPT)
  await k.bash(20, { agentId: 'a1' })
  await clock.advance(AUTO_MS * 2)
  await k.bash(5, { agentId: 'a2' })
  expect(await k.run()).toBeNull()
})

test('it never finishes on its own', LONG, async ($, on) => {
  const clock = beneath(on, () => ['desktop'])
  const k = kit($)
  await k.start() // the 1-second clock, ticking through all of it
  await k.say(PROMPT)
  // 24 calls after the start: the run is provisional, so Claude is told once and never checked on
  const said = await k.bash(AUTO_CALLS * 4)
  expect(said.filter(Boolean).map(c => c!.join('\n'))).toEqual([autoNote(TITLE)])
  // adopted by a title, it is checked as Claude's own: past both HUD checks (12, then 24 more as the first goes unanswered)
  await k.hud({ title: 'Migrate auth tables' })
  const checks = await k.bash(12 + 24)
  expect(checks.filter(c => c?.join('\n').includes('HUD check:')).length).toBe(2)
  await k.call({ tool: 'Bash', command: 'npm test', answer: { result: 'boom', isError: true } })
  await k.turn()
  await k.notify('b1', 'failed')
  await clock.advance(2 * PAUSE_MS) // an hour idle, second by second
  expect((await k.run())!.status).toBe('paused') // the clock acted, and paused it: no finish
  await k.say('anything else?')
  await k.turn()
  const r = (await k.run())!
  expect(['done', 'failed']).not.toContain(r.status)
  expect([r.endedAt, r.summary]).toEqual([undefined, undefined])
})
