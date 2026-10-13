import type { On, RenderSurface } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { KICKOFF } from './notes'

// simplification: loose calls; the kit's overloads over every tool and event are too deep for tsc
type Loose = (i: object) => Promise<{ context?: readonly string[] }>

// the engine's own answers beneath the plugin, which the kit leaves to the test
const bottoms = (on: On) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
}

test('the HUD is offered and suggested only where someone watches the strip', async ($, on) => {
  mock.clock(on)
  let surfaces: RenderSurface[] = []
  on('session.surfaces', () => ({ value: surfaces }))
  const offered: string[] = []
  on('tool.register', ($, e) => (offered.push(e.name), { value: { tool: `mcp__hud__${e.name}` } }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  bottoms(on)
  const submit = (text: string) => ($.prompt.submit as unknown as Loose)({ text, wait: false, origin: { kind: 'composer' } })
  const start = () => ($.session.start as unknown as Loose)({ cwd: '/', surface: surfaces[0] ?? null, isInteractive: false })
  const attach = (surface: RenderSurface) => ($.session.attach as unknown as Loose)({ surface, clientId: `${surface}:default` })

  // -p, the SDK, a scheduled run nobody opened: nothing draws, so no tool and no note
  await start()
  expect(offered).toEqual([])
  expect((await submit('build it')).context).toBeUndefined()
  // VS Code and the phone draw no strip
  surfaces = ['mobile']
  await attach('mobile')
  expect(offered).toEqual([])
  // the desktop app attaches after the start: the tool is offered, once
  surfaces = ['mobile', 'desktop']
  await attach('desktop')
  await attach('desktop')
  expect(offered).toEqual(['hud'])
  expect((await submit('build it')).context).toEqual([KICKOFF])
  // a background task's notification arrives as a prompt, but it is no message of the person's: no note
  const notice = '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>'
  expect((await ($.prompt.submit as unknown as Loose)({ text: notice, wait: false, origin: { kind: 'task-notification' } })).context).toBeUndefined()
  // the desktop app detaches a session it stops showing: no note while nobody looks
  surfaces = ['mobile']
  expect((await submit('build it')).context).toBeUndefined()
})

test('a terminal session offers the HUD at the start', async ($, on) => {
  mock.clock(on)
  on('session.surfaces', () => ({ value: ['terminal'] }))
  const offered: string[] = []
  on('tool.register', ($, e) => (offered.push(e.name), { value: { tool: `mcp__hud__${e.name}` } }))
  bottoms(on)
  await ($.session.start as unknown as Loose)({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(offered).toEqual(['hud'])
})

test("a subagent's HUD calls change nothing, and the HUD check waits for someone to watch", async ($, on) => {
  mock.clock(on, { now: 0 })
  let surfaces: RenderSurface[] = ['desktop']
  on('session.surfaces', () => ({ value: surfaces }))
  on('tool.call', () => ({ result: 'done' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  const call = $.tool.call as unknown as Loose
  await call({ tool: 'mcp__hud__hud', start: 'Deploy', progress: '1/12' })
  await call({ tool: 'mcp__hud__hud', start: 'Sub task', agentId: 'a1' })
  await call({ tool: 'mcp__hud__hud', done: 'sub done', agentId: 'a1' })
  // the main run is still the one live: a message mid-run is told its goal (here, its title)
  const note = (await ($.prompt.submit as unknown as Loose)({ text: 'go on', wait: false, origin: { kind: 'composer' } })).context?.join('\n') ?? ''
  expect(note).toBe('HUD: "Deploy".')
  // nobody watching: a dozen calls bring no HUD check
  surfaces = []
  for (let n = 0; n < 12; n++) expect((await call({ tool: 'Bash', command: 'true' })).context).toBeUndefined()
  // back on screen: the next call checks, counting the calls made meanwhile
  surfaces = ['desktop']
  expect((await call({ tool: 'Bash', command: 'true' })).context?.join('\n')).toContain('HUD check: 13 tool calls')
})

test("subagents' calls count on the board but never bring the main loop's HUD check", async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', () => ({ result: 'done' }))
  const call = $.tool.call as unknown as Loose
  await call({ tool: 'mcp__hud__hud', start: 'Deploy' })
  // three subagents at work: thirty calls between them, and no check reaches the main loop
  for (let n = 0; n < 30; n++) expect((await call({ tool: 'Bash', command: 'true', agentId: `a${n % 3}` })).context).toBeUndefined()
  // the main loop's own dozen still brings one
  for (let n = 0; n < 11; n++) expect((await call({ tool: 'Bash', command: 'true' })).context).toBeUndefined()
  expect((await call({ tool: 'Bash', command: 'true' })).context?.join('\n')).toContain('HUD check: 12 tool calls')
})

test("a fault in the HUD never costs another tool's call, and a failed HUD update says so", async ($, on) => {
  let broken = false
  on('clock.now', () => { if (broken) throw new Error('clock down'); return { value: 0 } })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  let ran = 0
  on('tool.call', () => (ran++, { result: 'done' }))
  const call = $.tool.call as unknown as (i: object) => Promise<{ result?: unknown; deny?: string }>
  await call({ tool: 'mcp__hud__hud', start: 'Deploy' })
  broken = true
  // the HUD fails after the tool ran: the result stands, and the tool doesn't run twice
  expect((await call({ tool: 'Bash', command: 'true' })).result).toBe('done')
  expect(ran).toBe(1)
  expect((await call({ tool: 'mcp__hud__hud', log: 'moved' })).deny).toContain('could not apply')
})
