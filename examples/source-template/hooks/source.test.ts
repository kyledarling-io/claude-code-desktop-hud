import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'
import { register } from './register'

// `claude plugin test` from the repo root runs this with the HUD as the plugin under test. The template loads beside it
// as an inline plugin, which is how another plugin meets the HUD. An inline plugin keeps only the text of its
// `register`, so a source whose test loads it this way keeps all its code inside `register`.
//
// `probe` is a stranger, driven by a tool call named after it: { read } returns what the HUD holds (any plugin may
// read it), { push } sends a slot it never declared.
const probe: Register = on => {
  on('tool.call', async ($, e, next) => {
    const i = e as unknown as { tool: string; read?: 'slots' | 'sources'; push?: never }
    if (String(i.tool) !== $.plugin.name) return next(e)
    const answer = i.read === 'slots' ? (await $.state.get({ plugin: 'hud', key: 'slots' })).value
      : i.read === 'sources' ? (await $.state.get({ plugin: 'hud', key: 'sources' })).value : await $.hud.push(i.push!)
    return { result: JSON.stringify(answer ?? {}) }
  })
}
// Another plugin hooking hud.push, which any plugin may do: it turns the first push away by changing its pattern. It
// sits a tier out, above the HUD, as a plugin that depends on the HUD does in the app.
const refuseFirst: Register = on => {
  let first = true
  on('hud.push', ($, e, next) => {
    const turned = first
    first = false
    return next(turned ? { ...e, pattern: 'list' } : e)
  })
}

// A source newer than the HUD: its declaration reaches the HUD as v2, which the HUD answers "speaks v2; this HUD reads
// v1". It counts the pushes that follow, and says how many when called.
const olderHud: Register = on => {
  let pushes = 0
  on('hud.declare', ($, e, next) => next({ ...e, v: 2 as never }))
  on('hud.push', ($, e, next) => { pushes += 1; return next(e) })
  on('tool.call', ($, e, next) => (String((e as unknown as { tool: string }).tool) === $.plugin.name ? { result: String(pushes) } : next(e)))
}

type Loose = (i: object) => Promise<{ result?: unknown }>
const via = ($: Engine) => async (tool: string, input: object) =>
  JSON.parse(String((await ($.tool.call as unknown as Loose)({ tool, ...input })).result)) as unknown
const start = ($: Engine, on: On) => {
  on('session.surfaces', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return ($.session.start as unknown as (i: object) => Promise<unknown>)({ cwd: '/', surface: null, isInteractive: false })
}

const TEMPLATE = { name: 'source-template', register }
const PROBE = { name: 'probe', register: probe }
const TICKS = { v: 1, id: 'ticks', pattern: 'stat', title: 'Ticks', note: 'one every 5 seconds', from: 'source-template' }

test("it declares at the start, then its count arrives as one slot under its own name", { plugins: [TEMPLATE, PROBE] }, async ($, on) => {
  const clock = mock.clock(on, { now: 5 })
  await start($, on)
  const call = via($)
  expect(await call('probe', { read: 'sources' })).toEqual({
    'source-template': { v: 1, name: 'Source template', access: 'Counts in its own memory. Reads nothing.', slots: [{ id: 'ticks', pattern: 'stat', title: 'Ticks' }] },
  })
  expect(await call('probe', { read: 'slots' })).toEqual({})
  await clock.advance(5000)
  // the HUD stamps when it took it (at) and the main loop's tool calls then (n: the probe's two reads)
  expect(await call('probe', { read: 'slots' })).toEqual({ 'source-template/ticks': { ...TICKS, value: 1, at: 5005, n: 2 } })
  // the same slot, upserted: one id, a count that moved
  await clock.advance(5000)
  expect(await call('probe', { read: 'slots' })).toEqual({ 'source-template/ticks': { ...TICKS, value: 2, at: 10005, n: 3 } })
})

test('a refusal is an answer, not a throw: the HUD says why, and the template carries on', { plugins: [{ name: 'refuse-first', tier: 'prepend', register: refuseFirst }, TEMPLATE, PROBE] }, async ($, on) => {
  const clock = mock.clock(on, { now: 5 })
  await start($, on)
  const call = via($)
  // the first push was turned away (a declared stat, sent as a list), so nothing is held yet; the count still moved
  await clock.advance(5000)
  expect(await call('probe', { read: 'slots' })).toEqual({})
  await clock.advance(5000)
  expect(await call('probe', { read: 'slots' })).toEqual({ 'source-template/ticks': { ...TICKS, value: 2, at: 10005, n: 1 } })
  // what a refusal looks like to the sender: { ok: false, why }, and nothing of the stranger's is held
  expect(await call('probe', { push: { v: 1, id: 'ticks', pattern: 'stat', title: 'Ticks', value: 1 } })).toEqual({ ok: false, why: 'probe has not declared itself' })
  expect(Object.keys((await call('probe', { read: 'slots' })) as object)).toEqual(['source-template/ticks'])
})

test('a refused declaration leaves the template quiet: it never pushes what the HUD would refuse', { plugins: [{ name: 'older-hud', tier: 'prepend', register: olderHud }, TEMPLATE, PROBE] }, async ($, on) => {
  const clock = mock.clock(on, { now: 5 })
  await start($, on)
  await clock.advance(15000)
  const call = via($)
  expect(await call('probe', { read: 'sources' })).toEqual({})
  expect(await call('probe', { read: 'slots' })).toEqual({})
  expect(await call('older-hud', {})).toBe(0)
})
