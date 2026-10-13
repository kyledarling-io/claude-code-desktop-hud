import type { Register } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'

import type { HudHeld } from '../types'
import { inOrder } from './board'
import { apply } from './run'
import { dashboard, describe, strip } from './svg'

// Slots as the HUD holds them, the HUD's own and another plugin's.
const held = (from: string, s: Omit<HudHeld, 'v' | 'from' | 'at'>): HudHeld => ({ v: 1, from, at: 0, ...s })
const TESTS = held('hud', { id: 'tests', pattern: 'stat', title: 'Tests', value: 2, unit: 'failed', tone: 'bad', note: 'claude plugin test: 39 passed, 2 failed' })
const CONTEXT = held('hud', { id: 'context', pattern: 'ring', title: 'Context', value: 72, max: 100, unit: '%', tone: 'warn', note: '720k of 1M tokens' })
const FAILING = held('hud', { id: 'failing', pattern: 'list', title: 'Failing runs', items: [{ label: 'npm test', value: 2, state: 'failed' }], note: 'npm test failed 2 times in a row' })
const PROD = held('deploys', { id: 'prod', pattern: 'stat', title: 'Production', value: 'failed', tone: 'bad', note: 'build 1432 failed 2m ago' })
const QUEUE = held('deploys', { id: 'queue', pattern: 'meter', title: 'Queue', value: 3, max: 10 })
const SLOTS = [TESTS, CONTEXT, FAILING, PROD, QUEUE]

test("slots fill what Claude's own items leave of four, in order, only in the patterns the strip draws", async () => {
  const r = apply(null, { start: 'Deploy', progress: '3/12', phase: { name: 'Build', state: 'now' } }, 0)
  r.phases.push({ name: 'Ship', state: 'todo' })
  // progress and phases are Claude's two; two slots fill the four, and the list never enters the strip
  expect(strip(r, 1400, SLOTS).shown).toEqual(['progress', 'phases', 'hud/tests', 'hud/context'])
  // a run whose own items make the four leaves no room
  const full = apply(r, { set: { 'hosts up': 9, 'p95 ms': 212 } }, 0)
  expect(strip(full, 1400, SLOTS).shown.filter(k => k.includes('/'))).toEqual([])
  // a run with nothing to draw yet shows the slots alone, never the bare call count
  expect(strip(apply(null, { start: 'Fresh' }, 0), 1400, SLOTS).shown).toEqual(['hud/tests', 'hud/context', 'deploys/prod', 'deploys/queue'])
  // short of room, slots drop before any of Claude's
  const narrow = strip(r, 330, SLOTS).shown
  expect(narrow.slice(0, 2)).toEqual(['progress', 'phases'])
  expect(narrow.length).toBeLessThan(4)
  // Claude can name a slot by its key, as it names its own items
  expect(strip(apply(r, { strip: ['deploys/prod', 'progress'] }, 0), 1400, SLOTS).shown).toEqual(['deploys/prod', 'progress'])
  const { source } = strip(r, 1400, SLOTS)
  expect(/NaN|undefined|Infinity/.test(source)).toBe(false)
})

test('the urgency place leads the strip and holds while everything else drops; nothing fills it yet', async () => {
  const r = apply(null, { start: 'Deploy', progress: '3/12', set: { 'hosts up': 9 } }, 0)
  const urgent = { slot: TESTS, says: 'Tests: 2 failed (were passing)' }
  expect(strip(r, 1400, SLOTS, urgent).shown[0]).toBe('urgent')
  // past the four: the urgency place is in front of them, not one of them
  expect(strip(r, 1400, SLOTS, urgent).shown.length).toBe(5)
  expect(strip(r, 320, SLOTS, urgent).shown[0]).toBe('urgent') // the narrowest band
  expect(strip(r, 270, SLOTS, urgent).shown).toEqual(['urgent'])
  expect(strip(r, 1400, SLOTS, urgent).source).toContain('Tests: 2 failed (were passing)')
  // the urgent slot is in front, not also among the rest
  expect(strip(r, 1400, SLOTS, urgent).shown.filter(k => k === 'hud/tests')).toEqual([])
})

test('the dashboard draws every slot with its note under its title, and who sent it when it is not the HUD', async () => {
  const r = apply(null, { start: 'Deploy', progress: '3/12' }, 0)
  for (const width of [240, 600, 1200]) {
    const { source } = dashboard(r, width, SLOTS)
    for (const s of SLOTS) expect(source).toContain(`>${s.title}<`)
    expect(source).toContain('>from deploys<') // the aside, beside the title
    expect(source).not.toContain('from hud')
    expect(source).toContain('build 1432 failed 2m ago')
    expect(/NaN|undefined|Infinity/.test(source)).toBe(false)
  }
  expect(describe(r, SLOTS)).toContain('Production (from deploys): failed, build 1432 failed 2m ago')
  expect(describe(r, SLOTS)).toContain('Tests: 2 failed, claude plugin test: 39 passed, 2 failed')
})

test("slots are drawn in order: the HUD's own first, the ones that most need seeing first, then each plugin's as it declared them", async () => {
  const decls = { deploys: { v: 1 as const, name: 'Deploys', access: 'x', slots: [{ id: 'queue', pattern: 'meter' as const, title: 'Queue' }, { id: 'prod', pattern: 'stat' as const, title: 'Production' }] } }
  const byKey = Object.fromEntries([PROD, QUEUE, CONTEXT, FAILING, TESTS].map(s => [`${s.from}/${s.id}`, s]))
  expect(inOrder(byKey, decls).map(s => `${s.from}/${s.id}`)).toEqual(['hud/tests', 'hud/failing', 'hud/context', 'deploys/queue', 'deploys/prod'])
})

// Another plugin pushing a slot, through $.hud, when its tool is called.
const deploys: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'deploys') return next(e)
    await $.hud.declare({ v: 1, name: 'Deploys', access: 'Reads deploy states from its own API.', slots: [{ id: 'prod', pattern: 'stat', title: 'Production' }] })
    await $.hud.push({ v: 1, id: 'prod', pattern: 'stat', title: 'Production', value: 'failed', tone: 'bad', note: 'build 1432 failed 2m ago' })
    return { result: 'ok' }
  })
}
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }

test('a slot another plugin pushes shows in the pane with its note and its sender, and in the desktop strip', { plugins: [{ name: 'deploys', register: deploys }] }, async ($, on) => {
  mock.clock(on)
  on('ui.panes', () => ({ value: [] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const call = $.tool.call as unknown as (i: object) => Promise<unknown>
  await call({ tool: 'mcp__hud__hud', start: 'Ship it' })
  await call({ tool: 'deploys' })
  // the strip takes a new slot at the next boundary (the pane at once): the turn's end
  await ($.turn.complete as unknown as (i: object) => Promise<unknown>)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  const mount = (t: object) => ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', ...t })
  for (const surface of ['terminal', 'desktop'] as const) {
    const p = await mount({ surface, component: 'Pane', requestId: 'hud', props: pane })
    const drawn = JSON.stringify(await p.drawn())
    for (const words of ['Production', 'build 1432 failed 2m ago', 'from deploys']) expect(drawn).toContain(words)
    await p.unmount()
    const b = await mount({ surface, component: 'AbovePrompt', props: band })
    const strip = JSON.stringify(await b.drawn())
    // the desktop strip draws it (a run with nothing of its own to draw yet); the terminal's band says it in a line of
    // text, signed, with why it is there (hooks/terminal.test.tsx has the rest)
    if (surface === 'desktop') expect(strip).toContain('Production (from deploys): failed')
    else expect(strip).toContain('Production (from deploys)')
    expect(strip).toContain('Changed just now · bad')
    await b.unmount()
  }
})
