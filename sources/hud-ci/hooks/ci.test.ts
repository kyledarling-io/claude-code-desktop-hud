import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

import { register } from './register'

// The CI source loaded as another plugin is, beside the HUD (the plugin under test). Beneath both the test answers
// $.process and the clock: `gh` prints what the test says (so no gh, network or secret is needed) and 30 seconds pass
// when the test says so.
const reader: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'read-hud') return next(e)
    const held = (e as unknown as { key: string }).key === 'sources' ? await $.state.get({ plugin: 'hud', key: 'sources' }) : await $.state.get({ plugin: 'hud', key: 'slots' })
    return { result: JSON.stringify(held.value ?? {}) }
  })
}
const PLUGINS = [{ name: 'hud-ci', register }, { name: 'reader', register: reader }]

type Loose = (i: object) => Promise<{ result?: unknown }>
const call = ($: Engine, input: object) => ($.tool.call as unknown as Loose)(input)
const read = async ($: Engine, key: 'slots' | 'sources') => JSON.parse(String((await call($, { tool: 'read-hud', key })).result)) as Record<string, unknown>
const endSession = ($: Engine) => ($.session.end as unknown as (i: object) => Promise<unknown>)({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
const shell = ($: Engine, command: string, tool: 'Bash' | 'PowerShell' = 'Bash') => call($, { tool, command })
const start = ($: Engine) => ($.session.start as unknown as (i: object) => Promise<unknown>)({ cwd: '/work', surface: null, isInteractive: false })

const T0 = Date.parse('2026-10-12T10:00:00Z')
const POLL = 30_000
const HOUR = 3_600_000
/**
 * A run as `gh run list` reports it. `made` is when GitHub created it, fixed, so it ages as the clock moves; left out,
 * it is the run GitHub made for the latest push or opened pull request (the world's `made`).
 */
const run = (status: string, conclusion = '', name = 'Build and test', made?: number) => ({ status, conclusion, name, made })

type Answer = { exitCode: number; stdout: string } | 'cannot start'
// The world beneath the plugins: the clock, who is watching, the session start, the tool call (a finished call, which
// may fail) and $.process (the branch git names, and what gh prints on the nth poll).
function world(on: On) {
  mock.store(on)
  const clock = mock.clock(on, { now: T0 })
  const git: string[][] = [], gh: string[][] = [], opts: { timeoutMs?: number; cwd?: string }[] = []
  const w = {
    clock, git, gh, opts, failed: false, denied: false,
    /** While set, a `gh` call waits for it before it answers: a poll caught in the middle of asking. */
    gate: undefined as Promise<void> | undefined,
    branch: { exitCode: 0, stdout: 'feat/x\n' } as Answer,
    /** When GitHub made the branch's latest run: before the test, then at each push or `gh pr create` that went through. */
    made: T0 - HOUR,
    runs: (_poll: number): Answer => w.printed(),
    /** What `gh run list --json status,conclusion,name,createdAt` prints. */
    printed: (...runs: ReturnType<typeof run>[]): Answer => ({
      exitCode: 0, stdout: JSON.stringify(runs.map(({ made, ...r }) => ({ ...r, createdAt: new Date(made ?? w.made).toISOString() }))),
    }),
  }
  on('session.surfaces', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', (_$, e) => {
    if (w.denied) return { deny: 'not now' }
    if (w.failed) return { result: 'done', isError: true as const }
    // GitHub makes a run for a push and for a pull request opened (the world's own reading, words only)
    if (/\bpush\b|\bpr create\b/.test(String((e as { command?: unknown }).command))) w.made = clock.now()
    return { result: 'done' }
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('process.run', async (_$, e) => {
    const a = e.argv[0] === 'git' ? (git.push([...e.argv]), w.branch) : (gh.push([...e.argv]), w.runs(gh.length))
    opts.push(e.init ?? {})
    if (e.argv[0] === 'gh') await w.gate
    if (a === 'cannot start') return { deny: `spawn ${e.argv[0]} ENOENT` }
    return { value: { exitCode: a.exitCode, stdout: a.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return w
}
// as the HUD holds it: what the source sent, its sender, when it took it (at), and the main loop's calls then (n, the
// HUD's own stamp for its ranker, pinned in the HUD's tests)
const slotOf = (value: string, tone: string, note: string, at: number) =>
  ({ 'hud-ci/run': { v: 1, id: 'run', pattern: 'stat', title: 'CI', value, tone, note, from: 'hud-ci', at, n: expect.any(Number) } })
const LIST = ['gh', 'run', 'list', '--branch', 'feat/x', '--limit', '1', '--json', 'status,conclusion,name,createdAt']

test('it declares itself, with an access line that names every command it runs', { plugins: PLUGINS }, async ($, on) => {
  world(on)
  await start($)
  expect(await read($, 'sources')).toEqual({
    'hud-ci': {
      v: 1, name: 'CI', slots: [{ id: 'run', pattern: 'stat', title: 'CI' }],
      access: "Runs `git branch --show-current` and the GitHub CLI (`gh run list`) for this repository's branch after you push or run `gh pr`. Needs `gh` signed in; reads the branch name and run status only.",
    },
  })
  expect(await read($, 'slots')).toEqual({})
})

test("after a push it follows the branch's latest run every 30 s and stops when it finishes", { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = n => w.printed(n < 3 ? run('in_progress') : run('completed', 'success'))
  expect((await shell($, 'git push -u origin feat/x')).result).toBe('done')
  // the branch is read once, at the push; nothing is said until gh has been asked
  expect(w.git).toEqual([['git', 'branch', '--show-current']])
  expect(w.opts[0]?.timeoutMs).toBe(2000)
  expect(w.gh).toEqual([])
  expect(await read($, 'slots')).toEqual({})
  await w.clock.advance(POLL)
  expect(w.gh).toEqual([LIST])
  expect(w.opts.at(-1)?.timeoutMs).toBeLessThanOrEqual(15_000)
  expect(await read($, 'slots')).toEqual(slotOf('running', 'info', 'Build and test on feat/x', T0 + POLL))
  // still running: asked again, nothing new to say, so the slot keeps the time it last changed
  await w.clock.advance(POLL)
  expect(w.gh).toHaveLength(2)
  expect(await read($, 'slots')).toEqual(slotOf('running', 'info', 'Build and test on feat/x', T0 + POLL))
  await w.clock.advance(POLL)
  expect(await read($, 'slots')).toEqual(slotOf('passed', 'good', 'Build and test on feat/x', T0 + 3 * POLL))
  // finished: no more polling
  await w.clock.advance(4 * 60_000)
  expect(w.gh).toHaveLength(3)
})

test('a failed run is bad; a cancelled or skipped one is neither passed nor failed and is named as it is', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  const ends = async (conclusion: string) => {
    w.runs = () => w.printed(run('completed', conclusion, 'Deploy'))
    await shell($, 'git push')
    await w.clock.advance(POLL)
    return (await read($, 'slots') as Record<string, { value?: string; tone?: string }>)['hud-ci/run']
  }
  expect(await ends('failure')).toMatchObject({ value: 'failed', tone: 'bad' })
  expect(await ends('timed_out')).toMatchObject({ value: 'failed', tone: 'bad' })
  expect(await ends('startup_failure')).toMatchObject({ value: 'failed', tone: 'bad' })
  expect(await ends('cancelled')).toMatchObject({ value: 'cancelled', tone: 'warn' })
  expect(await ends('action_required')).toMatchObject({ value: 'action required', tone: 'warn' })
  expect(await ends('success')).toMatchObject({ value: 'passed', tone: 'good' })
  w.runs = () => w.printed(run('queued', '', 'Deploy'))
  await shell($, 'git push')
  await w.clock.advance(POLL)
  expect(await read($, 'slots')).toEqual(slotOf('queued', 'info', 'Deploy on feat/x', T0 + 7 * POLL))
})

test('only a push or a gh pr command starts it: git push in any form, in a chain or in PowerShell', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  // each watch ends at once (the session ends under it), so none is live when the next command comes
  // the commands that start a watch, among those given: each one that does reads the branch once
  const started = async (commands: string[], tool: 'Bash' | 'PowerShell' = 'Bash') => {
    const found: string[] = []
    for (const c of commands) {
      const before = w.git.length
      await shell($, c, tool)
      if (w.git.length > before) found.push(c)
      await endSession($)
    }
    return found
  }
  expect(await started(['git status', 'git commit -m "push it later"', 'git pull', 'npm test', 'echo git push', 'ls push/', 'gh run list', 'gh issue create', 'cat gh-pr.md'])).toEqual([])
  const yes = ['git push', 'git push origin main', 'cd /work && git push -u origin HEAD', 'git -C /work push', 'git -c core.x=y push --force-with-lease', 'GIT_TRACE=1 git push', 'gh pr create --fill', 'gh pr merge 12 --squash', 'gh pr view 3', 'gh pr checks', 'npm test && gh pr ready']
  expect(await started(yes)).toEqual(yes)
  expect(await started(['git push; Write-Output done', '& git push', 'git status'], 'PowerShell')).toEqual(['git push; Write-Output done', '& git push'])
  await call($, { tool: 'Read', file_path: '/work/git push' })
  expect(w.git).toHaveLength(yes.length + 2)
})

test('a push that failed or was denied starts nothing', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.failed = true
  await shell($, 'git push')
  w.failed = false
  w.denied = true
  await shell($, 'git push')
  await w.clock.advance(5 * POLL)
  expect([w.git, w.gh]).toEqual([[], []])
})

test("a run from before the push is not the push's: nothing is shown until its own run appears", { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  // last night's run is the latest at first; 30 s later the push's own run is there
  w.runs = n => w.printed(n < 2 ? run('completed', 'success', 'Build and test', T0 - 8 * HOUR) : run('in_progress'))
  await shell($, 'git push')
  await w.clock.advance(POLL)
  expect(await read($, 'slots')).toEqual({})
  await w.clock.advance(POLL)
  expect(await read($, 'slots')).toEqual(slotOf('running', 'info', 'Build and test on feat/x', T0 + 2 * POLL))
})

test('a repository with no CI is asked for two minutes and then left alone', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = n => (n % 2 ? w.printed() : w.printed(run('completed', 'success', 'Old', T0 - 24 * HOUR)))
  await shell($, 'git push')
  await w.clock.advance(4 * 60_000)
  expect(w.gh).toHaveLength(4)
  expect(await read($, 'slots')).toEqual({})
})

test('a run still going after 20 minutes is let go: the slot is taken away, not left saying running', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = () => w.printed(run('in_progress'))
  await shell($, 'git push')
  await w.clock.advance(19 * 60_000)
  expect(Object.keys(await read($, 'slots'))).toEqual(['hud-ci/run'])
  await w.clock.advance(3 * 60_000)
  expect(w.gh).toHaveLength(40)
  expect(await read($, 'slots')).toEqual({})
})

test('gh missing, not signed in or answering nonsense: nothing is said, and it stops asking', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  const bad: Answer[] = ['cannot start', { exitCode: 4, stdout: '' }, { exitCode: 0, stdout: 'not json' }, { exitCode: 0, stdout: '{"a":1}' }, { exitCode: 0, stdout: '[{"status":7}]' }, { exitCode: 0, stdout: '[{"status":"completed","createdAt":"last week"}]' }]
  for (const answer of bad) {
    w.gh.length = 0
    w.runs = () => answer
    expect((await shell($, 'git push')).result).toBe('done')
    await w.clock.advance(10 * POLL)
    expect(w.gh, JSON.stringify(answer)).toHaveLength(1)
    expect(await read($, 'slots'), JSON.stringify(answer)).toEqual({})
  }
})

test('gh failing after it was showing a run takes the slot away', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = n => (n < 2 ? w.printed(run('in_progress')) : { exitCode: 1, stdout: '' })
  await shell($, 'git push')
  await w.clock.advance(POLL)
  expect(Object.keys(await read($, 'slots'))).toEqual(['hud-ci/run'])
  await w.clock.advance(POLL)
  expect(await read($, 'slots')).toEqual({})
})

test('no branch to follow (detached head, not a repository, no git): gh is never asked', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  for (const none of [{ exitCode: 0, stdout: '\n' }, { exitCode: 128, stdout: '' }, 'cannot start'] as Answer[]) {
    w.branch = none
    expect((await shell($, 'git push')).result).toBe('done')
  }
  await w.clock.advance(5 * POLL)
  expect(w.git).toHaveLength(3)
  expect(w.gh).toEqual([])
  expect(await read($, 'slots')).toEqual({})
})

test('a second push is the one followed: the first watch ends and its slot goes', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = () => w.printed(run('completed', 'failure', 'Old push'))
  await shell($, 'git push')
  await w.clock.advance(POLL)
  expect(Object.keys(await read($, 'slots'))).toEqual(['hud-ci/run'])
  // the next push: the old result goes at once, and only one watch polls
  w.runs = () => w.printed(run('in_progress', '', 'New push'))
  await shell($, 'git push')
  expect(await read($, 'slots')).toEqual({})
  w.gh.length = 0
  await w.clock.advance(POLL)
  expect(w.gh).toHaveLength(1)
  expect(await read($, 'slots')).toEqual(slotOf('running', 'info', 'New push on feat/x', T0 + 2 * POLL))
})

test('the branch is one argument: a name with spaces or a shell character is never split or run', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.branch = { exitCode: 0, stdout: 'a b;rm -rf $HOME\n' }
  await shell($, 'git push')
  await w.clock.advance(POLL)
  expect(w.gh[0]?.[4]).toBe('a b;rm -rf $HOME')
  expect(w.gh[0]).toHaveLength(9)
})

// Any plugin may hook hud.push, and the HUD may be gone: a source never throws into its own hooks.
const broken: Register = on => {
  on('hud.declare', () => ({ deny: 'HUD down' }))
  on('hud.push', () => ({ deny: 'HUD down' }))
  on('hud.clear', () => ({ deny: 'HUD down' }))
}
test('a HUD that refuses or fails never makes the source throw: the tool call still returns what it returned', { plugins: [{ name: 'broken', tier: 'prepend', register: broken }, ...PLUGINS] }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = n => w.printed(n < 2 ? run('in_progress') : run('completed', 'success'))
  expect((await shell($, 'git push')).result).toBe('done')
  await w.clock.advance(3 * POLL)
  expect(w.gh).toHaveLength(2)
})

// ---- edge cases ----

const timed = async <T>(f: () => Promise<T>) => {
  const from = performance.now()
  await f()
  return performance.now() - from
}

// (30 s allowed, so a loaded machine can't time the test out: it is the 500 ms asserted on each call that checks the time)
test('a command built to make a pattern backtrack stalls nothing: the tool call is not held up and starts no watch', { plugins: PLUGINS, timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  for (const n of [26, 40, 2000]) {
    for (const command of [`git${' --a'.repeat(n)} x`, `git ${'-c a=b '.repeat(n)}status`, `${'('.repeat(n * 20)}x`, `${'A=b '.repeat(n)}x`]) {
      expect(await timed(() => shell($, command)), command.slice(0, 40)).toBeLessThan(500)
    }
  }
  expect(w.git).toEqual([])
  // the same long run of options, then a push, is a push
  expect(await timed(() => shell($, `git${' --a'.repeat(40)} push`))).toBeLessThan(500)
  expect(w.git).toHaveLength(1)
})

test('two pushes that interleave start one watch, not two', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = () => w.printed(run('in_progress'))
  await Promise.all([shell($, 'git push'), shell($, 'git push origin feat/x')])
  w.gh.length = 0
  await w.clock.advance(POLL)
  expect(w.gh).toHaveLength(1)
  await w.clock.advance(POLL)
  expect(w.gh).toHaveLength(2)
})

test('a poll caught asking gh when a newer push comes never puts the old run back after the new push cleared it', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = () => w.printed(run('in_progress', '', 'Old push'))
  await shell($, 'git push')
  let release = () => {}
  w.gate = new Promise<void>(resolve => { release = resolve })
  await w.clock.advance(POLL)
  expect(w.gh).toHaveLength(1)
  // the newer push comes while that poll waits on gh
  await shell($, 'git push')
  release()
  w.gate = undefined
  await w.clock.settle()
  expect(await read($, 'slots')).toEqual({})
  // the new watch, alone, shows its own run
  w.runs = () => w.printed(run('in_progress', '', 'New push'))
  await w.clock.advance(POLL)
  expect(await read($, 'slots')).toEqual(slotOf('running', 'info', 'New push on feat/x', T0 + 2 * POLL))
})

test('the session ending ends the watch', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = () => w.printed(run('in_progress'))
  await shell($, 'git push')
  await w.clock.advance(POLL)
  expect(w.gh).toHaveLength(1)
  await endSession($)
  await w.clock.advance(10 * POLL)
  expect(w.gh).toHaveLength(1)
})

test('while a watch is live only a push restarts it: gh pr view, checks, status and create leave it be; with none live any gh pr command starts one', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = n => w.printed(n < 3 ? run('in_progress') : run('completed', 'success'))
  await shell($, 'git push')
  await w.clock.advance(POLL)
  expect(Object.keys(await read($, 'slots'))).toEqual(['hud-ci/run'])
  for (const command of ['gh pr view 12', 'gh pr checks', 'gh pr status', 'gh pr create --fill', 'cd app && gh pr view --web']) await shell($, command)
  // no new branch read, the slot never went, and the one watch goes on
  expect(w.git).toHaveLength(1)
  expect(Object.keys(await read($, 'slots'))).toEqual(['hud-ci/run'])
  await w.clock.advance(POLL)
  expect(w.gh).toHaveLength(2)
  expect(await read($, 'slots')).toEqual(slotOf('running', 'info', 'Build and test on feat/x', T0 + POLL))
  await w.clock.advance(POLL)
  expect(await read($, 'slots')).toEqual(slotOf('passed', 'good', 'Build and test on feat/x', T0 + 3 * POLL))
  // none live now: a gh pr command starts a watch again
  await shell($, 'gh pr checks')
  expect(w.git).toHaveLength(2)
  // and a push restarts a live one
  await shell($, 'git push')
  expect(w.git).toHaveLength(3)
})

test('a gh pr command never takes a finished result away: it stays until the next push, and only a newer run replaces it', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.runs = n => w.printed(n < 2 ? run('in_progress') : run('completed', 'success'))
  await shell($, 'git push')
  await w.clock.advance(2 * POLL)
  const passed = slotOf('passed', 'good', 'Build and test on feat/x', T0 + 2 * POLL)
  expect(await read($, 'slots')).toEqual(passed)
  // five minutes on, a look at the pull request, which makes no run: the result stands while gh is asked for two
  // minutes, once it stops asking, and when gh fails
  await w.clock.advance(5 * 60_000)
  await shell($, 'gh pr checks 14')
  expect(await read($, 'slots')).toEqual(passed)
  const asked = w.gh.length
  await w.clock.advance(3 * 60_000)
  expect(w.gh.length - asked).toBe(4)
  expect(await read($, 'slots')).toEqual(passed)
  w.runs = () => ({ exitCode: 1, stdout: '' })
  await shell($, 'gh pr view 14')
  await w.clock.advance(POLL)
  expect(await read($, 'slots')).toEqual(passed)
  // opening a pull request makes a run: that newer run replaces the result once gh reports it
  w.runs = () => w.printed(run('in_progress', '', 'PR checks'))
  await shell($, 'gh pr create --fill')
  expect(await read($, 'slots')).toEqual(passed)
  await w.clock.advance(POLL)
  expect(await read($, 'slots')).toEqual(slotOf('running', 'info', 'PR checks on feat/x', T0 + 20 * POLL))
})

// A host without $.process (the engine's types say "CLI only"). The kit's host withholds it, so a call is refused: the
// source says nothing, its hooks run to the end and the push returns as it would have.
const noProcess: Register = on => {
  on('engine.create', async ($, e, next) => {
    const { process: _withheld, ...rest } = (await next(e)) as Record<string, unknown>
    return rest as never
  })
}
test('a host without $.process: session.start resolves, the source declares itself and says nothing', { plugins: [{ name: 'no-process', tier: 'prepend', register: noProcess }, ...PLUGINS] }, async ($, on) => {
  const w = world(on)
  expect(await start($)).toEqual({ cwd: '/work' })
  expect(Object.keys(await read($, 'sources'))).toEqual(['hud-ci'])
  expect((await shell($, 'git push')).result).toBe('done')
  await w.clock.advance(5 * POLL)
  expect([w.git, w.gh, await read($, 'slots')]).toEqual([[], [], {}])
})

// A call may also throw before it returns a promise ($.process on a host without it, $.hud while the HUD reloads),
// which a `.catch` on the call never sees (SOURCES.md). The kit can't throw there, so this reads the hook the engine
// loads (an inline plugin is its register's text).
test('session.start catches each call with try/catch, not .catch on the call', async () => {
  const hook = String(register).split(/["']session\.start["']/)[1]?.split(/\bon\(/)[0] ?? ''
  expect(hook).toContain('$.hud.declare(')
  expect(hook).toContain('try {')
  expect(hook).not.toContain('.catch(')
})

// Every string in a value, keys too, that holds a control character. It walks the value itself: JSON.stringify writes
// each C0 character as the six printable characters \u00xx, so a pattern run over its text can never see one.
const withControls = (v: unknown): string[] =>
  typeof v === 'string' ? (/[\u0000-\u001f\u007f]/.test(v) ? [v] : [])
    : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [...withControls(k), ...withControls(x)]) : []

test('a name made of control codes and 500 characters reaches the board as plain text within the cuts', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  const hostile = `\u001b[31m${'x'.repeat(500)}`
  w.branch = { exitCode: 0, stdout: `${hostile}\n` }
  w.runs = () => w.printed(run('completed', 'success', hostile))
  await shell($, 'git push')
  await w.clock.advance(POLL)
  const held = (await read($, 'slots')) as Record<string, { value: string; note: string }>
  expect(Object.keys(held)).toEqual(['hud-ci/run'])
  expect(withControls({ note: 'a\u001b[31mb' })).toEqual(['a\u001b[31mb']) // the check itself sees what it looks for
  expect(withControls(held)).toEqual([])
  // and the exact text the gate leaves: the code gone, then the cut at 120
  expect(held['hud-ci/run']?.value).toBe('passed')
  expect(held['hud-ci/run']?.note).toBe(`[31m${'x'.repeat(116)}`)
})
