import type { PluginState } from 'claude-code'

import type { Declaration, Pushes } from './contract'
import { heads, type Call } from './tools'

// A source of test results: pass and fail counts from the summary a test run prints. The exit status can't be
// trusted for this: `claude plugin test . | tail` exits 0 with 3 tests failing, so the
// counts come from the output, and a run counts as a test run by its command or by a summary in its output.

export const declaration: Declaration = {
  v: 1,
  name: 'Test results',
  access: 'Reads the output of shell commands that run tests, for their pass and fail counts. Keeps the counts only.',
  slots: [{ id: 'tests', pattern: 'stat', title: 'Tests' }],
}

export type TestsState = PluginState['hud']['testResults']
export const init: TestsState = { failed: [] }

const RUNNER = /\b(tests?|pytest|vitest|jest|mocha|rspec|phpunit|ctest|tox|nox)\b/
// A runner's own summary lines, whole (hooks/extract.ts's pass_fail reads them in its own code). A count anywhere
// else, in a log line, a test's literals or the HUD's own note printed back, is not a test run.
const ONE: [RegExp, 'passed' | 'failed' | 'errors'][] = [
  [/^\s*(\d+) pass$/, 'passed'], [/^\s*(\d+) fail$/, 'failed'], [/^\s*(\d+) errors?$/, 'errors'], // bun and `claude plugin test`
  [/^\s*Errors\s+(\d+) errors?\b/, 'errors'], // vitest: an error that escaped every passing test (the run exits 1)
  [/^[ℹ#] pass (\d+)$/, 'passed'], [/^[ℹ#] fail (\d+)$/, 'failed'], // node --test (spec and TAP)
  [/^\s*(\d+) passing\b/, 'passed'], [/^\s*(\d+) failing\b/, 'failed'], // mocha
]
const BOTH = [
  /^\s*Tests:?\s+(.*)$/, // jest ("Tests:  2 failed, 21 passed, 23 total"), vitest ("Tests  1 failed | 21 passed (22)")
  /^=*\s*(\d+ (?:passed|failed|errors?)\b.*) in [\d.]+s(?: \([\d:]+\))?\s*=*$/, // pytest, with or without -q
  /^test result: (.*)$/, // cargo
]
// jest's suites line and vitest's files line count files, not tests: a file that failed to run leaves its tests out of the
// tests line, so a tests line with no failed count beside one is no count, never 0 failed
const FILES = /^\s*Test (?:Suites:|Files)\s+.*?\b([1-9]\d*) failed/

/** The last pass and fail counts a run printed, read only from its runner's summary lines. A runner's errors (pytest's "2
 * errors": a fixture or a module that broke; bun's and vitest's error line: one that escaped the tests) are failures. */
export function counts(text: string): { passed?: number; failed?: number } {
  const found: { passed?: number; failed?: number; errors?: number } = {}
  let broken = false
  for (const line of text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    for (const [re, key] of ONE) { const m = re.exec(line); if (m) found[key] = Number(m[1]) }
    if (FILES.test(line)) broken = true
    for (const re of BOTH) {
      const summary = re.exec(line)?.[1]
      if (summary === undefined) continue
      const passed = /(\d+) passed/.exec(summary)?.[1], failed = /(\d+) failed/.exec(summary)?.[1], errors = /(\d+) errors?\b/.exec(summary)?.[1]
      if (passed !== undefined) found.passed = Number(passed)
      if (failed !== undefined || errors !== undefined) found.failed = Number(failed ?? 0) + Number(errors ?? 0)
    }
  }
  const { errors, ...read } = found
  if (errors !== undefined) read.failed = (read.failed ?? 0) + errors
  return broken && !read.failed ? {} : read
}

export function observe(s: TestsState, c: Call): { state: TestsState } & Pushes {
  const none = { state: s, push: [], clear: [] }
  if (!['Bash', 'PowerShell'].includes(c.tool) || typeof c.input.command !== 'string') return none
  const { passed, failed } = counts(c.text ?? '')
  const named = heads(c.input.command).find(h => RUNNER.test(h))
  // both counts make a summary; one will do from a test command. "3 failed" alone in a log is not a test run
  const summary = passed !== undefined && failed !== undefined
  if (!summary && !(named && (passed ?? failed) !== undefined)) return none
  // simplification: a pass count alone reads as none failed (jest, pytest and mocha print no fail count then), so the figure
  // is 0; a bun run whose fail line a pipe cut reads 0 too. The note names only what was printed
  const fails = failed ?? 0
  const prev = s.failed.at(-1)
  const state = { failed: [...s.failed, fails].slice(-20) }
  return {
    state, clear: [],
    push: [{
      v: 1, id: 'tests', pattern: 'stat', title: 'Tests',
      value: fails, unit: 'failed', better: 'down', tone: fails ? 'bad' : 'good',
      delta: prev === undefined || prev === fails ? undefined : fails - prev, // no change, nothing to show
      points: state.failed.length > 1 ? state.failed : undefined,
      // only the counts the run printed: one it didn't print is never shown as 0
      note: `${named ?? 'a test run'}: ${[passed !== undefined && `${passed} passed`, failed !== undefined && `${failed} failed`].filter(Boolean).join(', ')}`,
    }],
  }
}
