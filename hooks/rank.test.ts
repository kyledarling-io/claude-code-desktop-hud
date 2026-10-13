import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

import type { HudHeld, HudRun } from '../types'
import { claudeSlots, FOCUS, nextArrangement, PINNED, rank, score, WAIT, widgetKey, type Arrangement, type Placed } from './rank'
import { apply } from './run'
import { intoRun } from './plan'

// Who decides what's shown: the person's pins, Claude's focus, the mode's slots, then the score.

const held = (from: string, s: Omit<HudHeld, 'v' | 'from' | 'at'>, at = 0): HudHeld => ({ v: 1, from, at, ...s })
const keys = (p: Placed[]) => p.map(x => x.key)
const whys = (p: Placed[]) => p.map(x => x.why)
const NONE = { pinned: [], hidden: [] }

// The worked example: Debug mode, no pins, no focus, at a turn's end
const CALLS = 40
const EXAMPLE = [
  held('hud', { id: 'tests', pattern: 'stat', title: 'Tests', value: 2, tone: 'bad', n: CALLS - 1 }),
  held('hud', { id: 'failing', pattern: 'list', title: 'Failing runs', tone: 'bad', n: CALLS - 1 }),
  held('hud', { id: 'context', pattern: 'ring', title: 'Context', value: 72, tone: 'warn', n: CALLS - 2 }),
  held('deploys', { id: 'prod', pattern: 'stat', title: 'Production', value: 'failed', tone: 'bad', hint: 1, n: CALLS - 30 }),
  held('hud', { id: 'edited', pattern: 'stat', title: 'Files edited', value: 3, n: CALLS }),
  held('hud', { id: 'cost', pattern: 'stat', title: 'Cost', value: 4.82, n: CALLS - 5 }),
]
const inOrder = (all: HudHeld[]) => (s: HudHeld) => all.indexOf(s)

test("the worked example, exactly", () => {
  // shuffled, so the order comes from the rules and not the list
  const slots = [EXAMPLE[5]!, EXAMPLE[3]!, EXAMPLE[0]!, EXAMPLE[4]!, EXAMPLE[2]!, EXAMPLE[1]!]
  const placed = rank(slots, { mode: 'debug', focus: [], prefs: NONE, calls: CALLS, order: inOrder(EXAMPLE) })
  expect(keys(placed)).toEqual(['hud/tests', 'hud/failing', 'hud/context', 'deploys/prod', 'hud/edited', 'hud/cost'])
  expect(whys(placed)).toEqual(['Debug mode', 'Debug mode', 'Changed 2 calls ago · warn', 'Hinted by deploys', 'Changed just now · no tone', 'Changed 5 calls ago · no tone'])
  expect(EXAMPLE.slice(2).map(s => score(s, CALLS).toFixed(2))).toEqual(['1.78', '1.03', '1.00', '0.75'])
  // with no hint, deploys/prod (0.53) falls below edited and cost: the hint lifted it two places, and no further
  const plain = EXAMPLE.map(s => (s.id === 'prod' ? { ...s, hint: undefined } : s))
  const without = rank(plain, { mode: 'debug', focus: [], prefs: NONE, calls: CALLS, order: inOrder(plain) })
  expect(keys(without).slice(2)).toEqual(['hud/context', 'hud/edited', 'hud/cost', 'deploys/prod'])
  expect(score(plain[3]!, CALLS).toFixed(2)).toBe('0.53')
  expect(without.at(-1)!.why).toBe('Changed 30 calls ago · bad')
  // severity: bad 3, warn 2, info, accent or none 1, good 0.5; one call ago reads in the singular
  expect((['bad', 'warn', 'info', 'accent', undefined, 'good'] as const).map(tone => score(held('x', { id: 'a', pattern: 'stat', title: 'A', tone, n: 0 }), 0))).toEqual([3, 2, 1, 1, 1, 0.5])
  expect(rank([held('x', { id: 'a', pattern: 'stat', title: 'A', tone: 'good', n: 4 })], { mode: 'build', focus: [], prefs: NONE, calls: 5, order: () => 0 })[0]!.why).toBe('Changed 1 call ago · good')
})

test('pinned leads, then focus, then the mode, then the score', () => {
  const s = (from: string, id: string, tone?: 'bad' | 'warn', n = 10) => held(from, { id, pattern: 'stat', title: id, tone, n })
  const all = [s('x', 'a', 'bad'), s('x', 'b', 'warn'), s('hud', 'failing'), s('hud', 'tests'), s('x', 'd'), s('x', 'e'), s('x', 'f', 'bad', 0)]
  const placed = rank(all, {
    mode: 'debug', calls: 10, order: inOrder(all),
    prefs: { pinned: ['x/e', 'x/gone'], hidden: [] }, focus: ['x/d', 'x/e', 'x/unknown'],
  })
  // a pin first; Claude's focus next (a key already placed or not held is passed over); Debug mode's slots in its order
  // (tests, then failing runs); the score last: a fresh bad slot beats a warn one, which beats a bad one 10 calls old
  expect(keys(placed)).toEqual(['x/e', 'x/d', 'hud/tests', 'hud/failing', 'x/a', 'x/b', 'x/f'])
  expect(whys(placed)).toEqual([PINNED, FOCUS, 'Debug mode', 'Debug mode', 'Changed just now · bad', 'Changed just now · warn', 'Changed 10 calls ago · bad'])
  // a mode that puts none of these first (research) leaves everything to the score: f, bad 10 calls ago (1.68), beats
  // the four with no tone just now (1), which tie and go in their order
  expect(keys(rank(all, { mode: 'research', focus: [], prefs: NONE, calls: 10, order: inOrder(all) }))).toEqual(['x/a', 'x/b', 'x/f', 'hud/failing', 'hud/tests', 'x/d', 'x/e'])
})

test('hidden keys never appear: not pinned, focused or in the mode', () => {
  const all = EXAMPLE
  const placed = rank(all, { mode: 'debug', calls: CALLS, order: inOrder(all), focus: ['hud/cost'], prefs: { pinned: ['hud/edited'], hidden: ['hud/edited', 'hud/cost', 'hud/tests'] } })
  expect(keys(placed)).toEqual(['hud/failing', 'hud/context', 'deploys/prod'])
})

test('ties go to declaration order, then key', () => {
  const s = (from: string, id: string) => held(from, { id, pattern: 'stat', title: id, n: 3 })
  const [b, a, c] = [s('hud', 'b'), s('hud', 'a'), s('deploys', 'c')]
  // the declaration order puts c first, then b; a and z share a place, so their keys decide
  const z = s('hud', 'z')
  const order = (x: HudHeld) => ({ c: 0, b: 1, a: 2, z: 2 })[x.id] ?? 9
  expect(keys(rank([z, a, b, c], { mode: 'build', focus: [], prefs: NONE, calls: 3, order }))).toEqual(['deploys/c', 'hud/b', 'hud/a', 'hud/z'])
})

test("Claude's widgets rank beside other slots as claude/<id>; the observer's plan as hud/plan", () => {
  let r = apply(null, { start: 'Tune', widgets: [{ id: 'loss', type: 'stat', title: 'Loss', value: 0.4, tone: 'bad' }, { id: 'heap', type: 'meter', value: 5, max: 8 }] }, 0, undefined, [], 7)
  r = intoRun(r, [{ id: '0', label: 'Read', state: 'done' }, { id: '1', label: 'Write', state: 'now' }], 0, 9)
  const mine = claudeSlots(r)
  expect(mine.map(s => [`${s.from}/${s.id}`, s.pattern, s.title, s.n])).toEqual([['claude/loss', 'stat', 'Loss', 7], ['claude/heap', 'meter', 'heap', 7], ['hud/plan', 'checklist', 'Plan', 9]])
  // a fresh bad widget of Claude's outranks a source's slot with no tone; the mirror reads as the HUD's
  const edited = held('hud', { id: 'edited', pattern: 'stat', title: 'Files edited', value: 2, n: 9 })
  const all = [...mine, edited]
  // (research mode puts none of these first, so the score decides)
  const placed = rank(all, { mode: 'research', focus: [], prefs: NONE, calls: 9, order: inOrder(all) })
  expect(keys(placed)).toEqual(['claude/loss', 'hud/plan', 'hud/edited', 'claude/heap'])
  expect(placed[0]!.why).toBe('Changed 2 calls ago · bad')
  // a mirror kept but not drawn (Claude's own phases lead) is no slot; no run, no slots
  expect(claudeSlots(apply(r, { phase: { name: 'Build', state: 'now' } }, 0)).map(s => s.id)).toEqual(['loss', 'heap'])
  expect(claudeSlots(null)).toEqual([])
})

// The strip at each boundary, picking the first two of what it is offered: a slot that left waits WAIT boundaries
// before it may come back, unless it changed or the person pinned it.
const P = (key: string, why = 'Changed just now · no tone', at = 0): Placed => ({ key, why, slot: held(key.split('/')[0]!, { id: key.split('/')[1]!, pattern: 'stat', title: key }, at) })
const firstTwo = (c: Placed[]) => c.slice(0, 2).map(p => p.key)
type Arr = Arrangement

// The churn metric: an item that leaves the strip and comes back within 3 boundaries without a
// change of its own (its `at`).
const churn = (frames: { strip: string[]; at: Record<string, number | undefined> }[]) => {
  let n = 0, left = 0
  const away = new Map<string, { b: number; was: number | undefined }>()
  frames.forEach((f, b) => {
    const before = b ? frames[b - 1]! : undefined
    for (const k of before?.strip ?? []) if (!f.strip.includes(k)) { away.set(k, { b, was: before!.at[k] }); left++ }
    for (const k of f.strip) {
      const gone = away.get(k)
      if (!before?.strip.includes(k) && gone && b - gone.b <= 3 && f.at[k] === gone.was) n++
      away.delete(k)
    }
  })
  return { churn: n, left }
}

test('nothing flip-flops: a slot that left waits 3 boundaries unless it changed; the person brings one back at once', () => {
  let arr: Arr | undefined
  const step = (placed: Placed[], fresh: string[] = []) => (arr = nextArrangement(arr, placed, firstTwo, 0, fresh)).strip
  const [a, b, c] = ['s/a', 's/b', 's/c']
  expect(step([P(a), P(b), P(c)])).toEqual([a, b])
  expect(step([P(c, undefined, 1), P(a), P(b)])).toEqual([c, a]) // c changed and rose; b left
  // c has decayed below b again without a change: b may not come back yet, so c holds its place
  for (let k = 0; k < WAIT; k++) expect(step([P(a), P(b), P(c, undefined, 1)])).toEqual([a, c])
  expect(step([P(a), P(b), P(c, undefined, 1)])).toEqual([a, b]) // past the wait
  // a slot that changed comes back at once
  expect(step([P(c, undefined, 2), P(a), P(b)])).toEqual([c, a])
  expect(step([P(b, undefined, 5), P(a), P(c, undefined, 2)])).toEqual([b, a])
  expect(step([P(a), P(c, undefined, 2), P(b, undefined, 5)])).toEqual([a, b]) // c, unchanged since it left, waits
  // one the person pinned comes back at once, and so does one the person brought back (an unmute)
  expect(step([P(c, PINNED, 2), P(a), P(b, undefined, 5)])).toEqual([c, a])
  expect(step([P(b, undefined, 5), P(a), P(c, undefined, 2)])).toEqual([a, c]) // b just left: it waits
  expect(step([P(b, undefined, 5), P(c, undefined, 2), P(a)], [b])).toEqual([b, c])
  // the strip says why each is there
  expect(arr!.why).toEqual({ [b]: 'Changed just now · no tone', [c]: 'Changed just now · no tone' })
})

test('a boundary storm and a person pinning repeatedly never flip the strip', () => {
  // twenty slots; a storm of boundaries with nothing changing but the person's pins, one on, one off, in turn
  const all = Array.from({ length: 8 }, (_, i) => held('x', { id: `s${i}`, pattern: 'stat', title: `s${i}`, tone: i % 3 ? undefined : 'bad', hint: i === 5 ? 1 : undefined, n: 40 - i * 4 }, i))
  let arr: Arr | undefined
  const frames: { strip: string[]; at: Record<string, number | undefined> }[] = []
  for (let b = 0; b < 30; b++) {
    const calls = 40 + b * 3 // the work goes on between boundaries: scores decay, the hinted one climbs
    const pinned = b % 4 === 1 ? ['x/s7'] : b % 4 === 2 ? ['x/s6', 'x/s7'] : []
    const placed = rank(all, { mode: 'build', focus: [], prefs: { pinned, hidden: [] }, calls, order: inOrder(all) })
    arr = nextArrangement(arr, placed, c => c.slice(0, Math.max(3, c.filter(p => p.why === PINNED).length)).map(p => p.key), b)
    // a pin is the person's own change to that slot
    frames.push({ strip: arr.strip, at: Object.fromEntries(all.map(s => [`x/${s.id}`, pinned.includes(`x/${s.id}`) ? 1000 + b : s.at])) })
  }
  const { churn: n, left } = churn(frames)
  expect(left).toBeGreaterThan(5) // things did move
  expect(n).toBe(0)
})

// ---- through the hooks, on both surfaces -------------------------------------------------------------------------

// What $.state holds, read by an inline plugin (a test's own $ has no state): /peek answers with it.
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async $ => ({
    text: JSON.stringify({
      run: (await $.state.get({ plugin: 'hud', key: 'run' })).value ?? null,
      slots: (await $.state.get({ plugin: 'hud', key: 'slots' })).value ?? {},
      arrangement: (await $.state.get({ plugin: 'hud', key: 'arrangement' })).value ?? null,
      urgent: (await $.state.get({ plugin: 'hud', key: 'urgent' })).value ?? null,
    }),
  }))
}
// Another plugin's slots: a deploy that failed, with the source's hint that it matters (staging, when the call says so).
const deploys: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'deploys') return next(e)
    const i = e as unknown as { value?: string; tone?: 'bad' | 'good'; stage?: boolean }
    await $.hud.declare({ v: 1, name: 'Deploys', access: 'Reads deploy states from its own API.', slots: [{ id: 'prod', pattern: 'stat', title: 'Production' }, { id: 'stage', pattern: 'stat', title: 'Staging' }] })
    await $.hud.push({ v: 1, id: i.stage ? 'stage' : 'prod', pattern: 'stat', title: i.stage ? 'Staging' : 'Production', value: i.value ?? 'failed', tone: i.tone ?? 'bad', hint: 1, note: 'build 1432' })
    return { result: 'ok' }
  })
}
const plugins = [{ name: 'peek', register: peek }, { name: 'deploys', register: deploys }]
// the hook tests make dozens of calls each: room under a loaded machine, as the auto-run tests have
const LONG = { plugins, timeoutMs: 30_000 }

type Loose = (i: object) => Promise<{ text?: string; result?: unknown }>
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
type Peeked = { run: HudRun | null; slots: Record<string, HudHeld>; arrangement: Arr | null; urgent: { says: string; heldTo?: number } | null }
const nodes = (n: unknown): Node[] => (typeof n === 'object' && n !== null ? [n as Node, ...((n as Node).children ?? []).flatMap(nodes)] : [])
const text = (n: unknown): string => (typeof n === 'string' ? n : typeof n === 'object' && n !== null ? ((n as Node).children ?? []).map(text).join('') : '')
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)</g)].map(m => m[1]!)
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
const kit = ($: Engine) => ({
  hud: (i: object) => ($.tool.call as unknown as Loose)({ tool: 'mcp__hud__hud', ...i }),
  call: (tool: string, i: object = {}) => ($.tool.call as unknown as Loose)({ tool, ...i }),
  turn: () => ($.turn.complete as unknown as Loose)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }),
  command: async (args: string) => String((await ($.command.run as unknown as Loose)({ command: 'hud', args })).text),
  state: async () => JSON.parse(String((await ($.command.run as unknown as Loose)({ command: 'peek', args: '' })).text)) as Peeked,
  // what a surface draws: the band's Svg (its source and alt) or the pane's words (the desktop's in its Svg)
  drawn: async (surface: 'terminal' | 'desktop', component: 'AbovePrompt' | 'Pane') => {
    const ui = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component, ...(component === 'Pane' ? { requestId: 'hud' } : {}), props: component === 'Pane' ? pane : band })
    const all = nodes(await ui.drawn())
    await ui.unmount()
    const svg = all.find(n => n.type === 'Svg')?.props
    return { words: [...all.filter(n => n.type === 'Text').map(text), ...(svg ? texts(String(svg.source)) : [])], alt: String(svg?.alt ?? '') }
  },
})
test('the strip changes only at boundaries: a slot pushed mid-turn shows in the pane at once, in the strip after the turn', LONG, async ($, on) => {
  mock.clock(on)
  on('session.surfaces', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const { hud, call, turn, drawn } = kit($)
  for (const surface of ['terminal', 'desktop'] as const) {
    await hud({ start: `Ship on ${surface}`, progress: '1/4' })
    await call('deploys', { stage: surface === 'terminal' }) // a slot new to the session each time
    // the pane is the full board: there at once, with why it's there
    expect((await drawn(surface, 'Pane')).words.join(' ')).toContain(surface === 'terminal' ? 'Staging' : 'Production')
    if (surface === 'desktop') {
      // the strip waits for the boundary; the alt, which says all the run holds, already names it
      expect((await drawn(surface, 'AbovePrompt')).words).not.toContain('Production')
      await turn()
      expect((await drawn(surface, 'AbovePrompt')).words).toContain('Production')
      // between boundaries a value changes in place
      await call('deploys', { value: 'live', tone: 'good' })
      expect((await drawn(surface, 'AbovePrompt')).words).toContain('live')
      // a hud call with a phase is a boundary too, as is a start
      await call('Edit', { file_path: '/w/a.ts' })
      expect((await drawn(surface, 'AbovePrompt')).words).not.toContain('Files edited')
      await hud({ phase: { name: 'Build', state: 'now' } })
      expect((await drawn(surface, 'AbovePrompt')).words).toContain('Files edited')
    } else {
      // the terminal's band lists the strip's slots as lines of text, and moves at the same boundaries
      expect((await drawn(surface, 'AbovePrompt')).words.join(' ')).not.toContain('Staging')
      await turn()
      expect((await drawn(surface, 'Pane')).words.join(' ')).toContain('Staging')
      expect((await drawn(surface, 'AbovePrompt')).words.join(' ')).toContain('Staging')
    }
  }
})

test('every pane block shows its why line; the alt and /hud say it too', LONG, async ($, on) => {
  mock.clock(on)
  on('store.set', () => ({ value: undefined })) // where a mute is kept
  on('session.surfaces', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const { hud, call, turn, command, state, drawn } = kit($)
  for (const surface of ['terminal', 'desktop'] as const) {
    // Claude's loss, sent first; the deploy long ago; an edit just now. Research mode puts neither first, so the score
    // decides
    await hud({ start: `Why on ${surface}`, mode: 'research', widget: { id: 'loss', type: 'stat', title: 'Loss', value: 0.4 } })
    // (22 calls on, the loss is aging but not stale: the boundaries below would retire a stale one)
    await call('deploys')
    for (let k = 0; k < 20; k++) await call('Bash', { command: 'true' })
    await call('Edit', { file_path: '/w/a.ts' })
    await turn()
    const want = { Production: 'Hinted by deploys', 'Files edited': 'Changed just now · no tone', Loss: 'Changed 22 calls ago · no tone' }
    expect((await state()).arrangement?.strip).toEqual(['deploys/prod', 'hud/edited', 'claude/loss'])
    const p = await drawn(surface, 'Pane')
    for (const why of Object.values(want)) expect(p.words.join('\n')).toContain(why)
    if (surface === 'desktop') {
      // under each block's title, in the pane's own words
      for (const [title, why] of Object.entries(want)) expect(p.words.indexOf(why)).toBe(p.words.indexOf(title) + 1)
      for (const [title, why] of Object.entries(want)) expect(p.alt).toMatch(new RegExp(`${title}[^—]*— ${why}`))
      expect((await drawn(surface, 'AbovePrompt')).alt).toContain('— Hinted by deploys')
    }
    // /hud: one line per strip item, and why it's there
    const said = await command('')
    expect(said).toContain('Production — Hinted by deploys\nFiles edited — Changed just now · no tone\nLoss — Changed 22 calls ago · no tone')
    // a muted sender's slots never appear: not in the pane, the strip or a why; unmuted, back at once
    await command('mute deploys')
    expect((await state()).arrangement?.strip).toEqual(['hud/edited', 'claude/loss'])
    const muted = (await drawn(surface, 'Pane')).words // the Sources list still names its slots, so it can come back
    expect(muted).not.toContain('Production')
    expect(muted.join(' ')).not.toMatch(/Production \(from deploys\)|Hinted by/)
    await command('unmute deploys')
    expect((await state()).arrangement?.strip).toEqual(['deploys/prod', 'hud/edited', 'claude/loss'])
    // the person's pin and mode are boundaries too, and say so
    await command('pin claude/loss')
    expect((await state()).arrangement).toMatchObject({ strip: ['claude/loss', 'deploys/prod', 'hud/edited'], why: { 'claude/loss': 'Pinned by you' } })
    await command('unpin claude/loss')
    if (surface === 'desktop') { // the person's mode holds for the session, so last
      await command('mode build')
      expect((await state()).arrangement?.why['hud/edited']).toBe('Build mode')
    }
    await hud({ done: 'ok' })
  }
})

test('no flip-flop within 3 boundaries: a storm of phases, turns and changing slots through the hooks', LONG, async ($, on) => {
  const clock = mock.clock(on)
  on('session.surfaces', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // the shell answers with a test summary that goes red and green by turns
  let failing = 0
  on('tool.call', ($, e) => (String(e.tool) === 'Bash' ? { result: '', text: `Tests: ${failing} failed, 30 passed, ${30 + failing} total` } : { result: 'ok' }))
  const { hud, call, turn, state } = kit($)
  const frames: { strip: string[]; at: Record<string, number | undefined> }[] = []
  const snap = async () => {
    const s = await state(), at: Record<string, number | undefined> = {}
    for (const [k, v] of Object.entries(s.slots)) at[k] = v.at
    for (const w of s.run?.widgets ?? []) at[widgetKey(w)] = w.at
    frames.push({ strip: s.arrangement?.strip ?? [], at })
  }
  await hud({ start: 'Storm', widgets: [{ id: 'w1', type: 'stat', value: 1 }, { id: 'w2', type: 'gauge', value: 40, tone: 'warn' }] })
  await snap()
  for (let k = 0; k < 24; k++) {
    await clock.advance(1000)
    if (k % 5 === 0) await call('deploys', { tone: k % 10 ? 'good' : 'bad' })
    for (let e = 0; e < k % 3; e++) await call('Edit', { file_path: `/w/f${e}.ts` })
    failing = k % 4 < 2 ? 0 : 2
    await call('Bash', { command: 'npm test' })
    await ($.session.measure as unknown as Loose)({ context: { percent: 60 + (k % 4) * 9, tokens: 1, window: 100 }, changed: ['context'] })
    if (k % 3 === 0) await hud({ widget: { id: 'w1', value: k, tone: k % 2 ? 'bad' : undefined } })
    // a storm: phases one after another, each a boundary
    if (k % 2 === 0) for (const name of ['a', 'b', 'c', 'd']) { await hud({ phase: { name: `${name}${k}`, state: 'now' } }); await snap() }
    if (k % 7 === 6) { await hud({ rebuild: true }); await snap() }
    await turn()
    await snap()
  }
  const { churn: n, left } = churn(frames)
  expect(left).toBeGreaterThan(0) // the strip did move
  expect(n).toBe(0)
})

// The engine beneath for the urgency: a shell run answers with the summary it carries; the store keeps what's set.
const NPM = (text: string) => ({ command: 'npm test', answer: { result: text, text } })
const engine = (on: On) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: kept[e.key] }))
  on('store.set', ($, e) => (kept[e.key] = e.value, { value: undefined }))
  on('session.surfaces', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('tool.call', ($, e) => (e as unknown as { answer?: { result: string } }).answer ?? { result: 'ok' })
  return clock
}

test("one boundary counter: a hud call with mode, focus or strip and the person's commands advance the run's, once, and end an urgency hold", LONG, async ($, on) => {
  engine(on)
  const { hud, call, command, state } = kit($)
  const counted = async () => (await state()).run?.boundaries ?? 0
  await hud({ start: 'Count', widget: { id: 'w', type: 'stat', value: 1 } })
  expect(await counted()).toBe(0)
  // each a boundary; a phase with focus beside it is one, not two
  const steps: [() => Promise<unknown>, number][] = [
    [() => hud({ focus: ['claude/w'] }), 1], [() => hud({ strip: ['progress'] }), 2], [() => hud({ mode: 'debug' }), 3],
    [() => hud({ phase: { name: 'Build', state: 'now' }, focus: [] }), 4],
    [() => command('pin claude/w'), 5], [() => command('unpin claude/w'), 6], [() => command('hide claude/w'), 7],
    [() => command('unhide claude/w'), 8], [() => command('mode build'), 9], [() => command('mute test results'), 10],
    [() => command('unmute test results'), 11],
    // one that changes nothing is no boundary
    [() => command('pin hud/nothing'), 11], [() => hud({ log: 'just a line' }), 11],
  ]
  for (const [step, n] of steps) {
    await step()
    expect(await counted()).toBe(n)
  }
  // tests go red, then green: the urgency place holds to the next boundary, which a pin now is
  await call('Bash', NPM('Tests: 0 failed, 41 passed, 41 total'))
  await call('Bash', NPM('Tests: 2 failed, 39 passed, 41 total'))
  await call('Bash', NPM('Tests: 0 failed, 41 passed, 41 total'))
  expect((await state()).urgent).toMatchObject({ says: 'npm test: 41 passed, 0 failed', heldTo: 12 })
  await command('pin claude/w')
  expect((await state()).urgent).toBeNull()
})

test("the band's alt says the urgency once; the pane says it as the slot's why", LONG, async ($, on) => {
  engine(on)
  const { hud, call, turn, state, drawn } = kit($)
  await hud({ start: 'Red', progress: '1/4' })
  await call('Bash', NPM('Tests: 0 failed, 41 passed, 41 total'))
  await call('Bash', NPM('Tests: 2 failed, 39 passed, 41 total'))
  await turn()
  const says = 'Tests: 2 failed (were passing)'
  expect((await state()).urgent).toMatchObject({ says })
  // the urgency place is its own: not among the strip's arranged slots
  expect((await state()).arrangement?.strip).not.toContain('hud/tests')
  const band = await drawn('desktop', 'AbovePrompt')
  expect(band.alt.split(says).length - 1).toBe(1)
  expect(band.alt.startsWith(`Urgent: ${says}.`)).toBe(true)
  for (const surface of ['terminal', 'desktop'] as const) expect((await drawn(surface, 'Pane')).words.join(' ')).toContain(`Urgent: ${says}`)
})

test('a hidden slot never shows on either surface: not as the lead checklist, not as the strip\'s trend', LONG, async ($, on) => {
  engine(on)
  const { hud, turn, command, drawn } = kit($)
  for (const surface of ['terminal', 'desktop'] as const) {
    // a checklist that leads (no progress, no phases) and a line the strip draws as its trend
    await hud({ start: `Hide on ${surface}`, mode: 'research', widgets: [
      { id: 'steps', type: 'checklist', title: 'Steps', items: [{ label: 'Probe', state: 'done' }, { label: 'Spawn the agents', state: 'now' }] },
      { id: 'loss', type: 'line', title: 'Loss curve', points: [3, 2, 1] },
    ] })
    await turn()
    const all = async () => [...(await drawn(surface, 'AbovePrompt')).words, ...(await drawn(surface, 'Pane')).words].join(' | ')
    expect(await all()).toContain('Spawn the agents')
    if (surface === 'desktop') expect(await all()).toContain('Loss curve')
    await command('hide claude/steps')
    await command('hide claude/loss')
    for (const words of ['Spawn the agents', 'Probe', 'Loss curve']) expect(await all()).not.toContain(words)
    await command('unhide claude/steps')
    await command('unhide claude/loss')
    await hud({ done: 'ok' })
  }
})

test('the strip holds still between boundaries: a failed call or a tile mid-turn waits for room, which the next boundary makes', LONG, async ($, on) => {
  engine(on)
  const { hud, call, turn, state, drawn } = kit($)
  await hud({ start: 'Room', mode: 'research', progress: '1/4' })
  await call('deploys')
  await call('Edit', { file_path: '/w/a.ts' })
  await ($.session.measure as unknown as Loose)({ context: { percent: 72, tokens: 720_000, window: 1_000_000 }, cost: { usd: 4.82 }, changed: ['context', 'cost'] })
  await turn()
  const decided = (await state()).arrangement?.strip
  expect(decided).toHaveLength(3) // progress, then three slots
  const titles = (await drawn('desktop', 'AbovePrompt')).words
  // mid-turn, the run's own items grow: a call fails and Claude sets a tile
  await call('Bash', { command: 'false', answer: { result: 'boom', isError: true } })
  await hud({ set: { rps: 5 } })
  const band = (await drawn('desktop', 'AbovePrompt')).words
  for (const t of ['Production', 'Context', 'Files edited', 'Cost'].filter(x => titles.includes(x))) expect(band).toContain(t)
  expect(band).not.toContain('Errors')
  expect(band).not.toContain('rps')
  expect((await state()).arrangement?.strip).toEqual(decided)
  // the pane has them at once, on both surfaces
  for (const surface of ['terminal', 'desktop'] as const) expect((await drawn(surface, 'Pane')).words.join(' ')).toMatch(/1 failed|errors/)
  // the next boundary makes room
  await turn()
  const after = (await drawn('desktop', 'AbovePrompt')).words
  expect(after).toContain('Errors')
  expect(after).toContain('rps')
  expect((await state()).arrangement?.strip.length).toBe(1)
})

test('/hud says each strip slot\'s why and tone as they are now, not as the boundary saw them', LONG, async ($, on) => {
  engine(on)
  const { hud, call, turn, command } = kit($)
  await hud({ start: 'Live', mode: 'research' })
  await call('deploys', { tone: 'good' })
  await turn()
  expect(await command('')).toContain('Production — Changed just now · good')
  await call('deploys', { tone: 'bad' }) // between boundaries: the strip keeps its place, the words are live
  const said = await command('')
  expect(said).toContain('Production — Changed just now · bad')
  expect(said).not.toContain('· good')
})

test('through the hooks a hinted slot pushed out by a fresh one waits 3 boundaries before it comes back, unless it changes', LONG, async ($, on) => {
  const clock = engine(on)
  const { hud, call, turn, state } = kit($)
  const frames: { strip: string[]; at: Record<string, number | undefined> }[] = []
  const decide = async () => {
    await turn()
    const s = await state()
    frames.push({ strip: s.arrangement?.strip ?? [], at: Object.fromEntries(Object.entries(s.slots).map(([k, v]) => [k, v.at])) })
    return s.arrangement?.strip
  }
  // the run's own items take three places (progress, errors, phases), so the slots have one
  await hud({ start: 'Wait', mode: 'research', progress: '1/4', phase: { name: 'Build', state: 'done' } })
  await hud({ phase: { name: 'Test', state: 'now' } })
  await call('Bash', { command: 'false', answer: { result: 'boom', isError: true } })
  // a deploy that failed, hinted by its source, then 32 calls of other work: 3 × 0.5^(32/12) + 0.5 = 0.97
  await call('deploys')
  for (let k = 0; k < 32; k++) await call('Bash', { command: 'true' })
  expect(await decide()).toEqual(['deploys/prod'])
  // a fresh edit (1.00) outranks it
  await call('Edit', { file_path: '/w/a.ts' })
  expect(await decide()).toEqual(['hud/edited'])
  // two calls on, the edit (0.89) has decayed below the deploy (0.90): without the wait it would come straight back
  await call('Bash', { command: 'true' })
  await call('Bash', { command: 'true' })
  expect(await decide()).toEqual(['hud/edited'])
  expect(await decide()).toEqual(['hud/edited'])
  // changed (a push a second later, as a session's clock moves), it comes back at once
  await clock.advance(1000)
  await call('deploys')
  expect(await decide()).toEqual(['deploys/prod'])
  expect(churn(frames).churn).toBe(0)
})

test("a bound widget is Claude's, though the observer fills it: claude/<id>, focusable, ranked by its last reading", LONG, async ($, on) => {
  engine(on)
  const { hud, call, turn, state, command } = kit($)
  // pure: the observer's stamp on a bound widget doesn't make it the HUD's
  const filled = { id: 'cov', type: 'ring' as const, title: 'Coverage', value: 81, bind: { on: 'shell' as const, match: 'coverage', extract: 'percent' as const }, by: 'observer', at: 0, n: 3 }
  const run = { ...apply(null, { start: 'Bound' }, 0), widgets: [filled] }
  expect(claudeSlots(run).map(s => [`${s.from}/${s.id}`, s.n])).toEqual([['claude/cov', 3]])
  expect(rank(claudeSlots(run), { mode: 'research', focus: ['claude/cov'], prefs: NONE, calls: 3, order: () => 0 })[0]).toMatchObject({ key: 'claude/cov', why: FOCUS })
  // through the hooks: Claude binds a widget to its test command; the observer fills it at the run's sixth call
  await hud({ start: 'Bound', mode: 'research', widget: { id: 'suite', type: 'stat', title: 'Suite', bind: { on: 'shell', match: 'npm test', extract: 'pass_fail' } } })
  for (let k = 0; k < 5; k++) await call('Bash', { command: 'true' })
  await call('Bash', { command: 'npm test', answer: { result: '', text: 'Tests: 2 failed, 39 passed, 41 total' } })
  await turn()
  const s = await state()
  expect(s.run?.widgets.find(w => w.id === 'suite')).toMatchObject({ by: 'observer', n: 6 })
  expect(s.arrangement?.strip).toContain('claude/suite')
  expect(await command('')).toContain('Suite — Changed just now')
  expect((await hud({ focus: ['claude/suite'] })).result).toBe('ok') // a key Claude may name
  expect(await command('')).toContain("Suite — Claude's focus")
})

test('a bound widget gone stale is one thing everywhere: no reading, changed when it last read, no tone', LONG, async ($, on) => {
  engine(on)
  const { hud, call, turn, state, command, drawn } = kit($)
  await hud({ start: 'Stale', mode: 'research', widget: { id: 'suite', type: 'stat', title: 'Suite', bind: { on: 'shell', match: 'npm test', extract: 'pass_fail' } } })
  // read at the first call; then 30 runs of the same command that print no summary
  await call('Bash', { command: 'npm test', answer: { result: '', text: 'Tests: 2 failed, 39 passed, 41 total' } })
  for (let k = 0; k < 30; k++) await call('Bash', { command: 'npm test', answer: { result: '', text: 'no summary' } })
  await turn()
  const why = 'Changed 30 calls ago · no tone'
  // the strip was decided on the same view: no reading, no old tone
  expect((await state()).arrangement?.why['claude/suite']).toBe(why)
  expect(await command('')).toContain(`Suite — ${why}`)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await drawn(surface, 'Pane')
    expect(pane.words.join(' ')).toContain('no reading')
    expect(pane.words.join(' ')).toContain(why)
    if (surface === 'desktop') {
      expect(pane.alt).toContain(`Suite: no reading — ${why}`)
      const band = await drawn(surface, 'AbovePrompt')
      expect(band.words).toContain('no reading')
      expect(band.alt).toContain(`Suite: no reading — ${why}`)
    }
  }
})

test('a hidden plan takes the progress it brought; Claude\'s own progress stays', LONG, async ($, on) => {
  engine(on)
  const { hud, call, turn, command, drawn } = kit($)
  const todos = [{ content: 'Read the issue', status: 'completed', activeForm: 'Reading' }, { content: 'Write the tests', status: 'in_progress', activeForm: 'Writing' }]
  const everything = async (surface: 'terminal' | 'desktop') => {
    const band = await drawn(surface, 'AbovePrompt'), pane = await drawn(surface, 'Pane')
    return [...band.words, band.alt, ...pane.words, pane.alt].join(' | ')
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    // the mirror leads, with its figure: 1 of 2 steps
    await hud({ start: `Plan on ${surface}`, mode: 'research' })
    await call('TodoWrite', { todos })
    await turn()
    expect(await everything(surface)).toMatch(/1 of 2|1\/2/)
    await command('hide hud/plan')
    expect(await everything(surface)).not.toMatch(/1 of 2|1\/2|steps/)
    await command('unhide hud/plan')
    // Claude's own progress is no plan's to take
    await hud({ start: `Own on ${surface}`, mode: 'research', progress: '3/8', progress_label: 'tasks' })
    await call('TodoWrite', { todos })
    await command('hide hud/plan')
    expect(await everything(surface)).toMatch(/3 of 8|3\/8/)
    await command('unhide hud/plan')
    await hud({ done: 'ok' })
  }
})
