import type { Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'
import type { HudRun } from '../types'
import { boundary, life, STALE } from './lifecycle'
import { shows } from './notes'
import { intoRun, mirror, type PlanItem } from './plan'
import { apply } from './run'
import { dashboard, describe, stepNow, strip } from './svg'

// The plan mirror: the main loop's task-list calls become an observer-owned checklist
// with the id `plan`. Built against the tool types; no session of this repo has had the tool, so nothing here proves it
// in the app.

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: `${content}ing` })
const item = (id: string, label: string, state: PlanItem['state']): PlanItem => ({ id, label, state })

test('each task-list tool becomes items: TodoWrite replaces, TaskCreate appends, TaskUpdate changes, TaskList replaces', () => {
  const written = mirror([], 'TodoWrite', { todos: [todo('Read', 'completed'), todo('Write', 'in_progress'), todo('Ship', 'pending')] }, undefined)
  expect(written).toEqual([item('0', 'Read', 'done'), item('1', 'Write', 'now'), item('2', 'Ship', 'todo')])
  // a new list replaces the old whole
  expect(mirror(written!, 'TodoWrite', { todos: [todo('Only', 'pending')] }, undefined)).toEqual([item('0', 'Only', 'todo')])
  expect(mirror(written!, 'TodoWrite', { todos: [] }, undefined)).toEqual([])

  const created = mirror(written!, 'TaskCreate', { subject: 'Review', description: 'look' }, { task: { id: 'a1', subject: 'Review' } })
  expect(created).toEqual([...written!, item('a1', 'Review', 'todo')])
  expect(mirror(created!, 'TaskCreate', { subject: 'Review again', description: '' }, { task: { id: 'a1', subject: 'Review again' } })?.filter(i => i.id === 'a1')).toEqual([item('a1', 'Review again', 'todo')]) // one item to an id

  expect(mirror(created!, 'TaskUpdate', { taskId: 'a1', status: 'in_progress' }, { success: true, taskId: 'a1', updatedFields: ['status'] })?.at(-1)).toEqual(item('a1', 'Review', 'now'))
  expect(mirror(created!, 'TaskUpdate', { taskId: 'a1', status: 'completed', subject: 'Reviewed' }, { success: true })?.at(-1)).toEqual(item('a1', 'Reviewed', 'done'))
  expect(mirror(created!, 'TaskUpdate', { taskId: 'a1', subject: 'Renamed' }, { success: true })?.at(-1)).toEqual(item('a1', 'Renamed', 'todo')) // a rename keeps the state
  expect(mirror(created!, 'TaskUpdate', { taskId: 'a1', status: 'deleted' }, { success: true })).toEqual(written)

  const listed = mirror(written!, 'TaskList', {}, { tasks: [{ id: '1', subject: 'One', status: 'completed', blockedBy: [] }, { id: '2', subject: 'Two', status: 'in_progress', blockedBy: [] }, { id: '3', subject: 'Three', status: 'pending', blockedBy: [] }] })
  expect(listed).toEqual([item('1', 'One', 'done'), item('2', 'Two', 'now'), item('3', 'Three', 'todo')])
})

test('anything else, or a call that names nothing held, mirrors nothing; junk is ignored without a throw', () => {
  const held = [item('1', 'One', 'todo')]
  expect(mirror(held, 'Bash', { command: 'ls' }, 'ok')).toBeUndefined()
  expect(mirror(held, 'TaskStop', { task_id: '1' }, {})).toBeUndefined() // a background shell, not the list
  expect(mirror(held, 'TaskUpdate', { taskId: 'nope', status: 'completed' }, { success: true })).toBeUndefined() // an item it never held
  expect(mirror(held, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: false, error: 'blocked' })).toBeUndefined() // a refused update
  expect(mirror(held, 'TaskCreate', { subject: 'x', description: '' }, 'created')).toBeUndefined() // no id to follow
  expect(mirror(held, 'TaskList', {}, { tasks: 'none' })).toBeUndefined()
  expect(mirror(held, 'TodoWrite', {}, undefined)).toBeUndefined() // no list sent
  // a list that arrives as JSON text, a state it doesn't know, a bad row
  expect(mirror([], 'TodoWrite', { todos: JSON.stringify([todo('A', 'pending')]) }, undefined)).toEqual([item('0', 'A', 'todo')])
  expect(mirror([], 'TodoWrite', { todos: [{ content: 'A', status: 'constructor' }, 7, null, { content: 5 }, todo('B', 'completed')] }, undefined)).toEqual([item('0', 'A', 'todo'), item('4', 'B', 'done')])
  expect(mirror(held, 'TaskUpdate', { taskId: '1', status: 'constructor' }, { success: true })).toEqual(held) // an unknown state changes nothing
})

test('labels lose markdown and control characters, and are cut at 40', () => {
  const long = 'Run the whole suite and then fix every failure in the new module before moving on'
  const [a, b, c] = mirror([], 'TodoWrite', { todos: [todo('Fix **the** `build`', 'pending'), todo('line\none\u001b[31m', 'pending'), todo(long, 'pending')] }, undefined)!
  expect([a!.label, b!.label]).toEqual(['Fix the build', 'line one [31m'])
  expect(c!.label.length).toBeLessThanOrEqual(40)
  expect(c!.label.endsWith('…')).toBe(true)
  expect(long.startsWith(c!.label.slice(0, -1))).toBe(true)
})

const items = [item('0', 'Read the issue', 'done'), item('1', 'Write the tests', 'now'), item('2', 'Ship it', 'todo')]
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1])

test('the mirror leads the dashboard and gives progress done ÷ total when Claude sent none', () => {
  const r = intoRun(apply(null, { start: 'Mirror' }, 0), items, 5000)
  expect(r.widgets).toEqual([{ id: 'plan', type: 'checklist', title: 'Plan', items: [{ label: 'Read the issue', state: 'done' }, { label: 'Write the tests', state: 'now' }, { label: 'Ship it', state: 'todo' }], by: 'observer', at: 5000, tick: 0 }])
  expect(r.progress).toEqual({ n: 1, total: 3, label: 'steps' })
  expect(r.progressBy).toBe('observer')
  expect(stepNow(r)).toEqual({ name: 'Write the tests', key: 'plan' })
  // the dashboard leads with the plan, and the strip draws it with the step in hand
  const board = texts(dashboard(r, 480).source)
  expect(board).toContain('Plan')
  expect(board).toContain('Write the tests')
  expect(texts(strip(r, 860).source)).toContain('Write the tests')
  expect(strip(r, 860).shown).toContain('plan')
  expect(describe(r)).toContain('Plan: 1 of 3 done, now Write the tests')
  // the clock is the run's: stamped with its ticks, and an update returns it to fresh
  const later = intoRun({ ...r, ticks: 30 }, [...items, item('3', 'More', 'todo')], 9000)
  expect(later.widgets[0]).toMatchObject({ by: 'observer', at: 9000, tick: 30 })
  expect(later.progress).toEqual({ n: 1, total: 4, label: 'steps' })
  // the list emptied: the plan and its progress go
  const none = intoRun(later, [], 9500)
  expect([none.widgets, none.progress, none.progressBy]).toEqual([[], undefined, undefined])
})

test("Claude's own phases lead and the mirror hides", () => {
  let r = apply(apply(null, { start: 'Mirror', phase: { name: 'Build', state: 'now' } }, 0), { phase: { name: 'Test', state: 'todo' } }, 0)
  r = intoRun(r, items, 5000)
  expect(r.widgets.map(w => w.id)).toEqual(['plan']) // kept
  expect([r.progress, r.progressBy]).toEqual([undefined, undefined]) // and its done ÷ total with it: two plans' counts would read as one
  expect(stepNow(r)).toEqual({ name: 'Build', key: 'phases' })
  expect(texts(dashboard(r, 480).source)).not.toContain('Write the tests')
  expect(strip(r, 860).shown).not.toContain('plan')
  expect(texts(strip(r, 860).source)).not.toContain('Write the tests')
  expect(describe(r)).not.toContain('Write the tests')
  expect(strip({ ...r, strip: ['plan', 'phases'] }, 860).shown).toEqual(['phases']) // not even when the strip names it
  // so does a checklist of Claude's, whatever its id
  const own = apply(intoRun(apply(null, { start: 'Mirror' }, 0), items, 1), { widget: { id: 'checks', type: 'checklist', title: 'Checks', items: [{ label: 'types', state: 'now' }, { label: 'lint', state: 'todo' }] } }, 2)
  expect(own.widgets.map(w => w.id)).toEqual(['plan', 'checks'])
  expect([own.progress, own.progressBy]).toEqual([undefined, undefined]) // the figure goes the moment Claude's checklist comes
  expect(stepNow(own)).toEqual({ name: 'types', key: 'checks' })
  expect(texts(dashboard(own, 480).source)).not.toContain('Write the tests')
  expect(strip(own, 860).shown).not.toContain('plan')
  // and a list sent while Claude's checklist leads brings no figure either
  expect(intoRun(own, [...items, item('3', 'More', 'todo')], 3).progress).toBeUndefined()
  // it comes back when Claude's lead goes
  const back = apply(own, { remove: ['checks'] }, 4)
  expect([back.progress, back.progressBy]).toEqual([{ n: 1, total: 3, label: 'steps' }, 'observer'])
  expect(stepNow(back)).toEqual({ name: 'Write the tests', key: 'plan' })
  expect(strip(back, 860).shown).toContain('plan')
  // and a plan of Claude's under the same id is Claude's: the mirror leaves it alone
  const claudes = apply(null, { start: 'Mine', widget: { id: 'plan', type: 'checklist', items: [{ label: 'Mine', state: 'now' }] } }, 0)
  expect(intoRun(claudes, items, 5000)).toBe(claudes)
})

test("Claude's progress wins over the mirror's, whichever came first", () => {
  // Claude's progress first: the mirror leaves it, and hides
  let r = apply(null, { start: 'Mirror', progress: '3/12', progress_label: 'hosts' }, 0)
  r = intoRun(r, items, 5000)
  expect(r.progress).toEqual({ n: 3, total: 12, label: 'hosts' })
  expect(r.progressBy).toBeUndefined()
  expect(stepNow(r)).toBeUndefined()
  expect(strip(r, 860).shown).not.toContain('plan')
  // the mirror's first: Claude's replaces it, and the mirror does not take it back
  r = intoRun(apply(null, { start: 'Mirror' }, 0), items, 5000)
  expect(r.progress).toEqual({ n: 1, total: 3, label: 'steps' })
  r = apply(r, { progress: '4/5' }, 6000)
  expect([r.progress, r.progressBy]).toEqual([{ n: 4, total: 5, label: undefined }, undefined])
  r = intoRun(r, [...items, item('3', 'More', 'todo')], 7000)
  expect(r.progress).toEqual({ n: 4, total: 5, label: undefined })
})

test("the mirror's progress comes back when Claude's checklist retires", () => {
  // Claude's checklist, stale across two boundaries, leaves the board; the mirror, fresh, leads again with its figure
  let r = apply(intoRun(apply(null, { start: 'Mirror' }, 0), items, 1), { widget: { id: 'checks', type: 'checklist', items: [{ label: 'types', state: 'now' }] } }, 2)
  expect(r.progress).toBeUndefined()
  r = { ...r, ticks: STALE, widgets: r.widgets.map(w => (w.id === 'plan' ? { ...w, tick: STALE } : w)) } // the plan just changed; Claude's did not
  r = boundary(boundary(r, 3), 4)
  expect(r.widgets.map(w => w.id)).toEqual(['plan'])
  expect([r.progress, r.progressBy]).toEqual([{ n: 1, total: 3, label: 'steps' }, 'observer'])
})

test("the mirror's progress goes with the mirror: removed, taken over, rebuilt or retired", () => {
  const mirrored = () => intoRun(apply(null, { start: 'Mirror' }, 0), items, 1)
  const gone = (r: HudRun) => [r.progress, r.progressBy]
  expect(gone(apply(mirrored(), { remove: ['plan'] }, 2))).toEqual([undefined, undefined])
  expect(gone(apply(mirrored(), { widget: { id: 'plan', type: 'checklist', items: [{ label: 'Mine', state: 'now' }] } }, 2))).toEqual([undefined, undefined])
  expect(gone(apply(mirrored(), { rebuild: true }, 2))).toEqual([undefined, undefined])
  // retired: unchanged for STALE calls, then across two boundaries
  let r: HudRun = { ...mirrored(), ticks: STALE }
  r = boundary(r, 3) // marked stale
  expect(r.widgets.map(w => w.id)).toEqual(['plan'])
  expect(r.progress).toBeDefined()
  r = boundary(r, 4) // second boundary: retired
  expect(r.widgets).toEqual([])
  expect(gone(r)).toEqual([undefined, undefined])
  expect(r.log.at(-1)?.text).toBe('Retired Plan')
})

// ---- through the hooks ------------------------------------------------------------------------------------------

// The run and the held plan as $.state has them, read by an inline plugin (a test's own $ has no state).
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async $ => ({
    text: JSON.stringify({ run: (await $.state.get({ plugin: 'hud', key: 'run' })).value ?? null, plan: (await $.state.get({ plugin: 'hud', key: 'plan' })).value ?? null }),
  }))
}
const PEEK = { plugins: [{ name: 'peek', register: peek }] }

// simplification: loose calls; the kit's overloads over every tool and event are too deep for tsc
type Loose = (i: object) => Promise<{ context?: readonly string[]; text?: string; result?: unknown }>
const kit = ($: Engine) => ({
  hud: (i: object) => ($.tool.call as unknown as Loose)({ tool: 'mcp__hud__hud', ...i }),
  call: (tool: string, i: object = {}) => ($.tool.call as unknown as Loose)({ tool, ...i }),
  state: async () => JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: '' })).text)) as { run: HudRun | null; plan: PlanItem[] | null },
})

test('the task-list calls of the main loop feed the plan: held always, shown in a live run, nothing from a subagent or a failure', PEEK, async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: [] }))
  let answer: unknown = 'done', deny: string | undefined
  on('tool.call', () => (deny ? { deny } : { result: answer }))
  const { hud, call, state } = kit($)
  // with no run, the plan is held, and a run that starts later takes it at the next list call
  await call('TodoWrite', { todos: [todo('Read', 'completed'), todo('Write', 'in_progress')] })
  expect((await state()).plan).toEqual([item('0', 'Read', 'done'), item('1', 'Write', 'now')])
  await hud({ start: 'Mirror' })
  expect((await state()).run?.widgets).toEqual([])
  await call('TodoWrite', { todos: [todo('Read', 'completed'), todo('Write', 'in_progress'), todo('Ship', 'pending')] })
  let { run } = await state()
  expect(run?.widgets[0]).toMatchObject({ id: 'plan', by: 'observer', at: 0, tick: 0 }) // stamped with the run's ticks as the call finishes
  expect(run?.progress).toEqual({ n: 1, total: 3, label: 'steps' })
  // a subagent's list is its own; a failed call changes nothing
  await call('TodoWrite', { agentId: 'a1', todos: [todo('Theirs', 'pending')] })
  deny = 'blocked'
  await call('TodoWrite', { todos: [todo('Denied', 'pending')] })
  deny = undefined
  expect((await state()).plan?.map(i => i.label)).toEqual(['Read', 'Write', 'Ship'])
  expect((await state()).run?.widgets[0]?.items?.map(i => i.label)).toEqual(['Read', 'Write', 'Ship'])
  // the incremental tools, from the tool's own answers
  answer = { task: { id: '9', subject: 'Review' } }
  await call('TodoWrite', { todos: [] })
  await call('TaskCreate', { subject: 'Review', description: 'look' })
  answer = { success: true, taskId: '9', updatedFields: ['status'] }
  await call('TaskUpdate', { taskId: '9', status: 'completed' })
  run = (await state()).run
  expect(run?.widgets[0]?.items).toEqual([{ label: 'Review', state: 'done' }])
  expect(run?.progress).toEqual({ n: 1, total: 1, label: 'steps' })
  // a run that is over takes no more
  await hud({ done: 'shipped' })
  await call('TodoWrite', { todos: [todo('Late', 'pending')] })
  expect((await state()).run?.widgets[0]?.items).toEqual([{ label: 'Review', state: 'done' }])
  expect((await state()).plan).toEqual([item('0', 'Late', 'todo')])
})

test('a mirrored plan costs no tokens, and an unchanged one is never named to Claude as a stale widget of its own', PEEK, async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  const { hud, call, state } = kit($)
  await hud({ start: 'Mirror', widget: { id: 'loss', type: 'line', points: [1, 2] } })
  const said: (readonly string[] | undefined)[] = []
  said.push((await call('TodoWrite', { todos: [todo('Read', 'in_progress')] })).context)
  // the general check at 12 calls goes unanswered, so the pointed one comes 24 calls on, at 36
  for (let n = 0; n < STALE + 12; n++) said.push((await call('Bash', { command: 'true' })).context)
  // the only widget named is Claude's loss; the plan is not Claude's to update
  const notes = said.flatMap(s => s ?? [])
  expect(notes.some(n => n.includes('your loss line'))).toBe(true)
  expect(notes.some(n => n.includes('plan'))).toBe(false)
  expect(said[0]).toBeUndefined()
  // it ages as any widget does: stale by now, and dim, only never Claude's to be told about
  const r = (await state()).run!
  expect(r.widgets.map(w => w.id)).toEqual(['loss', 'plan'])
  expect(life(r.widgets[1]!, r)).toBe('stale')
})

test("through the hooks the mirror's figure shows only while the plan leads", PEEK, async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'done' }))
  const { hud, call, state } = kit($)
  const figure = async () => (await state()).run?.progress
  await hud({ start: 'Mirror', widget: { id: 'checks', type: 'checklist', items: [{ label: 'types', state: 'now' }] } })
  await call('TodoWrite', { todos: [todo('Read', 'completed'), todo('Write', 'in_progress')] })
  expect(await figure()).toBeUndefined() // Claude's checklist leads
  await hud({ remove: ['checks'] })
  expect(await figure()).toEqual({ n: 1, total: 2, label: 'steps' }) // it goes, and the plan leads with its figure
  await hud({ phase: { name: 'Build', state: 'now' } })
  expect(await figure()).toBeUndefined() // Claude's phase leads
  await call('TodoWrite', { todos: [todo('Read', 'completed'), todo('Write', 'completed')] })
  expect(await figure()).toBeUndefined()
  await hud({ rebuild: true }) // the layout goes with the plan
  expect((await state()).run?.widgets).toEqual([])
})

test('no note to Claude names the mirror: not its figure, not its widget, in the HUD check or beside a message', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  const { hud, call } = kit($)
  const submit = () => ($.prompt.submit as unknown as Loose)({ text: 'go on', wait: false, origin: { kind: 'composer' } })
  // the mirror leads (Claude sent a stat and nothing that leads), with its figure
  await hud({ start: 'Ship it', widget: { id: 'loss', type: 'stat', value: 3 } })
  await call('TodoWrite', { todos: [todo('Read', 'completed'), todo('Write', 'in_progress')] })
  const notes = [(await submit()).context?.join('\n') ?? '']
  for (let n = 0; n < 11; n++) notes.push((await call('Bash', { command: 'true' })).context?.join('\n') ?? '')
  const all = notes.join('\n')
  expect(all).toContain('Focus ids: claude/loss.') // what Claude sent, still named (the steer names it by id)
  expect(all).toContain('HUD check: 12 tool calls')
  expect(all).not.toMatch(/plan|steps|progress/)
  // and with a progress of Claude's, its own is told and the mirror's is not
  expect(shows(intoRun(apply(null, { start: 'p', progress: '3/12', progress_label: 'hosts' }, 0), items, 1))).toBe('progress 3/12 hosts')
  expect(shows(intoRun(apply(null, { start: 'p', set: { rps: 5 } }, 0), items, 1))).toBe('stats rps')
})

// ---- both surfaces ----------------------------------------------------------------------------------------------

type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (n: unknown): Node[] => (typeof n === 'object' && n !== null ? [n as Node, ...((n as Node).children ?? []).flatMap(nodes)] : [])
const text = (n: unknown): string => (typeof n === 'string' ? n : typeof n === 'object' && n !== null ? ((n as Node).children ?? []).map(text).join('') : '')
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }

test("a TodoWrite call during a live run shows the plan in the strip and the band's step", async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  on('ui.panes', () => ({ value: [] }))
  const { hud, call } = kit($)
  const mount = (surface: string, component: string, props: object) =>
    ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component, ...(component === 'Pane' ? { requestId: 'hud' } : {}), props })
  for (const surface of ['terminal', 'desktop'] as const) {
    await hud({ start: `Mirror on ${surface}` })
    await call('TodoWrite', { todos: [todo('Read the issue', 'completed'), todo('Write the tests', 'in_progress'), todo('Ship it', 'pending')] })
    const ui = await mount(surface, 'AbovePrompt', band)
    const all = nodes(await ui.drawn())
    if (surface === 'terminal') {
      // no graphic here: the header says the progress in words, and a line under it says the plan and its step, as the
      // strip's item does (so the header leaves the step out, as the desktop's does when the strip draws it)
      const words = all.map(text).join(' ')
      expect(words).toMatch(/1\/3 steps/)
      expect(words).toMatch(/Plan: 1 of 3\s+▸ Write the tests/)
      expect(words).not.toMatch(/·\s+▸ Write the tests/) // not also a fact of the header
    } else {
      const svg = String(all.find(n => n.type === 'Svg')?.props?.source)
      expect(texts(svg)).toEqual(expect.arrayContaining(['Plan', 'Write the tests', '1 of 3']))
      expect(String(all.find(n => n.type === 'Svg')?.props?.alt)).toContain('Plan: 1 of 3 done, now Write the tests')
    }
    await ui.unmount()
    // the dashboard shows the plan too
    const dash = await mount(surface, 'Pane', pane)
    const drawn = nodes(await dash.drawn())
    const dashText = surface === 'terminal' ? drawn.map(text).join(' ') : texts(String(drawn.find(n => n.type === 'Svg')?.props?.source)).join(' ')
    expect(dashText).toContain('Write the tests')
    await dash.unmount()
    // Claude's own phase takes the lead: the mirror is kept and no longer drawn, on either surface
    await hud({ phase: { name: 'Build', state: 'now' } })
    const led = await mount(surface, 'Pane', pane)
    const ledNodes = nodes(await led.drawn())
    const ledText = surface === 'terminal' ? ledNodes.map(text).join(' ') : texts(String(ledNodes.find(n => n.type === 'Svg')?.props?.source)).join(' ')
    expect(ledText).not.toContain('Write the tests')
    await led.unmount()
  }
})
