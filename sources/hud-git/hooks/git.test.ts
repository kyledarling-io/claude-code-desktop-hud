import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

import { register } from './register'

// The git source loaded as another plugin is, beside the HUD (the plugin under test), as noun.test.ts loads a source.
// Beneath both the test answers $.process, so no git, repository or network is needed: `git` is whatever the test says
// `git status` printed.
const reader: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'read-hud') return next(e)
    const held = (e as unknown as { key: string }).key === 'sources' ? await $.state.get({ plugin: 'hud', key: 'sources' }) : await $.state.get({ plugin: 'hud', key: 'slots' })
    return { result: JSON.stringify(held.value ?? {}) }
  })
}
const PLUGINS = [{ name: 'hud-git', register }, { name: 'reader', register: reader }]

type Loose = (i: object) => Promise<{ result?: unknown }>
const call = ($: Engine, input: object) => ($.tool.call as unknown as Loose)(input)
const read = async ($: Engine, key: 'slots' | 'sources') => JSON.parse(String((await call($, { tool: 'read-hud', key })).result)) as Record<string, unknown>
const shell = ($: Engine, command: string, tool: 'Bash' | 'PowerShell' = 'Bash') => call($, { tool, command })
const start = ($: Engine) => ($.session.start as unknown as (i: object) => Promise<unknown>)({ cwd: '/work', surface: null, isInteractive: false })

/** `git status --porcelain=v2 --branch` as git prints it. */
const status = (o: { head?: string; oid?: string; upstream?: string; ab?: string; files?: string[] } = {}) =>
  [
    `# branch.oid ${o.oid ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'}`,
    `# branch.head ${o.head ?? 'main'}`,
    ...(o.upstream ? [`# branch.upstream ${o.upstream}`] : []),
    ...(o.ab ? [`# branch.ab ${o.ab}`] : []),
    ...(o.files ?? []),
  ].join('\n') + '\n'
const MOD = '1 .M N... 100644 100644 100644 1111111 2222222 src/secret-plans.ts'
const NEW = '? notes/todo.txt'

type Answer = { exitCode: number; stdout: string } | 'cannot start'
// The world beneath the plugins: the clock, who is watching, the session start, the tool call (a finished call, which
// may fail) and $.process (what git prints, or nothing starting at all).
function world(on: On) {
  const clock = mock.clock(on, { now: 5 })
  const calls: { argv: readonly string[]; init?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } }[] = []
  const w = { clock, calls, git: { exitCode: 0, stdout: status() } as Answer, denied: false }
  mock.store(on)
  on('session.surfaces', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', () => (w.denied ? { deny: 'not now' } : { result: 'done' }))
  on('process.run', (_$, e) => {
    calls.push(e)
    const a = w.git
    if (a === 'cannot start') return { deny: 'spawn git ENOENT' }
    return { value: { exitCode: a.exitCode, stdout: a.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return w
}
// as the HUD holds it, with the HUD's own stamp n (the main loop's calls then, for its ranker, pinned in the HUD's tests)
const branch = (value: unknown, note: unknown, at = 5) => ({ 'hud-git/branch': { v: 1, id: 'branch', pattern: 'stat', title: 'Branch', value, note, from: 'hud-git', at, n: expect.any(Number) } })

test('at session start it declares itself and shows the branch: one git status in the session folder, 2 s at most', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  w.git = { exitCode: 0, stdout: status({ upstream: 'origin/main', ab: '+2 -0', files: [MOD, MOD, NEW] }) }
  await start($)
  expect(w.calls.map(c => c.argv)).toEqual([['git', 'status', '--porcelain=v2', '--branch']])
  expect(w.calls[0]?.init?.timeoutMs).toBe(2000)
  expect(w.calls[0]?.init?.cwd).toBeUndefined()
  expect(await read($, 'slots')).toEqual(branch('main', '3 files changed · 2 ahead'))
  expect(await read($, 'sources')).toEqual({
    'hud-git': {
      v: 1, name: 'Git', slots: [{ id: 'branch', pattern: 'stat', title: 'Branch' }],
      access: "Runs `git status` in the session's folder at session start and after git commands. Reads the branch and counts; never file contents.",
    },
  })
})

test('after a finished Bash or PowerShell call that ran git it reads again; any other call costs nothing', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.calls.length = 0
  await shell($, 'npm test')
  await shell($, 'echo "a git thing"')
  await shell($, 'ls git-hooks/')
  await call($, { tool: 'Read', file_path: '/work/git' })
  expect(w.calls).toEqual([])
  w.git = { exitCode: 0, stdout: status({ head: 'feat/x', upstream: 'origin/feat/x', ab: '+0 -3' }) }
  await shell($, 'cd /work && git checkout feat/x')
  expect(w.calls).toHaveLength(1)
  expect(await read($, 'slots')).toEqual(branch('feat/x', 'clean · 3 behind'))
  w.git = { exitCode: 0, stdout: status({ head: 'main', upstream: 'origin/main', ab: '+0 -0' }) }
  await shell($, 'git -C /work switch main', 'PowerShell')
  await shell($, 'GIT_PAGER=cat git log', 'Bash')
  expect(w.calls).toHaveLength(3)
  expect(await read($, 'slots')).toEqual(branch('main', 'clean'))
})

test('a git call that was denied did not run, so there is nothing new to read', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.calls.length = 0
  w.denied = true
  await shell($, 'git commit -am x')
  expect(w.calls).toEqual([])
})

test('what the note says: files, ahead, behind, as git counts them, and nothing it does not know', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  const noteOf = async (stdout: string) => {
    w.git = { exitCode: 0, stdout }
    await shell($, 'git status')
    return (await read($, 'slots') as Record<string, { note?: string }>)['hud-git/branch']?.note
  }
  expect(await noteOf(status({ upstream: 'origin/main', ab: '+0 -0' }))).toBe('clean')
  expect(await noteOf(status({ upstream: 'origin/main', ab: '+0 -0', files: [MOD] }))).toBe('1 file changed')
  expect(await noteOf(status({ upstream: 'origin/main', ab: '+4 -1', files: [MOD, NEW] }))).toBe('2 files changed · 4 ahead · 1 behind')
  // changed, renamed, unmerged and untracked files count; ignored ones do not
  expect(await noteOf(status({ files: [
    '1 A. N... 000000 100644 100644 0000000 3333333 added.ts',
    '2 R. N... 100644 100644 100644 4444444 5555555 R100 new name.ts\told name.ts',
    'u UU N... 100644 100644 100644 100644 6666666 7777777 8888888 conflict.ts',
    NEW, '! build/out.js',
  ] }))).toBe('4 files changed')
  // no upstream: no ahead or behind line at all, rather than a 0 it does not know
  expect(await noteOf(status())).toBe('clean')
})

test('a detached head and a repository with no commit are named as git names them', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  w.git = { exitCode: 0, stdout: status({ head: '(detached)', oid: 'abcdef0123456789abcdef0123456789abcdef01' }) }
  await shell($, 'git checkout abcdef0')
  expect(await read($, 'slots')).toEqual(branch('detached abcdef0', 'clean'))
  w.git = { exitCode: 0, stdout: status({ head: 'main', oid: '(initial)', files: [NEW] }) }
  await shell($, 'git init')
  expect(await read($, 'slots')).toEqual(branch('main', '1 file changed'))
})

test("a branch name too long for the value is cut with … and told whole in the note, after the counts", { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  const long = 'feature/rework-the-whole-checkout-flow'
  w.git = { exitCode: 0, stdout: status({ head: long, files: [MOD] }) }
  await start($)
  expect(await read($, 'slots')).toEqual(branch('feature/rework-the-whol…', `1 file changed · ${long}`))
})

test('no file name, path or content reaches the slot: counts and the branch only', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  w.git = { exitCode: 0, stdout: status({ files: [MOD, NEW, '2 R. N... 100644 100644 100644 4444444 5555555 R100 .env.production\tid_rsa'] }) }
  await start($)
  const held = JSON.stringify(await read($, 'slots'))
  for (const secret of ['secret-plans', 'todo.txt', '.env', 'id_rsa', 'notes/']) expect(held).not.toContain(secret)
})

test('not a repository, git missing or git too slow: the slot goes and nothing is said', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(Object.keys(await read($, 'slots'))).toEqual(['hud-git/branch'])
  w.git = { exitCode: 128, stdout: '' }
  await shell($, 'git status')
  expect(await read($, 'slots')).toEqual({})
  // it comes back when a repository does
  w.git = { exitCode: 0, stdout: status() }
  await shell($, 'git init')
  expect(Object.keys(await read($, 'slots'))).toEqual(['hud-git/branch'])
  w.git = 'cannot start'
  const answered = await shell($, 'git status')
  expect(answered.result).toBe('done')
  expect(await read($, 'slots')).toEqual({})
  // stdout that is not status at all
  w.git = { exitCode: 0, stdout: 'fatal: something else\n' }
  await shell($, 'git status')
  expect(await read($, 'slots')).toEqual({})
  // and at session start
  w.git = 'cannot start'
  await start($)
  expect(await read($, 'slots')).toEqual({})
})

test('an unchanged branch is not pushed again, so the slot keeps the time it last changed', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.advance(60_000)
  await shell($, 'git status')
  expect(await read($, 'slots')).toEqual(branch('main', 'clean', 5))
  w.git = { exitCode: 0, stdout: status({ files: [MOD] }) }
  await shell($, 'git status')
  expect(await read($, 'slots')).toEqual(branch('main', '1 file changed', 60_005))
})

// Any plugin may hook hud.push and refuse it (a deny rejects the caller): a source never throws into its own hooks.
const broken: Register = on => {
  on('hud.declare', () => ({ deny: 'HUD down' }))
  on('hud.push', () => ({ deny: 'HUD down' }))
  on('hud.clear', () => ({ deny: 'HUD down' }))
}
test('a HUD that refuses every call never makes the source throw: its hooks run to the end and the tool call returns what it returned', { plugins: [{ name: 'broken', tier: 'prepend', register: broken }, ...PLUGINS] }, async ($, on) => {
  const w = world(on)
  // the refused declare doesn't stop the hook: the status is still read, and again after each git command
  await start($)
  expect(w.calls).toHaveLength(1)
  expect((await shell($, 'git status')).result).toBe('done')
  expect(w.calls).toHaveLength(2)
  w.git = { exitCode: 128, stdout: '' }
  expect((await shell($, 'git status')).result).toBe('done')
  expect(w.calls).toHaveLength(3)
  expect(await read($, 'slots')).toEqual({})
})

// ---- edge cases ----

// Every string in a value, keys too, that holds a control character. It walks the value itself: JSON.stringify writes
// each C0 character as the six printable characters \u00xx, so a pattern run over its text can never see one.
const withControls = (v: unknown): string[] =>
  typeof v === 'string' ? (/[\u0000-\u001f\u007f]/.test(v) ? [v] : [])
    : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [...withControls(k), ...withControls(x)]) : []

test('a name made of control codes and 500 characters reaches the board as plain text within the cuts, the counts first', { plugins: PLUGINS }, async ($, on) => {
  const w = world(on)
  const hostile = `\u001b[31m${'x'.repeat(500)}`
  w.git = { exitCode: 0, stdout: status({ head: hostile, upstream: 'origin/x', ab: '+2 -1', files: [MOD] }) }
  await start($)
  const held = (await read($, 'slots')) as Record<string, { value: string; note: string }>
  expect(Object.keys(held)).toEqual(['hud-git/branch'])
  expect(withControls({ note: 'a\u001b[31mb' })).toEqual(['a\u001b[31mb']) // the check itself sees what it looks for
  expect(withControls(held)).toEqual([])
  // and the exact text the gate leaves: the code gone (its place is a space in the note), then the cut at 120, which
  // takes the name's tail and never the counts
  expect(held['hud-git/branch']?.value).toBe(`[31m${'x'.repeat(18)}…`)
  expect(held['hud-git/branch']?.note).toBe(`1 file changed · 2 ahead · 1 behind ·  [31m${'x'.repeat(77)}`)
})

// (30 s allowed, so a loaded machine can't time the test out: it is the 500 ms asserted on each call that checks the time)
test('a command built to make a pattern backtrack stalls nothing: the tool call is not held up and no status is read', { plugins: PLUGINS, timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  w.calls.length = 0
  for (const n of [20_000, 100_000]) {
    for (const command of [`${'('.repeat(n)}x`, `${'A=b '.repeat(n / 10)}x`, `${'a/'.repeat(n / 2)}x`]) {
      const from = performance.now()
      await shell($, command)
      expect(performance.now() - from, command.slice(0, 20)).toBeLessThan(500)
    }
  }
  expect(w.calls).toEqual([])
  // behind a long run of prefixes it is still a git command
  await shell($, `${'('.repeat(30_000)}git status`)
  expect(w.calls).toHaveLength(1)
})

// A host without $.process (the engine's types say "CLI only"). The kit's host withholds it, so a call is refused: the
// source says nothing, its hooks run to the end and the git command returns as it would have.
const noProcess: Register = on => {
  on('engine.create', async ($, e, next) => {
    const { process: _withheld, ...rest } = (await next(e)) as Record<string, unknown>
    return rest as never
  })
}
test('a host without $.process: session.start resolves, the source declares itself and says nothing', { plugins: [{ name: 'no-process', tier: 'prepend', register: noProcess }, ...PLUGINS] }, async ($, on) => {
  const w = world(on)
  expect(await start($)).toEqual({ cwd: '/work' })
  expect(Object.keys(await read($, 'sources'))).toEqual(['hud-git'])
  expect((await shell($, 'git status')).result).toBe('done')
  expect([w.calls, await read($, 'slots')]).toEqual([[], {}])
})

// A host's $.process may also throw before it returns a promise, which a `.catch` on the call never sees (SOURCES.md).
// The kit can't throw there, so this reads the hook the engine loads (an inline plugin is its register's text).
test('session.start catches each call with try/catch, not .catch on the call', async () => {
  const hook = String(register).split(/["']session\.start["']/)[1]?.split(/\bon\(/)[0] ?? ''
  expect(hook).toContain('$.process.run(')
  expect(hook).toContain('try {')
  expect(hook).not.toContain('.catch(')
})
