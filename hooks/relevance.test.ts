import { test, expect, mock } from 'claude-code/testing'
import { shows, stale } from './notes'
import { apply } from './run'
import { answer } from './tool'

test('rebuild swaps the layout for the new work and keeps the run', async () => {
  let r = apply(null, { start: 'Fix CI', goal: 'green build', set: { failing: 4 }, progress: '1/4', phase: { name: 'lint', state: 'now' }, widget: { id: 'flaky', type: 'bars' }, strip: ['progress'] }, 0)
  expect(r.log.map(l => l.text)).toEqual(['Goal: green build'])
  r = apply(r, { count: 'timeout', point: 3, log: 'lint fixed' }, 1000)
  r = { ...r, calls: 9, errors: 2 }
  r = apply(r, { rebuild: true, goal: 'cut test time', set: { 'suite time': '14m' }, title: 'Speed up CI' }, 2000)
  // the layout is the new one alone
  expect(r.tiles).toEqual({ 'suite time': '14m' })
  expect([r.widgets, r.phases, r.cells, r.points, r.fun]).toEqual([[], [], [], [], []])
  expect([r.progress, r.strip, r.counts]).toEqual([undefined, undefined, {}])
  // the run goes on: title and goal move, the clock, log and counts stay
  expect([r.title, r.goal, r.startedAt, r.calls, r.errors]).toEqual(['Speed up CI', 'cut test time', 0, 9, 2])
  expect(r.log.map(l => l.text)).toEqual(['Goal: green build', 'lint fixed', 'Goal: cut test time'])
  // rebuilding a finished run picks the work back up
  const done = apply(r, { done: 'faster' }, 3000)
  const back = apply(done, { rebuild: true }, 4000)
  expect([back.status, back.endedAt, back.summary, back.log.at(-1)?.text]).toEqual(['running', undefined, undefined, 'Dashboard rebuilt'])
  // a rebuild as a JSON string, as a reload delivers it, still rebuilds; start wins over rebuild
  expect(apply(r, { rebuild: 'true' as never }, 5000).tiles).toEqual({})
  expect(apply(r, { start: 'New', rebuild: true }, 5000).log).toEqual([])
  // what Claude reads about the board names what to keep or remove
  expect(shows(apply(null, { start: 'S', progress: '2/5', set: { a: 1 }, widget: { id: 'lat', type: 'line' } }, 0))).toBe('progress 2/5; stats a; widgets lat (line)')
})

test('the HUD goes stale on 12 calls with nothing sent, counted from the last check; time alone never', async () => {
  const r = apply(null, { start: 'T' }, 0)
  expect(stale({ ...r, sinceUpdate: 11 })).toBe(false)
  expect(stale({ ...r, sinceUpdate: 12 })).toBe(true)
  // a few long calls are no drift, however long they take (a remote job's): the clock plays no part
  expect(stale({ ...r, sinceUpdate: 2, updatedAt: 0, startedAt: 0 })).toBe(false)
  expect(stale({ ...r, sinceUpdate: 12, nudged: { at: 1000, calls: 12 } })).toBe(false)
  expect(stale({ ...r, sinceUpdate: 24, nudged: { at: 1000, calls: 12 } })).toBe(true) // a check from before back-off: 12, as ever
  // each check gone unanswered doubles the next window: 24 calls, then 48, and no more
  expect(stale({ ...r, sinceUpdate: 35, nudged: { at: 0, calls: 12, n: 1 } })).toBe(false)
  expect(stale({ ...r, sinceUpdate: 36, nudged: { at: 0, calls: 12, n: 1 } })).toBe(true)
  expect(stale({ ...r, sinceUpdate: 14, nudged: { at: 0, calls: 12, n: 1 } })).toBe(false)
  expect(stale({ ...r, sinceUpdate: 59, nudged: { at: 0, calls: 12, n: 5 } })).toBe(false)
  expect(stale({ ...r, sinceUpdate: 60, nudged: { at: 0, calls: 12, n: 5 } })).toBe(true)
  expect(stale({ ...r, sinceUpdate: 14, nudged: { at: 0, calls: 12, n: 5 } })).toBe(false)
})

test('an unanswered HUD check doubles the next window, to 48 calls at most; a hud call resets it; quiet time asks nothing', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  const call = $.tool.call as unknown as (i: object) => Promise<{ context?: readonly string[] }>
  // which of the next n calls carried a HUD check, counted from 1
  const checked = async (n: number) => {
    const at: number[] = []
    for (let i = 1; i <= n; i++) if ((await call({ tool: 'Bash', command: 'true' })).context?.join('\n').includes('HUD check')) at.push(i)
    return at
  }
  await call({ tool: 'mcp__hud__hud', start: 'Deploy', goal: 'ship v2' })
  expect(await checked(12 + 24 + 48 + 48)).toEqual([12, 36, 84, 132])
  // any hud call resets it to 12
  await call({ tool: 'mcp__hud__hud', log: 'canary healthy' })
  expect(await checked(12 + 24)).toEqual([12, 36])
  // quiet time asks nothing: the general check goes only on calls with nothing sent
  await call({ tool: 'mcp__hud__hud', log: 'rolling out' })
  const quietly = async (ms: number) => (await clock.advance(ms), checked(2))
  for (const ms of [5, 10, 20, 40].map(m => m * 60_000)) expect(await quietly(ms)).toEqual([])
  expect(await checked(4)).toEqual([4]) // the twelfth call since the update, as ever
})

test('a denied call carries no HUD check: the check comes with the next call', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  let denied = false
  on('tool.call', () => (denied ? { deny: "The user doesn't want to proceed with this tool use." } : { result: 'done' }))
  const call = $.tool.call as unknown as (i: object) => Promise<{ context?: readonly string[] }>
  const checks = async (command: string) => (await call({ tool: 'Bash', command })).context?.join('\n').includes('HUD check') ?? false
  await call({ tool: 'mcp__hud__hud', start: 'Deploy' })
  for (let n = 0; n < 11; n++) expect(await checks('true')).toBe(false)
  // the twelfth call would bring the check; a denied one never does, so it comes with the next
  denied = true
  expect(await checks('rm -rf build')).toBe(false)
  denied = false
  expect(await checks('true')).toBe(true)
})

test('Claude is asked to rebuild when the HUD goes quiet, and a new message carries the goal', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] })) // the checks go where someone watches
  on('tool.call', () => ({ result: 'done' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  // simplification: loose call; tool.call's overloads over every tool are too deep for tsc
  const call = $.tool.call as unknown as (i: object) => Promise<{ context?: readonly string[] }>
  const submit = (text: string) => ($.prompt.submit as unknown as (i: object) => Promise<{ context?: readonly string[] }>)({ text, wait: false, origin: { kind: 'composer' } })

  expect((await submit('deploy it')).context).toBeUndefined() // no run, no note
  await call({ tool: 'mcp__hud__hud', start: 'Deploy', goal: 'ship v2', progress: '1/12' })
  const contexts: (readonly string[] | undefined)[] = []
  for (let n = 0; n < 12; n++) contexts.push((await call({ tool: 'Bash', command: 'true' })).context)
  expect(contexts.slice(0, 11).every(c => c === undefined)).toBe(true)
  // the check is short, and names the count and what to send: what the HUD shows is the steer's to say, by each message
  const check = contexts[11]?.join('\n') ?? ''
  expect(check).toContain('HUD check: 12 tool calls')
  expect(check).toContain('rebuild: true')
  expect(check).toContain('done or fail')
  expect(check.length).toBeLessThanOrEqual(160)
  // one check per window: the next call is quiet again, and an update starts the count over
  expect((await call({ tool: 'Bash', command: 'true' })).context).toBeUndefined()
  await call({ tool: 'mcp__hud__hud', progress: '2/12' })
  for (let n = 0; n < 11; n++) expect((await call({ tool: 'Bash', command: 'true' })).context).toBeUndefined()

  // a message mid-run carries the goal, to be read against the message (the skill section says what to do with a change),
  // and the ids of the slots the strip shows once there are any (skill.test.ts)
  expect((await submit('actually, roll back instead')).context).toEqual(['HUD: "ship v2".'])
  await call({ tool: 'mcp__hud__hud', done: 'shipped' })
  // a finished run asks nothing: no check for the calls after it in its turn, no note on the next message. (A long turn
  // after that message starts a run of its own: autorun.test.tsx.)
  for (let n = 0; n < 12; n++) expect((await call({ tool: 'Bash', command: 'true' })).context).toBeUndefined()
  expect((await submit('thanks')).context).toBeUndefined()
})

test("text past the strip's room is kept whole, and Claude hears by how much, so the next one fits", async ($, on) => {
  mock.clock(on, { now: 0 })
  const call = $.tool.call as unknown as (i: object) => Promise<{ result?: unknown }>
  expect((await call({ tool: 'mcp__hud__hud', start: 'Plan PR', goal: 'Budgets, overflow feedback, cuts by structure' })).result).toBe('ok')
  const goal = 'Three in-house parsers plus the v1 file format, tested on a sample project; then rework the plan'
  const said = String((await call({ tool: 'mcp__hud__hud', goal, log: 'x '.repeat(50) })).result)
  expect(said).toBe(`ok, but the strip cuts goal at 60 characters (yours is ${goal.length}) and log at 70 characters (yours is 100). Send a shorter goal now, most important words first. Keep the next log line under 70.`)
  // markdown doesn't count against the room: it isn't drawn
  expect(answer({ title: '**' + 'a'.repeat(60) + '**' })).toBe('ok')
  expect(answer({ done: 'd'.repeat(71) })).toBe('ok, but the strip cuts done at 70 characters (yours is 71). Keep the next summary under 70.')
})
