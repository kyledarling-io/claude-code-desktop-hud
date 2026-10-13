import type { On, Register, RenderSurface } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

import type { HudLine, HudRun } from '../types'
import { agentSaid, said, write } from './autolog'
import { lastLine } from './render'
import { apply, GOAL } from './run'
import type { Call } from './sources/tools'
import { dashboard } from './svg'

// What one finished call says in the log: said() reads the call, write() merges the line into the log.
const call = (tool: string, input: Record<string, unknown>, failed = false, text?: string): Call => ({ tool, input, failed, text })
const logged = (c: Call, before?: number, after?: { passed?: number; failed?: number }, into: HudLine[] = []) =>
  said(c, before, after).reduce((log, s) => write(log, s, 1000), into)
const texts = (...args: Parameters<typeof logged>) => logged(...args).map(l => l.text)
const claude = (text: string, at = 0): HudLine => ({ at, text, level: 'info' })
const observer = (text: string, at = 0): HudLine => ({ at, text, level: 'info', by: 'observer' })

test('each finished call says its one line, in the log\'s words, as the observer', async () => {
  expect(texts(call('Edit', { file_path: 'C:\\work\\hud\\hooks\\svg.ts' }))).toEqual(['edited svg.ts'])
  expect(texts(call('Write', { file_path: '/work/hud/hooks/autolog.ts' }))).toEqual(['edited autolog.ts'])
  expect(texts(call('Edit', { file_path: '/work/hud/hooks/svg.ts' }, true))).toEqual([]) // a refused edit changed nothing
  // a shell run that failed is known by its last step; one that passed says nothing
  expect(texts(call('Bash', { command: 'cd /work && npm test | tail -5' }, true))).toEqual(['npm test failed'])
  expect(texts(call('PowerShell', { command: 'npx tsc -p .' }, true))).toEqual(['npx tsc failed'])
  expect(texts(call('Bash', { command: 'npm test' }))).toEqual([])
  // a test summary: the first of a run says its count, a change says from and to, no change says nothing
  const tests = call('Bash', { command: 'npm test' }, false, '3 failed 7 passed')
  expect(texts(tests, undefined, { passed: 7, failed: 3 })).toEqual(['tests: 3 failed'])
  expect(texts(tests, 2, { passed: 10, failed: 0 })).toEqual(['tests: 2 failed → 0'])
  expect(texts(tests, 3, { passed: 7, failed: 3 })).toEqual([])
  expect(texts(tests, 3, { passed: 12 })).toEqual(['tests: 3 failed → 0']) // a summary of passes alone is 0 failed
  expect(texts(tests, 3, {})).toEqual([]) // no count at all is no reading, not 0
  expect(texts(tests, 3, undefined)).toEqual([])
  expect(said(tests, 2, { passed: 10, failed: 0 })).toEqual([{ kind: 'tests', failed: 0, passed: 10, was: 2 }])
  // fetches and searches name the site or the query; one that failed says nothing
  expect(texts(call('WebFetch', { url: 'https://docs.anthropic.com/en/docs/claude-code/hooks' }))).toEqual(['fetched docs.anthropic.com'])
  expect(texts(call('WebSearch', { query: 'claude code hooks' }))).toEqual(['searched “claude code hooks”'])
  const long = texts(call('WebSearch', { query: 'how do I make the prompt submit hook add a note when nothing is running yet' }))[0]!
  expect(long).toMatch(/^searched “.+…”$/)
  expect(long.length).toBeLessThan(50)
  expect(texts(call('WebFetch', { url: 'https://docs.anthropic.com/' }, true))).toEqual([])
  expect(texts(call('WebFetch', { url: 'not a url' }))).toEqual([])
  expect(texts(call('WebSearch', { query: '  ' }))).toEqual([])
  expect(texts(call('Read', { file_path: '/work/hud/hooks/svg.ts' }))).toEqual([])
  // compaction is written by its own hook
  expect(write([], { kind: 'compact' }, 1000).map(l => l.text)).toEqual(['context compacted'])
  // every line is the observer's, and a failure or a failing summary is marked, not left to colour alone
  const all = [...logged(call('Edit', { file_path: '/w/a.ts' })), ...logged(call('Bash', { command: 'npm test' }, true)), ...logged(tests, 2, { failed: 3 }), ...logged(tests, 3, { failed: 0 })]
  expect(all.every(l => l.by === 'observer' && l.at === 1000)).toBe(true)
  expect(all.map(l => l.level)).toEqual(['info', 'err', 'warn', 'ok'])
})

test('a failing test run logs its tests line alone', async () => {
  const failing = call('Bash', { command: 'npm test' }, true, '3 failed 7 passed')
  // the summary line carries the meaning: no "npm test failed" beside it, for a first count or a change
  expect(texts(failing, undefined, { passed: 7, failed: 3 })).toEqual(['tests: 3 failed'])
  expect(texts(failing, 2, { passed: 7, failed: 3 })).toEqual(['tests: 2 failed → 3'])
  // with no tests line written (the count is the same), or no summary at all, the failure is still told
  expect(texts(failing, 3, { passed: 7, failed: 3 })).toEqual(['npm test failed'])
  expect(texts(call('Bash', { command: 'npm test' }, true, 'Error: spawn ENOENT'), 3, undefined)).toEqual(['npm test failed'])
})

test('consecutive edits to one file collapse: edited svg.ts ×3', async () => {
  let log: HudLine[] = []
  for (const at of [1000, 2000, 3000]) log = write(log, { kind: 'edit', file: 'svg.ts' }, at)
  expect(log).toEqual([{ at: 3000, text: 'edited svg.ts ×3', level: 'info', by: 'observer' }])
})

test('an edit to another file starts a new line, and so does anything between two edits', async () => {
  let log = [claude('building', 0)]
  const edit = (file: string, at: number) => (log = write(log, { kind: 'edit', file }, at))
  edit('svg.ts', 1); edit('svg.ts', 2); edit('run.ts', 3)
  expect(log.map(l => l.text)).toEqual(['building', 'edited svg.ts ×2', 'edited run.ts'])
  edit('svg.ts', 4) // the newest line is run.ts's, so this is a new line, not a third svg.ts edit
  expect(log.map(l => l.text)).toEqual(['building', 'edited svg.ts ×2', 'edited run.ts', 'edited svg.ts'])
  log = write(log, { kind: 'failed', command: 'npm test' }, 5)
  edit('svg.ts', 6)
  expect(log.map(l => l.text).slice(-3)).toEqual(['edited svg.ts', 'npm test failed', 'edited svg.ts'])
  // Claude's own line in the same words is never taken over
  const hers = [claude('edited svg.ts', 1)]
  expect(write(hers, { kind: 'edit', file: 'svg.ts' }, 2).map(l => [l.text, l.by])).toEqual([['edited svg.ts', undefined], ['edited svg.ts', 'observer']])
})

test("a shell run's output never reaches the log: only its command head", async () => {
  const output = '\x1b[31mFAIL\x1b[0m   C:\\Users\\me\\"quoted"\\path   3f2a9c1e-7b4d-4e8a-9c6f-2d1b0a5e8f73\n'.repeat(140) // over 10,000 characters
  expect(output.length).toBeGreaterThan(10_000)
  const run = call('Bash', { command: 'cd "C:\\Users\\me" && npm test -- --grep "' + 'x'.repeat(10_000) + '"' }, true, output)
  const log = logged(run, undefined, undefined)
  expect(log.map(l => l.text)).toEqual(['npm test failed'])
  expect(JSON.stringify(log)).not.toMatch(/FAIL|3f2a9c1e|\x1b|quoted/)
  // a very long name is cut by fit(), not stored whole
  const name = 'a'.repeat(300) + '.ts'
  expect(texts(call('Edit', { file_path: `/w/${name}` }))[0]!.length).toBeLessThan(80)
})

test('a subagent starting, finishing or failing says so, by name, and never collapses with an edit', async () => {
  const line = (state: 'started' | 'finished' | 'failed') => write([], agentSaid({ name: 'Map the tables', state }), 1000)[0]!
  expect([line('started'), line('finished'), line('failed')].map(l => [l.text, l.level, l.by])).toEqual([
    ['agent started: Map the tables', 'info', 'observer'],
    ['agent finished: Map the tables', 'ok', 'observer'],
    ['agent failed: Map the tables', 'err', 'observer'],
  ])
  // after an edit, an agent line is a line of its own; and the next edit starts anew
  let log = write([], { kind: 'edit', file: 'a.ts' }, 1)
  log = write(log, agentSaid({ name: 'a.ts', state: 'started' }), 2)
  log = write(log, { kind: 'edit', file: 'a.ts' }, 3)
  expect(log.map(l => l.text)).toEqual(['edited a.ts', 'agent started: a.ts', 'edited a.ts'])
  // a long description is cut by fit(), not stored whole
  const long = agentSaid({ name: 'Investigate the flaky ledger reconciliation test in the billing service '.repeat(3), state: 'started' })
  expect(write([], long, 1)[0]!.text.length).toBeLessThan(60)
  expect(write([], long, 1)[0]!.text).toMatch(/…$/)
})

test("the newest Claude line holds the band's last line until 5 observer lines follow it", async () => {
  const mine = claude('tests green; opening the PR', 1)
  let log = [observer('edited a.ts', 0), mine]
  expect(lastLine(log)).toBe(mine)
  for (const n of [1, 2, 3, 4]) {
    log = [...log, observer(`edited f${n}.ts`, 10 + n)]
    expect(lastLine(log)).toBe(mine)
  }
  log = [...log, observer('edited f5.ts', 15)]
  expect(lastLine(log)?.text).toBe('edited f5.ts') // the fifth since: the place goes to the newest line
  // a new Claude line takes the place at once, and an explicit by: 'claude' is Claude's too
  const next: HudLine = { ...claude('canary healthy', 20), by: 'claude' }
  expect(lastLine([...log, next])).toBe(next)
  expect(lastLine([...log, next, observer('edited g.ts', 21)])).toBe(next)
  // goal changes are the header's: skipped, and they neither hold the place nor count as observer lines
  const goal = claude(GOAL + 'ship it', 22)
  expect(lastLine([mine, goal])).toBe(mine)
  expect(lastLine([mine, observer('a'), goal, observer('b'), observer('c'), observer('d'), observer('e')])?.text).toBe('e')
  expect(lastLine([mine, observer('a'), observer('b'), observer('c'), observer('d'), goal])).toBe(mine)
  // with none of Claude's lines the newest is the observer's; an empty log has none
  expect(lastLine([observer('x'), observer('y')])?.text).toBe('y')
  expect(lastLine([claude(GOAL + 'only a goal')])).toBeUndefined()
  expect(lastLine([])).toBeUndefined()
})

test('the log keeps 200 lines', async () => {
  let log: HudLine[] = Array.from({ length: 199 }, (_, i) => claude(`step ${i}`, i))
  for (const file of ['a.ts', 'b.ts', 'c.ts']) log = write(log, { kind: 'edit', file }, 1000)
  expect(log).toHaveLength(200)
  expect(log[0]!.text).toBe('step 2')
  expect(log.at(-1)!.text).toBe('edited c.ts')
  log = write(log, { kind: 'edit', file: 'c.ts' }, 2000) // a collapse at the cap changes no length
  expect(log).toHaveLength(200)
  expect(log.at(-1)!.text).toBe('edited c.ts ×2')
})

// ---- through the hooks: the real tool.call and session.compact on both surfaces

type Loose = (i: object) => Promise<{ result?: unknown }>
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (n: unknown): Node[] => (typeof n === 'object' && n !== null ? [n as Node, ...((n as Node).children ?? []).flatMap(nodes)] : [])
const text = (n: unknown): string => (typeof n === 'string' ? n : nodes(n)[0]?.children?.map(text).join('') ?? '')
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const mount = ($: Engine, t: object) => ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', ...t })
const SURFACES = ['terminal', 'desktop'] as const

// Reads the run from the session's state, above the HUD so the read itself is no call to count.
const reader: Register = on => {
  on('tool.call', async ($, e, next) =>
    String(e.tool) === 'read-hud' ? { result: JSON.stringify((await $.state.get({ plugin: 'hud', key: 'run' })).value ?? null) } : next(e))
}
const plugins = [{ name: 'reader', tier: 'prepend' as const, register: reader }]
const runOf = async ($: Engine) => JSON.parse(String((await ($.tool.call as unknown as Loose)({ tool: 'read-hud' })).result)) as HudRun | null

// The engine beneath: someone watching on the surface in turn, and a call that fails when it is told to.
const beneath = (on: On, surface: () => RenderSurface) => {
  mock.clock(on)
  on('ui.panes', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: [surface()] }))
  on('tool.call', ($, e) => {
    const { fail, text } = e as unknown as { fail?: boolean; text?: string }
    return fail ? { result: 'boom', text, isError: true } : { result: 'ok', text }
  })
}

// How a surface's pane draws one log line: the terminal's text dims, the dashboard's takes the muted token.
const dimmed = async (ui: Handle, surface: RenderSurface, words: string): Promise<boolean> => {
  const all = nodes(await ui.drawn())
  if (surface === 'terminal') {
    const line = all.find(n => n.type === 'Text' && text(n) === words)
    expect(line).toBeDefined()
    return line!.props?.dimColor === true
  }
  const svg = String(all.find(n => n.type === 'Svg')?.props?.source)
  const m = new RegExp(`class="(\\w+)">${words.replace('.', '\\.')}<`).exec(svg)
  expect(m).not.toBeNull()
  return m![1] === 'm'
}

test("a live run logs a failing build and an edit; a subagent's edit logs nothing; no run, no lines", { plugins }, async ($, on) => {
  let surface: RenderSurface = 'terminal'
  beneath(on, () => surface)
  const call = $.tool.call as unknown as Loose
  // no run yet: the observer has nothing to write to
  await call({ tool: 'Edit', file_path: '/w/hooks/svg.ts' })
  await call({ tool: 'Bash', command: 'npm run build', fail: true })
  expect(await runOf($)).toBeNull()
  for (const s of SURFACES) {
    surface = s
    await call({ tool: 'mcp__hud__hud', start: `Ship it on ${s}`, log: 'starting' })
    await call({ tool: 'Edit', file_path: '/w/hooks/svg.ts' })
    await call({ tool: 'Bash', command: 'cd /w && npm run build | tail', fail: true })
    // a subagent's work counts on the board but is not the main loop's to log
    await call({ tool: 'Edit', file_path: '/w/hooks/run.ts', agentId: 'a1' })
    await call({ tool: 'Bash', command: 'npm test', fail: true, agentId: 'a1' })
    const r = (await runOf($))!
    expect(r.log.map(l => [l.text, l.by])).toEqual([['starting', undefined], ['edited svg.ts', 'observer'], ['npm run build failed', 'observer']])
    expect(r.calls).toBe(4)
    // the pane draws Claude's line as it is and the observer's dim
    const ui = await mount($, { surface: s, component: 'Pane', requestId: 'hud', props: pane })
    expect(await dimmed(ui, s, 'starting')).toBe(false)
    expect(await dimmed(ui, s, 'edited svg.ts')).toBe(true)
    expect(await dimmed(ui, s, 'npm run build failed')).toBe(true)
    await ui.unmount()
    // a run that has finished takes no more lines
    await call({ tool: 'mcp__hud__hud', done: 'shipped' })
    const before = (await runOf($))!.log.length
    await call({ tool: 'Edit', file_path: '/w/hooks/other.ts' })
    await call({ tool: 'Bash', command: 'npm run build', fail: true })
    expect((await runOf($))!.log).toHaveLength(before)
  }
})

test('test counts reach the log from the tests source: first summary, then the change, never an unchanged count', { plugins }, async ($, on) => {
  let surface: RenderSurface = 'terminal'
  beneath(on, () => surface)
  const call = $.tool.call as unknown as Loose
  const lines = async () => (await runOf($))!.log.map(l => l.text)
  for (const s of SURFACES) {
    surface = s
    await call({ tool: 'mcp__hud__hud', start: `Fix it on ${s}` })
    // the counts of an earlier run in this session are the tests source's memory: the first run of the session says its count
    const first = s === 'terminal'
    // jest's own summary line: the tests source reads a runner's summary, never a count in prose
    await call({ tool: 'Bash', command: 'npm test', text: 'Tests:       3 failed, 7 passed, 10 total', fail: true })
    await call({ tool: 'Bash', command: 'npm test', text: 'Tests:       3 failed, 7 passed, 10 total', fail: true })
    await call({ tool: 'Bash', command: 'npm test', text: 'Tests:       10 passed, 10 total' })
    // a log that carries numbers but no test run is no summary
    await call({ tool: 'Bash', command: 'tail app.log', text: '5 failed logins' })
    expect(await lines()).toEqual(first
      ? ['tests: 3 failed', 'npm test failed', 'tests: 3 failed → 0']
      : ['tests: 0 failed → 3', 'npm test failed', 'tests: 3 failed → 0'])
    await call({ tool: 'mcp__hud__hud', done: 'ok' })
  }
})

test("the band's last line stays Claude's until 5 observer lines have come after it", { plugins }, async ($, on) => {
  let surface: RenderSurface = 'terminal'
  beneath(on, () => surface)
  const call = $.tool.call as unknown as Loose
  for (const s of SURFACES) {
    surface = s
    await call({ tool: 'mcp__hud__hud', start: `Ship it on ${s}`, log: 'tests green; opening the PR' })
    const ui = await mount($, { surface: s, component: 'AbovePrompt', props: band })
    const shown = async () => nodes(await ui.drawn()).filter(n => n.type === 'Text').map(text).join(' | ')
    for (const f of ['a', 'b', 'c', 'd']) {
      await call({ tool: 'Edit', file_path: `/w/${f}.ts` })
      expect(await shown()).toContain('tests green; opening the PR')
      expect(await shown()).not.toContain('edited')
    }
    await call({ tool: 'Edit', file_path: '/w/e.ts' })
    expect(await shown()).toContain('edited e.ts')
    expect(await shown()).not.toContain('tests green')
    await ui.unmount()
  }
})

// a compaction leaves at least one message, and is handed one to run over
const MSGS = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

test('compaction logs one line; a precompute logs none', { plugins }, async ($, on) => {
  let surface: RenderSurface = 'terminal'
  beneath(on, () => surface)
  // the engine's compaction beneath the plugin: it stands unless told to skip
  on('session.compact', ($, e) => (e.instructions === 'veto' ? { skip: 'off' } : { messages: MSGS }))
  const call = $.tool.call as unknown as Loose
  const compact = $.session.compact as unknown as Loose
  // no run: no line
  await compact({ trigger: 'manual', messages: MSGS })
  expect(await runOf($)).toBeNull()
  for (const s of SURFACES) {
    surface = s
    await call({ tool: 'mcp__hud__hud', start: `Long one on ${s}` })
    await compact({ trigger: 'precompute', messages: MSGS })
    await compact({ trigger: 'manual', messages: MSGS, agentId: 'a1' }) // a subagent's own transcript
    await compact({ trigger: 'manual', messages: MSGS, instructions: 'veto' }) // a veto leaves the conversation as it was
    expect((await runOf($))!.log).toEqual([])
    await compact({ trigger: 'manual', messages: MSGS })
    expect((await runOf($))!.log.map(l => [l.text, l.by])).toEqual([['context compacted', 'observer']])
    await compact({ trigger: 'auto', messages: MSGS })
    expect((await runOf($))!.log.map(l => l.text)).toEqual(['context compacted', 'context compacted'])
    const ui = await mount($, { surface: s, component: 'Pane', requestId: 'hud', props: pane })
    expect(await dimmed(ui, s, 'context compacted')).toBe(true)
    await ui.unmount()
    await call({ tool: 'mcp__hud__hud', done: 'ok' })
  }
})

// ---- old state: a log written before `by` existed

test("log lines with no by draw as Claude's lines, on both surfaces", { plugins }, async ($, on) => {
  // the dashboard (the desktop pane's drawing), from a run exactly as 1.4.0 kept it: no line has a by
  const old: HudRun = { ...apply(null, { start: 'Old run' }, 0), log: [{ at: 0, text: 'built it', level: 'info' }, { at: 1000, text: 'all green', level: 'ok' }] }
  const svg = dashboard(old, 600).source
  expect(svg).toMatch(/class="t">built it</)
  expect(svg).toMatch(/class="t">all green</)
  expect(svg).not.toMatch(/class="m">(built it|all green)</)
  expect(lastLine(old.log)).toBe(old.log[1])
  // and through the pane of each surface, a line Claude logged
  let surface: RenderSurface = 'terminal'
  beneath(on, () => surface)
  for (const s of SURFACES) {
    surface = s
    await ($.tool.call as unknown as Loose)({ tool: 'mcp__hud__hud', start: `Old on ${s}`, log: 'built it' })
    const ui = await mount($, { surface: s, component: 'Pane', requestId: 'hud', props: pane })
    expect(await dimmed(ui, s, 'built it')).toBe(false)
    await ui.unmount()
  }
})
