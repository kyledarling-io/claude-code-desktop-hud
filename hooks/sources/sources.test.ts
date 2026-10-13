import { test, expect } from 'claude-code/testing'

import { accept, acceptDeclaration, type Declaration, type Slot } from './contract'
import * as meter from './meter'
import * as tests from './tests'
import * as tools from './tools'

// A short session: edits (one refused), test runs whose counts move, a heredoc refused twice, a script that fails
// until the work moves on
const run = (command: string, text = '', failed = false): tools.Call => ({ tool: 'Bash', input: { command }, failed, text })
const edit = (file_path: string, failed = false, tool = 'Edit'): tools.Call => ({ tool, input: { file_path }, failed })
const heredoc = "cat >> hooks/gate.test.ts <<'EOF'\ntest('a call', () => {})\nEOF"
const summary = (pass: number, fail: number) => ` ${pass} pass\n ${fail} fail\nRan ${pass + fail} tests across 5 files. [1.51s]`
const calls: tools.Call[] = [
  { tool: 'Read', input: { file_path: 'hooks/strip.tsx' }, failed: false },
  edit('hooks/strip.tsx'), edit('hooks/strip.tsx'), edit('hooks/strip.test.tsx', false, 'Write'),
  edit('hooks/svg.ts', true),
  run('claude plugin test . 2>&1 | tail -3', summary(13, 3)), // a pipe exits 0
  run(heredoc, 'refused', true), run(heredoc, 'refused', true),
  edit('hooks/gate.test.ts'),
  run('claude plugin test . 2>&1 | tail -3', summary(15, 2)),
  run('cat hooks/gate.test.ts', "test('a call', () => {})"),
  run('python scripts/fit.py', 'SyntaxError: unexpected EOF while parsing', true),
  edit('hooks/svg.ts'),
  run('claude plugin test .', summary(17, 0)),
  ...['git status', 'git diff --stat', 'sed -n 1,20p hooks/svg.ts', 'grep -n stat hooks/svg.ts', 'tail -4 hooks/svg.ts',
    'git log --oneline -3', 'ls hooks', 'head -3 hooks/svg.ts'].map(c => run(c)),
  run('claude plugin test . 2>&1 | tail -3', summary(16, 1)), // the tenth run since python's: the work moved on
]

// What the gate keeps of a slot that needs nothing dropped: the slot itself, less its empty fields.
const kept = (s: Slot) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined))
const passes = (s: Slot, decl: Declaration, at: number) => {
  const held = accept(s, 'hud', decl, at)
  expect(typeof held === 'string' ? held : '').toBe('') // the reason, if refused
  expect(held).toEqual({ ...kept(s), from: 'hud', at })
}

test('a session: the sources read it, and every slot they send passes the v1 gate unchanged', async () => {
  let t = tools.init, r = tests.init
  const sent: Slot[] = [], cleared: string[] = []
  for (const [at, c] of calls.entries()) {
    const a = tools.observe(t, c), b = tests.observe(r, c)
    t = a.state, r = b.state
    for (const s of [...a.push, ...b.push]) passes(s, s.id === 'tests' ? tests.declaration : tools.declaration, at)
    sent.push(...a.push, ...b.push)
    cleared.push(...a.clear, ...b.clear)
  }
  // edited: one per file a successful edit touched, counted apart from the source
  const files = new Set(calls.filter(c => ['Edit', 'Write'].includes(c.tool) && !c.failed).map(c => c.input.file_path))
  expect([sent.filter(s => s.id === 'edited').at(-1)?.value, files.size]).toEqual([4, 4])
  // tests: the runs' failures in order, as they printed them. The first exited 0 with 3 failing
  const runs = sent.filter(s => s.id === 'tests')
  expect(runs.map(s => s.value)).toEqual([3, 2, 0, 1])
  const first = calls.find(c => /\b3 fail\b/.test(c.text ?? ''))
  expect(first?.failed).toBe(false)
  expect([runs[0]?.note, runs[1]?.delta]).toEqual(['claude plugin test: 13 passed, 3 failed', -1])
  // failing: a command that failed is named until it passes, or the work moves on; then the slot goes
  expect([...new Set(sent.filter(s => s.id === 'failing').map(s => s.note))]).toEqual(['cat failed once in a row', 'cat failed 2 times in a row', 'python failed once in a row'])
  expect([t.failing, cleared]).toEqual([{}, ['failing', 'failing']])
})

test('a shell run is known by its steps', async () => {
  const cases: [string, string[]][] = [
    ['cd ~/x && claude plugin test . 2>&1 | tail -25', ['claude plugin test']],
    ['npx -y -p typescript@5.6.3 tsc -p . 2>&1 | head; claude plugin validate .', ['npx tsc', 'claude plugin validate']],
    ["python - <<'EOF'\nimport re\nprint(1)\nEOF", ['python']],
    ['FOO=1 npm run build', ['npm run build']],
    ['export X=1; cd dir', []],
    ['C:/tools/node.exe dev/trial.mjs', ['node']],
    ['git commit -m "fix: the thing"', ['git commit']],
    ['Get-ChildItem -Recurse', ['Get-ChildItem']],
  ]
  for (const [command, want] of cases) expect(tools.heads(command)).toEqual(want)
})

test('test summaries from the common runners, and nothing from a log line', async () => {
  expect(tests.counts(' 25 pass\n 0 fail\nRan 25 tests across 5 files.')).toEqual({ passed: 25, failed: 0 }) // bun, claude plugin test
  expect(tests.counts('Tests:       2 failed, 21 passed, 23 total')).toEqual({ passed: 21, failed: 2 }) // jest
  expect(tests.counts('==== 1 failed, 40 passed in 2.31s ====')).toEqual({ passed: 40, failed: 1 }) // pytest
  expect(tests.counts('  21 passing (40ms)\n  2 failing')).toEqual({ passed: 21, failed: 2 }) // mocha
  expect(tests.counts('test result: FAILED. 9 passed; 1 failed; 0 ignored')).toEqual({ passed: 9, failed: 1 }) // cargo
  const run = (command: string, text: string) => tests.observe(tests.init, { tool: 'Bash', input: { command }, failed: false, text }).push
  expect(run('cat build.log', 'step 4: 3 failed')).toEqual([]) // one count, and no test command
  expect(run('pytest -q', '3 failed in 0.52s')[0]?.value).toBe(3) // one count from a test command will do
})

test("only a runner's own summary line is a test run: a log line or test code that mentions counts is not", async () => {
  // the HUD's own log lines printed back from a page, and a test file's literals shown by sed
  const printed = [
    run('node scripts/show-log.mjs', 'log: t:2 failed ; m:npm test: 39 passed, 0 failed ; m:npm run build failed once in a row'),
    run('sed -n 205,212p hooks/autolog.test.ts', "    await call({ tool: 'Bash', command: 'npm test', text: '3 failed, 7 passed', fail: true })\n    await call({ tool: 'Bash', command: 'npm test', text: '0 failed, 10 passed' })"),
  ]
  for (const c of printed) expect([tests.counts(c.text ?? ''), tests.observe(tests.init, c).push]).toEqual([{}, []])
  // every runner's own shape still reads, ANSI colour and Windows line ends and all
  const shapes: [string, { passed?: number; failed?: number }][] = [
    ['\x1b[32m 25 pass\x1b[0m\r\n\x1b[31m 2 fail\x1b[0m\r\nRan 27 tests across 5 files.', { passed: 25, failed: 2 }], // bun, claude plugin test
    ['ℹ tests 4\nℹ pass 3\nℹ fail 1\nℹ duration_ms 61.2', { passed: 3, failed: 1 }], // node --test
    ['# pass 4\n# fail 0', { passed: 4, failed: 0 }], // node --test, TAP
    ['Test Suites: 1 failed, 3 passed, 4 total\nTests:       2 failed, 21 passed, 23 total', { passed: 21, failed: 2 }], // jest
    ['      Tests  1 failed | 21 passed (22)', { passed: 21, failed: 1 }], // vitest
    ['========= 1 failed, 40 passed in 65.43s (0:01:05) =========', { passed: 40, failed: 1 }], // pytest
    ['3 passed in 0.12s', { passed: 3 }], // pytest -q
    ['  21 passing (40ms)\n  2 failing', { passed: 21, failed: 2 }], // mocha
    ['test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured', { passed: 9, failed: 0 }], // cargo
  ]
  for (const [text, want] of shapes) expect(tests.counts(text), text).toEqual(want)
  // prose that mentions counts, wherever it stands
  for (const text of ['step 4: 3 failed', 'npm test: 39 passed, 0 failed', "text: '0 failed, 10 passed'", 'all 12 pass now', '(fail) 3 passed'])
    expect(tests.counts(text), text).toEqual({})
})

// pytest's errors are failures; jest's (and vitest's) suites line counts files, and a file that failed to run leaves its
// tests out of the tests line: no count then, never 0 failed. Failed tests beside a failed suite still read.
test("a runner's errors count as failed, and a failed suite beside no failed test gives no count", async () => {
  expect(tests.counts('==================== 3 passed, 2 errors in 1.20s ====================')).toEqual({ passed: 3, failed: 2 })
  expect(tests.counts('============ 1 failed, 3 passed, 2 errors in 1.20s ============')).toEqual({ passed: 3, failed: 3 })
  expect(tests.counts('==================== 2 errors in 0.50s ====================')).toEqual({ failed: 2 })
  expect(tests.counts('=== 5 passed, 1 warning, 1 error in 0.31s ===')).toEqual({ passed: 5, failed: 1 })
  expect(tests.counts('Test Suites: 1 failed, 1 passed, 2 total\nTests:       3 passed, 3 total\nSnapshots:   0 total')).toEqual({})
  expect(tests.counts('Tests:  3 passed, 3 total\nTest Suites: 1 failed, 1 passed, 2 total')).toEqual({})
  expect(tests.counts(' Test Files  1 failed | 1 passed (2)\n      Tests  3 passed (3)')).toEqual({}) // vitest
  expect(tests.counts('Test Suites: 1 failed, 3 passed, 4 total\nTests:       2 failed, 21 passed, 23 total')).toEqual({ passed: 21, failed: 2 })
  const run = (command: string, text: string) => tests.observe(tests.init, { tool: 'Bash', input: { command }, failed: false, text }).push
  expect(run('pytest', '3 passed, 2 errors in 1.20s')[0]?.value).toBe(2)
  expect(run('npx jest', 'Test Suites: 1 failed, 1 passed, 2 total\nTests:       3 passed, 3 total')).toEqual([]) // nothing new
  // an error that escaped every passing test: vitest's Errors line, bun's error line (the run exits 1)
  expect(tests.counts(' Test Files  1 passed (1)\n      Tests  3 passed (3)\n     Errors  1 error\n   Start at  12:00:00\n   Duration  412ms')).toEqual({ passed: 3, failed: 1 })
  expect(tests.counts('# Unhandled error between tests\nerror: boom\n\n 3 pass\n 0 fail\n 1 error\n 3 expect() calls\nRan 3 tests across 1 file. [12.00ms]')).toEqual({ passed: 3, failed: 1 })
  expect(tests.counts(' 3 pass\n 2 fail\n 2 errors\nRan 5 tests across 1 file.')).toEqual({ passed: 3, failed: 4 })
  expect(run('npx vitest run', '      Tests  3 passed (3)\n     Errors  2 errors')[0]?.value).toBe(2)
})

test('a run that printed only a fail count claims no pass count', async () => {
  const run = (text: string) => tests.observe(tests.init, { tool: 'Bash', input: { command: 'claude plugin test . | tail -2' }, failed: false, text }).push[0]
  const tailed = run(' 3 fail\nRan 25 tests across 5 files.') // `| tail -2` cut " 22 pass"
  expect([tailed?.value, tailed?.note]).toEqual([3, 'claude plugin test: 3 failed'])
  expect(run(' 22 pass\n 3 fail')?.note).toBe('claude plugin test: 22 passed, 3 failed') // both printed, both named
  // a pass count alone: the note names it only, and the figure reads none failed
  const passes = run(' 24 pass\nRan 24 tests across 5 files.')
  expect([passes?.value, passes?.note]).toEqual([0, 'claude plugin test: 24 passed'])
})

test('the meter: context fills at 70% and nearly full at 85%, limits show past half', async () => {
  const now = Date.parse('2026-10-11T12:00:00Z')
  const at = (percent: number, changed: meter.Measure['changed'] = ['context']) =>
    meter.observe({ context: { percent, tokens: percent * 10_000, window: 1_000_000 }, rateLimits: [], changed }, now).push[0]
  expect([at(40)?.tone, at(70)?.tone, at(85)?.tone]).toEqual([undefined, 'warn', 'bad'])
  expect(at(86)?.note).toBe('860k of 1M tokens; compaction is near')
  expect(at(40, ['cost'])).toBeUndefined() // only what moved is sent
  const limits = (percentUsed: number) => meter.observe({
    context: { window: 1_000_000 }, cost: { usd: 1.234 }, changed: ['rateLimits', 'cost'],
    rateLimits: [{ kind: 'seven_day', percentUsed: 12 }, { kind: 'five_hour', percentUsed, resetsAt: '2026-10-11T13:30:00Z' }],
  }, now)
  expect(limits(30)).toEqual({ push: [expect.objectContaining({ id: 'cost', value: 1.23 })], clear: ['limits'] })
  expect(limits(72).push[1]).toEqual(expect.objectContaining({ id: 'limits', title: '5-hour limit', tone: 'warn', note: '72% used; resets in 1h 30m' }))
  for (const s of [...limits(90).push, ...meter.observe({ context: { percent: 90, window: 1_000_000 }, rateLimits: [], changed: ['context'] }, now).push]) passes(s, meter.declaration, now)
})

test('sites fetched and searched, newest first; a file URL is not a fetch', async () => {
  let s = tools.init
  for (const c of [
    { tool: 'WebFetch', input: { url: 'https://docs.example.com/a' } },
    { tool: 'WebSearch', input: { query: 'claude code desktop mods' } },
    { tool: 'mcp__Claude_Browser__navigate', input: { url: 'file:///~/x.html' } },
    { tool: 'mcp__Claude_Browser__navigate', input: { url: 'https://www.aitmpl.com/mods/' } },
    { tool: 'WebFetch', input: { url: 'https://docs.example.com/b' } },
  ]) s = tools.observe(s, { ...c, failed: false }).state
  expect([s.fetched, s.fetches]).toEqual([['docs.example.com', 'www.aitmpl.com', '“claude code desktop mods”'], 4])
})

test('the v1 gate: plain data only, declared slots only, unknown fields dropped, text cut, sender tagged', async () => {
  const decl = acceptDeclaration({ v: 1, name: 'Deploys', access: 'Reads deploy states from its own API.', slots: [{ id: 'prod', pattern: 'stat', title: 'Prod' }, { id: 'prod', pattern: 'list', title: 'Dup' }, { id: 'Bad Id', pattern: 'stat', title: 'x' }], extra: true })
  expect(decl).toEqual({ v: 1, name: 'Deploys', access: 'Reads deploy states from its own API.', slots: [{ id: 'prod', pattern: 'stat', title: 'Prod' }] })
  expect(acceptDeclaration({ v: 1, name: 'No access line', slots: [{ id: 'a', pattern: 'stat', title: 'A' }] })).toBe('a declaration names itself and says what it can access')
  expect(acceptDeclaration({ v: 2, name: 'n', access: 'a', slots: [] })).toBe('speaks v2; this HUD reads v1')
  const d = decl as Declaration
  const slot = { v: 1, id: 'prod', pattern: 'stat', title: 'Prod' }
  expect(accept({ ...slot, id: 'staging' }, 'deploys', d, 0)).toBe('deploys declared no slot "staging"')
  expect(accept({ ...slot, pattern: 'list' }, 'deploys', d, 0)).toBe('"prod" is declared a stat')
  expect(accept(slot, 'deploys', undefined, 0)).toBe('deploys has not declared itself')
  expect(accept({ ...slot, v: 2 }, 'deploys', d, 0)).toBe('speaks v2; this HUD reads v1')
  expect(accept(new (class { v = 1 })(), 'deploys', d, 0)).toBe('a slot is a plain object')
  expect(accept({
    ...slot, value: Infinity, delta: NaN, hint: 7, tone: 'neon', onPress: () => 1, html: '<b>x</b>',
    note: 'line one\nline two' + 'x'.repeat(200), items: [{ label: 'a', color: '#f00', value: 1 }, { value: 2 }],
  }, 'deploys', d, 5)).toEqual({ v: 1, id: 'prod', pattern: 'stat', title: 'Prod', hint: 1, note: ('line one line two' + 'x'.repeat(200)).slice(0, 120), items: [{ label: 'a', value: 1 }], from: 'deploys', at: 5 })
})

test('the gate makes every control character a space: C0 and C1, DEL, the line and paragraph separators, the bidi controls', async () => {
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  const codes = [...range(0x00, 0x1f), 0x7f, ...range(0x80, 0x9f), 0x2028, 0x2029, 0x200e, 0x200f, ...range(0x202a, 0x202e), ...range(0x2066, 0x2069)]
  expect(codes).toHaveLength(78)
  const d = acceptDeclaration({ v: 1, name: 'Deploys', access: 'Reads deploy states.', slots: [{ id: 'prod', pattern: 'checklist', title: 'Prod' }] }) as Declaration
  for (const code of codes) {
    const t = `a${String.fromCharCode(code)}b`
    const held = accept({ v: 1, id: 'prod', pattern: 'checklist', title: t, note: t, items: [{ label: t, note: t }] }, 'deploys', d, 0)
    expect(held, `U+${code.toString(16).padStart(4, '0')}`).toMatchObject({ title: 'a b', note: 'a b', items: [{ label: 'a b', note: 'a b' }] })
  }
  // a run of them is one space, and none is left at either end
  const bidi = String.fromCharCode(0x202e, 0x2066, 0x85)
  expect(accept({ v: 1, id: 'prod', pattern: 'checklist', title: `${bidi}Prod${bidi}ok${bidi}` }, 'deploys', d, 0)).toMatchObject({ title: 'Prod ok' })
})
