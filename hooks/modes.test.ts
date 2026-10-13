import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'
import { MODES } from './modes'
import { NO_PREFS, prefsCommand, prefsOf } from './prefs'
import { DESCRIPTION, SCHEMA } from './tool'

// Another plugin's slot (deploys/prod), the HUD's own (hud/context, from the meter) and Claude's widget (claude/p95):
// the three kinds of key a person or Claude may name.
const deploys: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'deploys') return next(e)
    await $.hud.declare({ v: 1, name: 'Deploys', access: 'Reads deploy states.', slots: [{ id: 'prod', pattern: 'stat', title: 'Production' }] })
    await $.hud.push({ v: 1, id: 'prod', pattern: 'stat', title: 'Production', value: 'failed', tone: 'bad', note: 'build 1432 failed 2m ago' })
    return { result: 'ok' }
  })
}
// What the HUD keeps in $.state, read back the way the ranker reads it: /peek <key>
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async ($, e) => {
    const key = (e.args ?? '').trim() // state keys are literals at the call, so each is spelled out
    const got = key === 'mode' ? await $.state.get({ plugin: 'hud', key: 'mode' })
      : key === 'modeByPerson' ? await $.state.get({ plugin: 'hud', key: 'modeByPerson' })
      : key === 'focus' ? await $.state.get({ plugin: 'hud', key: 'focus' })
      : await $.state.get({ plugin: 'hud', key: 'prefs' })
    return { text: JSON.stringify(got.value ?? null) }
  })
}
const plugins = [{ name: 'deploys', register: deploys }, { name: 'peek', register: peek }]

// The store beneath the plugin, recording what the HUD writes.
const store = (on: On, kept: Record<string, unknown> = {}) => {
  on('store.get', ($, e) => ({ value: kept[e.key] }))
  on('store.set', ($, e) => (kept[e.key] = e.value, { value: undefined }))
  return kept
}
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
const mount = ($: Engine, t: object) => ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', ...t })
const command = ($: Engine, name: string, args: string) => ($.command.run as unknown as (i: object) => Promise<{ text: string }>)({ command: name, args }).then(o => o.text)
const hud = ($: Engine, args: string) => command($, 'hud', args)
const state = async ($: Engine, key: string) => JSON.parse(await command($, 'peek', key)) as unknown
const call = ($: Engine, i: object) => ($.tool.call as unknown as (i: object) => Promise<{ result?: unknown }>)(i)
const say = ($: Engine, input: object) => call($, { tool: 'mcp__hud__hud', ...input }).then(r => String(r.result))
const paneText = async ($: Engine, surface: 'terminal' | 'desktop') => {
  const p = await mount($, { surface, component: 'Pane', requestId: 'hud', props: pane })
  const seen = JSON.stringify(await p.drawn())
  await p.unmount()
  return seen
}
// the engine beneath, registered before the test's first call on $
const beneath = (on: On) => {
  mock.clock(on)
  on('ui.panes', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: [] }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
}
// a run with a widget, a plugin's slot and a HUD source's slot, in that key order: deploys/prod, hud/context, claude/p95
const setup = async ($: Engine) => {
  await say($, { start: 'Ship it', widget: { id: 'p95', type: 'stat', value: 212 } })
  await call($, { tool: 'deploys' })
  await ($.session.measure as unknown as (i: object) => Promise<unknown>)({ context: { percent: 87, tokens: 870_000, window: 1_000_000 }, changed: ['context'] })
}
const KEYS = 'deploys/prod, hud/context, claude/p95'

test('the five modes are data: the slots each puts first, in order', async () => {
  // debug puts tests and failing runs first, not context: rank.test.ts's worked example places context by its score in
  // Debug mode
  expect(Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, m.slots]))).toEqual({
    build: ['hud/tests', 'hud/failing', 'hud/edited'],
    debug: ['hud/tests', 'hud/failing'],
    review: ['hud/edited', 'hud/tests'],
    research: ['hud/fetched', 'hud/context'],
    plan: ['hud/plan', 'hud/agents-running', 'hud/agents'],
  })
  expect(Object.values(MODES).map(m => m.label)).toEqual(['Build', 'Debug', 'Review', 'Research', 'Plan'])
})

test('the hud tool offers mode and focus, with their vocabulary in the property descriptions and the description still in budget', async () => {
  const props = SCHEMA.properties as unknown as Record<string, { enum?: string[]; type?: string; items?: object; description?: string }>
  expect(props.mode?.enum).toEqual(['build', 'debug', 'review', 'research', 'plan'])
  for (const m of ['build', 'debug', 'review', 'research', 'plan']) expect(props.mode?.description).toContain(`${m}: `)
  expect(props.mode?.description).toContain('/hud mode')
  expect(props.focus).toMatchObject({ type: 'array', items: { type: 'string' } })
  for (const words of ['Up to 3', 'hud/tests', 'claude/<widget id>', '<plugin>/<id>', 'phase boundary']) expect(props.focus?.description).toContain(words)
  // the tool's own text didn't grow for them: 2,048 characters reach the model in the desktop app
  expect(DESCRIPTION.length).toBeLessThanOrEqual(2048)
  expect(DESCRIPTION).not.toContain('focus')
})

test('/hud mode lists the five and the current one; a name switches for the session; /hud and the pane say which', { plugins }, async ($, on) => {
  store(on)
  beneath(on)
  await setup($)
  expect(await state($, 'mode')).toBeNull() // nothing written until someone sets one: the ranker reads absent as build
  const list = await hud($, 'mode')
  expect(list).toContain('Mode: Build')
  for (const m of ['build', 'debug', 'review', 'research', 'plan']) expect(list).toContain(`\n  ${m}: `)
  expect(list).toContain('/hud mode <name>')
  expect(await hud($, 'mode Debug')).toBe("Mode is Debug for this session; Claude's mode no longer applies.")
  expect(await state($, 'mode')).toBe('debug')
  expect(await hud($, 'mode')).toContain('Mode: Debug (set by you)')
  expect(await hud($, 'mode nonsense')).toBe('No mode "nonsense". Name one of: build, debug, review, research, plan.')
  expect(await state($, 'mode')).toBe('debug')
  // both surfaces: /hud itself, and the pane on terminal and desktop
  expect(await hud($, '')).toContain('Mode: Debug (set by you)')
  for (const surface of ['terminal', 'desktop'] as const) expect(await paneText($, surface)).toContain('Mode: Debug (set by you)')
})

test('/hud shows the mode with no run live, on both surfaces\' panes too', { plugins }, async ($, on) => {
  store(on)
  beneath(on)
  expect(await hud($, '')).toBe('No HUD yet. Claude starts one for a long task, or ask for one.\nMode: Build')
  await hud($, 'mode review')
  expect(await hud($, '')).toContain('Mode: Review (set by you)')
  for (const surface of ['terminal', 'desktop'] as const) expect(await paneText($, surface)).toContain('Mode: Review (set by you)')
})

test("Claude's mode applies until the person sets one; the person's holds for the session", { plugins }, async ($, on) => {
  store(on)
  beneath(on)
  await setup($)
  expect(await say($, { mode: 'review' })).toBe('ok')
  expect(await state($, 'mode')).toBe('review')
  expect(await hud($, 'mode')).toContain("Mode: Review (Claude's pick)")
  expect(await say($, { mode: 'debug' })).toBe('ok')
  expect(await state($, 'mode')).toBe('debug')
  // the person's word beats Claude's, and Claude is told so it stops sending it
  await hud($, 'mode research')
  expect(await state($, 'mode')).toBe('research')
  expect(await say($, { mode: 'plan' })).toBe('ok\nmode: the person chose Research, so yours was not applied')
  expect(await state($, 'mode')).toBe('research')
  // the person may change their mind
  await hud($, 'mode plan')
  expect(await state($, 'mode')).toBe('plan')
  // a mode Claude sends that is no mode is named back, and nothing changes
  expect((await say($, { mode: 'turbo' }))).toBe('ok\nmode: unknown "turbo" (modes: build, debug, review, research, plan)')
  expect(await state($, 'mode')).toBe('plan')
})

test("Claude's own mode and focus are for the task: a new run clears them, never the person's mode", { plugins }, async ($, on) => {
  store(on)
  beneath(on)
  await setup($)
  await say($, { mode: 'debug', focus: ['deploys/prod'] })
  expect([await state($, 'mode'), await state($, 'focus')]).toEqual(['debug', ['deploys/prod']])
  await say($, { start: 'Next task' })
  expect([await state($, 'mode'), await state($, 'focus')]).toEqual(['build', []])
  // a start that carries them sets them after the clearing
  await say($, { start: 'Third', mode: 'review', focus: ['hud/context'] })
  expect([await state($, 'mode'), await state($, 'focus')]).toEqual(['review', ['hud/context']])
  await hud($, 'mode plan')
  await say($, { start: 'Fourth' })
  expect([await state($, 'mode'), await state($, 'focus')]).toEqual(['plan', []])
})

test('focus: up to 3 keys kept as sent; an id the HUD does not hold is named back, with the known ones', { plugins }, async ($, on) => {
  store(on)
  beneath(on)
  await setup($)
  expect(await state($, 'focus')).toBeNull()
  expect(await say($, { focus: ['hud/context', 'claude/p95'] })).toBe('ok')
  expect(await state($, 'focus')).toEqual(['hud/context', 'claude/p95'])
  // the answer names ids only: no value or note of a slot reaches Claude
  const answer = await say($, { focus: ['deploys/prod', 'hud/x', 'claude/p95'] })
  expect(answer).toBe(`ok\nfocus: unknown hud/x (known: ${KEYS})`)
  expect(answer).not.toContain('build 1432')
  expect(answer).not.toContain('failed')
  // kept anyway: a slot the HUD's own source has not raised yet may come
  expect(await state($, 'focus')).toEqual(['deploys/prod', 'hud/x', 'claude/p95'])
  // more than 3: the first 3 count, and Claude is told
  expect(await say($, { focus: ['hud/context', 'claude/p95', 'deploys/prod', 'hud/tests'] })).toBe('ok\nfocus: only 3 count; kept hud/context, claude/p95, deploys/prod')
  expect(await state($, 'focus')).toEqual(['hud/context', 'claude/p95', 'deploys/prod'])
  // JSON text, junk and repeats: the usable ids apply
  expect(await say($, { focus: '["deploys/prod", 7, "", "deploys/prod"]' })).toBe('ok')
  expect(await state($, 'focus')).toEqual(['deploys/prod'])
  // an empty list clears it; a call without the field leaves it
  await say($, { log: 'x' })
  expect(await state($, 'focus')).toEqual(['deploys/prod'])
  expect(await say($, { focus: [] })).toBe('ok')
  expect(await state($, 'focus')).toEqual([])
  // beside a text over the strip's budget, both notes arrive
  const both = await say($, { goal: 'g'.repeat(80), focus: ['hud/x'] })
  expect(both.split('\n')).toEqual([expect.stringContaining('the strip cuts goal'), expect.stringContaining('focus: unknown hud/x')])
})

test("the plan mirror is known as hud/plan (the observer's), Claude's own widget as claude/<id>", { plugins }, async ($, on) => {
  store(on)
  beneath(on)
  on('tool.call', () => ({ result: 'done' }))
  await setup($)
  await call($, { tool: 'TodoWrite', todos: [{ content: 'Mirror step', status: 'in_progress', activeForm: 'x' }] })
  expect(await say($, { focus: ['hud/plan', 'claude/plan', 'claude/p95'] })).toBe(`ok\nfocus: unknown claude/plan (known: ${KEYS}, hud/plan)`)
})

test('/hud pin, unpin, hide and unhide: one sentence each, kept in the store and mirrored in state', { plugins }, async ($, on) => {
  const kept = store(on)
  beneath(on)
  await setup($)
  expect(await state($, 'prefs')).toBeNull()
  expect(await hud($, 'pin hud/context')).toBe('Pinned hud/context: it stays first.')
  expect(await hud($, 'pin deploys/prod')).toBe('Pinned deploys/prod: it stays first.')
  expect(await state($, 'prefs')).toEqual({ pinned: ['hud/context', 'deploys/prod'], hidden: [] }) // in pin order
  expect(kept.prefs).toEqual({ pinned: ['hud/context', 'deploys/prod'], hidden: [] })
  expect(await hud($, 'pin hud/context')).toBe('hud/context is already pinned.')
  expect(await hud($, 'unpin hud/context')).toBe('Unpinned hud/context.')
  expect(await hud($, 'unpin hud/context')).toBe("hud/context isn't pinned.")
  expect(await hud($, 'hide claude/p95')).toBe('Hid claude/p95: /hud unhide claude/p95 brings it back.')
  expect(await hud($, 'hide claude/p95')).toBe('claude/p95 is already hidden.')
  expect(kept.prefs).toEqual({ pinned: ['deploys/prod'], hidden: ['claude/p95'] })
  expect(await hud($, 'unhide claude/p95')).toBe('claude/p95 is shown again.')
  expect(await hud($, 'unhide claude/p95')).toBe("claude/p95 isn't hidden.")
  // a slot is pinned or hidden, never both: the later word wins
  expect(await hud($, 'hide deploys/prod')).toBe('Hid deploys/prod (it was pinned): /hud unhide deploys/prod brings it back.')
  expect(await state($, 'prefs')).toEqual({ pinned: [], hidden: ['deploys/prod'] })
  expect(await hud($, 'pin deploys/prod')).toBe('Pinned deploys/prod: it stays first, and is no longer hidden.')
  expect(await state($, 'prefs')).toEqual({ pinned: ['deploys/prod'], hidden: [] })
  // a key typed in another case finds the slot
  expect(await hud($, 'hide HUD/Context')).toBe('Hid hud/context: /hud unhide hud/context brings it back.')
})

test('an unknown key is answered with the known ones, and changes nothing; a key that has gone can still be unpinned', { plugins }, async ($, on) => {
  const kept = store(on)
  beneath(on)
  await setup($)
  for (const sub of ['pin', 'hide']) {
    expect(await hud($, `${sub} hud/nope`)).toBe(`No slot "hud/nope". Name one of: ${KEYS}.`)
    expect(await hud($, sub)).toBe(`Name a slot to ${sub}: ${KEYS}.`)
  }
  expect(await hud($, 'unpin hud/nope')).toBe("hud/nope isn't pinned.")
  expect(kept.prefs).toBeUndefined()
  expect(await state($, 'prefs')).toBeNull()
  // pinned, then the run's widget goes (a rebuild clears the layout): it is no longer known, and still comes off
  await hud($, 'pin claude/p95')
  await say($, { rebuild: true })
  expect(await hud($, 'pin claude/p95')).toContain('No slot "claude/p95"')
  expect(await hud($, 'unpin claude/p95')).toBe('Unpinned claude/p95.')
  expect(kept.prefs).toEqual({ pinned: [], hidden: [] })
})

test('/hud and the pane list what is pinned and hidden, on both surfaces', { plugins }, async ($, on) => {
  store(on)
  beneath(on)
  await setup($)
  await hud($, 'pin hud/context')
  await hud($, 'pin deploys/prod')
  await hud($, 'hide claude/p95')
  const said = await hud($, '')
  expect(said).toContain('Mode: Build')
  expect(said).toContain('Pinned: hud/context, deploys/prod')
  expect(said).toContain('Hidden: claude/p95')
  for (const surface of ['terminal', 'desktop'] as const) {
    const seen = await paneText($, surface)
    expect(seen).toContain('Pinned: hud/context, deploys/prod')
    expect(seen).toContain('Hidden: claude/p95')
    expect(seen).toContain('/hud pin')
  }
})

test("pins and hides kept in an earlier session apply from the start; a store that holds junk or can't be read leaves none", { plugins }, async ($, on) => {
  store(on, { prefs: { pinned: ['deploys/prod', 7], hidden: ['hud/cost'], extra: 1 } })
  beneath(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  await ($.session.start as unknown as (i: object) => Promise<unknown>)({ cwd: '/', surface: null, isInteractive: false })
  expect(await state($, 'prefs')).toEqual({ pinned: ['deploys/prod'], hidden: ['hud/cost'] })
  expect(await hud($, '')).toContain('Pinned: deploys/prod')
})

test("a store that can't be read leaves none pinned or hidden", { plugins }, async ($, on) => {
  on('store.get', () => { throw new Error('no store') })
  on('store.set', () => ({ value: undefined }))
  beneath(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  await ($.session.start as unknown as (i: object) => Promise<unknown>)({ cwd: '/', surface: null, isInteractive: false })
  expect(await hud($, 'mode')).toContain('Mode: Build')
  expect(await state($, 'prefs')).toBeNull()
})

test("a subagent's mode and focus change nothing", { plugins }, async ($, on) => {
  store(on)
  beneath(on)
  await setup($)
  const r = await call($, { tool: 'mcp__hud__hud', agentId: 'sub-1', mode: 'debug', focus: ['hud/context'] })
  expect(r.result).toBe('The HUD shows the main conversation only; this call changed nothing.')
  expect([await state($, 'mode'), await state($, 'focus')]).toEqual([null, null])
})

test('the pure parts: junk from the store, keys cut to a list, nothing held to pin', async () => {
  expect(prefsOf({ pinned: ['a', 'a', 7, ''], hidden: ['a', 'b'], extra: 1 })).toEqual({ pinned: ['a'], hidden: ['b'] })
  for (const junk of [null, 7, 'x', [], { pinned: 'a' }]) expect(prefsOf(junk)).toEqual({ pinned: [], hidden: [] })
  expect(prefsCommand(NO_PREFS, 'pin', 'a', []).text).toBe('No slots to pin yet.')
  const many = Array.from({ length: 25 }, (_, i) => `p/s${i}`)
  expect(prefsCommand(NO_PREFS, 'hide', 'nope', many).text).toBe(`No slot "nope". Name one of: ${many.slice(0, 20).join(', ')}, ….`)
  expect(prefsCommand(NO_PREFS, 'unpin', '', []).text).toBe('Nothing is pinned.')
  expect(prefsCommand({ pinned: ['a/b'], hidden: [] }, 'unpin', '', []).text).toBe('Name one to unpin: a/b.')
  // nothing is changed in place
  const held = { pinned: ['a/b'], hidden: [] }
  prefsCommand(held, 'hide', 'a/b', ['a/b'])
  expect(held).toEqual({ pinned: ['a/b'], hidden: [] })
})
