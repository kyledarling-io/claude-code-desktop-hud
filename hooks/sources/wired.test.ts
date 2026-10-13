import type { Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

import type { Slot } from './contract'
import * as tests from './tests'
import * as tools from './tools'

// A short session: edits, a test run that fails and then passes, a build that fails once, and a call to the HUD itself
const run = (command: string, text = '', failed = false): tools.Call => ({ tool: 'Bash', input: { command }, failed, text })
const calls: tools.Call[] = [
  { tool: 'Edit', input: { file_path: 'src/ledger.ts' }, failed: false },
  run('npm test', 'Tests:       2 failed, 21 passed, 23 total', true),
  run('npm run build', 'error TS2322: Type string is not assignable to type number.', true),
  { tool: 'Edit', input: { file_path: 'src/ledger.ts' }, failed: false },
  { tool: 'Write', input: { file_path: 'src/ledger.test.ts' }, failed: false },
  { tool: 'mcp__hud__hud', input: { widget: { id: 'plan', items: [{ label: 'Types fixed', state: 'done' }] } }, failed: false },
  run('npm run build'),
  run('npm test', 'Tests:       24 passed, 24 total'),
]

// The HUD's own sources wired in: a session's calls go through the HUD's tool.call hook, and the slots it
// holds are read back the way any plugin may read them (an inline plugin answering `read-hud`).
const reader: Register = on => {
  on('tool.call', async ($, e, next) =>
    String(e.tool) === 'read-hud' ? { result: JSON.stringify((await $.state.get({ plugin: 'hud', key: 'slots' })).value ?? {}) } : next(e))
}
const held = async ($: Engine) =>
  JSON.parse(String((await ($.tool.call as unknown as (i: object) => Promise<{ result?: unknown }>)({ tool: 'read-hud' })).result)) as Record<string, object>
const kept = (s: Slot) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined))

test("a session through the HUD's own tool.call: its sources hold what they read, under the HUD's name, with no run live", { plugins: [{ name: 'reader', register: reader }], timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on, { now: 7 })
  // the engine beneath: each call answers as the session has it (failed = an error result the model read)
  on('tool.call', ($, e) => {
    const c = calls[(e as unknown as { n: number }).n]!
    return c.failed ? { result: c.text ?? 'failed', text: c.text, isError: true } : { result: c.text ?? '', text: c.text }
  })
  for (const [n, c] of calls.entries()) await ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: c.tool, ...c.input, n })
  // what the pure sources leave standing after the same calls: each id's last push, less what they cleared, and the
  // main loop's call count at that push (n: the call that pushed it among them; a hud call is not counted)
  let t = tools.init, r = tests.init, n = 0
  const last: Record<string, Slot & { n: number }> = {}
  for (const c of calls) {
    if (c.tool !== 'mcp__hud__hud') n++
    const a = tools.observe(t, c), b = tests.observe(r, c)
    t = a.state, r = b.state
    for (const s of [...a.push, ...b.push]) last[s.id] = { ...s, n }
    for (const id of [...a.clear, ...b.clear]) delete last[id]
  }
  expect(Object.keys(last).sort()).toEqual(['edited', 'tests'])
  expect(await held($)).toEqual(Object.fromEntries(Object.entries(last).map(([id, s]) => [`hud/${id}`, { ...kept(s), from: 'hud', at: 7 }])))
})

test('context, cost and limits from session.measure, only what moved; a limit under half goes', { plugins: [{ name: 'reader', register: reader }] }, async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-11T12:00:00Z') })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const measure = $.session.measure as unknown as (i: object) => Promise<unknown>
  await measure({
    context: { percent: 87, tokens: 870_000, window: 1_000_000 }, cost: { usd: 1.234 }, changed: ['context', 'cost', 'rateLimits'],
    rateLimits: [{ kind: 'five_hour', percentUsed: 90, resetsAt: '2026-10-11T12:40:00Z' }],
  })
  expect(await held($)).toEqual({
    'hud/context': expect.objectContaining({ value: 87, tone: 'bad', note: '870k of 1M tokens; compaction is near', from: 'hud' }),
    'hud/cost': expect.objectContaining({ value: 1.23, unit: 'USD', from: 'hud' }),
    'hud/limits': expect.objectContaining({ title: '5-hour limit', value: 90, note: '90% used; resets in 40m', from: 'hud' }),
  })
  await measure({ context: { window: 1_000_000 }, changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] })
  expect(Object.keys(await held($))).toEqual(['hud/context', 'hud/cost'])
})
