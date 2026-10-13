import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

import type { HudHeld } from '../types'
import { apply } from './run'
import { strip } from './svg'
import { urgentFor, urgentNow, type Urgent } from './urgency'

// Slots as the HUD holds them, the HUD's own and another plugin's.
const slot = (from: string, s: Pick<HudHeld, 'id' | 'pattern' | 'title'> & Partial<HudHeld>): HudHeld => ({ v: 1, from, at: 0, ...s })
const LIMITS = slot('hud', { id: 'limits', pattern: 'meter', title: '5-hour limit', value: 88, max: 100, unit: '%', tone: 'bad', note: '88% used; resets in 40m' })
const FAILING = slot('hud', { id: 'failing', pattern: 'list', title: 'Failing runs', tone: 'bad', items: [{ label: 'npm test', value: 3, state: 'failed' }, { label: 'tsc', value: 1, state: 'failed' }] })
const TESTS = slot('hud', { id: 'tests', pattern: 'stat', title: 'Tests', value: 2, unit: 'failed', tone: 'bad', delta: 2, points: [0, 2] })
const CONTEXT = slot('hud', { id: 'context', pattern: 'ring', title: 'Context', value: 87, max: 100, unit: '%', tone: 'bad', note: '870k of 1M tokens; compaction is near' })
// the same slots once their rules stopped holding, as their sources then say them
const GREEN = slot('hud', { id: 'tests', pattern: 'stat', title: 'Tests', value: 0, unit: 'failed', tone: 'good', delta: -2, points: [0, 2, 0], note: 'npm test: 41 passed, 0 failed' })
const CALM = slot('hud', { id: 'context', pattern: 'ring', title: 'Context', value: 60, max: 100, unit: '%', note: '600k of 1M tokens' })
const LOW = slot('hud', { id: 'limits', pattern: 'meter', title: '5-hour limit', value: 50, max: 100, unit: '%', note: '50% used; resets in 40m' })
const rule = (...held: HudHeld[]) => urgentNow(held, undefined, 0)?.rule

test('each rule fires, in its own words', () => {
  expect(urgentNow([LIMITS], undefined, 0)).toEqual({ key: 'hud/limits', rule: 'U1', says: '5-hour limit 88%; resets in 40m', since: 0 })
  expect(urgentNow([FAILING], undefined, 0)).toEqual({ key: 'hud/failing', rule: 'U2', says: 'npm test failed 3 times in a row', since: 0 })
  expect(urgentNow([TESTS], undefined, 0)).toEqual({ key: 'hud/tests', rule: 'U3', says: 'Tests: 2 failed (were passing)', since: 0 })
  expect(urgentNow([CONTEXT], undefined, 0)).toEqual({ key: 'hud/context', rule: 'U4', says: 'Context 87%; compaction is near', since: 0 })
  // the window's name and reset come from the slot: a weekly limit, and one with no reset to give
  expect(urgentNow([{ ...LIMITS, title: 'Weekly limit', value: 91, note: '91% used; resets in 2h 5m' }], undefined, 4)?.says).toBe('Weekly limit 91%; resets in 2h 5m')
  expect(urgentNow([{ ...LIMITS, note: '88% used' }], undefined, 4)?.says).toBe('5-hour limit 88%')
  // a rule says what began it: the count of boundaries then
  expect(urgentNow([CONTEXT], undefined, 4)?.since).toBe(4)
})

test('a rule needs its threshold: 85%, three in a row, a pass that turned to a fail', () => {
  expect(rule({ ...LIMITS, value: 84 })).toBeUndefined()
  expect(rule({ ...LIMITS, value: 85 })).toBe('U1')
  expect(rule({ ...FAILING, items: [{ label: 'npm test', value: 2, state: 'failed' }] })).toBeUndefined()
  expect(rule({ ...FAILING, items: [{ label: 'npm test', value: 3, state: 'failed' }] })).toBe('U2')
  expect(rule({ ...FAILING, items: [] })).toBeUndefined()
  expect(rule({ ...CONTEXT, value: 84 })).toBeUndefined()
  expect(rule({ ...CONTEXT, value: 85 })).toBe('U4')
  // tests: failing now, and it was passing before
  expect(rule({ ...TESTS, points: [1, 2] })).toBeUndefined() // was failing already
  expect(rule({ ...TESTS, points: [0, 0, 2] })).toBe('U3')
  expect(rule({ ...TESTS, points: [2, 0, 2] })).toBe('U3') // passing in between
  expect(rule({ ...TESTS, points: undefined })).toBeUndefined() // the first run on record: nothing was passing
  expect(rule({ ...TESTS, value: 0, points: [2, 0] })).toBeUndefined() // passing
  // a value the source didn't give as a number says nothing
  expect(rule({ ...LIMITS, value: '99' })).toBeUndefined()
})

test("only the HUD's own slots fire a rule: another plugin's, however bad, never does", () => {
  const outside = [LIMITS, FAILING, TESTS, CONTEXT].map(s => ({ ...s, from: 'deploys', value: s.id === 'failing' ? undefined : 99, hint: 1, tone: 'bad' as const }))
  expect(urgentNow(outside, undefined, 0)).toBeUndefined()
  // beside the HUD's own, they change nothing
  expect(urgentNow([...outside, { ...CONTEXT, value: 50 }], undefined, 0)).toBeUndefined()
  expect(urgentNow([...outside, CONTEXT], undefined, 0)?.key).toBe('hud/context')
})

test('one at a time, first rule first: an earlier rule takes the place at once, a later one never does', () => {
  expect(rule(CONTEXT, TESTS, FAILING, LIMITS)).toBe('U1')
  expect(rule(CONTEXT, TESTS, FAILING)).toBe('U2')
  expect(rule(CONTEXT, TESTS)).toBe('U3')
  // U1 begins while U4 stands: the earlier rule leads at once
  const u4 = urgentNow([CONTEXT], undefined, 0)
  expect(urgentNow([CONTEXT, LIMITS], u4, 3)).toMatchObject({ rule: 'U1', since: 3 })
  // U4 begins while U3 stands: it is the later rule, and U3 stays
  const u3 = urgentNow([TESTS], undefined, 0)
  expect(urgentNow([CONTEXT, TESTS], u3, 3)).toEqual(u3)
})

test("it holds until the next boundary after its rule stops, saying the slot's note now, never the old state; then it goes", () => {
  const on = urgentNow([TESTS], undefined, 2)
  expect(on).toMatchObject({ rule: 'U3', says: 'Tests: 2 failed (were passing)', since: 2 })
  // the tests pass again: the rule stops; it stays, with the boundary it waits for, and says what the slot says now
  const held = urgentNow([GREEN], on, 2)
  expect(held).toEqual({ ...on, says: 'npm test: 41 passed, 0 failed', heldTo: 3 })
  // slot changes before the boundary move the note with the slot
  expect(urgentNow([{ ...GREEN, note: 'npm test: 42 passed, 0 failed' }], held, 2)).toEqual({ ...on, says: 'npm test: 42 passed, 0 failed', heldTo: 3 })
  // a slot with no note is named, not left saying what it said
  expect(urgentNow([{ ...GREEN, note: undefined }], on, 2)?.says).toBe('Tests')
  // the slot gone (cleared, or its source muted): nothing to say, and the hold ends
  expect(urgentNow([], held, 2)).toBeUndefined()
  expect(urgentNow([CONTEXT], held, 2)).toMatchObject({ rule: 'U4', since: 2 }) // what holds now has the place
  // the boundary passes: gone
  expect(urgentNow([GREEN], held, 3)).toBeUndefined()
  // and stays gone
  expect(urgentNow([GREEN], undefined, 3)).toBeUndefined()
})

test('it never flickers: its rule holding again before the boundary keeps it, and a count that went back (a new run) ends a hold', () => {
  const on = urgentNow([CONTEXT], undefined, 5)
  const held = urgentNow([CALM], on, 5)
  expect(held).toMatchObject({ says: '600k of 1M tokens', heldTo: 6 })
  // 86% again before the boundary: the same urgency, no longer waiting on one, with its first since
  const again = urgentNow([{ ...CONTEXT, value: 86 }], held, 5)
  expect(again).toEqual({ key: 'hud/context', rule: 'U4', says: 'Context 86%; compaction is near', since: 5 })
  // a later boundary, with the rule holding, takes nothing
  expect(urgentNow([{ ...CONTEXT, value: 86 }], again, 6)).toEqual(again)
  // an earlier rule, begun while one waits out its hold, leads at once; a later one waits for it
  expect(urgentNow([LIMITS], held, 5)).toMatchObject({ rule: 'U1' })
  const waiting = urgentNow([LOW], urgentNow([LIMITS], undefined, 5), 5)
  expect(waiting).toMatchObject({ rule: 'U1', says: '50% used; resets in 40m', heldTo: 6 })
  expect(urgentNow([LOW, CONTEXT], waiting, 5)).toEqual(waiting) // U4 holds, but U1's hold comes first
  expect(urgentNow([LOW, CONTEXT], waiting, 6)).toMatchObject({ rule: 'U4', since: 6 }) // after it, U4
  // the count went back, as in a new run: the hold is over
  expect(urgentNow([CALM], held, 0)).toBeUndefined()
})

test('the strip is given the slot as held, so its tone is live too; with the slot gone it has nothing to draw', () => {
  const u = urgentNow([TESTS], undefined, 0) as Urgent
  expect(urgentFor([CONTEXT, TESTS], u)).toEqual({ slot: TESTS, says: 'Tests: 2 failed (were passing)' })
  expect(urgentFor([CONTEXT, TESTS], u)?.slot).toBe(TESTS) // the strip leaves this one out of the rest by identity
  expect(urgentFor([CONTEXT], u)).toBeUndefined()
  expect(urgentFor([TESTS], undefined)).toBeUndefined()
  // the mark takes the slot's tone as it stands: red while it fails, green once it passes, not red for a plain one
  const r = apply(null, { start: 'Ship it' }, 0)
  const mark = (tone: HudHeld['tone']) => /l5\.5 10h-11z" fill="([^"]+)"/.exec(strip(r, 1400, [], { slot: { ...GREEN, tone }, says: 'x' }).source)?.[1]
  const [bad, warn, good, plain] = [mark('bad'), mark('warn'), mark('good'), mark(undefined)]
  expect(new Set([bad, warn, good]).size).toBe(3)
  expect(plain).not.toBe(bad)
})

// ---- through the hooks ----

type Loose = (i: object) => Promise<{ text?: string; result?: unknown; context?: readonly string[] }>
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }

// Reads the urgency place back out of state (a test's own $ has no state: an inline plugin reads it).
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async $ => ({ text: JSON.stringify((await $.state.get({ plugin: 'hud', key: 'urgent' })).value ?? null) }))
}
// An outside plugin that says everything is urgent, in the HUD's own slot names.
const rogue: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'rogue') return next(e)
    await $.hud.declare({ v: 1, name: 'Rogue', access: 'Says it is all urgent.', slots: [
      { id: 'limits', pattern: 'meter', title: '5-hour limit' }, { id: 'failing', pattern: 'list', title: 'Failing runs' },
      { id: 'tests', pattern: 'stat', title: 'Tests' }, { id: 'context', pattern: 'ring', title: 'Context' },
    ] })
    await $.hud.push({ v: 1, id: 'limits', pattern: 'meter', title: '5-hour limit', value: 99, max: 100, tone: 'bad', hint: 1, note: '99% used; resets in 1m' })
    await $.hud.push({ v: 1, id: 'failing', pattern: 'list', title: 'Failing runs', tone: 'bad', hint: 1, items: [{ label: 'rm -rf', value: 9, state: 'failed' }] })
    await $.hud.push({ v: 1, id: 'tests', pattern: 'stat', title: 'Tests', value: 9, tone: 'bad', hint: 1, points: [0, 9] })
    await $.hud.push({ v: 1, id: 'context', pattern: 'ring', title: 'Context', value: 99, max: 100, tone: 'bad', hint: 1 })
    return { result: 'ok' }
  })
}
// A plugin that makes the HUD's write of the urgency place fail, as a fault in its own rules would: the value it gets to
// write is one that state refuses (a throwing hook is merely skipped by the engine, so it can't stand in for a fault).
const faulty: Register = on => {
  on('state.set', ($, e, next) => {
    const w = e as unknown as { plugin: string; key: string }
    return w.plugin === 'hud' && w.key === 'urgent' ? next({ ...e, value: undefined } as typeof e) : next(e)
  })
}
const plugins = [{ name: 'peek', register: peek }, { name: 'rogue', register: rogue }]

// the engine beneath: a call answers as its `answer` says, else ok; a measure reports what changed
// (`ran` collects the calls that reach it, and `surfaces` says who watches)
const beneath = (on: On, ran: object[] = [], surfaces: ('terminal' | 'desktop')[] = []) => {
  mock.clock(on)
  on('ui.panes', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('tool.call', (_$, e) => (ran.push(e), (e as unknown as { answer?: { result: string; text?: string; isError: true } | { result: string; text?: string } }).answer ?? { result: 'ok' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
}
const store = (on: On, kept: Record<string, unknown> = {}) => {
  on('store.get', (_$, e) => ({ value: kept[e.key] }))
  on('store.set', (_$, e) => (kept[e.key] = e.value, { value: undefined }))
  return kept
}
const kit = ($: Engine) => {
  const loose = (f: unknown) => f as Loose
  const turn = (agentId?: string) => loose($.turn.complete)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) })
  return {
    hud: (i: object) => loose($.tool.call)({ tool: 'mcp__hud__hud', ...i }),
    call: (i: object) => loose($.tool.call)(i),
    measure: (m: { context?: number; limit?: number }) => loose($.session.measure)({
      context: { window: 1_000_000, ...(m.context === undefined ? {} : { percent: m.context, tokens: m.context * 10_000 }) },
      rateLimits: m.limit === undefined ? [] : [{ kind: 'five_hour', percentUsed: m.limit, resetsAt: '1970-01-01T00:40:00Z' }],
      changed: [m.context === undefined ? '' : 'context', m.limit === undefined ? '' : 'rateLimits'].filter(Boolean),
    }),
    turn,
    command: (args: string, command = 'hud') => loose($.command.run)({ command, args }).then(o => String(o.text)),
    urgent: async () => JSON.parse(await kit($).command('', 'peek')) as Urgent | null,
    band: async (surface: 'terminal' | 'desktop') => {
      const b = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component: 'AbovePrompt', props: band })
      const drawn = JSON.stringify(await b.drawn())
      await b.unmount()
      return drawn
    },
  }
}
type Kit = ReturnType<typeof kit>
const SURFACES = ['terminal', 'desktop'] as const

// the shell runs that make a rule hold
const NPM = (text: string, failed = false) => ({ tool: 'Bash', command: 'npm test', answer: { result: text, text, ...(failed ? { isError: true } : {}) } })
const CASES: { rule: Urgent['rule']; key: string; says: string; before: (k: Kit) => Promise<unknown>; fire: (k: Kit) => Promise<unknown> }[] = [
  { rule: 'U1', key: 'hud/limits', says: '5-hour limit 88%; resets in 40m', before: k => k.measure({ limit: 84 }), fire: k => k.measure({ limit: 88 }) },
  { rule: 'U2', key: 'hud/failing', says: 'npm test failed 3 times in a row', before: async k => { await k.call(NPM('boom', true)); await k.call(NPM('boom', true)) }, fire: k => k.call(NPM('boom', true)) },
  { rule: 'U3', key: 'hud/tests', says: 'Tests: 2 failed (were passing)', before: k => k.call(NPM('Tests: 0 failed, 41 passed, 41 total')), fire: k => k.call(NPM('Tests: 2 failed, 39 passed, 41 total')) },
  { rule: 'U4', key: 'hud/context', says: 'Context 87%; compaction is near', before: k => k.measure({ context: 84 }), fire: k => k.measure({ context: 87 }) },
]
for (const c of CASES) {
  test(`${c.rule} fires from what the HUD's own source saw: "${c.says}", leading the desktop strip`, { plugins }, async ($, on) => {
    beneath(on)
    const k = kit($)
    await k.hud({ start: 'Ship it', progress: '3/8' })
    await c.before(k)
    expect(await k.urgent()).toBeNull()
    await c.fire(k)
    expect(await k.urgent()).toMatchObject({ rule: c.rule, key: c.key, says: c.says })
    for (const surface of SURFACES) {
      const drawn = await k.band(surface)
      expect(drawn).toContain('Ship it')
      if (surface === 'desktop') {
        expect(drawn).toContain(c.says) // in the strip's image, and in its alt in words
        expect(drawn).toContain('>Urgent<')
        expect(drawn).toContain(`Urgent: ${c.says}.`)
      }
    }
  })
}

test('the first test run on record that fails is not a pass that went red', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.call(NPM('Tests: 2 failed, 39 passed, 41 total'))
  expect(await k.urgent()).toBeNull()
  await k.call(NPM('Tests: 0 failed, 41 passed, 41 total'))
  await k.call(NPM('Tests: 3 failed, 38 passed, 41 total'))
  expect(await k.urgent()).toMatchObject({ rule: 'U3', says: 'Tests: 3 failed (were passing)' })
})

test("an outside plugin's slots, in the HUD's own names and with a hint of 1, raise nothing", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Ship it', progress: '3/8' })
  await k.call({ tool: 'rogue' })
  await k.measure({ context: 50, limit: 60 })
  expect(await k.urgent()).toBeNull()
  for (const surface of SURFACES) {
    const drawn = await k.band(surface)
    expect(drawn).toContain('Ship it')
    expect(drawn).not.toMatch(/urgent/i)
  }
  // the HUD's own source then says it for real, and the rogue's slots still count for nothing
  await k.measure({ context: 90 })
  expect(await k.urgent()).toMatchObject({ rule: 'U4', key: 'hud/context' })
})

test('a held urgency stays through slot changes and the main loop\'s other work, and a boundary ends it: a turn, a phase', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Ship it', progress: '3/8' })
  await k.measure({ context: 87 })
  expect(await k.urgent()).toMatchObject({ rule: 'U4', since: 0 })
  // the rule stops; the place stays, saying what the slot says now and not the old state, on the desktop strip too
  await k.measure({ context: 40 })
  expect(await k.urgent()).toMatchObject({ rule: 'U4', says: '400k of 1M tokens', heldTo: 1 })
  expect(await k.band('desktop')).toContain('Urgent: 400k of 1M tokens.')
  expect(await k.band('desktop')).not.toContain('compaction is near')
  // neither a log line, a tool call, nor a subagent's turn is a boundary
  await k.hud({ log: 'Context compacted by hand' })
  await k.call({ tool: 'Bash', command: 'true' })
  await k.turn('agent-1')
  expect(await k.urgent()).toMatchObject({ rule: 'U4', heldTo: 1 })
  expect(await k.band('desktop')).toContain('Urgent: 400k of 1M tokens.')
  // the main loop's turn ends: gone
  await k.turn()
  expect(await k.urgent()).toBeNull()
  for (const surface of SURFACES) expect(await k.band(surface)).not.toContain('Urgent: ')
  // a phase is a boundary too (it counts in the run's boundaries as the turn does)
  await k.measure({ context: 90 })
  await k.measure({ context: 20 })
  expect(await k.urgent()).toMatchObject({ rule: 'U4', heldTo: 2 })
  await k.hud({ phase: { name: 'Test', state: 'now' } })
  expect(await k.urgent()).toBeNull()
  // and it comes back the moment its rule holds again
  await k.measure({ context: 91 })
  expect(await k.urgent()).toMatchObject({ rule: 'U4', says: 'Context 91%; compaction is near' })
})

test("its rule holding again before the boundary keeps it, and it needs no run: with none live, a main-loop turn's end is the boundary", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.measure({ context: 87 })
  await k.measure({ context: 40 })
  expect(await k.urgent()).toMatchObject({ rule: 'U4', heldTo: 1 })
  await k.measure({ context: 88 })
  const back = await k.urgent()
  expect(back).toMatchObject({ rule: 'U4', says: 'Context 88%; compaction is near' })
  expect(back?.heldTo).toBeUndefined()
  await k.turn() // the rule still holds: a boundary takes nothing
  expect(await k.urgent()).toMatchObject({ rule: 'U4' })
  await k.measure({ context: 40 })
  expect(await k.urgent()).toMatchObject({ rule: 'U4', heldTo: 1 })
  await k.turn('agent-1') // a subagent's turn is no boundary
  expect(await k.urgent()).toMatchObject({ rule: 'U4' })
  await k.turn()
  expect(await k.urgent()).toBeNull()
  // a finished run counts nothing either
  await k.hud({ start: 'Done soon' })
  await k.hud({ done: 'Finished' })
  await k.measure({ context: 87 })
  await k.measure({ context: 40 })
  expect(await k.urgent()).toMatchObject({ rule: 'U4' })
  await k.turn()
  expect(await k.urgent()).toBeNull()
})

test('a muted HUD source raises no urgency; muting what shows takes it away at once; unmuting lets its rule hold again', { plugins }, async ($, on) => {
  const kept = store(on)
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Ship it', progress: '3/8' })
  expect(await k.command('mute context and cost')).toContain('Context and cost is muted')
  await k.measure({ context: 90, limit: 90 })
  expect(await k.urgent()).toBeNull()
  for (const surface of SURFACES) expect(await k.band(surface)).not.toContain('compaction is near')
  // unmuted, its slots were held all along: the rule holds at once, the first rule first
  expect(await k.command('unmute context and cost')).toBe('Context and cost is back.')
  expect(await k.urgent()).toMatchObject({ rule: 'U1', key: 'hud/limits' })
  expect(await k.band('desktop')).toContain('5-hour limit 90%')
  // muting another source leaves it; muting its own takes it away, with no boundary
  await k.command('mute tool signals')
  expect(await k.urgent()).toMatchObject({ rule: 'U1' })
  await k.command('mute context and cost')
  expect(await k.urgent()).toBeNull()
  expect(await k.band('desktop')).not.toContain('5-hour limit')
  expect(kept.muted).toEqual(['hud:tool-signals', 'hud:context-and-cost'])
})

test("tests go red, then green: the place keeps its position but says the live note, never the old state, until the next boundary; then it is empty", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Ship it', progress: '3/8' })
  await k.call(NPM('Tests: 0 failed, 41 passed, 41 total'))
  await k.call(NPM('Tests: 2 failed, 39 passed, 41 total'))
  expect(await k.urgent()).toMatchObject({ rule: 'U3', says: 'Tests: 2 failed (were passing)' })
  expect(await k.band('desktop')).toContain('Urgent: Tests: 2 failed (were passing).')
  // green again: the rule stops, the place stays, with the slot's note and no claim of failing
  await k.call(NPM('Tests: 0 failed, 50 passed, 50 total'))
  expect(await k.urgent()).toMatchObject({ rule: 'U3', says: 'npm test: 50 passed, 0 failed', heldTo: 1 })
  for (const surface of SURFACES) {
    const drawn = await k.band(surface)
    expect(drawn).not.toContain('were passing')
    if (surface === 'desktop') {
      expect(drawn).toContain('>Urgent<') // still in front
      expect(drawn).toContain('Urgent: npm test: 50 passed, 0 failed.')
      expect(drawn).toContain('>npm test: 50 passed, 0 failed<')
    }
  }
  // the next boundary: the place is empty
  await k.turn()
  expect(await k.urgent()).toBeNull()
  for (const surface of SURFACES) {
    const drawn = await k.band(surface)
    expect(drawn).not.toContain('Urgent: ')
    expect(drawn).not.toContain('>Urgent<')
  }
})

test("a fault in the urgency place never costs the call it rides: the hud call answers, another tool's runs once", { plugins: [...plugins, { name: 'faulty', register: faulty }] }, async ($, on) => {
  const ran: object[] = []
  beneath(on, ran)
  const k = kit($)
  // the run was updated, so the answer is not "it is unchanged"
  expect((await k.hud({ start: 'Ship it', progress: '3/8' })).result).toBe('ok')
  expect((await k.hud({ phase: { name: 'Test', state: 'now' } })).result).toBe('ok')
  expect(await k.band('desktop')).toContain('Ship it')
  // another tool's finished call is answered, and not run again for the fault
  const text = 'Tests: 0 failed, 41 passed, 41 total'
  expect((await k.call(NPM(text))).result).toBe(text)
  expect(ran.length).toBe(1)
  // a measure and a turn's end go on as well, and the urgency place just never fills
  await k.measure({ context: 90 })
  expect((await k.turn()).text).toBe('')
  expect(await k.urgent()).toBeNull()
})

test("urgency text never reaches the model: not a message's context, not a tool call's, standing or held", { plugins }, async ($, on) => {
  beneath(on, [], ['desktop'])
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  const k = kit($)
  const submit = async (text: string) =>
    (await ($.prompt.submit as unknown as Loose)({ text, wait: false, origin: { kind: 'composer' } })).context?.join('\n') ?? ''
  // what the model could read of the urgency: its sentence, and the slot's note once it is held
  const never = (said: string) => { for (const words of ['were passing', 'Tests: 2 failed', 'Urgent', 'npm test: 50 passed']) expect(said).not.toContain(words) }
  await k.hud({ start: 'Ship it', goal: 'Green tests', progress: '3/8' })
  await k.call(NPM('Tests: 0 failed, 41 passed, 41 total'))
  await k.call(NPM('Tests: 2 failed, 39 passed, 41 total'))
  expect(await k.urgent()).toMatchObject({ rule: 'U3' })
  // a message mid-run carries the note with the goal (so there is a note to read), and not the urgency
  const note = await submit('keep going')
  expect(note).toContain('HUD: "Green tests"')
  never(note)
  // The run is Claude's (a hud `start`), so the HUD checks it: twelve calls since its last hud call land in the check
  // window (the two test runs count), and the check comes after a result. It does not carry the urgency either.
  const checks = []
  for (let n = 0; n < 12; n++) checks.push(...((await k.call({ tool: 'Bash', command: 'true' })).context ?? []))
  expect(checks.join('\n')).toContain('HUD check')
  never(checks.join('\n'))
  // Claude answers it with a hud call (a log line, no boundary), which starts the window over at twelve: an unanswered
  // check would have doubled it. Then the tests go green, so the place is held with the slot's note in place of the sentence.
  await k.hud({ log: 'Rerunning the tests' })
  await k.call(NPM('Tests: 0 failed, 50 passed, 50 total'))
  expect(await k.urgent()).toMatchObject({ rule: 'U3', says: 'npm test: 50 passed, 0 failed', heldTo: 1 })
  const heldNote = await submit('and again')
  expect(heldNote).toContain('HUD: "Green tests"')
  never(heldNote)
  const later = []
  for (let n = 0; n < 12; n++) later.push(...((await k.call({ tool: 'Bash', command: 'true' })).context ?? []))
  expect(later.join('\n')).toContain('HUD check')
  never(later.join('\n'))
})
