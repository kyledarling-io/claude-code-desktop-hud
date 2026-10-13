import { test, expect } from 'claude-code/testing'

import { extract, type Extractor, type Reading } from './extract'
import { tidy } from './text'

// A table row: what the output is called, the output, and the reading it should give (undefined: no reading).
// The name goes into the compared value, so a failure says which row it was.
type Case = [name: string, text: string, want: Reading | undefined]
const reads = (kind: Extractor, cases: Case[]) => {
  for (const [name, text, want] of cases) expect({ name, got: extract(kind, text, false) }).toEqual({ name, got: want })
}
const ESC = '\x1b'
const NBSP = '\xa0'
const BEL = '\x07'
const BOM = String.fromCharCode(0xfeff)
const KINDS: Extractor[] = ['pass_fail', 'n_of_m', 'percent', 'duration', 'last_number']
const failing = (failed: number, passed?: number): Reading => ({ value: failed, failed, ...(passed === undefined ? {} : { passed }), unit: 'failed' })

// Outputs as the tools print them. BUN_*, NODE_*, TSC_* and the tail of CURL_BAR were captured from the real tools
// (bun's as `claude plugin test` prints it); jest, vitest, pytest, mocha, cargo, npm and the Keras and tqdm logs
// follow the formats those tools document.
const BUN_RED = `hooks/svg.test.ts:
(pass) every widget type renders clean svg [80.21ms]
(pass) markdown Claude writes is drawn as plain text [3.32ms]

 13 pass
 3 fail
Ran 16 tests across 5 files. [1.51s]`
const BUN_GREEN = `(pass) the pane lists every source with what it can access and its slots [999.50ms]

 88 pass
 0 fail
Ran 88 tests across 14 files. [3.59s]`
const NODE_RED = `✔ ok one (1.1837ms)
✔ ok two (0.2275ms)
✖ bad (1.4135ms)
ℹ tests 3
ℹ suites 0
ℹ pass 2
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 145.4602

✖ failing tests:

test at a.test.mjs:5:1
✖ bad (1.4135ms)
  AssertionError [ERR_ASSERTION]: 1 == 2
      at TestContext.<anonymous> (file:///a.test.mjs:5:28)
  }`
const NODE_GREEN = `✔ ok one (0.8643ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 107.4456`
const JEST_RED = `Test Suites: 1 failed, 3 passed, 4 total
Tests:       2 failed, 21 passed, 23 total
Snapshots:   0 total
Time:        1.234 s
Ran all test suites.`
const JEST_GREEN = `Test Suites: 4 passed, 4 total
Tests:       21 passed, 21 total
Time:        0.9 s`
const PYTEST_RED = `=========================== short test summary info ============================
FAILED tests/test_a.py::test_x - assert 1 == 2
======================= 1 failed, 20 passed, 2 warnings in 1.23s =======================`
const PYTEST_GREEN = `============================== 21 passed in 0.52s ===============================`
const CARGO_RED = `running 23 tests
test result: FAILED. 21 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s`
const NPM = `added 142 packages, and audited 143 packages in 6s

31 packages are looking for funding
  run \`npm fund\` for details

found 0 vulnerabilities`
const TSC_PLAIN = `x.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
y.ts(1,26): error TS2552: Cannot find name 'undefinedName'. Did you mean 'undefined'?
Found 3 errors in 2 files.`
// tsc --pretty: colour codes inside the lines, and a table after the count
const TSC_PRETTY = `${ESC}[96mx.ts${ESC}[0m:${ESC}[93m1${ESC}[0m:${ESC}[93m7${ESC}[0m - ${ESC}[91merror${ESC}[0m${ESC}[90m TS2322: ${ESC}[0mType 'string' is not assignable to type 'number'.

${ESC}[7m1${ESC}[0m const a: number = 'x'
${ESC}[7m ${ESC}[0m ${ESC}[91m      ~${ESC}[0m


Found 3 errors in 2 files.

Errors  Files
     2  x.ts${ESC}[90m:1${ESC}[0m
     1  y.ts${ESC}[90m:1${ESC}[0m`
// curl -# redraws its bar with a carriage return; the last redraw is the real one
const CURL_BAR = `\r######                                                                     8.3%\r################                                                          23.0%\r######################################################################## 100.0%\r\n`
const CURL_METER = `  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
\r  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0
100  1256  100  1256    0     0   5000      0 --:--:-- --:--:-- --:--:--  5000`
const KERAS = `Epoch 3/10
938/938 [==============================] - 12s 13ms/step - loss: 0.2345 - accuracy: 0.9210
Epoch 4/10
412/938 [============>.................] - ETA: 6s - loss: 0.1987 - accuracy: 0.9402`
const TQDM = `Epoch 3/10: 100%|██████████| 938/938 [00:12<00:00, 75.1it/s, loss=0.234]
Epoch 4/10:  45%|████▌     | 422/938 [00:05<00:06, 80.1it/s, loss=0.198]`

test('pass_fail reads the failed count and the passed count a runner printed, and no count it did not', () => {
  reads('pass_fail', [
    ['bun, 3 failing (the exit status of `| tail` would say 0)', BUN_RED, failing(3, 13)],
    ['bun, green', BUN_GREEN, failing(0, 88)],
    ['node:test, failing: the details after the summary do not matter', NODE_RED, failing(1, 2)],
    ['node:test, green', NODE_GREEN, failing(0, 1)],
    ['node:test, TAP reporter', '# tests 23\n# pass 21\n# fail 2\n# duration_ms 98', failing(2, 21)],
    ['jest: the suites line is not the tests line', JEST_RED, failing(2, 21)],
    ['vitest', ' Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 21 passed (23)\n   Duration  1.23s', failing(2, 21)],
    ['pytest, failing', PYTEST_RED, failing(1, 20)],
    ['mocha', '  21 passing (35ms)\n  2 failing\n\n  1) suite\n       a test:\n     AssertionError: expected 1 to equal 2', failing(2, 21)],
    ['cargo', CARGO_RED, failing(2, 21)],
    ['the colour codes jest prints inside the line', `${ESC}[1mTests:${ESC}[22m       ${ESC}[1m${ESC}[31m2 failed${ESC}[39m${ESC}[22m, ${ESC}[1m${ESC}[32m21 passed${ESC}[39m${ESC}[22m, 23 total`, failing(2, 21)],
    ['bold markdown round the count', '**2 failed**, 21 passed', failing(2, 21)],
    ['a runner that prints failures only: no passed count is claimed', 'Tests: 23 failed, 23 total', failing(23)],
  ])
  // jest, pytest and mocha print a failed count only when there is one, so a lone passed count reads as none failed;
  // `failed` stays unset: the output never printed it
  for (const [text, passed] of [[JEST_GREEN, 21], [PYTEST_GREEN, 21], ['  21 passing (35ms)', 21]] as const) {
    const r = extract('pass_fail', text, false)
    expect(r).toEqual({ value: 0, passed, unit: 'failed' })
    expect(r && 'failed' in r).toBe(false)
  }
  const lone = extract('pass_fail', '3 failed', false)
  expect(lone && 'passed' in lone).toBe(false)
  // no summary: no reading, and a count that is not a count is not read
  reads('pass_fail', [
    ['npm install', NPM, undefined],
    ['tsc', TSC_PLAIN, undefined],
    ['prose', 'All tests passed. No tests failed. 3 passengers, 5 password hints, 2 failures', undefined],
    ['a decimal and a thousands group', '0.5 failed, 1,234 passed', undefined],
    ['a count run into a word', 'a1b2c321 passed', undefined],
    ['empty', '', undefined],
  ])
  // the last summary is the last count and the one just before it, if it is the other count and close by; skipped and
  // todo counts may sit between them. Anything earlier is another summary
  reads('pass_fail', [
    ['cargo, two binaries: the last summary wins', 'test result: FAILED. 5 passed; 2 failed; 0 ignored\ntest result: ok. 3 passed; 0 failed; 0 ignored', failing(0, 3)],
    ['jest with skipped and todo counts between the two', 'Tests:       1 failed, 2 skipped, 3 todo, 21 passed, 27 total', failing(1, 21)],
    ['bun with a skip line between the two', ' 5 pass\n 1 skip\n 2 fail\nRan 8 tests across 1 file.', failing(2, 5)],
    ['mocha with a pending line between the two', '  21 passing (35ms)\n  1 pending\n  2 failing', failing(2, 21)],
    ['a second run that failed, after one that passed', '21 passed in 1.2s\n1 failed, 20 passed in 1.3s', failing(1, 20)],
    ['counts far apart are not one summary: the failed count alone', `21 passed ${'x '.repeat(30)}2 failed`, failing(2)],
    // no reading when a failed count cannot be placed: it may be this summary's, or an older one's, and 0 would be a guess
    ['jest: a failed suite above a passing tests line', 'Test Suites: 1 failed, 3 passed, 4 total\nTests: 21 passed, 21 total', undefined],
    ['a run that failed, then one that passed', '1 failed, 20 passed in 1.3s\n21 passed in 1.2s', undefined],
  ])
  // the call's failure is for `exit`, not here
  expect(extract('pass_fail', BUN_RED, true)).toEqual(extract('pass_fail', BUN_RED, false))
})

// What vitest 3 and bun print when a test run passes every test and an error escapes them.
const VITEST_ERROR = ` ✓ src/a.test.ts (3 tests) 4ms

⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯

Vitest caught 1 unhandled error during the test run.
This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.

⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯
Error: boom
 ❯ src/a.test.ts:5:9

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 Test Files  1 passed (1)
      Tests  3 passed (3)
     Errors  1 error
   Start at  12:00:00
   Duration  412ms (transform 21ms, setup 0ms, collect 18ms, tests 4ms, environment 0ms, prepare 64ms)
`
const BUN_ERROR = `src/a.test.ts:
✓ a [0.10ms]
✓ b [0.05ms]
✓ c [0.04ms]

# Unhandled error between tests
-------------------------------
error: boom
-------------------------------

 3 pass
 0 fail
 1 error
 3 expect() calls
Ran 3 tests across 1 file. [12.00ms]`

// A runner's errors are failures (pytest's "2 errors": a fixture or a module that broke), and jest's suites line counts
// files: a suite that failed to run leaves its tests out of the tests line, so a passing tests line beside a failed suite
// is no reading, never 0 failed, whichever line comes first.
test("pass_fail counts a runner's errors as failed, and a failed jest suite with no failed test is no reading", () => {
  reads('pass_fail', [
    ['pytest, passes and errors', '==================== 3 passed, 2 errors in 1.20s ====================', failing(2, 3)],
    ['pytest, failures, passes and errors', '============ 1 failed, 3 passed, 2 errors in 1.20s ============', failing(3, 3)],
    ['pytest, errors alone', '==================== 2 errors in 0.50s ====================', failing(2)],
    ['pytest, one error after a warning', '=== 5 passed, 1 warning, 1 error in 0.31s ===', failing(1, 5)],
    ['jest, a suite that failed to run above a passing tests line', 'Test Suites: 1 failed, 1 passed, 2 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        1.2 s', undefined],
    ['jest, the same the other way round', 'Tests:  3 passed, 3 total\nTest Suites: 1 failed, 1 passed, 2 total', undefined],
    ['jest, failed suites and failed tests: the tests line', JEST_RED, failing(2, 21)],
    ['jest, green', JEST_GREEN, { value: 0, passed: 21, unit: 'failed' }],
    // an unhandled error: every test passed and the run failed (it exits 1). vitest says so on its Errors line, bun on its own
    ['vitest, an unhandled error beside passing tests', VITEST_ERROR, failing(1, 3)],
    ['bun, an error between tests beside passing tests', BUN_ERROR, failing(1, 3)],
  ])
})

test('n_of_m reads N/M and N of M, with M above 0 and N no more than M', () => {
  reads('n_of_m', [
    ['keras: the last of the epoch and the batch', KERAS, { value: 412, total: 938 }],
    ['tqdm', TQDM, { value: 422, total: 938 }],
    ['N of M', 'Compiled 3 of 10 modules', { value: 3, total: 10 }],
    ['0 of M', 'Retrying 0 of 5', { value: 0, total: 5 }],
    ['a size', 'Downloading 1.2/5.0 MB', { value: 1.2, total: 5 }],
    ['a count beside text', 'tests: 7/9 passed', { value: 7, total: 9 }],
    ['N over M is not a fraction of M', 'ratio 10/5', undefined],
    ['M of 0', 'queue 0/0', undefined],
    ['a later one that is not valid does not stop the valid one before it', '3/4 then 9/5', { value: 3, total: 4 }],
    ['an earlier one that is not valid', '9/5 then 3/4', { value: 3, total: 4 }],
    ['dates are not counts', 'built 2026/10/12, due 12/10/2026, was 10-12', undefined],
    ['paths and versions are not counts', 'src/2/3.ts v1.2/3 a1/2 http://host:80/1/2', undefined],
    ['a minus sign', 'delta -3/10', undefined],
    ['bun and npm print none', `${BUN_GREEN}\n${NPM}`, undefined],
    ['spaces round the slash: not read', 'Step 5 / 10', undefined],
  ])
})

test('percent reads N% from 0 to 100', () => {
  reads('percent', [
    ['curl -# redraws its bar: the last redraw', CURL_BAR, { value: 100, unit: '%' }],
    ['tqdm', TQDM, { value: 45, unit: '%' }],
    ['pytest -v', 'tests/test_a.py::test_x PASSED [ 45%]\ntests/test_a.py::test_y PASSED [100%]', { value: 100, unit: '%' }],
    ['a decimal', 'Statements   : 85.71% ( 12/14 )', { value: 85.71, unit: '%' }],
    ['0%', 'starting 0%', { value: 0, unit: '%' }],
    ['over 100 is not a percentage', 'cpu 340%', undefined],
    ['the last one in range', 'accuracy 98.2%, cpu 340%', { value: 98.2, unit: '%' }],
    ['negative, ASCII and Unicode', 'down -5%, off −7%', undefined],
    ['a space before the sign: not read', 'done 45 %', undefined],
    ['a thousands group', 'sold 1,000%', undefined],
    ['curl\'s default meter has no % sign on its numbers', CURL_METER, undefined],
    ['a format string', 'progress %d%% of %s', undefined],
    ['keras prints none', KERAS, undefined],
  ])
})

test('duration reads h, m, s and ms and gives seconds', () => {
  reads('duration', [
    ['1h 2m 3s', 'took 1h 2m 3s', { value: 3723, unit: 's' }],
    ['2m 3.5s', 'took 2m 3.5s', { value: 123.5, unit: 's' }],
    ['850ms', 'in 850ms', { value: 0.85, unit: 's' }],
    ['12.3s', 'done in 12.3s', { value: 12.3, unit: 's' }],
    ['no spaces, as go and time print it', 'real\t1m2.345s', { value: 62.345, unit: 's' }],
    ['words', 'took 1 hour 5 minutes 2 seconds', { value: 3902, unit: 's' }],
    ['words with commas and "and"', 'up 3 hours, 5 minutes and 2 seconds', { value: 11102, unit: 's' }],
    ['days', 'up 2d 3h', { value: 183600, unit: 's' }],
    ['days in words', 'Up 2 days', { value: 172800, unit: 's' }],
    ['a space before the unit, as jest prints it', JEST_RED, { value: 1.234, unit: 's' }],
    ['bun', BUN_RED, { value: 1.51, unit: 's' }],
    ['pytest', PYTEST_RED, { value: 1.23, unit: 's' }],
    ['cargo', CARGO_RED, { value: 0.04, unit: 's' }],
    ['npm', NPM, { value: 6, unit: 's' }],
    ['keras: the last duration in the log', KERAS, { value: 6, unit: 's' }],
    ['keras: 12s 13ms/step are two durations, not 12.013s', '938/938 [====] - 12s 13ms/step - loss: 0.23', { value: 0.013, unit: 's' }],
    ['the last one', 'build 1m 20s, tests 2m 10s', { value: 130, unit: 's' }],
    ['units out of order are not one duration', 'retry in 10s 20s', undefined],
    ['and no older duration stands in for it', 'build 5s, retry in 10s 20s', undefined],
    ['and not with a comma between them', 'retry in 5 minutes, 10 minutes', undefined],
    // the Oxford comma
    ['the Oxford comma', 'took 1 hour, 5 minutes, and 3 seconds', { value: 3903, unit: 's' }],
    ['the Oxford comma with two parts', 'took 5 minutes, and 3 seconds', { value: 303, unit: 's' }],
    // milliseconds after another part are no reading; before a slash they are a rate of their own
    ['milliseconds after seconds', 'took 2m 3s 450ms', undefined],
    ['milliseconds after hours', 'took 1h 850ms', undefined],
    ['milliseconds after seconds with a comma', 'took 3s, 450ms', undefined],
    ['milliseconds after seconds are no reading, and no older duration stands in', 'warm-up 5s, then took 2m 3s 450ms', undefined],
    ['milliseconds that are a rate: the last duration', 'took 2m 3s 450ms/step', { value: 0.45, unit: 's' }],
    ['milliseconds alone still read', 'took 450ms', { value: 0.45, unit: 's' }],
    ['a clock is not read', 'ETA 00:12:30, [00:05<00:06, 80.1it/s]', undefined],
    ['a negative one', 'drift -5s', undefined],
    ['a thousands group', 'took 1,234ms', undefined],
    ['a version or a name', 'v1.5s foo-5s a2m', undefined],
    ['a hash that starts like a duration', 'commit 3m4f2a1, then 5d3f9c1 and 2s9a', undefined],
    ['tsc and curl print none', `${TSC_PLAIN}\n${CURL_BAR}`, undefined],
  ])
})

test('last_number reads nothing from a failed call, and the extractors that report progress keep reading it', () => {
  // the last number of an error is a line, a code or a count from the error: no reading, never a figure
  expect(extract('last_number', 'error at line 17', true)).toBeUndefined()
  expect(extract('last_number', 'curl: (7) Failed to connect', true)).toBeUndefined()
  expect(extract('last_number', 'p95: 187ms', true)).toBeUndefined() // even a figure the command printed before it failed
  expect(extract('last_number', 'error at line 17', false)).toEqual({ value: 17 })
  expect(extract('last_number', 'p95: 187ms', false)).toEqual({ value: 187, unit: 'ms' })
  // the last progress the command printed before it failed is true as far as it went
  expect(extract('duration', 'failed after 4.1s', true)).toEqual({ value: 4.1, unit: 's' })
  expect(extract('n_of_m', 'copied 12/40 tables, then failed', true)).toEqual({ value: 12, total: 40 })
  expect(extract('percent', 'at 45% the build failed', true)).toEqual({ value: 45, unit: '%' })
  expect(extract('pass_fail', '2 failed, 21 passed', true)).toEqual(failing(2, 21))
})

test('last_number reads the last finite number, with the unit written beside it', () => {
  reads('last_number', [
    ['keras: the last of the line', KERAS, { value: 0.9402 }],
    ['tqdm', TQDM, { value: 0.198 }],
    ['a unit beside it', 'took 12.3s', { value: 12.3, unit: 's' }],
    ['a size', 'wrote 512MB', { value: 512, unit: 'MB' }],
    ['a size after a space', 'wrote 512 MB', { value: 512, unit: 'MB' }],
    ['a percentage', 'cpu 45%', { value: 45, unit: '%' }],
    ['a word that is not a unit', 'loss 0.5 at step', { value: 0.5 }],
    ['a thousands group', 'copied 1,234 files', { value: 1234 }],
    ['an exponent', 'lr 3.2e-05', { value: 3.2e-5 }],
    ['negative', 'reward -12.5', { value: -12.5 }],
    ['negative, with the Unicode minus', 'reward −3', { value: -3 }],
    ['a plus sign', 'delta +4', { value: 4 }],
    ['npm', NPM, { value: 0 }],
    ['curl\'s meter: its speed column', CURL_METER, { value: 5000 }],
    ['tsc: the count of files, which is not the count of errors (exit is what tsc has)', TSC_PLAIN, { value: 2 }],
    // dates, clock times, host:port:line and ratios are not numbers
    ['an ISO date', 'built 2026-10-12', undefined],
    ['a clock time', 'at 12:30:45', undefined],
    ['a clock time with fractions', 'at 12:30:45.123', undefined],
    ['an ISO timestamp', '2026-10-12T12:30:45Z', undefined],
    ['a date with a clock, then a zone: the year is the last number', 'Mon Oct 12 12:30:45 PDT 2026', { value: 2026 }],
    ['file, line and column', 'foo.js:12:5', undefined],
    ['file and line', 'foo.js:12', { value: 12 }],
    ['a ratio', 'ratio 3:1', undefined],
    ['a range', 'range 5-10', undefined],
    ['a label with no space after the colon', 'loss:0.5', { value: 0.5 }],
    ['a negative number after a colon', 'loss:-0.5', { value: -0.5 }],
    ['the time of day does not hide the number before it', 'step 42 at 12:30:45', { value: 42 }],
    // an exponent with the Unicode minus
    ['an exponent with the Unicode minus', 'lr 3.2e−05', { value: 3.2e-5 }],
    ['both signs in the Unicode minus', 'reward −3.2e−05', { value: -3.2e-5 }],
    ['an exponent with a plus', 'n 1e+3', { value: 1000 }],
    // a unit that belongs to a rate is not the number's unit, and an ordinal suffix is no unit
    ['a rate: MB/s', 'speed 5MB/s', { value: 5 }],
    ['a rate: it/s', 'tqdm 75.1it/s', { value: 75.1 }],
    ['a rate after a space', 'speed 5 MB/s', { value: 5 }],
    ['a rate: GB/s', 'speed 3.5GB/s', { value: 3.5 }],
    ['ordinals', 'the 3rd of 1st 2nd 21st', { value: 21 }],
    ['an ordinal th', 'run 4th', { value: 4 }],
    ['a time before a slash', 'took 3s/step', { value: 3 }],
    ['a hex number, a version, a hash, a name', 'node v24.19.0 commit a1b2c3d 5d3f9c1 0x1F gpt-4 H100 1.2.3', undefined],
    ['a European decimal', 'cost 1,5', undefined],
    ['no number', 'all good', undefined],
    ['empty', '', undefined],
  ])
})

test('exit is 1 for a failed call and 0 for one that is not, and reads no text', () => {
  expect(extract('exit', '', true)).toEqual({ value: 1 })
  expect(extract('exit', '', false)).toEqual({ value: 0 })
  expect(extract('exit', BUN_RED, false)).toEqual({ value: 0 }) // a summary that says failed: not what exit reads
  expect(extract('exit', TSC_PRETTY, true)).toEqual({ value: 1 })
  expect(extract('exit', undefined as unknown as string, true)).toEqual({ value: 1 })
})

test('ANSI codes, control characters and Unicode in the output', () => {
  reads('pass_fail', [
    ['colour codes round the counts', `${ESC}[32m 25 pass${ESC}[0m\n${ESC}[31m 2 fail${ESC}[0m\n`, failing(2, 25)],
    ['cursor codes, carriage returns, bells and NULs', `\x00\x07${ESC}[2K${ESC}[1G 25 pass\r\n 0 fail\r\n${ESC}[?25h`, failing(0, 25)],
    ['a non-breaking space', `25${NBSP}pass${NBSP}${NBSP} 2${NBSP}fail`, failing(2, 25)],
    ['a byte order mark', `${BOM} 25 pass\n 0 fail`, failing(0, 25)],
    ['symbols round the counts', '✅ 21 passed ❌ 2 failed 🎉', failing(2, 21)],
    ['text in other scripts', 'テスト結果: 25 pass 0 fail 完了', failing(0, 25)],
    ['full-width digits are not digits here', '２１ passed ２ failed', undefined],
    ['Arabic-Indic digits are not digits here', '٢١ passed ٢ failed', undefined],
  ])
  reads('n_of_m', [['emoji beside the fraction', '🎉3/4🎉', { value: 3, total: 4 }]])
  // the codes go before the number is read, so a code between the digits and the sign is no break
  reads('percent', [['codes round it', `${ESC}[1m45%${ESC}[0m`, { value: 45, unit: '%' }], ['codes inside it', `${ESC}[1m45${ESC}[0m%`, { value: 45, unit: '%' }]])
  reads('duration', [['tsc --pretty and curl print none', TSC_PRETTY + CURL_BAR, undefined]])
  reads('last_number', [['tsc --pretty: the last number of the table, not a colour code', TSC_PRETTY, { value: 1 }]])
  // escapes other than colour codes. A title, a hyperlink, a saved cursor, a character set and a
  // device string leave no digit behind
  const osc = (body: string, end = BEL) => `${ESC}]${body}${end}`
  const ST = `${ESC}\\`
  reads('last_number', [
    ['an OSC window title', `build ok${osc('0;my title')}`, undefined],
    ['an OSC window title ended by ST', `build ok${osc('0;my title', ST)}`, undefined],
    ['an OSC 8 hyperlink and its close', `see ${osc('8;;https://x.test/a', ST)}link${osc('8;;', ST)}`, undefined],
    ['an OSC 8 hyperlink with BEL, round a number', `${osc('8;;https://x.test/a')}42 files${osc('8;;')}`, { value: 42 }],
    ['an OSC title with digits in it', `done${osc('0;3 jobs, 9 errors')}`, undefined],
    ['an OSC cut off before its end: it ends at the line', `${ESC}]0;title\nbuilt 25`, { value: 25 }],
    ['save and restore cursor', `${ESC}7 building${ESC}8`, undefined],
    ['a character set', `${ESC}(0lqqk${ESC}(B`, undefined],
    ['a device control string', `${ESC}P1$r0m${ST}ok`, undefined],
  ])
  reads('pass_fail', [['OSC titles between the counts', `${osc('0;t')} 25 pass ${osc('2;x')}\n 0 fail${osc('0;t')}`, failing(0, 25)]])
  reads('n_of_m', [['an OSC title with a fraction in it', `done${osc('0;build 3/4')}`, undefined]])
  reads('percent', [['an OSC title with a percentage in it', `done${osc('0;45% built')}`, undefined]])
  reads('duration', [['an OSC title with a duration in it', `done${osc('0;took 3s')}`, undefined]])
})

test('NaN, Infinity and numbers too big to be finite are never read', () => {
  const junk = 'NaN% Infinity/Infinity NaN of NaN NaN passed Infinity failed -Infinity NaNs Infinitys loss: NaN'
  for (const kind of KINDS) expect({ kind, got: extract(kind, junk, false) }).toEqual({ kind, got: undefined })
  const huge = '9'.repeat(400)
  reads('pass_fail', [
    ['an infinite count is skipped', `3 passed 1 failed ${huge} failed`, failing(1, 3)],
    ['and alone is no reading', `${huge} passed`, undefined],
  ])
  reads('n_of_m', [['huge over huge', `${huge}/${huge}`, undefined]])
  reads('percent', [['huge percent', `${huge}%`, undefined]])
  reads('duration', [['huge seconds', `${huge}s`, undefined]])
  // the last finite number wins: one that overflows is not a number, and the one before it speaks
  reads('last_number', [
    ['1e999 is not finite', 'loss 0.5 then 1e999', { value: 0.5 }],
    ['a huge integer is not finite', `loss 0.5 then ${huge}`, { value: 0.5 }],
    ['only a huge one', huge, undefined],
  ])
})

test('the last match wins when there are many', () => {
  const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n')
  reads('pass_fail', [['10,000 summaries', lines(10_000, i => `${i} passed, ${i % 3} failed`), failing(10_000 % 3, 10_000)]])
  reads('n_of_m', [['10,000 fractions', lines(10_000, i => `${i}/10000`), { value: 10_000, total: 10_000 }]])
  reads('percent', [['10,000 percentages', lines(10_000, i => `${i % 101}%`), { value: 10_000 % 101, unit: '%' }]])
  reads('duration', [['10,000 durations', lines(10_000, i => `step ${i} took ${i}s`), { value: 10_000, unit: 's' }]])
  reads('last_number', [['a training log', lines(10_000, i => `step ${i} loss ${(1 / i).toFixed(4)}`), { value: 0.0001 }]])
})

test('only the last 4,000 characters, as tidied, are read; a number cut by the edge is not read as a smaller one', () => {
  const filler = (n: number) => 'x '.repeat(n / 2)
  // "25 pass 2 fail " then 2k characters of filler, tidied to 2k + 14: 4,000 is the longest that is read whole
  const summary = '25 pass 2 fail '
  expect(tidy(summary + 'x '.repeat(1993)).length).toBe(4000)
  expect(extract('pass_fail', summary + 'x '.repeat(1993), false)).toEqual(failing(2, 25))
  // two characters over, and the edge cuts "25 pass": the first 80 characters of what is left go, so no half of a summary
  // is read ("2 fail" alone would be failing(2), a count of one half of it)
  expect(extract('pass_fail', summary + 'x '.repeat(1994), false)).toBeUndefined()
  // a summary further back than the window is not read, and nothing older stands in for it
  expect(extract('pass_fail', summary + filler(4_500), false)).toBeUndefined()
  reads('pass_fail', [['node:test with failure details after the summary', `${NODE_RED}\n${filler(4_500)}`, undefined]])
  // "1234 passed" with its head cut off by the window is not "234 passed", whichever of its characters the edge meets
  for (let n = 1990; n <= 2005; n++) {
    const text = '1234 passed ' + 'x '.repeat(n)
    expect({ n, passed: extract('pass_fail', text, false)?.passed }).toEqual({ n, passed: tidy(text).length <= 4000 ? 1234 : undefined })
  }
  // the readers of a single token, which the offset rule below does not guard, lose the word the edge cuts: "1234 files"
  // cut to "234 files" is no reading, whichever character the edge meets
  for (const [kind, token, whole] of [
    ['last_number', '1234 files', { value: 1234 }],
    ['n_of_m', '1234/5678', { value: 1234, total: 5678 }],
    ['percent', '45.5%', { value: 45.5, unit: '%' }],
  ] as const) {
    for (let n = 1990; n <= 2005; n++) {
      const text = token + ' ' + 'x '.repeat(n)
      expect({ kind, n, got: extract(kind, text, false) }).toEqual({ kind, n, got: tidy(text).length <= 4000 ? whole : undefined })
    }
  }
  // nothing is cut when nothing real was: a long output of blanks and codes before the summary leaves it whole
  reads('pass_fail', [
    ['9,000 spaces, then a summary', ' '.repeat(9_000) + ' 25 pass\n 2 fail', failing(2, 25)],
    ['9,000 blank lines', '\n'.repeat(9_000) + ' 25 pass\n 2 fail', failing(2, 25)],
    ['3,000 colour codes, then a summary', `${ESC}[0m`.repeat(3_000) + ' 25 pass\n 2 fail', failing(2, 25)],
    ['a line, then 20,000 characters of cursor codes, then a summary', `Building...${`${ESC}[2K${ESC}[1G`.repeat(2_500)} 25 pass\n 2 fail`, failing(2, 25)],
    ['a line, then 9,000 spaces, then a summary', `Building...${' '.repeat(9_000)} 25 pass\n 2 fail`, failing(2, 25)],
  ])
  // an edge that falls inside a surrogate pair does not throw
  expect(extract('last_number', '😀'.repeat(5_000) + 'a 7', false)).toEqual({ value: 7 })
})

// A duration or a summary near the edge is read whole or not at all, never from its last
// part ("1h 2m 3s" is not 123 or 3; "2 failed, 21 passed" is not 0 failed, 21 passed), whichever of its characters the
// edge meets and wherever in the window it starts. Tidied text of 4,200 - pos characters puts the value `pos` characters
// from the start of the window: negative is cut by the edge, 0 to 79 is near it, and from 80 it is read. Each value has
// a test of its own, to stay inside the time a test gets.
const placed = (value: string, pos: number, coded: boolean) => {
  const tailLen = 3999 - pos - value.length
  const tail = tailLen % 2 ? 'x' + ' x'.repeat((tailLen - 1) / 2) : 'xx' + ' x'.repeat((tailLen - 2) / 2)
  const text = 'x '.repeat(100) + value + ' ' + tail
  return coded ? text.replaceAll(' ', ` ${ESC}[0m`) : text // the same with a colour code at every space: 3 times the raw characters
}
const NEAR_EDGE: [kind: Extractor, value: string, whole: Reading][] = [
  ['duration', 'took 1h 2m 3s', { value: 3723, unit: 's' }],
  ['duration', 'up 3 hours, 5 minutes, and 2 seconds', { value: 11102, unit: 's' }],
  ['duration', 'up 2 days, 3 hours, 5 minutes, and 9 seconds', { value: 183909, unit: 's' }],
  ['pass_fail', 'Tests: 2 failed, 21 passed, 23 total', failing(2, 21)],
  ['pass_fail', 'Tests: 1 failed, 2 skipped, 3 todo, 21 passed, 27 total', failing(1, 21)], // its passed count is 21 characters from the failed one
  ['pass_fail', '13 pass 3 fail', failing(3, 13)],
  ['pass_fail', 'ℹ pass 21 ℹ fail 2', failing(2, 21)],
]
for (const [kind, value, whole] of NEAR_EDGE) {
  test(`${kind} "${value}" at every offset of the window: whole, or not at all`, () => {
    const wrong: string[] = [] // gathered here and compared once: an expect() for each of the 400 would be slower than the reads
    let read = 0, edge = 0
    const at = (pos: number, coded: boolean) => {
      const text = placed(value, pos, coded)
      const got = extract(kind, text, false)
      const label = `${coded ? 'coded ' : ''}at ${pos}`
      const isWhole = JSON.stringify(got) === JSON.stringify(whole)
      if (got !== undefined && !isWhole) wrong.push(`${label}: read ${JSON.stringify(got)}, a part of ${JSON.stringify(whole)}`)
      if (pos >= 130 && !isWhole) wrong.push(`${label}: well inside the window and not read: ${JSON.stringify(got)}`)
      if (pos < 0 && got) wrong.push(`${label}: read, though the edge cut it off`)
      if (isWhole) read++
      if (isWhole && pos >= 80) edge++
    }
    for (let pos = -20; pos <= 135; pos++) at(pos, false) // every offset: the edge itself, the first 80, and after them
    for (const pos of [-30, -1, 0, 1, 40, 70, 79, 80, 81, 100, 130, 140]) at(pos, true) // with raw text three times as long
    // the text is where the sweep says it is
    for (const pos of [-20, 0, 79, 135]) {
      const tidied = tidy(placed(value, pos, false))
      expect({ pos, size: tidied.length, at: tidied.indexOf(value) }).toEqual({ pos, size: 4200 - pos, at: 200 })
      expect(tidy(placed(value, pos, true))).toBe(tidied)
    }
    expect(wrong).toEqual([])
    expect(read).toBeGreaterThan(40) // it did read the value where it could, so the sweep is no vacuous pass
    expect(edge).toBeGreaterThan(40)
  })
}

test('a 2 MB output: read from its tail, quickly, whatever its shape', () => {
  const MB2 = 2_000_000
  const fill = (unit: string) => unit.repeat(Math.ceil(MB2 / unit.length))
  const summary = '\n 25 pass\n 2 fail\n'
  const shapes: [string, string][] = [
    ['dots', '.'.repeat(MB2)],
    ['one long line of coloured ticks', fill(`${ESC}[32m✓${ESC}[0m test `)],
    ['progress redraws with carriage returns and cursor codes', fill(`${ESC}[2K${ESC}[1G⠋ building 42%\r`)],
    ['open brackets, which markdown tidying is quadratic on', '['.repeat(MB2)],
    ['open links', fill('[a](')],
    ['digits', '1'.repeat(MB2)],
    ['digits and slashes', fill('1/')],
    ['spaced numbers', fill('1 ')],
    ['duration-like', fill('1m ')],
    ['commas', fill('1,')],
  ]
  let slowest = 0
  const run = (kind: Extractor, text: string) => {
    const t0 = performance.now()
    const r = extract(kind, text, false)
    slowest = Math.max(slowest, performance.now() - t0)
    return r
  }
  for (const [name, body] of shapes) {
    expect({ name, size: body.length >= MB2 }).toEqual({ name, size: true })
    expect({ name, got: run('pass_fail', body + summary) }).toEqual({ name, got: failing(2, 25) })
    for (const kind of KINDS) run(kind, body) // whatever each returns, none hangs
  }
  // 2 MB with nothing to read: no reading from any extractor, and exit still answers
  const nothing = fill('lorem ipsum dolor ')
  for (const kind of KINDS) expect({ kind, got: run(kind, nothing) }).toEqual({ kind, got: undefined })
  expect(extract('exit', nothing, true)).toEqual({ value: 1 })
  // whose only readings are at the head, outside the window
  const head = '25 pass 0 fail 3/4 45% 3s 7 '
  for (const kind of KINDS) expect({ kind, got: run(kind, head + nothing) }).toEqual({ kind, got: undefined })
  // and the same readings at the tail are read
  expect(run('n_of_m', nothing + ' 3/4')).toEqual({ value: 3, total: 4 })
  expect(run('percent', nothing + ' 45%')).toEqual({ value: 45, unit: '%' })
  expect(run('duration', nothing + ' 3s')).toEqual({ value: 3, unit: 's' })
  expect(run('last_number', nothing + ' 7')).toEqual({ value: 7 })
  expect(slowest).toBeLessThan(500) // ms, for one call: tidying the whole of '[' x 2 MB would take the better part of an hour
})

test('junk in: an unknown kind, no text, text that is not text', () => {
  for (const kind of ['', 'nope', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    expect({ kind, got: extract(kind as Extractor, '25 pass', false) }).toEqual({ kind, got: undefined })
  }
  for (const text of [undefined, null, 25, {}, ['25 pass']]) {
    for (const kind of KINDS) expect({ kind, text, got: extract(kind, text as unknown as string, false) }).toEqual({ kind, text, got: undefined })
  }
})
