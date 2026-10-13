import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'
import type { HudRun, HudWidget } from '../types'
import { matches, observe, validBind } from './bind'
import { AGING, life, STALE } from './lifecycle'
import { nudge, pointed } from './notes'
import { apply } from './run'
import type { Call } from './sources/tools'
import { DESCRIPTION } from './tool'

// Bindings: a widget Claude binds to its calls is filled by the observer from each
// matching call of the main loop, through the extractors (hooks/extract.ts). A call that doesn't parse is a miss, and a
// bound widget ages only on matching calls: stale, it draws "no reading", never its old number.

test('a binding is checked when it arrives, and one that cannot stand says why', async () => {
  for (const on of ['shell', 'edit', 'fetch'] as const) {
    expect(validBind({ on, match: 'npm test', extract: 'pass_fail' })).toEqual({ bind: { on, match: 'npm test', extract: 'pass_fail' } })
    expect(validBind({ on, extract: 'exit' })).toEqual({ why: `match must be text for ${on}` })
    expect(validBind({ on, match: '  ', extract: 'exit' })).toEqual({ why: `match must be text for ${on}` })
    expect(validBind({ on, match: 7, extract: 'exit' })).toEqual({ why: `match must be text for ${on}` })
  }
  for (const on of ['measure', 'agents', 'plan'] as const) {
    expect(validBind({ on, extract: 'percent' })).toEqual({ bind: { on, extract: 'percent' } })
    expect(validBind({ on, match: 'x', extract: 'percent' })).toEqual({ why: `${on} takes no match` })
  }
  expect(validBind({ on: 'ssh', match: 'x', extract: 'exit' })).toEqual({ why: 'on must be one of shell, edit, fetch, measure, agents, plan' })
  expect(validBind({ on: 'shell', match: 'x', extract: 'regex' })).toEqual({ why: 'extract must be one of pass_fail, n_of_m, percent, duration, last_number, exit' })
  for (const junk of [null, 7, 'shell', [], undefined]) expect(validBind(junk)).toEqual({ why: 'it must be { on, match, extract }' })
  // only what a binding is: anything else Claude sends with it is left out
  expect(validBind({ on: 'plan', extract: 'n_of_m', every: 5 })).toEqual({ bind: { on: 'plan', extract: 'n_of_m' } })
})

test('a match the HUD could never see is refused, with the form it takes', async () => {
  // a shell run is known by its program and up to two verbs (heads()): a path, an argument, a flag or a space past them never reach it
  for (const match of ['./run-tests.sh', 'pytest tests/unit', 'npm test --ci', 'make test '])
    expect(validBind({ on: 'shell', match, extract: 'pass_fail' })).toEqual({ why: 'match must be a command name, like pytest or npm test' })
  for (const match of ['pytest', 'npm test', 'test', 'run-tests.sh', 'npm run build'])
    expect(validBind({ on: 'shell', match, extract: 'pass_fail' })).toEqual({ bind: { on: 'shell', match, extract: 'pass_fail' } })
  // a site is known by its host
  for (const match of ['https://example.com', 'example.com/status', 'localhost:3000'])
    expect(validBind({ on: 'fetch', match, extract: 'exit' })).toEqual({ why: 'match must be a host, like example.com' })
  expect(validBind({ on: 'fetch', match: 'example.com', extract: 'exit' })).toEqual({ bind: { on: 'fetch', match: 'example.com', extract: 'exit' } })
})

test("a shell match that is a general-purpose reader is refused: its output is anyone's, so it would read every call of it", async () => {
  // READERS: curl, tail, ssh and the rest run for anything, so a binding to one reads whatever they print
  for (const reader of ['curl', 'wget', 'tail', 'head', 'cat', 'echo', 'printf', 'grep', 'rg', 'jq', 'ssh']) {
    for (const match of [reader, ` ${reader} `, reader.toUpperCase()]) {
      expect(validBind({ on: 'shell', match, extract: 'exit' })).toEqual({ why: `${reader} runs for anything; bind a script of your own, like health-check` })
    }
    // only for a shell command: the same word as the end of a path or of a host is another binding
    expect(validBind({ on: 'edit', match: reader, extract: 'exit' })).toEqual({ bind: { on: 'edit', match: reader, extract: 'exit' } })
  }
  // a command that is a program of its own, and a script, stands
  for (const match of ['pytest', 'make', 'npm test', 'health-check', 'health.sh', 'deploy.sh', 'cargo build']) {
    expect(validBind({ on: 'shell', match, extract: 'exit' })).toEqual({ bind: { on: 'shell', match, extract: 'exit' } })
  }
  // simplification: a list, so a reader not on it still matches broadly, and one with a word beside it matches the narrower command
  expect(validBind({ on: 'shell', match: 'ssh uptime', extract: 'exit' })).toEqual({ bind: { on: 'shell', match: 'ssh uptime', extract: 'exit' } })
  // a script is found by its name, run by its path or by a shell; heads() keeps a name with a dot only as the program,
  // so `health.sh` is read when it is run itself (./health.sh), not when `bash` runs it. A name with no dot is both.
  const run = (match: string, command: string) => matches({ on: 'shell', match, extract: 'exit' }, { tool: 'Bash', input: { command }, failed: false, text: '' })
  expect(run('health-check', './health-check')).toBe(true)
  expect(run('health-check', 'bash health-check')).toBe(true)
  expect(run('health-check', 'sh health-check --all')).toBe(true)
  expect(run('health-check', '/opt/bin/health-check web-01')).toBe(true)
  expect(run('health.sh', './health.sh')).toBe(true)
  expect(run('health.sh', '/opt/bin/health.sh')).toBe(true)
  expect(run('health.sh', 'bash health.sh')).toBe(false)
  expect(run('health-check', 'curl https://web-01/health')).toBe(false)
})

const call = (tool: string, input: Record<string, unknown>, text = ''): Call => ({ tool, input, failed: false, text })
test('each `on` matches its own calls, and match is plain text, never a pattern', async () => {
  const shell = { on: 'shell', match: 'npm test', extract: 'pass_fail' } as const
  expect(matches(shell, call('Bash', { command: 'cd /repo && npm test -- --watch=false | tail -5' }))).toBe(true)
  expect(matches(shell, call('PowerShell', { command: 'npm test' }))).toBe(true)
  expect(matches(shell, call('Bash', { command: 'git commit -m "npm test passes"' }))).toBe(false) // an argument, not a command
  expect(matches(shell, call('Edit', { command: 'npm test' }))).toBe(false)
  expect(matches({ ...shell, match: 'ssh' }, call('Bash', { command: 'ssh web-01 uptime' }))).toBe(true)
  // a pattern's marks are only characters: ".*" is no wildcard, and "(" no group
  expect(matches({ ...shell, match: '.*' }, call('Bash', { command: 'npm test' }))).toBe(false)
  expect(matches({ ...shell, match: 'test(' }, call('Bash', { command: 'npm test' }))).toBe(false)
  const edit = { on: 'edit', match: 'db/schema.sql', extract: 'exit' } as const
  expect(matches(edit, call('Edit', { file_path: '/repo/db/schema.sql' }))).toBe(true)
  expect(matches(edit, call('Write', { file_path: 'C:\\repo\\db\\schema.sql' }))).toBe(true)
  expect(matches(edit, call('Edit', { file_path: '/repo/db/schema.sql.bak' }))).toBe(false)
  expect(matches(edit, call('Bash', { command: 'vi db/schema.sql' }))).toBe(false)
  const fetch = { on: 'fetch', match: 'example.com', extract: 'last_number' } as const
  expect(matches(fetch, call('WebFetch', { url: 'https://status.example.com/p95' }))).toBe(true)
  expect(matches(fetch, call('WebFetch', { url: 'https://example.org/example.com' }))).toBe(false) // the host, not the path
  expect(matches(fetch, call('WebFetch', { url: 'not a url' }))).toBe(false)
  expect(matches({ on: 'agents', extract: 'n_of_m' }, call('Agent', { prompt: 'review' }))).toBe(true)
  expect(matches({ on: 'agents', extract: 'n_of_m' }, call('Bash', { command: 'agents' }))).toBe(false)
  for (const tool of ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList']) expect(matches({ on: 'plan', extract: 'n_of_m' }, call(tool, {}))).toBe(true)
  expect(matches({ on: 'plan', extract: 'n_of_m' }, call('Read', {}))).toBe(false)
  expect(matches({ on: 'measure', extract: 'percent' }, call('session.measure', {}))).toBe(true)
  expect(matches({ on: 'measure', extract: 'percent' }, call('Bash', { command: 'measure' }))).toBe(false)
})

// ---- through the hooks

// The run as $.state holds it, read by an inline plugin (a test's own $ has no state).
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async $ => ({ text: JSON.stringify((await $.state.get({ plugin: 'hud', key: 'run' })).value ?? null) }))
}
const PEEK = { plugins: [{ name: 'peek', register: peek }], timeoutMs: 30_000 }
type Loose = (i: object) => Promise<{ context?: readonly string[]; text?: string; result?: unknown }>
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }

// A session beneath the plugin: someone watching on desktop, and each call answering with the text it carries.
const world = ($: Engine, on: On) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', ($, e) => {
    const { says, denies, answer } = e as unknown as { says?: string; denies?: boolean; answer?: { result: unknown } }
    return answer ?? (denies ? { deny: 'The person denied this call.' } : { result: says ?? 'done', text: says })
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.panes', () => ({ value: [] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const loose = (f: unknown) => f as Loose
  const run = async () => JSON.parse(String((await loose($.command.run)({ command: 'peek', args: '' })).text)) as HudRun
  return {
    hud: (i: object) => loose($.tool.call)({ tool: 'mcp__hud__hud', ...i }),
    call: (tool: string, i: object = {}) => loose($.tool.call)({ tool, ...i }),
    bash: (command: string, says?: string, more: object = {}) => loose($.tool.call)({ tool: 'Bash', command, says, ...more }),
    measure: (percent: number) => loose($.session.measure)({ context: { tokens: percent * 10_000, window: 1_000_000, percent }, rateLimits: [], changed: ['context'] }),
    turn: () => loose($.turn.complete)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }),
    run,
    widget: async (id: string) => (await run()).widgets.find(w => w.id === id) as HudWidget,
    mount: (surface: string, component: string) =>
      (($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component, ...(component === 'Pane' ? { requestId: 'hud' } : {}), props: component === 'Pane' ? pane : band })),
  }
}

test("Claude's binding goes with the widget, and the tool's answer names one it could not take", PEEK, async ($, on) => {
  const { hud, widget } = world($, on)
  expect((await hud({ start: 'Deploy', widget: { id: 'tests', type: 'stat', bind: { on: 'shell', match: 'npm test', extract: 'pass_fail' } } })).result).toBe('ok')
  expect(await widget('tests')).toMatchObject({ bind: { on: 'shell', match: 'npm test', extract: 'pass_fail' }, bound: { hits: 0, misses: 0, seen: 0 } })
  // as a JSON string, as a reload delivers a field the schema hasn't declared yet
  await hud({ widget: { id: 'p95', type: 'line', bind: '{"on":"shell","match":"bench","extract":"last_number"}' } })
  expect((await widget('p95')).bind).toEqual({ on: 'shell', match: 'bench', extract: 'last_number' })
  // a binding that can't stand leaves the widget unbound, and the answer says why, by id
  expect((await hud({ widget: { id: 'hosts', type: 'stat', bind: { on: 'shell', extract: 'exit' } } })).result).toBe('ok\nbind on hosts: match must be text for shell')
  expect((await hud({ widget: { id: 'hosts', bind: { on: 'shell', match: './run-tests.sh', extract: 'exit' } } })).result)
    .toBe('ok\nbind on hosts: match must be a command name, like pytest or npm test')
  expect((await widget('hosts')).bind).toBeUndefined()
  expect((await hud({ widget: { id: 'tests', bind: { on: 'measure', match: 'x', extract: 'percent' } } })).result).toBe('ok\nbind on tests: measure takes no match')
  expect(await widget('tests')).not.toHaveProperty('bind')
  // a widget that holds no single reading takes none
  expect((await hud({ widget: { id: 'steps', type: 'checklist', bind: { on: 'plan', extract: 'n_of_m' } } })).result)
    .toBe('ok\nbind on steps: a checklist takes no reading (stat, gauge, ring, meter, line or text do)')
  // and an update with no bind keeps the one it has
  await hud({ widget: { id: 'p95', title: 'p95 latency' } })
  expect((await widget('p95')).bind).toEqual({ on: 'shell', match: 'bench', extract: 'last_number' })
  // the vocabulary is in the property's description: the tool's own stays in what reaches the model
  expect(DESCRIPTION.length).toBeLessThanOrEqual(2048)
})

test('a matching call that parses fills the widget as the observer, its clock stamped; a line takes a point', PEEK, async ($, on) => {
  const { hud, bash, widget, run } = world($, on)
  await hud({ start: 'Fix the suite', widgets: [
    { id: 'tests', type: 'stat', title: 'Tests', value: 9, delta: 2, tone: 'good', bind: { on: 'shell', match: 'npm test', extract: 'pass_fail' } },
    { id: 'p95', type: 'line', title: 'p95', points: [210, 205], bind: { on: 'shell', match: 'bench', extract: 'last_number' } },
    { id: 'tables', type: 'ring', title: 'Tables', bind: { on: 'shell', match: 'migrate', extract: 'n_of_m' } },
    { id: 'said', type: 'text', bind: { on: 'shell', match: 'migrate', extract: 'n_of_m' } },
  ] })
  await bash('ls') // no match: nothing moves
  expect((await widget('tests')).bound).toEqual({ hits: 0, misses: 0, seen: 0 })
  await bash('cd /repo && npm test | tail -3', 'Tests:       2 failed, 39 passed, 41 total')
  const r = await run()
  expect(await widget('tests')).toMatchObject({ value: 2, unit: 'failed, 39 passed', tone: 'bad', by: 'observer', at: 0, tick: r.ticks, bound: { hits: 1, misses: 0, seen: 1 } })
  expect((await widget('tests')).delta).toBeUndefined() // Claude's change no longer says how this one moved
  await bash('npm run bench', 'runs: 200; p95: 187ms')
  expect(await widget('p95')).toMatchObject({ points: [210, 205, 187], by: 'observer' })
  await bash('./migrate --all', 'migrated 412/938 tables')
  expect(await widget('tables')).toMatchObject({ value: 412, max: 938 })
  expect((await widget('said')).text).toBe('412 of 938')
  // a reading is the observer's, but the widget is still Claude's: named, kept and keyed as Claude's
  expect((await run()).widgets.map(w => w.id)).toEqual(['tests', 'p95', 'tables', 'said'])
  expect(String((await hud({ focus: ['claude/tests'] })).result)).toBe('ok')
})

test("each `on` fills its widget: an edit, a fetch, an Agent's result, the task list's done of total, the context", PEEK, async ($, on) => {
  const { hud, call, measure, widget } = world($, on)
  await hud({ start: 'Ship it', widgets: [
    { id: 'schema', type: 'stat', bind: { on: 'edit', match: 'schema.sql', extract: 'exit' } },
    { id: 'status', type: 'stat', bind: { on: 'fetch', match: 'example.com', extract: 'last_number' } },
    { id: 'review', type: 'meter', bind: { on: 'agents', extract: 'n_of_m' } },
    { id: 'steps', type: 'ring', bind: { on: 'plan', extract: 'n_of_m' } },
    { id: 'ctx', type: 'gauge', bind: { on: 'measure', extract: 'percent' } },
  ] })
  await call('Edit', { file_path: '/repo/db/schema.sql', says: 'The file has been updated.' })
  expect((await widget('schema')).value).toBe(0)
  await call('WebFetch', { url: 'https://status.example.com/latency', says: 'p95 212 ms' })
  expect(await widget('status')).toMatchObject({ value: 212, unit: 'ms' })
  // an Agent sent to the background has no result yet: no reading, and no miss
  await call('Agent', { prompt: 'p', description: 'later', run_in_background: true, answer: { result: { status: 'async_launched', agentId: 'b1', description: 'later', prompt: 'p', outputFile: 'o' } } })
  expect((await widget('review')).bound).toEqual({ hits: 0, misses: 0, seen: 0 })
  await call('Agent', { prompt: 'review the diff', description: 'review', says: 'Reviewed 7/9 files; two need a second look.' })
  expect(await widget('review')).toMatchObject({ value: 7, max: 9 })
  const todos = [
    { content: 'Map', status: 'completed', activeForm: 'x' }, { content: 'Move', status: 'in_progress', activeForm: 'y' }, { content: 'Test', status: 'pending', activeForm: 'z' },
  ]
  // a task-list call that failed changed no list: no reading, and no miss
  await call('TodoWrite', { todos, answer: { isError: true, result: 'refused', text: 'refused' } })
  expect(await widget('steps')).toMatchObject({ bound: { hits: 0, misses: 0, seen: 0 } })
  expect((await widget('steps')).value).toBeUndefined()
  await call('TodoWrite', { todos })
  expect(await widget('steps')).toMatchObject({ value: 1, max: 3, by: 'observer' })
  await measure(64)
  expect(await widget('ctx')).toMatchObject({ value: 64, unit: '%' })
})

test('a shell sent to the background has no result yet: no reading and no miss, as it was', PEEK, async ($, on) => {
  const { hud, call, widget } = world($, on)
  await hud({ start: 'Run the suite', widget: { id: 'suite', type: 'stat', title: 'Suite', bind: { on: 'shell', match: 'npm test', extract: 'exit' } } })
  const before = await widget('suite')
  await call('Bash', { command: 'npm test', run_in_background: true, answer: { result: { backgroundTaskId: 'bash_1' }, text: 'Command running in background with ID: bash_1' } })
  expect(await widget('suite')).toEqual(before)
})

test('a miss ages a bound widget, a call that does not match ages it not at all, and a reading makes it fresh', PEEK, async ($, on) => {
  const { hud, bash, widget, run } = world($, on)
  await hud({ start: 'Warm the cache', widget: { id: 'cache', type: 'stat', bind: { on: 'shell', match: 'cache', extract: 'last_number' } } })
  await bash('npm run cache', 'cache: 4821 entries')
  // the work goes elsewhere: a bound widget waits for its own command, however long
  for (let n = 0; n < STALE * 2; n++) await bash('git status', 'clean')
  expect(life(await widget('cache'), await run())).toBe('fresh')
  for (let n = 0; n < AGING; n++) await bash('npm run cache', 'cache: unavailable')
  const aging = await widget('cache')
  expect([aging.value, aging.bound, life(aging, await run())]).toEqual([4821, { hits: 1, misses: AGING, seen: AGING + 1 }, 'aging'])
  // a denied run never ran, and a subagent's is its own: neither is a miss
  await bash('npm run cache', 'cache: unavailable', { agentId: 'a1' })
  await bash('npm run cache', 'cache: unavailable', { denies: true })
  expect((await widget('cache')).bound?.misses).toBe(AGING)
  await bash('npm run cache', 'cache: 5012 entries')
  const back = await widget('cache')
  expect([back.value, back.bound, life(back, await run())]).toEqual([5012, { hits: 2, misses: 0, seen: AGING + 2 }, 'fresh'])
})

test('stale, a bound widget draws "no reading" on both surfaces, never its old number', PEEK, async ($, on) => {
  const { hud, bash, widget, run, mount } = world($, on)
  await hud({ start: 'Warm the cache', widget: { id: 'cache', type: 'stat', title: 'Cache size', unit: 'entries', bind: { on: 'shell', match: 'cache', extract: 'last_number' } } })
  await bash('npm run cache', 'cache: 4821 entries')
  for (let n = 0; n < STALE; n++) await bash('npm run cache', 'cache: unavailable')
  expect(life(await widget('cache'), await run())).toBe('stale')
  expect((await widget('cache')).value).toBe(4821) // the run keeps it; only the drawing leaves it out
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const component of ['Pane', 'AbovePrompt']) {
      const ui = await mount(surface, component)
      const drawn = JSON.stringify(await ui.drawn())
      await ui.unmount()
      expect(drawn).not.toMatch(/\b4,?821\b/)
      // the terminal's band draws no widgets; the panes and the desktop strip (and its alt) say so in words
      if (component === 'Pane' || surface === 'desktop') expect(drawn).toContain('no reading')
    }
  }
})

test('a bound widget is fresh only with a reading someone stands behind: a rebind or an update without a value draws "no reading"', PEEK, async ($, on) => {
  const { hud, bash, widget, run, mount } = world($, on)
  // every surface's drawing, the panes and the bands, as one string
  const drawn = async () => {
    let all = ''
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const component of ['Pane', 'AbovePrompt']) {
        const ui = await mount(surface, component)
        all += JSON.stringify(await ui.drawn())
        await ui.unmount()
      }
    }
    return all
  }
  await hud({ start: 'Warm the cache', widget: { id: 'cache', type: 'stat', title: 'Cache size', bind: { on: 'shell', match: 'cache', extract: 'last_number' } } })
  await bash('npm run cache', 'cache: 4821 entries')
  for (let n = 0; n < STALE; n++) await bash('npm run cache', 'cache: unavailable')
  // stale; then a title alone: still stale (its misses stay), and no number anyone stands behind
  await hud({ widget: { id: 'cache', title: 'Cache entries' } })
  let all = await drawn()
  expect(all).not.toMatch(/\b4,?821\b/)
  expect(all).toContain('Cache entries')
  expect(all).toContain('no reading')
  expect((await widget('cache')).bound?.misses).toBe(STALE)
  expect(life(await widget('cache'), await run())).toBe('stale')
  // then Claude binds it to another command, as the pointed check asks: it starts over, with nothing to show yet
  await hud({ widget: { id: 'cache', bind: { on: 'shell', match: 'warm', extract: 'last_number' } } })
  all = await drawn()
  expect(all).not.toMatch(/\b4,?821\b/)
  expect(all).toContain('no reading')
  expect((await widget('cache')).bound).toEqual({ hits: 0, misses: 0, seen: 0 })
  expect(life(await widget('cache'), await run())).toBe('fresh')
  // a reading of the new command is current; a title sent after it takes it away again (it was the observer's, not Claude's)
  await bash('npm run warm', 'warmed 9377 entries')
  expect(await widget('cache')).toMatchObject({ value: 9377, by: 'observer', bound: { misses: 0 } })
  await hud({ widget: { id: 'cache', title: 'Cache' } })
  all = await drawn()
  expect(all).not.toMatch(/9,?377/)
  expect(all).toContain('no reading')
  // a value Claude sends is Claude's to stand behind: drawn, and fresh
  await bash('npm run warm', 'warm: unavailable')
  await hud({ widget: { id: 'cache', value: 512 } })
  expect(await widget('cache')).toMatchObject({ value: 512, by: 'claude', bound: { misses: 0 } })
  expect(await drawn()).not.toContain('no reading')
})

test('a stale bound widget: a title keeps it named, so no check comes back at once; a new binding starts it over, kept and named again when it goes stale', PEEK, async ($, on) => {
  const { hud, bash, widget, run, turn } = world($, on)
  await hud({ start: 'Warm the cache', widget: { id: 'cache', type: 'stat', bind: { on: 'shell', match: 'cache', extract: 'last_number' } } })
  await bash('npm run cache', 'cache: 4821 entries')
  let said: (readonly string[] | undefined)[] = []
  for (let n = 0; n < STALE; n++) said.push((await bash('npm run cache', 'cache: unavailable')).context)
  expect(said.at(-1)?.join('\n')).toContain('your cache stat')
  expect((await run()).named).toEqual(['cache'])
  // a title alone leaves it stale: it stays named, so the next call carries no second check for it
  await hud({ widget: { id: 'cache', title: 'Cache entries' } })
  expect((await run()).named).toEqual(['cache'])
  expect((await bash('git status', 'clean')).context).toBeUndefined()
  // a new binding starts over: not stale, nothing to show, free to be named again
  await hud({ widget: { id: 'cache', bind: { on: 'shell', match: 'warm', extract: 'last_number' } } })
  expect(life(await widget('cache'), await run())).toBe('fresh')
  expect((await run()).named).toEqual([])
  // two boundaries with no reading: still there, as it is not stale under its new binding
  await turn()
  await turn()
  expect((await run()).widgets.map(w => w.id)).toEqual(['cache'])
  // stale under the new binding, it is named again
  said = []
  for (let n = 0; n < STALE; n++) said.push((await bash('npm run warm', 'warm: unavailable')).context)
  expect(said.slice(0, -1).every(c => c === undefined)).toBe(true)
  expect(said.at(-1)?.join('\n')).toBe(`HUD check: your cache stat hasn't changed in ${STALE} calls while you ran ${STALE} npm run warm commands. Update, bind or remove it.`)
})

test('a bound widget gone stale is named in a pointed check, with what ran meanwhile, in 160 characters', PEEK, async ($, on) => {
  const { hud, bash } = world($, on)
  await hud({ start: 'Warm the cache', widget: { id: 'cache', type: 'stat', bind: { on: 'shell', match: 'cache', extract: 'last_number' } } })
  await bash('npm run cache', 'cache: 4821 entries')
  const said: (readonly string[] | undefined)[] = []
  for (let n = 0; n < STALE; n++) said.push((await bash('npm run cache', 'cache: unavailable')).context)
  // nothing before it: a run with a binding gets no general check, at 12 or later
  expect(said.slice(0, -1).every(c => c === undefined)).toBe(true)
  const note = said.at(-1)?.join('\n') ?? ''
  expect(note).toBe(`HUD check: your cache stat hasn't changed in ${STALE} calls while you ran ${STALE} npm run cache commands. Update, bind or remove it.`)
  expect(note.length).toBeLessThanOrEqual(160)
})

test('the pointed check names ids and command heads only, never a value or a note, and stays in 160 characters', async () => {
  const ran = Array.from({ length: 30 }, (_, i) => ({ tick: i + 1, head: i % 3 ? 'ssh' : 'curl' }))
  const hosts = { id: 'hosts', type: 'stat', value: 'web-01 failed: secret-token-123' } as const
  const one = { ...apply(null, { start: 'Roll out', widget: hosts }, 0), ticks: 30, ran }
  expect(pointed(one)).toBe("HUD check: your hosts stat hasn't changed in 30 calls while you ran 20 ssh commands. Update, bind or remove it.")
  // a long id is cut; what ran goes when the note would run past 160
  const r = { ...apply(null, { start: 'Roll out', widgets: [hosts, { id: 'x'.repeat(80), type: 'gauge', value: 3, text: 'a note' }] }, 0), ticks: 30, ran }
  const note = pointed(r) ?? ''
  expect(note.startsWith(`HUD check: your hosts stat, ${'x'.repeat(39)}… gauge haven't changed in 30 calls`)).toBe(true)
  expect(note).not.toContain('secret')
  expect(note).not.toContain('a note')
  expect(note.length).toBeLessThanOrEqual(160)
  // what ran is said only while the record reaches back over every call it counts
  expect(pointed({ ...one, ran: Array.from({ length: 200 }, (_, i) => ({ tick: i + 40, head: 'ssh' })), ticks: 240 })).toBe("HUD check: your hosts stat hasn't changed in 240 calls. Update, bind or remove it.")
  expect(pointed({ ...one, ran: Array.from({ length: 200 }, (_, i) => ({ tick: i + 1, head: 'ssh' })), ticks: 200 })).toContain('while you ran 200 ssh commands')
  // and the general check is short and names no value either
  const general = nudge({ ...r, sinceUpdate: 12 })
  expect(general).toBe('HUD check: 12 tool calls since your last HUD update. Send what moved or bind it; rebuild: true if the work changed; done or fail if finished.')
  expect(general.length).toBeLessThanOrEqual(160)
})

test('a shell head is kept in 30 characters at most, however long the command', async () => {
  const r = { ...apply(null, { start: 'T' }, 0), ticks: 1 }
  const seen = observe(r, call('Bash', { command: 'x' + 'a'.repeat(5000) + ' --flag' }), 0)
  expect(seen.ran?.map(x => x.head.length)).toEqual([30])
  expect(seen.ran?.[0]?.head.endsWith('…')).toBe(true)
})

test('the general HUD check goes only while no binding has seen its calls, after 12 calls with nothing sent, backing off as before', PEEK, async ($, on) => {
  const { hud, bash } = world($, on)
  const checked = async (n: number) => {
    const at: number[] = []
    for (let i = 1; i <= n; i++) if ((await bash('true')).context?.join('\n').includes('HUD check')) at.push(i)
    return at
  }
  await hud({ start: 'Deploy', widget: { id: 'up', type: 'stat', bind: { on: 'shell', match: 'health-check', extract: 'exit' } } })
  // a binding whose command never ran has proved nothing (it never ages, so it is never named): checked as if unbound
  expect(await checked(12)).toEqual([12])
  // once its command is seen (a reading or a miss), the widget keeps itself, and the general check goes quiet
  await bash('./health-check --quiet')
  expect(await checked(24 + 48)).toEqual([])
  await hud({ start: 'Deploy again', widget: { id: 'up', type: 'stat', value: 1 } })
  expect(await checked(12 + 24)).toEqual([12, 36])
})

test('a failed call is a miss for last_number: the last number of an error is not a reading', PEEK, async ($, on) => {
  const { hud, bash, widget } = world($, on)
  await hud({ start: 'Count the rows', widgets: [
    { id: 'left', type: 'stat', bind: { on: 'shell', match: 'npm run count', extract: 'last_number' } },
    { id: 'speed', type: 'line', bind: { on: 'shell', match: 'npm run count', extract: 'last_number' } },
    { id: 'took', type: 'line', bind: { on: 'shell', match: 'npm run count', extract: 'duration' } },
  ] })
  await bash('npm run count', '42 left')
  expect(await widget('left')).toMatchObject({ value: 42, bound: { hits: 1, misses: 0, seen: 1 } })
  // it failed, and its last number is a line in the error: the widget stays at 42, and the call counts against it
  await bash('npm run count', 'error at line 17', { answer: { result: 'x', isError: true, text: 'error at line 17' } })
  expect(await widget('left')).toMatchObject({ value: 42, bound: { hits: 1, misses: 1, seen: 2 } })
  expect((await widget('speed')).points).toEqual([42])
  // the duration it printed before it failed is true as far as it went, so that extractor still reads
  await bash('npm run count', 'failed after 3.5s at line 9', { answer: { result: 'x', isError: true, text: 'failed after 3.5s at line 9' } })
  expect(await widget('left')).toMatchObject({ value: 42, bound: { hits: 1, misses: 2, seen: 3 } })
  expect(await widget('took')).toMatchObject({ points: [3.5], bound: { hits: 1 } })
  // a call that succeeds reads again, and is fresh
  await bash('npm run count', '40 left')
  expect(await widget('left')).toMatchObject({ value: 40, bound: { hits: 2, misses: 0, seen: 4 } })
})

test("a bound widget by the id plan stays Claude's: the task list's mirror never takes it over", PEEK, async ($, on) => {
  const { hud, call, bash, widget } = world($, on)
  await hud({ start: 'Ship it', widget: { id: 'plan', type: 'stat', bind: { on: 'shell', match: 'count', extract: 'last_number' } } })
  await bash('npm run count', '17 left')
  await call('TodoWrite', { todos: [{ content: 'Map', status: 'completed', activeForm: 'x' }] })
  expect(await widget('plan')).toMatchObject({ type: 'stat', value: 17 })
})
