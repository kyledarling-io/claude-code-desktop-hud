import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

import type { HudHeld, HudRun } from '../types'
import { AGING, AUTO_CALLS, STALE } from './lifecycle'
import { PINNED, rank, type Arrangement } from './rank'
import { agoOf, alarmLine, bandLines, cutText, entryOf, factList, figuresOf, fitFacts, fitLine, fitText, headerOf, len } from './render'
import { apply } from './run'
import { lay } from './cells'
import { dashboard, fit, measure, strip, stripPicked, wrapPx } from './svg'

// The terminal pass: what the desktop band and pane show of auto-run, the clocks, the
// auto-log, the slots with their why, the urgency place and the mode, the terminal's band and pane show too, by the
// same rules: a hidden slot never shows, the strip moves only at boundaries (the urgency place is the exception), and
// every figure, why and tone shown is the live one. Each feature loops over both surfaces.

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

// ---- the pure parts -----------------------------------------------------------------------------------------------

const held = (from: string, s: Omit<HudHeld, 'v' | 'from' | 'at'>, at = 0): HudHeld => ({ v: 1, from, at, ...s })
const TESTS = held('hud', { id: 'tests', pattern: 'stat', title: 'Tests', value: 2, unit: 'failed', tone: 'bad', n: 9 })
const PROD = held('deploys', { id: 'prod', pattern: 'stat', title: 'Production', value: 'failed', tone: 'bad', note: 'build 1432', n: 9 })
const placed = (...slots: HudHeld[]) => rank(slots, { mode: 'build', focus: [], prefs: { pinned: [], hidden: [] }, calls: 10, order: s => slots.indexOf(s) })

test("the urgency place as a line: ⚠ and what it says, in the slot's tone as it stands, as the desktop's mark is", () => {
  const says = 'Tests: 2 failed (were passing)'
  const tone = (t: HudHeld['tone']) => alarmLine({ slot: { ...TESTS, tone: t }, says }).color
  expect(alarmLine({ slot: TESTS, says })).toEqual({ text: `⚠ ${says}`, color: 'error' })
  expect([tone('bad'), tone('warn'), tone('good'), tone('info'), tone('accent'), tone(undefined)]).toEqual(['error', 'warning', 'success', 'suggestion', 'claude', 'claude'])
  // held after its rule stopped: it says what the slot says now, and wears the slot's tone as it stands now
  expect(alarmLine({ slot: { ...TESTS, value: 0, tone: 'good' }, says: 'npm test: 50 passed, 0 failed' })).toEqual({ text: '⚠ npm test: 50 passed, 0 failed', color: 'success' })
  expect(alarmLine({ slot: TESTS, says: 'run `npm test` **now**' }).text).toBe('⚠ run npm test now')
})

const LOSS = [1.92, 1.41, 1.08, 0.86, 0.71, 0.62, 0.55, 0.49, 0.47, 0.5, 0.44, 0.4, 0.37, 0.35, 0.34]
const widget = (w: Omit<HudRun['widgets'][number], 'id'>) => ({ id: 'w', ...w })

test('a figure for the band keeps its number whole and first: the spark or the bar is what shrinks', () => {
  const loss = figuresOf(widget({ type: 'line', points: LOSS }))
  expect(loss.map(f => f.split(' ')[0])).toEqual(['0.34', '0.34', '0.34', '0.34', '0.34']) // the last value first, every time
  expect(loss.map(len)).toEqual([20, 17, 13, 9, 4]) // fullest to barest
  const meter = figuresOf(widget({ type: 'meter', value: 62, max: 100, unit: '%' }))
  expect(meter.map(f => f.split(' ')[0])).toEqual(['62%', '62%', '62%', '62%', '62%']) // the percentage first, every time
  expect(meter.map(len)).toEqual([20, 16, 12, 8, 3]) // fullest to barest
  // a gauge, ring or meter headlines its value as the desktop does, never its share rounded to a percentage
  expect(figuresOf(widget({ type: 'meter', value: 71.5, max: 80, unit: 'GB' })).map(f => f.split(' █')[0]!.split(' ░')[0])).toEqual(['71.5 GB of 80', '71.5 GB of 80', '71.5 GB of 80', '71.5 GB of 80', '71.5 GB of 80', '71.5 GB'])
  expect(figuresOf(widget({ type: 'gauge', value: 91.2, unit: '%', max: 100 }))[0]).toMatch(/^91\.2% [█░]+$/)
  expect(figuresOf(widget({ type: 'ring', value: 3, max: 10 })).at(-2)).toBe('3 of 10')
  expect(figuresOf(widget({ type: 'stat', value: 0, unit: 'failed', delta: -2 }))).toEqual(['0 failed (▼2)', '0 failed'])
  expect(figuresOf(widget({ type: 'stat', value: 'failed' }))).toEqual(['failed'])
  // a checklist: done of total, then the step in hand, in whole words, down to the count
  const plan = figuresOf(widget({ type: 'checklist', items: [{ label: 'Map the call sites', state: 'done' }, { label: 'Move refresh logic behind it', state: 'now' }, { label: 'Delete the old path' }] }))
  expect(plan).toEqual(['1 of 3  ▸ Move refresh logic behind it', '1 of 3  ▸ Move refresh logic behind', '1 of 3  ▸ Move refresh logic', '1 of 3  ▸ Move refresh', '1 of 3  ▸ Move', '1 of 3'])
  expect(figuresOf(widget({ type: 'line', points: [] }))).toEqual(['no points yet'])
})

test('a band line never cuts a figure: the why gives way, then the spark or bar, then the title, and the line goes whole', () => {
  const why = 'Changed 12 calls ago · warn'
  const loss = figuresOf(widget({ type: 'line', points: LOSS })), limit = figuresOf(widget({ type: 'meter', value: 62, max: 100, unit: '%' }))
  for (const cols of [60, 105, 150]) {
    for (const [title, figures] of [['Training loss', loss], ['5-hour limit', limit], ['Production (from deploys)', ['failed']], ['A title that goes on and on and on past any room a band has', limit]] as const) {
      const l = fitLine(title, [...figures], why, cols)
      expect(l).toBeDefined()
      const text = `  ${l!.title}: ${l!.figure}${l!.why ? `  ${l!.why}` : ''}`
      expect(len(text)).toBeLessThanOrEqual(cols)
      expect(figures).toContain(l!.figure) // a figure as figuresOf() gave it, whole
      expect(text).not.toMatch(/\d…/) // no cut number
    }
  }
  // roomy: all of it; narrower: the why is cut, then gone, while the figure is whole
  expect(fitLine('Training loss', loss, why, 150)).toEqual({ title: 'Training loss', figure: loss[0], why })
  const cutWhy = fitLine('Training loss', loss, why, 60)!
  expect(cutWhy).toMatchObject({ title: 'Training loss', figure: loss[0] })
  expect(cutWhy.why).toBe('Changed 12 calls ago…')
  expect(fitLine('Training loss', loss, why, 40)!.why).toBeUndefined()
  // a why cut down to one word says nothing, and goes
  const step = figuresOf(widget({ type: 'checklist', items: [{ label: 'Move refresh logic behind it', state: 'now' }] }))
  expect(fitLine('Plan', step, 'Changed just now · no tone', 60)).toEqual({ title: 'Plan', figure: step[0] })
  // then the spark shrinks (the number stays), then the title is cut, and a figure that fits nowhere drops the line
  expect(fitLine('Training loss', loss, why, 28)!.figure).toBe(loss.find(f => 2 + 13 + 2 + len(f) <= 28))
  expect(fitLine('Training loss', loss, why, 16)).toEqual({ title: 'Trainin…', figure: '0.34' })
  expect(fitLine('Training loss', loss, why, 9)).toBeUndefined()
  // the percentage of a meter is never cut to a bare bar
  for (let cols = 8; cols < 60; cols++) {
    const l = fitLine('5-hour limit', limit, why, cols)
    if (l) expect(l.figure).toMatch(/^62%/)
  }
})

test("the header row, budgeted: the bar gives way first, then the goal, then the title; the strip's own are a line each when the facts have no room", () => {
  const r0 = apply(null, { start: 'Deploy v2.4 to 12 hosts', goal: 'Roll out with a canary, then batches of 120', progress: '7/12', progress_label: 'hosts', phase: { name: 'Rollout', state: 'now' } }, 0)
  const r = { ...apply(r0, { phase: { name: 'Verify', state: 'todo' } }, 0), errors: 1, calls: 4 }
  const at = (cols: number, o: Partial<Parameters<typeof headerOf>[0]> = {}) => headerOf({ r, now: 0, jobs: 0, cols, dot: 2, buttons: 17, hasBar: true, picked: ['progress', 'errors', 'phases'], drawn: [], open: false, ...o })
  // roomy: the title and the goal whole, every fact, a bar from what is left (from 151 columns: ⏱ takes two)
  expect(at(151)).toMatchObject({ title: 'Deploy v2.4 to 12 hosts', goal: 'Roll out with a canary, then batches of 120', facts: '⏱ 0:00  ·  7/12 hosts  ·  ▸ Rollout  ·  1 error', bar: 10, own: [] })
  // narrower: the bar goes, the goal is cut at a word (never "…120" cut to "1…"), then dropped
  expect(at(106)).toMatchObject({ goal: 'Roll out…', bar: 0 })
  expect(at(80).goal).toBeUndefined()
  // narrower: the title is cut at a word, never "Deploy v2.4 to 1…"; the clock goes before the errors and the step
  expect(at(60)).toMatchObject({ title: 'Deploy v2.4 to…', facts: '▸ Rollout  ·  1 error' })
  // and what the strip chose that the facts have no room for is a line of its own, never dropped
  expect(at(60).own.map(l => `${l.title}: ${l.figure}`)).toEqual(['Progress: 7 of 12 hosts'])
  expect(at(45).own.map(l => `${l.title}: ${l.figure}`)).toEqual(['Progress: 7 of 12 hosts', 'Phase: 1 of 2  ▸ Rollout'])
  expect(at(30)).toMatchObject({ facts: '', own: [{ key: 'progress' }, { key: 'errors', figure: '1 of 4 calls' }, { key: 'phases' }] })
  // what the strip did not choose is not drawn for it; with the dashboard open, the title alone
  expect(at(30, { picked: [] }).own).toEqual([])
  expect(at(60, { open: true })).toEqual({ title: 'Deploy v2.4 to 12 hosts', facts: '', bar: 0, own: [] })
})

test('a last line is fitted to its columns: a path shortened first, then cut at a word, never after a number', () => {
  const line = 'Wrote /srv/billing/ledger/backfill/shard-07/reconcile-report.json; 18,200 accounts reconciled, 0 mismatches. Next: shards 8 to 12'
  expect(fitText(line, 200)).toBe(line) // it fits: as it is
  expect(fitText(line, 100).startsWith('Wrote …/')).toBe(true) // it doesn't: the path first
  for (let cols = 12; cols <= 140; cols++) {
    const t = fitText(line, cols)
    expect(len(t), `${cols}`).toBeLessThanOrEqual(cols)
    expect(t, `${cols}`).not.toMatch(/\d…/)
  }
})

test('cutting text: at a word, with …, never after a digit', () => {
  expect(cutText('Changed 12 calls ago · warn', 17)).toBe('Changed 12 calls…')
  expect(cutText('Changed 12 calls ago', 20)).toBe('Changed 12 calls ago')
  expect(cutText('abc def ghi', 8)).toBe('abc def…') // already at a word's end: kept
  expect(cutText('Phase 2 audit of the ledger', 9)).toBe('Phase…') // not "Phase 2…": a number cut reads as a smaller one
  expect(cutText('Production', 5)).toBe('Prod…')
})

// An East Asian wide or fullwidth character, ⏱, ⚠ and every other pictograph are counted as 2 columns, the width some
// terminals give them; counting wide only cuts a column sooner.
test('a wide character takes two columns, and an em where the desktop measures it; a cut counts columns, not characters', () => {
  expect([len('構築'), len('ｗｉｄｅ'), len('⏱ 0:00'), len('⚠ Tests'), len('▸ ✓ ● → … ·'), len('abc')]).toEqual([4, 8, 7, 8, 11, 3])
  expect(['✔', '❤', '☀', '➡', '⏲', '✅', '©', '🚀'].map(len)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]) // every pictograph
  expect([len(String.fromCharCode(0x26a0, 0xfe0f)), len('e' + String.fromCharCode(0x301))]).toEqual([2, 1]) // a variation selector, and a mark that joins its letter, take none
  for (const room of [4, 7, 10, 15]) expect(len(cutText('構築テスト結果の確認と修正を行う', room)), `${room}`).toBeLessThanOrEqual(room)
  expect(lay({ type: 'Text', children: ['請求 v2.4'] }, 6).overflow).toEqual(['9 > 6: 請求 v2.4'])
  expect(lay({ type: 'Text', props: { wrap: 'truncate-end' }, children: ['請求サービス'] }, 7).lines).toEqual(['請求サ…'])
  expect(Math.abs(measure('構築', 13) - measure('MM', 13) / 0.84)).toBeLessThan(1e-9) // 1em each, M being 0.84
})

test("text cut by fit() or wrapPx() never ends right after a number, at any width", () => {
  const texts = ['Deploy v2.4 to 12 hosts', "Beat v6's 89.4% validation accuracy within 10 epochs", 'Wrote /srv/billing/shard-07/report.json; 18,200 accounts reconciled, 0 mismatches. Next: shards 8 to 12', 'p95 under 120 ms on the replay set', 'invoices 1300000 backfilled', 'Phase 2 audit of the ledger 2026']
  for (const t of texts) {
    for (let px = 20; px <= 900; px++) {
      expect(fit(t, px, 13), `${t} @ ${px}`).not.toMatch(/\d…$/)
      for (const l of wrapPx(t, px, 13, 2, { bold: true })) expect(l, `${t} @ ${px}`).not.toMatch(/\d…$/)
    }
  }
})

test('header facts are whole or not at all, the ones that matter most kept first, in their own order', () => {
  const r = apply(null, { start: 'Ship it', progress: '7/12', progress_label: 'hosts', phase: { name: 'Rollout to production hosts', state: 'now' } }, 0)
  const facts = factList({ ...r, errors: 3, calls: 9 }, 420_000, [], Infinity, 2)
  expect(facts.map(f => f.text)).toEqual(['⏱ 7:00', '2 jobs running', '7/12 hosts', '▸ Rollout to production hosts', '3 errors'])
  expect(fitFacts(facts, 100)).toBe('⏱ 7:00  ·  2 jobs running  ·  7/12 hosts  ·  ▸ Rollout to production hosts  ·  3 errors')
  // narrower: what the strip draws outranks the clock (the errors, the step, the progress), the jobs go first
  expect(fitFacts(facts, 70)).toBe('⏱ 7:00  ·  7/12 hosts  ·  ▸ Rollout to production hosts  ·  3 errors')
  expect(fitFacts(facts, 40)).toBe('⏱ 7:00  ·  7/12 hosts  ·  3 errors')
  expect(fitFacts(facts, 25)).toBe('7/12 hosts  ·  3 errors')
  expect(fitFacts(facts, 8)).toBe('3 errors') // the clock is the first of the strip's own to go: not "⏱ 7…", not "3 err…"
  expect(fitFacts(facts, 7)).toBe('⏱ 7:00') // too narrow for the errors, so the clock whole
  expect(fitFacts(facts, 5)).toBe('')
  const left: typeof facts = []
  fitFacts(facts, 40, left)
  expect(left.map(f => f.key)).toEqual(['jobs', 'step']) // what did not fit
})

test("the band's lines: exactly the items the desktop strip chose, in its order, each as it stands now", () => {
  const board = placed(TESTS, PROD)
  const r = apply(null, { start: 'Ship', set: { 'invoices backfilled': 1300000 }, point: 3 }, 0)
  const r2 = apply(r, { point: 5 }, 0)
  const picked = stripPicked(r2, [TESTS, PROD], undefined, undefined)
  // the run's own (a tile, the trend) and the slots after them: the same list the strip draws
  expect(picked.map(p => p.key)).toEqual(['invoices backfilled', 'trend', 'hud/tests', 'deploys/prod'])
  const lines = bandLines(picked, board, r2, 105)
  expect(lines.map(l => `${l.title}: ${l.figure}`)).toEqual(['invoices backfilled: 1.3M', 'Trend: 5 ▁█', 'Tests: 2 failed', 'Production (from deploys): failed'])
  expect(lines[2]!.why).toBe(board.find(p => p.key === 'hud/tests')!.why) // the board's why, now
  expect(lines[0]!.why).toBeUndefined() // the run's own items are on no board
  // hidden or muted since: the board no longer holds the slot, so the band doesn't draw it
  expect(bandLines(picked, board.filter(p => p.key !== 'hud/tests'), r2, 105).map(l => l.title)).toEqual(['invoices backfilled', 'Trend', 'Production (from deploys)'])
  // progress, phases and errors are the header's
  const own = apply(apply(r2, { progress: '1/4', phase: { name: 'Build', state: 'now' } }, 0), { phase: { name: 'Ship', state: 'todo' } }, 0)
  expect(stripPicked(own, [], undefined, undefined).map(p => p.key)).toEqual(['progress', 'invoices backfilled', 'phases'])
  expect(bandLines(stripPicked(own, [], undefined, undefined), [], own, 105).map(l => l.title)).toEqual(['invoices backfilled'])
})

test('an entry: the title signed when another plugin sent it, the figure, and how long a widget of Claude has sat', () => {
  const r = apply(null, { start: 'Tune', widget: { id: 'heap', type: 'meter', title: 'Heap', value: 5, max: 8 } }, 0)
  const heap = placed(...[held('claude', { id: 'heap', pattern: 'meter', title: 'Heap', value: 5, max: 8 })])[0]!
  expect(entryOf(heap, r)).toMatchObject({ title: 'Heap', value: '5 of 8 ██████████░░░░░░', old: false, ago: undefined })
  // aging: 12 calls on and three minutes later (as of the run's last call)
  const aging = { ...r, ticks: AGING, tickAt: 180_000 }
  expect(entryOf(heap, aging)).toMatchObject({ old: true, ago: '3m ago' })
  const sold = placed(PROD)[0]!
  expect(entryOf(sold, r)).toMatchObject({ title: 'Production (from deploys)', value: 'failed', note: 'build 1432', old: false })
  expect(entryOf(placed(TESTS)[0]!, r)).toMatchObject({ title: 'Tests', value: '2 failed' }) // the HUD's own go unsigned
  expect(agoOf({ at: 0, tick: 0 }, aging)).toBe('3m ago')
  expect(agoOf({ at: 0, tick: AGING }, aging)).toBeUndefined() // fresh
  expect(agoOf(undefined, aging)).toBeUndefined()
})

// ---- through the hooks, on both surfaces --------------------------------------------------------------------------

// What $.state holds, read by an inline plugin (a test's own $ has no state): /peek answers with it.
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async $ => ({
    text: JSON.stringify({
      run: (await $.state.get({ plugin: 'hud', key: 'run' })).value ?? null,
      arrangement: (await $.state.get({ plugin: 'hud', key: 'arrangement' })).value ?? null,
      urgent: (await $.state.get({ plugin: 'hud', key: 'urgent' })).value ?? null,
    }),
  }))
}
// Another plugin's slot: a deploy that failed, with the source's hint that it matters.
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

type Loose = (i: object) => Promise<{ text?: string; result?: unknown; context?: readonly string[] }>
type Handle = { drawn: () => Promise<unknown>; press: (t: { key: string }) => Promise<unknown>; unmount: () => Promise<void> }
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (n: unknown): Node[] => (typeof n === 'object' && n !== null ? [n as Node, ...((n as Node).children ?? []).flatMap(nodes)] : [])
const text = (n: unknown): string => (typeof n === 'string' ? n : typeof n === 'object' && n !== null ? ((n as Node).children ?? []).map(text).join('') : '')
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)</g)].map(m => m[1]!)
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 105, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }

// The engine beneath: the app's one dock, someone watching, each call answered as it says (else ok), a message entering
// as sent, a measure reporting what changed, and the engine's own band an empty drawing.
const beneath = (on: On, surfaces: () => Surface[] = () => []) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on)
  const shown = new Set<string>()
  on('ui.open', ($, e) => (shown.add(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($, e) => (shown.delete(e.id), { value: undefined }))
  on('ui.panes', () => ({ value: [...shown].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.surfaces', () => ({ value: surfaces() }))
  on('tool.call', ($, e) => (e as unknown as { answer?: { result: unknown } }).answer ?? { result: 'ok' })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__hud__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  return clock
}

const kit = ($: Engine) => {
  const loose = (f: unknown) => f as Loose
  const mount = (surface: Surface, component: 'AbovePrompt' | 'Pane', cols?: number) =>
    ($.ui.mount as unknown as (t: object) => Promise<Handle>)({
      plugin: 'hud', surface, component, ...(component === 'Pane' ? { requestId: 'hud', props: { ...pane, ...(cols ? { bodyColumns: cols } : {}) } } : { props: { ...band, ...(cols ? { bodyColumns: cols } : {}) } }),
    })
  const k = {
    hud: (i: object) => loose($.tool.call)({ tool: 'mcp__hud__hud', ...i }),
    call: (tool: string, i: object = {}) => loose($.tool.call)({ tool, ...i }),
    bash: async (n: number) => { for (let j = 0; j < n; j++) await loose($.tool.call)({ tool: 'Bash', command: 'true' }) },
    npm: (summary: string) => loose($.tool.call)({ tool: 'Bash', command: 'npm test', answer: { result: summary, text: summary } }),
    measure: (context: number) => loose($.session.measure)({ context: { window: 1_000_000, percent: context, tokens: context * 10_000 }, rateLimits: [], changed: ['context'] }),
    turn: () => loose($.turn.complete)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }),
    say: (t: string) => loose($.prompt.submit)({ text: t, wait: false, origin: { kind: 'composer' } }),
    command: async (args: string) => String((await loose($.command.run)({ command: 'hud', args })).text),
    state: async () => JSON.parse(String((await loose($.command.run)({ command: 'peek', args: '' })).text)) as { run: HudRun | null; arrangement: Arrangement | null; urgent: { says: string; heldTo?: number } | null },
    mount,
    // what a surface draws: its nodes, the lines of a terminal drawing top to bottom, and for the desktop the words of its
    // image and its alt
    drawn: async (surface: Surface, component: 'AbovePrompt' | 'Pane', cols?: number) => {
      const ui = await mount(surface, component, cols)
      const root = (await ui.drawn()) as Node
      await ui.unmount()
      const all = nodes(root), svg = all.find(n => n.type === 'Svg')?.props
      const rows = (root.children ?? []).map(text).map(r => r.trimStart())
      const words = [...all.filter(n => n.type === 'Text').map(text), ...(svg ? texts(String(svg.source)) : [])].map(w => w.replaceAll(' ', ' '))
      return { root, all, rows, words, alt: String(svg?.alt ?? ''), source: String(svg?.source ?? '') }
    },
  }
  return k
}
type Drawn = Awaited<ReturnType<ReturnType<typeof kit>['drawn']>>
const first = (d: Drawn) => (d.root.children as Node[])[0]!

test("the urgency place: a first line ⚠ <says> in the slot's tone, then the slot as it says it now, then gone at the boundary", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  for (const surface of SURFACES) {
    await k.hud({ start: `Ship it on ${surface}`, progress: '3/8' })
    await k.npm('Tests: 0 failed, 41 passed, 41 total')
    await k.npm('Tests: 2 failed, 39 passed, 41 total')
    const says = 'Tests: 2 failed (were passing)'
    expect((await k.state()).urgent).toMatchObject({ says })
    const [b, p] = [await k.drawn(surface, 'AbovePrompt'), await k.drawn(surface, 'Pane')]
    if (surface === 'terminal') {
      // the first line of the band and of the pane
      for (const d of [b, p]) {
        expect(d.rows[0]).toBe(`⚠ ${says}`)
        expect(first(d).props).toMatchObject({ color: 'error', bold: true }) // the tests slot is bad: red, as the desktop's mark is
      }
    } else {
      expect(b.alt.startsWith(`Urgent: ${says}.`)).toBe(true) // the desktop strip leads with it, and the alt says it first
      expect(b.words).toContain('Urgent')
      expect(b.words).toContain(says)
    }
    // the pane names it among the board, too, as the slot's why
    expect(p.words.join('\n')).toContain(`Urgent: ${says}`)

    // the tests go green: the place stays until the boundary, saying the slot's note as it is now, never the old state
    await k.npm('Tests: 0 failed, 50 passed, 50 total')
    expect((await k.state()).urgent).toMatchObject({ says: 'npm test: 50 passed, 0 failed', heldTo: 1 })
    const [hb, hp] = [await k.drawn(surface, 'AbovePrompt'), await k.drawn(surface, 'Pane')]
    for (const d of [hb, hp]) expect(d.words.join('\n')).not.toContain('were passing')
    if (surface === 'terminal') {
      for (const d of [hb, hp]) {
        expect(d.rows[0]).toBe('⚠ npm test: 50 passed, 0 failed')
        expect(first(d).props?.color).toBe('success') // the slot is good again; the line doesn't wear the alarm of a state that passed
      }
    } else expect(hb.alt.startsWith('Urgent: npm test: 50 passed, 0 failed.')).toBe(true)

    // the dashboard open beside it has the whole board, so the band keeps its header (the whole of it: tests/pane-open below)
    const ui = await k.mount(surface, 'AbovePrompt')
    await ui.press({ key: 'toggle' })
    const open = nodes(await ui.drawn())
    expect(open.map(text).join('\n')).not.toMatch(/⚠|Urgent/)
    await ui.press({ key: 'toggle' })
    await ui.unmount()

    // the boundary: the place is empty, on both
    await k.turn()
    expect((await k.state()).urgent).toBeNull()
    for (const d of [await k.drawn(surface, 'AbovePrompt'), await k.drawn(surface, 'Pane')]) expect(d.words.join('\n')).not.toMatch(/⚠|Urgent/)
    await k.hud({ done: 'ok' })
  }
})

test("the urgency place leads the band at 60, 105 and 150 columns, and an outside plugin's slots in the HUD's names raise none", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Ship it', progress: '3/8' })
  await k.measure(60)
  for (const surface of SURFACES) for (const cols of [60, 105, 150]) expect((await k.drawn(surface, 'AbovePrompt', cols)).words.join('\n')).not.toMatch(/⚠|Urgent/)
  await k.measure(90)
  for (const cols of [60, 105, 150]) {
    const t = await k.drawn('terminal', 'AbovePrompt', cols)
    expect(t.rows[0]).toBe('⚠ Context 90%; compaction is near')
    expect(first(t).props?.wrap).toBe('truncate-end') // the terminal cuts it to the band, never wraps it onto a second line
    expect((await k.drawn('desktop', 'AbovePrompt', cols)).alt).toContain('Urgent: Context 90%; compaction is near.')
  }
})

test('a hidden slot never raises the urgency line, and a muted source takes it away at once', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Ship it', progress: '3/8' })
  await k.measure(90)
  for (const surface of SURFACES) expect((await k.drawn(surface, 'AbovePrompt')).words.join('\n')).toContain('Context 90%')
  // the person hides it: it shows nowhere, whatever the rules say
  expect(await k.command('hide hud/context')).toContain('Hid')
  for (const surface of SURFACES) for (const component of ['AbovePrompt', 'Pane'] as const) expect((await k.drawn(surface, component)).words.join('\n')).not.toMatch(/⚠|Urgent|Context 90%/)
  expect(await k.command('unhide hud/context')).toContain('shown')
  for (const surface of SURFACES) expect((await k.drawn(surface, 'AbovePrompt')).words.join('\n')).toContain('Context 90%')
  await k.command('mute context and cost')
  for (const surface of SURFACES) expect((await k.drawn(surface, 'AbovePrompt')).words.join('\n')).not.toMatch(/⚠|Urgent|Context 90%/)
})

test("a hidden slot's rule holds no place: the next rule's takes it, and the first takes it back at once when unhidden", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Ship it', progress: '3/8' })
  await k.npm('Tests: 0 failed, 41 passed, 41 total') // the slot exists, and the person hides it (only a slot the HUD holds can be)
  expect(await k.command('hide hud/tests')).toContain('Hid')
  await k.npm('Tests: 2 failed, 39 passed, 41 total') // rule U3 would hold, over a slot nobody sees
  expect((await k.state()).urgent).toBeNull()
  await k.measure(90)
  expect((await k.state()).urgent).toMatchObject({ rule: 'U4', says: 'Context 90%; compaction is near' })
  for (const surface of SURFACES) {
    const band = await k.drawn(surface, 'AbovePrompt')
    expect(band.words.join('\n') + band.alt).toContain('Context 90%; compaction is near')
    expect(band.words.join('\n') + band.alt).not.toContain('Tests: 2 failed')
  }
  // unhidden, the earlier rule is first again
  await k.command('unhide hud/tests')
  expect((await k.state()).urgent).toMatchObject({ rule: 'U3', says: 'Tests: 2 failed (were passing)' })
  for (const surface of SURFACES) expect((await k.drawn(surface, 'AbovePrompt')).words.join('\n')).toContain('Tests: 2 failed (were passing)')
})

// A run with no progress of its own, so the strip is the slots alone: Claude's loss, a deploy that failed long ago
// (lifted by its source's hint) and an edit just now. Research mode puts neither first, so the score decides.
const SHIPPING = async (k: ReturnType<typeof kit>, name: string) => {
  await k.hud({ start: name, mode: 'research', widget: { id: 'loss', type: 'stat', title: 'Loss', value: 0.4 } })
  await k.call('deploys')
  await k.bash(20)
  await k.call('Edit', { file_path: '/w/a.ts' })
  await k.turn()
}

test('slots in rank order, each with its why: the terminal band lists the strip as the last boundary decided it, the pane the whole board', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  for (const surface of SURFACES) {
    await SHIPPING(k, `Why on ${surface}`)
    expect((await k.state()).arrangement?.strip).toEqual(['deploys/prod', 'hud/edited', 'claude/loss'])
    const want = [['Production', 'Hinted by deploys'], ['Files edited', 'Changed just now · no tone'], ['Loss', 'Changed 22 calls ago · no tone']] as const
    const b = await k.drawn(surface, 'AbovePrompt'), p = await k.drawn(surface, 'Pane')
    if (surface === 'terminal') {
      // one line per slot under the header, in the strip's order; the figure, then its why whole at the line's end
      const lines = b.rows.filter(r => want.some(([title]) => r.startsWith(title)))
      expect(lines).toHaveLength(3)
      want.forEach(([title, why], i) => { expect(lines[i]).toMatch(new RegExp(`^${title}.*  ${why}$`)) })
      expect(lines[0]).toContain('Production (from deploys): failed') // another plugin's slot is signed
    } else {
      // the desktop's strip draws their figures and its alt says each with its why, in rank order
      want.forEach(([title, why]) => expect(b.alt).toMatch(new RegExp(`${title}[^—]*— ${why}`)))
      expect(want.map(([title]) => b.alt.indexOf(title))).toEqual([...want.map(([title]) => b.alt.indexOf(title))].sort((x, y) => x - y))
    }
    // the pane: the whole board in rank order, each with its why (the terminal's under the figure; the desktop's under its title)
    const words = p.words.join('\n')
    want.forEach(([title, why]) => { expect(words).toContain(why); expect(words.indexOf(title)).toBeLessThan(words.indexOf(why)) })
    expect(want.map(([, why]) => words.indexOf(why))).toEqual(want.map(([, why]) => words.indexOf(why)).sort((x, y) => x - y))
    await k.hud({ done: 'ok' })
  }
})

test('the strip moves only at boundaries; between them a figure changes in place, and the why and tone are the live ones', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  for (const surface of SURFACES) {
    await k.hud({ start: `Boundaries on ${surface}`, widget: { id: 'loss', type: 'stat', title: 'Loss', value: 0.4 } })
    await k.turn()
    // a slot new to the session waits for the boundary in the band; the pane has it at once. (A why is live and moves with
    // the calls; which slots show, and in what order, does not.)
    const titles = async () => (await k.drawn(surface, 'AbovePrompt')).rows.filter(r => /^[\w ()]+: /.test(r)).map(r => r.split(': ')[0])
    const before = await titles()
    const slot = surface === 'terminal' ? 'Production' : 'Staging' // new to the session each time round
    await k.call('deploys', { value: 'failed', stage: surface === 'desktop' })
    expect((await k.drawn(surface, 'Pane')).words.join('\n')).toContain(slot)
    const mid = await k.drawn(surface, 'AbovePrompt')
    if (surface === 'terminal') expect(await titles()).toEqual(before)
    else expect(mid.words).not.toContain(slot)
    await k.turn()
    const after = await k.drawn(surface, 'AbovePrompt')
    expect(after.words.join('\n')).toContain(slot)
    if (surface === 'terminal') expect(after.rows.find(r => r.startsWith(slot))).toMatch(/failed {2}Changed just now · bad$/)
    // between boundaries the figure changes in place: the band says what the slot says now, the why with it
    await k.call('deploys', { value: 'live', tone: 'good', stage: surface === 'desktop' })
    const live = await k.drawn(surface, 'AbovePrompt')
    if (surface === 'terminal') {
      expect(live.rows.find(r => r.startsWith(slot))).toMatch(/: live {2}Hinted by deploys$/) // the why moved with the figure: the hint now lifts it, the tone is good
      expect(live.rows.join('\n')).not.toMatch(/failed|· bad/) // neither the old figure nor the old tone
    } else {
      expect(live.words).toContain('live')
      expect(live.words).not.toContain('failed')
    }
    // a call that raises another new slot (the HUD's own, new to the session each time round) moves nothing in the band
    // until a boundary, and a phase is one
    const title = surface === 'terminal' ? 'Files edited' : 'Context'
    await (surface === 'terminal' ? k.call('Edit', { file_path: '/w/b.ts' }) : k.measure(40))
    expect((await k.drawn(surface, 'AbovePrompt')).words.join('\n')).not.toContain(title)
    await k.hud({ phase: { name: 'Build', state: 'now' } }) // a boundary
    expect((await k.drawn(surface, 'AbovePrompt')).words.join('\n')).toContain(title)
    await k.hud({ done: 'ok' })
  }
})

test('hidden never shows, even between boundaries; a muted sender is gone and back', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  for (const surface of SURFACES) {
    await SHIPPING(k, `Hide on ${surface}`)
    const slots = async () => (await k.drawn(surface, 'AbovePrompt')).words.join('\n')
    expect(await slots()).toContain('Production')
    await k.command('hide deploys/prod')
    expect(await slots()).not.toContain('Production')
    expect((await k.drawn(surface, 'Pane')).words.join('\n')).not.toContain('Hinted by')
    await k.command('unhide deploys/prod')
    expect(await slots()).toContain('Production')
    await k.command('mute deploys')
    expect(await slots()).not.toContain('Production')
    // (the Sources list still names its slots, so a muted one can come back; the board has none of them)
    const board = await k.drawn(surface, 'Pane')
    expect(surface === 'terminal' ? board.words.filter(w => w.startsWith('Production (from')) : texts(board.source).filter(w => w === 'Production')).toEqual([])
    await k.command('unmute deploys')
    expect(await slots()).toContain('Production')
    await k.hud({ done: 'ok' })
  }
})

test("the person's pin leads the band, and the mode puts its slots first with its name as their why", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  for (const surface of SURFACES) {
    await k.hud({ start: `Mode on ${surface}`, widget: { id: 'loss', type: 'stat', title: 'Loss', value: 0.4 } })
    await k.call('Edit', { file_path: '/w/a.ts' })
    await k.npm('Tests: 1 failed, 40 passed, 41 total')
    await k.command('mode debug')
    const b = await k.drawn(surface, 'AbovePrompt'), p = await k.drawn(surface, 'Pane')
    // the mode's own slots lead with its name, the rest go by score
    if (surface === 'terminal') expect(b.rows.find(r => r.startsWith('Tests'))).toMatch(/ {2}Debug mode$/)
    else expect(b.alt).toMatch(/Tests[^—]*— Debug mode/)
    expect(p.words.join('\n')).toContain('Debug mode')
    // the pane says the mode and what the person set, on both surfaces
    expect(p.words.join('\n')).toContain('Mode: Debug (set by you)')
    await k.command('pin claude/loss')
    const pinned = await k.drawn(surface, 'AbovePrompt')
    if (surface === 'terminal') expect(pinned.rows.filter(r => /^(Loss|Tests|Files edited)/.test(r))[0]).toMatch(new RegExp(`^Loss.*  ${PINNED}$`))
    else expect(pinned.alt).toMatch(new RegExp(`Loss[^—]*— ${PINNED}`))
    expect((await k.drawn(surface, 'Pane')).words.join('\n')).toContain('Pinned: claude/loss')
    await k.command('unpin claude/loss')
    await k.command('mode build')
    await k.hud({ done: 'ok' })
  }
})

// The desktop strip's own captions, in its order: one `caps()` text per item (progress, phases, errors and the urgency place
// among them).
const stripLabels = (d: Drawn) => [...d.source.matchAll(/<text[^>]*font-size="11" font-weight="500"[^>]*class="m"[^>]*>([^<]*)</g)].map(m => m[1]!.replaceAll(' ', ' '))
// The titles of the terminal band's slot lines, in order (the band's last line is a log line, which may read "tests: 2 failed" too).
const bandTitles = (d: Drawn, log: string[] = []) => d.rows.flatMap(r => (log.includes(r) ? [] : /^([^:]{2,60}): /.exec(r)?.[1] ?? []))

// Four runs the trial draws, each with a different kind of item in the strip's frame: tiles, the plan, a widget of Claude's
// as the trend and its slots, and widgets bound to Claude's own commands.
const RUNS: Record<string, { skip: string; make: (k: ReturnType<typeof kit>, clock: { advance: (ms: number) => Promise<void> }) => Promise<unknown> }> = {
  long: {
    skip: 'no progress here',
    make: async k => {
      await k.hud({ start: 'Migrate the billing and invoicing subsystem to the event-sourced ledger', goal: 'Move every invoice into the ledger', phase: { name: 'Backfill', state: 'done' }, set: { 'invoices backfilled so far': 1300000, 'customer accounts reconciled': 18200 } })
      await k.hud({ phase: { name: 'Reconcile balances', state: 'now' } })
    },
  },
  plan: {
    skip: 'steps',
    make: async k => {
      await k.hud({ start: 'Refactor auth module', goal: 'Move token refresh behind one interface' })
      await k.call('TodoWrite', { todos: [
        { content: 'Map the call sites', status: 'completed', activeForm: 'Mapping' }, { content: 'Move refresh logic behind it', status: 'in_progress', activeForm: 'Moving' }, { content: 'Run the auth tests', status: 'pending', activeForm: 'Running' },
      ] })
    },
  },
  aging: {
    skip: 'shards|progress', // (the later progress call sends no label)
    make: async (k, clock) => {
      await k.hud({ start: 'Tune the search index', goal: 'p95 under 120 ms', progress: '2/5', progress_label: 'shards', set: { 'docs indexed': 41200 }, widgets: [
        { id: 'recall', type: 'stat', title: 'Recall@10', value: 0.91 },
        { id: 'build', type: 'line', title: 'Index build time', unit: 's', better: 'down', tone: 'info', points: [212, 198, 187, 176, 171] },
        { id: 'mix', type: 'donut', title: 'Query mix', items: [{ label: 'keyword', value: 52 }, { label: 'semantic', value: 31 }] },
      ] })
      await clock.advance(3 * 60_000)
      await k.bash(12)
      await k.hud({ widget: { id: 'heap', type: 'meter', title: 'Heap', value: 5.1, max: 8, unit: 'GB', tone: 'warn' } })
      await clock.advance(4 * 60_000)
      await k.bash(12)
      await k.hud({ progress: '3/5', set: { 'queries replayed': 1800 } })
    },
  },
  bound: {
    skip: 'progress',
    make: async k => {
      await k.hud({ start: 'Fix the flaky ledger suite', goal: 'Green tests on three runs in a row', widgets: [
        { id: 'tests', type: 'stat', title: 'Tests', bind: { on: 'shell', match: 'npm test', extract: 'pass_fail' } },
        { id: 'p95', type: 'line', title: 'Bench p95', unit: 'ms', better: 'down', tone: 'info', points: [212, 205], bind: { on: 'shell', match: 'bench', extract: 'last_number' } },
        { id: 'cov', type: 'ring', title: 'Coverage', bind: { on: 'shell', match: 'coverage', extract: 'percent' } },
      ] })
      await k.call('Bash', { command: 'npm run coverage', answer: { result: '', text: 'All files | 81.4%' } })
      for (let n = 0; n < STALE; n++) await k.call('Bash', { command: 'npm run coverage', answer: { result: '', text: 'coverage: no data' } })
      for (const ms of [201, 198, 194]) await k.call('Bash', { command: 'npm run bench', answer: { result: '', text: `p95: ${ms}ms` } })
      await k.npm('Tests: 2 failed, 39 passed, 41 total')
      await k.turn()
    },
  },
}

test("the band draws exactly the items the desktop strip chose, in its order: tiles, the plan, a trend and bound widgets, not only the arranged slots", { plugins }, async ($, on) => {
  const clock = beneath(on)
  const k = kit($)
  for (const [name, { skip, make }] of Object.entries(RUNS)) {
    await make(k, clock)
    // a desktop band wide enough (1,400px) that its fit drops nothing it chose
    const desktop = stripLabels(await k.drawn('desktop', 'AbovePrompt', 200))
    const terminal = bandTitles(await k.drawn('terminal', 'AbovePrompt', 200), (await k.state()).run!.log.map(l => l.text))
    const chosen = desktop.filter(l => !new RegExp(`^(phase \\d|errors$|urgent$|${skip})`, 'i').test(l))
    expect(terminal.length, name).toBeGreaterThan(0)
    expect(terminal.map(t => t.toLowerCase()), name).toEqual(chosen.map(l => l.toLowerCase()))
    await k.hud({ done: 'ok' })
  }
})

test('no slot line of the band ends in a cut figure at 60, 105 or 150 columns: a digit then …, or a bar with no number', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Train the classifier', strip: ['loss', 'mem', 'acc', 'sps'], widgets: [
    { id: 'loss', type: 'line', title: 'Training loss', better: 'down', tone: 'info', points: [1.92, 1.41, 1.08, 0.86, 0.71, 0.62, 0.55, 0.49, 0.47, 0.5, 0.44, 0.4, 0.37, 0.35, 0.34] },
    { id: 'mem', type: 'meter', title: 'GPU memory', value: 71.5, max: 80, unit: 'GB', tone: 'warn' },
    { id: 'acc', type: 'gauge', title: 'Validation accuracy on the held-out set', value: 91.2, unit: '%', tone: 'good' },
    { id: 'sps', type: 'stat', title: 'Samples per second', value: 18420, delta: 310, better: 'up' },
  ] })
  await k.turn()
  for (const cols of [105, 60, 150, 40]) {
    const rows = (await k.drawn('terminal', 'AbovePrompt', cols)).rows.filter(r => /^[^:]{2,60}: /.test(r))
    expect(rows.length).toBeGreaterThan(cols === 40 ? 0 : 2)
    for (const r of rows) {
      expect(2 + len(r), r).toBeLessThanOrEqual(cols)
      expect(r, r).not.toMatch(/\d…/)
      const mark = r.search(/[█░▁▂▃▄▅▆▇]/)
      if (mark >= 0) expect(r.slice(r.indexOf(': '), mark), r).toMatch(/\d/) // a bar or a spark comes after its number
      expect(r, r).not.toMatch(/[█░▁▂▃▄▅▆▇]…/)
    }
  }
})

test('the header keeps its facts whole at 60, 105 and 150 columns: never "⏱ 7…", the errors and the step outranking the clock', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Migrate the billing and invoicing subsystem to the event-sourced ledger', goal: 'Move every invoice and payment record into the ledger and verify the balances', progress: '7/12', progress_label: 'hosts', phase: { name: 'Reconcile', state: 'now' } })
  await k.hud({ phase: { name: 'Verify', state: 'todo' } })
  for (let n = 0; n < 3; n++) await k.call('Bash', { command: 'false', answer: { result: 'boom', isError: true } })
  const FACT = /^(⏱ \d+:\d\d|\d+ jobs? running|\d+\/\d+( \S+)?|▸ .+|\d+ errors?)$/
  const seen: string[][] = []
  for (const cols of [60, 105, 150]) {
    const d = await k.drawn('terminal', 'AbovePrompt', cols)
    const row = (d.root.children as Node[]).find(n => n.type === 'Box' && n.props?.flexDirection === 'row')!
    const facts = (row.children as Node[]).find(n => n.type === 'Box' && n.props?.flexShrink === 0)
    const parts = text(facts).trim().split('  ·  ')
    seen.push(parts)
    for (const part of parts) expect(part, `${cols}: ${part}`).toMatch(FACT)
    expect(parts, `${cols}`).toContain('3 errors') // the errors stay at every width, as the strip's do
    expect(lay(d.root, cols).overflow, `${cols}`).toEqual([])
  }
  // the fewer the columns, the fewer the facts: at 60 the clock has gone before the errors and the step, which the strip draws
  expect(seen[0]!.length).toBeLessThan(seen[1]!.length)
  expect(seen[0]!).not.toContain('⏱ 0:00')
  expect(seen[1]!).toEqual(['7/12 hosts', '▸ Reconcile', '3 errors']) // at 105 the clock (its ⏱ two columns) is the one that goes
  expect(seen[2]!).toContain('⏱ 0:00')
})

// Runs shaped like the trial's, each with what narrows a band: a long title and goal with figures in them, progress, phases
// and errors the strip draws, a trend, gauges and meters, a plan, an urgency, a log line with a path and numbers.
const SWEEP: Record<string, (k: ReturnType<typeof kit>) => Promise<unknown>> = {
  rollout: async k => {
    await k.hud({ start: 'Deploy v2.4 to 12 hosts', goal: 'Roll out with a canary, then the rest in batches of 120', progress: '7/12', progress_label: 'hosts', phase: { name: 'Build', state: 'done' }, log: 'Starting rollout of v2.4' })
    await k.hud({ phase: { name: 'Canary', state: 'done' } })
    await k.hud({ phase: { name: 'Rollout', state: 'now' }, widgets: [{ id: 'rps', type: 'stat', title: 'Requests/s', value: 8950, delta: 950, better: 'up', points: [7400, 7800, 8950] }, { id: 'p95', type: 'stat', title: 'p95 latency', value: 231, unit: 'ms' }] })
    await k.hud({ phase: { name: 'Verify', state: 'todo' }, log: 'web-08 failed its health check: connection refused', level: 'err' })
    await k.call('Bash', { command: 'false', answer: { result: 'boom', isError: true } })
  },
  training: async k => {
    await k.hud({ start: 'Train support-ticket classifier v7', goal: "Beat v6's 89.4% validation accuracy within 10 epochs", progress: '4/10', progress_label: 'epochs', phase: { name: 'Train', state: 'now' }, strip: ['progress', 'acc', 'trend', 'phases'], log: 'Epoch 4/10 done: val acc 91.2%, checkpoint saved' })
    await k.hud({ phase: { name: 'Evaluate', state: 'todo' }, widgets: [
      { id: 'acc', type: 'gauge', title: 'Val accuracy', value: 91.2, unit: '%', tone: 'good' },
      { id: 'mem', type: 'meter', title: 'GPU memory', value: 71.5, max: 80, unit: 'GB', tone: 'warn' },
      { id: 'loss', type: 'line', title: 'Training loss', better: 'down', points: [1.92, 1.41, 1.08, 0.86, 0.71, 0.62, 0.55, 0.49, 0.47, 0.5, 0.44, 0.4, 0.37, 0.35, 0.34] },
    ] })
    await k.call('Bash', { command: 'false', answer: { result: 'boom', isError: true } })
    await k.call('Bash', { command: 'false', answer: { result: 'boom', isError: true } })
  },
  long: async k => {
    await k.hud({ start: 'Migrate the billing and invoicing subsystem to the event-sourced ledger', goal: 'Move every invoice and payment record into the append-only ledger and verify balances for 18,200 accounts', phase: { name: 'Backfill', state: 'done' }, set: { 'invoices backfilled so far': 1300000, 'customer accounts reconciled': 18200 } })
    await k.hud({ phase: { name: 'Reconcile per-customer balances against the ledger', state: 'now' }, log: 'Wrote /srv/billing/ledger/backfill/shard-07/reconcile-report.json; 18,200 accounts reconciled, 0 mismatches. Next: shards 8 to 12', level: 'ok' })
    for (let n = 0; n < 2; n++) await k.call('Bash', { command: 'false', answer: { result: 'boom', isError: true } })
  },
  plan: async k => {
    await k.hud({ start: 'Refactor the auth module for the 2.0 release', goal: 'Move token refresh behind one interface in under 3 passes' })
    await k.call('TodoWrite', { todos: [
      { content: 'Map the call sites', status: 'completed', activeForm: 'Mapping' }, { content: 'Move refresh logic behind it', status: 'in_progress', activeForm: 'Moving' }, { content: 'Run the auth tests 3 times', status: 'pending', activeForm: 'Running' },
    ] })
  },
  copy: async k => {
    await k.hud({ start: 'Copy the billing ledger to the replica', goal: 'Move 18,200 rows in under 5 s', progress: '4/9', progress_label: 'tables', log: '18,200 rows copied in 4.2 s' })
    await k.call('deploys', { value: 'live', tone: 'good' })
    await k.hud({ log: 'Copied 1,300,000 invoices from /srv/billing/ledger/backfill/shard-07 in 4.2 s; 0 rows differ, 18,200 accounts match', level: 'ok' })
    await k.hud({ count: 'rows retried', count_by: 14, fun: ['The replica took 18,200 rows in 4.2 s: 4,333 rows a second.'] })
  },
  urgent: async k => {
    await k.hud({ start: 'Ship the billing service', goal: 'Green tests, then deploy to production by 17:00', progress: '3/8', progress_label: 'tasks' })
    await k.npm('Tests: 0 failed, 41 passed, 41 total')
    await k.call('Edit', { file_path: '/src/billing/ledger-schema.ts' })
    await k.npm('Tests: 2 failed, 39 passed, 41 total')
    await k.measure(72)
    await k.turn()
  },
  // wide characters: a title and a goal in Japanese (two columns each) with figures in them, a pictograph in the log, and
  // the ⚠ of the urgency line and the header's ⏱ (counted as two columns each, the width some terminals give them)
  cjk: async k => {
    await k.hud({ start: '請求サービスを v2.4 へ 12 台に展開する', goal: 'テストを通してから本番へ 18,200 件を移す', progress: '3/8', progress_label: 'タスク', phase: { name: 'テスト', state: 'now' } })
    await k.hud({ phase: { name: '展開', state: 'todo' }, log: '✔ 台帳を 18,200 件 4.2 秒で移した ➡ 次は 12 台' })
    await k.npm('Tests: 0 failed, 41 passed, 41 total')
    await k.npm('Tests: 2 failed, 39 passed, 41 total')
    await k.turn()
  },
}

test('the band swept from 30 to 170 columns, the terminal at every width and the desktop at every third, on both surfaces: no cut number, no bare bar or spark, what the strip draws of the run is there, nothing overflows', { plugins, timeoutMs: 60_000 }, async ($, on) => {
  beneath(on)
  const k = kit($)
  const MARK = /[█░▁▂▃▄▅▆▇]/
  for (const [name, make] of Object.entries(SWEEP)) {
    await make(k)
    // what the desktop strip draws of the run's own, at a width where it drops nothing
    const wide = stripLabels(await k.drawn('desktop', 'AbovePrompt', 200))
    const wantErrors = wide.some(l => /^errors$/i.test(l)), wantPhase = wide.some(l => /^phase \d/i.test(l))
    for (let cols = 30; cols <= 170; cols++) {
      const t = await k.drawn('terminal', 'AbovePrompt', cols), at = `${name} @ ${cols}`
      const { lines, overflow } = lay(t.root, cols)
      expect(overflow, at).toEqual([]) // nothing the terminal would have to cut that may not be cut
      const text = lines.map(l => l.trimEnd()).join('\n')
      expect(text, at).not.toMatch(/\d…/) // no number cut: Ink's own cut included, as the model makes it
      // a bar or a spark comes with its number first: on a slot line (`title: number mark`) and in the header (a progress number)
      for (const l of lines) if (/^ {2}[^:]+: /.test(l) && MARK.test(l)) expect(l.slice(l.indexOf(': '), l.search(MARK)), `${at}: ${l}`).toMatch(/\d/)
      const header = lines.find(l => l.startsWith('●')) ?? ''
      if (MARK.test(header)) expect(text, at).toMatch(/\d+\/\d+|Progress: /)
      // what the strip chose of the run's own is never dropped: in the header, or a line of its own
      if (wantErrors) expect(text, at).toMatch(/\d+ errors?|Errors: \d/)
      if (wantPhase) expect(text, at).toMatch(/▸ |Phase: \d/)
      // the desktop's band, at every third width (its cuts are fit()'s, which the test above holds at every px): no number
      // cut in any text it draws, its header and its strip's image
      if ((cols - 30) % 3 === 0) for (const w of (await k.drawn('desktop', 'AbovePrompt', cols)).words) expect(w, `${at} (desktop)`).not.toMatch(/\d…/)
    }
    await k.hud({ done: 'ok' })
  }
})

test('the pane swept from 30 to 120 columns, a width at a time: no number cut by the terminal, no bar or spark without its number, nothing overflows', { plugins, timeoutMs: 60_000 }, async ($, on) => {
  beneath(on)
  const k = kit($)
  const MARK = /[█░▁▂▃▄▅▆▇]/
  for (const [name, make] of Object.entries(SWEEP)) {
    await make(k)
    for (let cols = 30; cols <= 120; cols++) {
      const t = await k.drawn('terminal', 'Pane', cols), at = `${name} pane @ ${cols}`
      const { lines, overflow } = lay(t.root, cols, true) // the pane's Text wraps, as Ink wraps it
      expect(overflow, at).toEqual([])
      for (const l of lines) {
        expect(l, `${at}: ${l}`).not.toMatch(/\d…/) // no number cut: Ink's own cut included
        if (MARK.test(l)) expect(l, `${at}: ${l}`).toMatch(/\d/) // a bar or a spark comes with its number on its line
      }
    }
    await k.hud({ done: 'ok' })
  }
})

test('with the dashboard open the band keeps a line of status, title and its buttons, on both surfaces: no goal, facts, last line or slots', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  for (const surface of SURFACES) {
    await k.hud({ start: `Open on ${surface}`, goal: 'Keep the pane beside it', progress: '3/8', log: 'the last line of the log' })
    await k.npm('Tests: 0 failed, 41 passed, 41 total')
    await k.npm('Tests: 2 failed, 39 passed, 41 total')
    await k.turn()
    const closed = (await k.drawn(surface, 'AbovePrompt')).words.join('\n')
    expect(closed).toContain('the last line of the log') // Claude's newest line, under the strip
    expect(closed).toContain('Keep the pane beside it')
    const ui = await k.mount(surface, 'AbovePrompt')
    await ui.press({ key: 'toggle' })
    const open = nodes(await ui.drawn()).filter(n => n.type === 'Text').map(text).join('\n').replaceAll(' ', ' ')
    expect(open).toContain(`Open on ${surface}`)
    expect(nodes(await ui.drawn()).some(n => n.type === 'Button' && n.props?.label === 'Collapse')).toBe(true)
    for (const gone of ['Keep the pane beside it', 'the last line of the log', '⏱', '⚠', 'Urgent']) expect(open, gone).not.toContain(gone)
    await ui.press({ key: 'toggle' })
    await ui.unmount()
    await k.hud({ done: 'ok' })
  }
})

test("clocks: a block that hasn't changed in a while is dim in the band and the pane, and the pane says when ('Nm ago'), tiles too", { plugins }, async ($, on) => {
  const clock = beneath(on)
  const k = kit($)
  for (const surface of SURFACES) {
    await k.hud({ start: `Tune on ${surface}`, widget: { id: 'heap', type: 'meter', title: 'Heap', value: 5, max: 8 }, set: { rps: 3 } })
    await k.turn()
    const dimLines = (d: Drawn) => d.all.filter(n => n.type === 'Text' && n.props?.dimColor === true).map(text)
    const fresh = await k.drawn(surface, 'AbovePrompt')
    if (surface === 'terminal') expect(fresh.all.some(n => n.type === 'Text' && n.props?.dimColor !== true && text(n) === '5 of 8 ██████████░░░░░░')).toBe(true)
    else expect(fresh.source).not.toContain('class="dim"')
    await clock.advance(3 * 60_000)
    await k.bash(AGING)
    const [b, p] = [await k.drawn(surface, 'AbovePrompt'), await k.drawn(surface, 'Pane')]
    if (surface === 'terminal') {
      // the band's line for it, dim; the pane's line and tile say "3m ago"
      expect(b.all.some(n => n.type === 'Text' && n.props?.dimColor === true && text(n) === '5 of 8 ██████████░░░░░░')).toBe(true)
      expect(dimLines(p).filter(t => t === '3m ago')).toHaveLength(1) // the tile's, under its figure
      expect(dimLines(p).filter(t => t === '  · 3m ago')).toHaveLength(1) // the widget's, after its figure
    } else {
      expect(b.source).toContain('class="dim"')
      expect(p.source).toContain('class="dim"')
      expect(p.words).toContain('3m ago')
    }
    // the tile says it too: on the terminal as a line under its figure, on the desktop as the aside of its block
    if (surface === 'terminal') expect(p.all.filter(n => n.type === 'Box' && n.props?.borderStyle === 'round').map(text).some(t => t.includes('rps') && t.includes('3m ago'))).toBe(true)
    else expect(texts(p.source).filter(w => w.endsWith('3m ago'))).toHaveLength(2) // the widget's "63% · 3m ago" and the tile's "3m ago"
    await k.hud({ done: 'ok' })
  }
})

test("the auto-log: the observer's lines are dim in the pane and Claude's are not; the band's last line keeps Claude's until five of the observer's follow", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  for (const surface of SURFACES) {
    await k.hud({ start: `Log on ${surface}`, log: 'tests green; opening the PR' })
    for (const f of ['a', 'b', 'c', 'd']) await k.call('Edit', { file_path: `/w/${surface}-${f}.ts` })
    const last = async () => (await k.drawn(surface, 'AbovePrompt')).words.join('\n')
    expect(await last()).toContain('tests green; opening the PR')
    expect(await last()).not.toContain(`edited ${surface}-`) // (the strip's own "Files edited" figure is no log line)
    await k.call('Edit', { file_path: `/w/${surface}-e.ts` })
    expect(await last()).toContain(`edited ${surface}-e.ts`)
    expect(await last()).not.toContain('tests green')
    // in the pane the observer's line is dim (the terminal's text dims, the dashboard takes the muted token) and Claude's is not
    const p = await k.drawn(surface, 'Pane')
    if (surface === 'terminal') {
      const dim = (words: string) => p.all.find(n => n.type === 'Text' && text(n) === words)?.props?.dimColor === true
      expect([dim(`edited ${surface}-e.ts`), dim('tests green; opening the PR')]).toEqual([true, false])
    } else {
      const classOf = (words: string) => new RegExp(`class="(\\w+)">${words.replace('.', '\\.')}<`).exec(p.source)?.[1]
      expect([classOf(`edited ${surface}-e.ts`), classOf('tests green; opening the PR')]).toEqual(['m', 't'])
    }
    await k.hud({ done: 'ok' })
  }
})

test('a bound widget gone stale draws "no reading", dim, in the band and the pane, never its old number', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  const cache = (text: string) => k.call('Bash', { command: 'npm run cache', answer: { result: text, text } })
  for (const surface of SURFACES) {
    await k.hud({ start: `Warm the cache on ${surface}`, widget: { id: 'cache', type: 'stat', title: 'Cache size', unit: 'entries', bind: { on: 'shell', match: 'cache', extract: 'last_number' } } })
    await cache('cache: 4821 entries')
    await k.turn() // a boundary: the strip takes the widget as it stands
    for (const d of [await k.drawn(surface, 'AbovePrompt'), await k.drawn(surface, 'Pane')]) expect(d.words.join('\n')).toMatch(/4,?821/)
    for (let n = 0; n < STALE; n++) await cache('cache: unavailable')
    for (const component of ['AbovePrompt', 'Pane'] as const) {
      const d = await k.drawn(surface, component)
      expect(d.words.join('\n')).not.toMatch(/4,?821/)
      expect(d.words.join('\n') + d.alt).toContain('no reading')
      // its why counts from its last reading, not from now
      expect(d.words.join('\n') + d.alt).toContain(`Changed ${STALE} calls ago`)
      expect(d.words.join('\n') + d.alt).not.toContain('Changed just now')
      // the terminal's line is dim: it has not been read in a while
      if (surface === 'terminal') expect(d.all.some(n => n.type === 'Text' && n.props?.dimColor === true && text(n) === 'no reading')).toBe(true)
    }
    await k.hud({ done: 'ok' })
  }
})

test("auto-run: a run's title is dim until Claude names it, and a state but running says so in words in the band", { plugins }, async ($, on) => {
  let surfaces: Surface[] = ['terminal']
  beneath(on, () => surfaces)
  const k = kit($)
  for (const s of SURFACES) {
    surfaces = [s]
    await k.say('Migrate the auth tables and fix whatever breaks')
    await k.bash(AUTO_CALLS)
    let b = await k.drawn(s, 'AbovePrompt')
    expect(b.words.join('\n')).toContain('Migrate the auth tables')
    expect(b.all.some(n => n.type === 'Text' && n.props?.dimColor === true && text(n).includes('Migrate the auth tables'))).toBe(true)
    // dim in the pane too (the native header, on both surfaces)
    expect((await k.drawn(s, 'Pane')).all.some(n => n.type === 'Text' && n.props?.dimColor === true && text(n).includes('Migrate the auth tables'))).toBe(true)
    // running is the usual state; the band says nothing of it but the dot (the desktop's header says "Running")
    if (s === 'terminal') expect(b.words.join('\n')).not.toMatch(/Running|Waiting/)
    await k.turn()
    b = await k.drawn(s, 'AbovePrompt')
    expect(b.words.join('\n')).toContain('Waiting for you')
    await k.hud({ done: 'ok' })
    expect((await k.drawn(s, 'AbovePrompt')).words.join('\n')).toContain('Done')
    await k.turn()
  }
})

test('no pane buttons and no hover in the terminal band or pane: the band has its two buttons and the pane none', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await SHIPPING(k, 'Buttons')
  await k.measure(90)
  const b = await k.drawn('terminal', 'AbovePrompt'), p = await k.drawn('terminal', 'Pane')
  expect(b.all.filter(n => n.type === 'Button').map(n => n.props?.key)).toEqual(['toggle', 'hide'])
  expect(p.all.some(n => n.type === 'Button')).toBe(false)
  for (const d of [b, p]) {
    expect(d.all.some(n => n.props?.display === 'none' || n.props?.hover !== undefined || n.props?.position === 'absolute')).toBe(false)
    expect(d.all.some(n => n.props?.onPress !== undefined && n.type !== 'Button')).toBe(false)
  }
})

test("a runner's errors are failures, and a jest run whose suite failed to run reads nothing new, never 0 failed, on both surfaces", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  const sh = (command: string, text: string) => k.call('Bash', { command, answer: { result: text, text } })
  await k.hud({ start: 'Fix the suite', widget: { id: 'jest', type: 'stat', title: 'Jest run', bind: { on: 'shell', match: 'jest', extract: 'pass_fail' } } })
  await sh('pytest -q', '==================== 3 passed, 2 errors in 1.20s ====================')
  await sh('npx jest', 'Test Suites: 1 failed, 1 passed, 2 total\nTests:       3 passed, 3 total\nSnapshots:   0 total')
  const w = (await k.state()).run!.widgets.find(x => x.id === 'jest')!
  expect([w.value, w.bound?.misses]).toEqual([undefined, 1]) // a miss: no reading
  for (const surface of SURFACES) {
    const words = (await k.drawn(surface, 'Pane')).words.join('\n')
    expect(words, surface).toContain('pytest: 3 passed, 2 failed') // the tests slot as pytest left it
    expect(words, surface).not.toContain('jest: 3 passed')
    expect(words, surface).not.toMatch(/\b0 failed/)
  }
})

test('a denied call logs "<command> denied", never "failed", and counts as no error nor toward "failed 3 times in a row", on both surfaces', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Ship the release' })
  for (let n = 0; n < 3; n++) await k.call('Bash', { command: 'npm run deploy', answer: { deny: 'The person denied this call.' } })
  const s = await k.state()
  expect(s.run!.log.map(l => l.text)).toEqual(['npm run deploy denied', 'npm run deploy denied', 'npm run deploy denied'])
  expect([s.run!.calls, s.run!.errors]).toEqual([3, 0]) // the person's refusal, not the command failing
  expect(s.urgent).toBeNull()
  await k.turn()
  for (const surface of SURFACES) {
    for (const component of ['AbovePrompt', 'Pane'] as const) {
      const words = (await k.drawn(surface, component)).words.join('\n')
      expect(words, `${surface} ${component}`).toContain('npm run deploy denied') // the pane's log and the band's last line
      expect(words, `${surface} ${component}`).not.toMatch(/npm run deploy failed|in a row|\d errors?\b|\d failed/) // no line, no failing-runs slot, no errors
    }
  }
  // a run that really fails after them is failing once, not four times, and one error
  await k.call('Bash', { command: 'npm run deploy', answer: { result: 'boom', isError: true } })
  expect((await k.drawn('terminal', 'Pane')).words.join('\n')).toContain('npm run deploy failed once in a row')
  expect((await k.state()).run!.errors).toBe(1)
})

test("off-schema fields never blank the HUD on either surface, and the tool's answer is what the call did: applied, never 'unchanged'", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  const out = await k.hud({ start: 'Odd fields', accent: 'red', progress: '-3/10', widgets: [
    { id: 'a', type: 'stat', title: 7, value: 3 }, { id: 'b', type: 'list', title: 'Hosts', items: 'web-01' }, { id: 'c', type: 'bars', title: 'Mix', items: [{ label: 7, value: 2, color: 'teal' }] },
  ] }) as { result?: unknown; deny?: string }
  expect(out.deny).toBeUndefined()
  expect(String(out.result).split('\n')).toEqual([
    'ok', 'accent: "red" is no colour; send a hex like #d97757, or good, bad, warn, info or accent', 'progress: "-3/10" is not n/total with 0 ≤ n ≤ total',
    'color on c: "teal" is no colour; send a hex like #d97757, or good, bad, warn, info or accent',
  ])
  expect((await k.state()).run!.widgets.map(w => w.title)).toEqual(['7', 'Hosts', 'Mix'])
  await k.turn()
  for (const surface of SURFACES) for (const component of ['AbovePrompt', 'Pane'] as const) {
    expect((await k.drawn(surface, component)).words.join('\n'), `${surface} ${component}`).toContain('Odd fields')
  }
})

// A fault beneath the HUD: with /break on, reading the arrangement or Claude's focus fails, as deciding the strip and
// taking the focus do after a hud call has applied.
const breaker: Register = on => {
  let armed = false
  on('command.run', { command: 'break' }, ($, e) => ((armed = e.args === 'on'), { text: 'ok' }))
  on('state.get', ($, e, next) => {
    const w = e as unknown as { plugin: string; key: string }
    return armed && w.plugin === 'hud' && ['arrangement', 'focus'].includes(w.key) ? { deny: 'state down' } : next(e)
  })
}

test("a fault after a hud call has applied (taking the focus, deciding the strip) costs its answer nothing: it says ok", { plugins: [...plugins, { name: 'breaker', register: breaker }] }, async ($, on) => {
  beneath(on)
  const k = kit($)
  const brk = (args: string) => ($.command.run as unknown as Loose)({ command: 'break', args })
  await k.hud({ start: 'Faulty' })
  await brk('on')
  const out = await k.hud({ title: 'Renamed', focus: ['hud/tests'], strip: ['progress'] }) as { result?: unknown; deny?: string }
  await brk('off')
  expect([out.deny, out.result]).toEqual([undefined, 'ok'])
  expect((await k.state()).run!.title).toBe('Renamed')
})

// A plugin beneath the HUD that rewrites a run titled "Below zero" or "Over the top" with a progress no update can send now:
// one from before the guard, as an older state may hold.
const outOfRange: Register = on => {
  on('state.set', ($, e, next) => {
    const w = e as unknown as { plugin: string; key: string; value: { title?: string } | null }
    const n = w.plugin === 'hud' && w.key === 'run' ? { 'Below zero': -3, 'Over the top': 15 }[String(w.value?.title)] : undefined
    return n === undefined ? next(e) : next({ ...e, value: { ...w.value, progress: { n, total: 10 } } } as typeof e)
  })
}

test('a progress below zero or past its total, as an older state may hold, draws clamped on both surfaces and never throws', { plugins: [...plugins, { name: 'out-of-range', register: outOfRange }] }, async ($, on) => {
  beneath(on)
  const k = kit($)
  for (const [title, n] of [['Below zero', -3], ['Over the top', 15]] as const) {
    await k.hud({ start: title, progress: '3/10' })
    await k.turn()
    expect((await k.state()).run!.progress?.n).toBe(n)
    for (const surface of SURFACES) for (const component of ['AbovePrompt', 'Pane'] as const) for (const cols of [60, 105]) {
      expect((await k.drawn(surface, component, cols)).words.join('\n'), `${title}: ${surface} ${component} ${cols}`).toContain(title)
    }
    await k.hud({ done: 'ok' })
  }
})

// Both surfaces redraw every second while a run is live: a redraw must stay cheap however long Claude's text is. fit()
// takes no more of a text than can fit before it measures, so 2,000 characters cost what 200 do.
test('a run of the longest text (12 log lines, title and goal at 2,000 characters) redraws in well under 100 ms on both surfaces', { plugins, timeoutMs: 30_000 }, async ($, on) => {
  beneath(on)
  const k = kit($)
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 97}`).join(' ').slice(0, 2000)
  await k.hud({ start: words(400), goal: words(400) })
  for (let n = 0; n < 12; n++) await k.hud({ log: words(400) })
  const r = (await k.state()).run!
  expect(r.log.every(l => l.text.length === 2000)).toBe(true)
  // the HUD's own drawing: the dashboard and the strip (3 s and more each before)
  for (const draw of [() => dashboard(r, 640), () => strip(r, 840)]) {
    draw() // (the first draw warms the module)
    const t = performance.now()
    draw()
    expect(performance.now() - t).toBeLessThan(100)
  }
  // and each redraw through the hooks, the kit's layout of 4,000 characters of native text and all (half a second for the
  // terminal pane and more for the desktop's before)
  for (const surface of SURFACES) for (const component of ['AbovePrompt', 'Pane'] as const) {
    await k.drawn(surface, component) // (the first draw warms the module)
    const t = performance.now()
    await k.drawn(surface, component)
    expect(performance.now() - t, `${surface} ${component}`).toBeLessThan(250)
  }
})

test("Claude's tiles named like the run's own counts draw as Claude sent them, and the run's counts apart, on both surfaces", { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Tiles', set: { errors: 12, 'tool calls': 99 } })
  await k.call('Bash', { command: 'true' })
  const tiles = async () => (await k.drawn('terminal', 'Pane')).all.filter(n => n.type === 'Box' && n.props?.borderStyle === 'round').map(text)
  expect(await tiles()).toEqual(['errors12', 'tool calls99', 'tool calls1']) // no errors of its own: none drawn
  await k.call('Bash', { command: 'false', answer: { result: 'boom', isError: true } })
  expect(await tiles()).toEqual(['errors12', 'tool calls99', 'tool calls2', 'errors1'])
  // the desktop's dashboard: Claude's two, and the call count with its failures under it
  const words = texts((await k.drawn('desktop', 'Pane')).source)
  for (const w of ['12', '99', 'Tool calls', '2', '1 failed']) expect(words, w).toContain(w)
})

test('figures as the desktop says them: the trend formatted, a gauge with its unit at its smallest, a % of 100 as its value, never "of 100%"', { plugins }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.hud({ start: 'Figures', point: 1234567, strip: ['mem', 'trend', 'a'], widgets: [
    { id: 'mem', type: 'gauge', title: 'Memory', value: 12, unit: 'GB', max: 16 }, { id: 'cov', type: 'ring', title: 'Coverage', value: 62.4, unit: '%', max: 100 },
    { id: 'a', type: 'stat', title: 'Alpha', value: 1234 }, { id: 'b', type: 'stat', title: 'Beta', value: 5678 },
  ] })
  await k.hud({ point: 0.30000000000000004 })
  await ($.session.measure as unknown as Loose)({ context: { percent: 72, tokens: 720_000, window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 62 }], changed: ['context', 'rateLimits'] })
  await k.turn()
  // the trend's last point as every figure is written: 0.30, not 0.30000000000000004
  const pane = { terminal: (await k.drawn('terminal', 'Pane')).words.join('\n'), desktop: texts((await k.drawn('desktop', 'Pane')).source).join('\n') }
  for (const [surface, words] of Object.entries(pane)) {
    expect(words, surface).not.toContain('0.30000000000000004')
    expect(words, surface).toContain('0.30')
    // a meter, gauge or ring on a 0 to 100 % scale: its value ("62%"), the 5-hour limit and the context alike
    expect(words, surface).not.toMatch(/of 100 ?%|% of 100/)
  }
  expect(pane.desktop.split('\n')).toEqual(expect.arrayContaining(['62%', '62.4'])) // the limit's caption; the ring's exact value
  // the strip's gauge at its smallest still says what its number is of: never a bare 12 without its GB
  let smallest = 0
  for (let cols = 40; cols <= 160; cols += 4) {
    const t = texts((await k.drawn('desktop', 'AbovePrompt', cols)).source)
    if (t.includes('12')) expect(t.join('|'), `${cols}`).toMatch(/GB of 16/)
    if (t.includes('12 GB')) smallest++
    expect(t.join('|'), `${cols}`).not.toMatch(/of 100%/)
  }
  expect(smallest).toBeGreaterThan(0)
})

// A plugin beneath the HUD that drops the write of its arrangement, as the state of a run from before there was one reads
const unarranged: Register = on => {
  on('state.set', ($, e, next) => {
    const w = e as unknown as { plugin: string; key: string }
    return w.plugin === 'hud' && w.key === 'arrangement' ? next({ ...e, value: null } as typeof e) : next(e)
  })
}

test('with no arrangement yet the terminal band draws the default pick the desktop strip draws, until the first boundary', { plugins: [...plugins, { name: 'unarranged', register: unarranged }] }, async ($, on) => {
  beneath(on)
  const k = kit($)
  await k.call('deploys')
  await k.hud({ start: 'Old', log: 'started' })
  await k.turn()
  expect((await k.state()).arrangement).toBeNull()
  for (const surface of SURFACES) {
    const b = await k.drawn(surface, 'AbovePrompt')
    expect(b.words.join('\n')).toContain('Old')
    expect(b.words.join('\n')).toContain('started')
    // the same default pick on both: a slot Claude's own items leave room for, in the order they were declared
    if (surface === 'terminal') expect(bandTitles(b)).toEqual(['Production (from deploys)'])
    else expect(b.words).toContain('Production')
    // the pane has the whole board either way
    expect((await k.drawn(surface, 'Pane')).words.join('\n')).toContain('Production')
  }
})
