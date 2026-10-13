import type { HudExtractor } from '../types'
import { tidy } from './text'

// The extractors: a fixed set of readers that each take one number out of the output of
// a call. Pure: text in, a Reading out, nothing registered and nothing sent to `$`. A wrong number is worse than none,
// so a reader that is not sure says nothing (undefined) and the caller counts a miss. Three rules hold for all of them:
// the last 4,000 characters of the tidied output are the window (see windowOf for what the edge costs); the last match
// that is valid and finite wins; and a number that is only part of something else (a version, a date, a hash, 1,234,
// 0.5) is not a number.

export type Extractor = HudExtractor // the six, as a binding names them (types/index.d.ts)
export type Reading = { value: number; total?: number; passed?: number; failed?: number; unit?: string }

const WINDOW = 4000
// simplification: tidy()'s markdown pass is quadratic on a long run of "[" (16,000 of them take 0.2 s, 2 MB the better part
// of an hour), so only twice the window of the text reaches it, after the linear passes below have taken the escapes
// and the blanks out. Only the last 128 KB of the raw output are looked at (CAP; the passes take a millisecond or two there); a bigger output is a cut output.
const RAW = 2 * WINDOW
const CAP = 1 << 17

// Escapes that tidy() leaves digits of: a string introduced by OSC (titles, hyperlinks), DCS, APC, PM or SOS ends at BEL
// or ST, and at the first control character if it has no end; a character set ("ESC ( 0"); a single-character escape
// ("ESC 7" saves the cursor). CSI colour and cursor codes ("ESC [") go with them, here and not in tidy(), so that the
// "[" of a code is not a "[" for its markdown pass, and the blanks collapse before the text is measured.
const ESCAPES = /\x1b[\]P_^X][^\x00-\x1f]*(?:\x07|\x1b\\)?|\x1b[()*+#][0-9A-Za-z]|\x1b[0-9=<>A-OQ-WYZa-z]/g
const CSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const BLANK = /[\s\x00-\x1f\x7f]+/g
// When the output was cut, the edge may fall inside a duration ("1h 2m 3s") or a summary ("2 failed, 21 passed"), and
// the half left would read as a smaller wrong number. What starts in the first FROM characters of the window is not
// read: more than the longest duration (about 40: "2 days, 3 hours, 5 minutes, and 9 seconds"), and more than a
// summary (a count, NEAR, a count). What starts after them has all its left context in the window, so it is whole.
const FROM = 80

/**
 * The window: the last 4,000 characters of the tidied output, and `from`, the offset before which a duration or a
 * count is not to be read. When the output was longer than the window, its first word is dropped (a number cut by the
 * edge must not read as a smaller one, "1234" as "234") and `from` reaches 80 characters from the edge; when nothing
 * real was cut, it is 0. Blanks and escape codes are not text, so 9,000 spaces before a summary cut nothing.
 */
function windowOf(text: unknown): { t: string; from: number } {
  if (typeof text !== 'string') return { t: '', from: 0 }
  const s = text.slice(-CAP).replace(ESCAPES, '').replace(CSI, '').replace(BLANK, ' ').trim()
  const t = tidy(s.slice(-RAW))
  const cut = text.length > CAP || s.length > RAW || t.length > WINDOW
  if (!cut) return { t, from: 0 }
  const w = t.slice(-WINDOW)
  const i = w.indexOf(' ') // tidy() leaves single spaces, so this is the end of the first word
  // `from` counts from the edge, so a long first word that is dropped takes the characters it covers off it
  return i < 0 ? { t: '', from: 0 } : { t: w.slice(i + 1), from: Math.max(0, FROM - (i + 1)) }
}

// "−" below is U+2212, the minus sign some tools print; the other "-" is the hyphen.
/** A number as text: thousands commas out, the Unicode minus made a hyphen. Undefined when it is not finite ("1e999", 400 digits). */
const num = (s: string | undefined) => {
  const n = s ? Number(s.replace(/,/g, '').replace(/−/g, '-')) : NaN
  return Number.isFinite(n) ? n + 0 : undefined // + 0 makes -0 a 0
}

// A number starts where no word, decimal, group or sign runs into it: not "v24.19", "a1b2", "1,234", "gpt-4", "0.5".
const LEAD = String.raw`(?<![\w.,+−-])`
const D = String.raw`\d+(?:\.\d+)?`
const SIGN = String.raw`[-+−]?`

/** The last match `read` accepts; with `strict`, the last match, which is no reading if `read` does not accept it. */
function lastOf(t: string, re: RegExp, read: (m: RegExpExecArray) => Reading | undefined, strict = false) {
  let out: Reading | undefined
  for (const m of t.matchAll(re)) {
    const r = read(m)
    if (r || strict) out = r
  }
  return out
}

// ---- pass_fail: the counts a test runner's summary prints
// bun and `claude plugin test` (" 25 pass"), jest, vitest and pytest ("2 failed, 21 passed"), mocha ("21 passing"),
// cargo ("21 passed; 2 failed"), and node:test, which puts the word first ("ℹ pass 21", "# pass 21" in TAP). A runner's
// errors are failures: pytest's, which end its summary before its time ("3 passed, 2 errors in 1.20s": a fixture or a
// module that broke), bun's, the line after its fail count ("0 fail 1 error"), and vitest's Errors line ("Errors 1
// error"): an error that escaped every passing test, and the run exits 1. Errors anywhere else are not a test run's
// ("Found 3 errors in 2 files.").
const COUNT = new RegExp(String.raw`${LEAD}(\d+) (pass(?:ed|ing)?|fail(?:ed|ing)?|errors?(?= in \d+(?:\.\d+)?s\b))\b|(?<=\d fail )(\d+) (errors?)\b|\bErrors (\d+) (errors?)\b|[ℹ#] (pass|fail) (\d+)\b`, 'g')
// jest's suites line counts files, not tests, and is not read; a suite that failed to run leaves its tests out of the
// tests line, which then has no failed count: no reading, never 0 failed
const SUITES = /Test Suites:.*?\btotal\b/g

// The last summary is the last count and, before it, each count of another kind (passed, failed, errors) not far off.
// Counts are not paired from the start of the window: a summary the window starts inside would put every pair out of step.
const NEAR = 30 // characters between two counts of one summary: ", " and "; " are 2, bun's "1 skip" line 8, jest's "2 skipped, 3 todo, " 19

// The counts before `from` are in the window to be looked back at (the mate, a failed count), but the last count must
// start after it, or the edge may have cut the other half of its summary off.
function passFail(window: string, from: number): Reading | undefined {
  let broken = false // (blanked, not cut out, so every offset stays where `from` says)
  const t = window.replace(SUITES, m => ((broken ||= /\b[1-9]\d* failed/.test(m)), ' '.repeat(m.length)))
  const seen: { n: number; kind: string; at: number; end: number }[] = []
  for (const m of t.matchAll(COUNT)) {
    const n = num(m[1] ?? m[3] ?? m[5] ?? m[8])
    if (n !== undefined) seen.push({ n, kind: (m[2] ?? m[4] ?? m[6] ?? m[7] ?? '').slice(0, 4), at: m.index, end: m.index + m[0].length })
  }
  const last = seen.at(-1)
  if (!last || last.at < from) return undefined
  const summary = [last]
  for (let i = seen.length - 2; i >= 0; i--) {
    const s = seen[i]!
    if (summary[0]!.at - s.end > NEAR || summary.some(x => x.kind === s.kind)) break
    summary.unshift(s)
  }
  const passed = summary.find(s => s.kind === 'pass'), bad = summary.filter(s => s.kind !== 'pass')
  // jest, pytest, vitest and mocha print "failed" only when something failed, so a passed count with no failed count
  // anywhere is 0 failed in `value`. A failed count that cannot be placed in this summary (a failed suite above a
  // passing tests line, an earlier run that failed) leaves it unknown: no reading, never a guess.
  if (!bad.length && (broken || seen.some(s => s.kind !== 'pass'))) return undefined
  const failed = bad.reduce((n, s) => n + s.n, 0)
  return { value: failed, ...(bad.length ? { failed } : {}), ...(passed && { passed: passed.n }), unit: 'failed' }
}

// ---- n_of_m: "412/938", "3 of 10". No spaces round the slash, and not a date, a path or a version.
const FRACTION = new RegExp(String.raw`(?<!/)${LEAD}(${D})(?:/| of )(${D})(?![\d/]|[.,]\d)`, 'g')

// ---- percent: "45%", 0 to 100
const PERCENT = new RegExp(String.raw`${LEAD}(${SIGN}${D})%`, 'g')

// ---- duration: "1h 2m 3s", "2m 3.5s", "1m2.345s", "12.3s", "1.234 s", "850ms", "3 hours, 5 minutes", "2d 3h", in seconds.
// Days, hours, minutes and seconds join when they run in descending order ("3 hours, 5 minutes, and 2 seconds").
// Milliseconds are a duration of their own ("850ms"); one that follows another part ("2m 3s 450ms") is no reading, since
// it may be its tail or another duration, unless a slash follows it ("12s 13ms/step": a rate, so two durations and the
// last is 13 ms, not 12.013 s). Units out of order ("10s 20s") are no reading either, and, being the last duration, they
// leave no older one standing in for them.
// A part may be followed by a digit ("1m2.345s" has no boundary between its m and its 2), but the whole may not
// ("3m4f2a1" is a hash, not 3 minutes).
const HMS = String.raw`${D} ?(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![A-Za-z_])`
const MS = String.raw`${D} ?(?:milliseconds?|ms)(?![A-Za-z_])`
const AND = String.raw`(?:,? ?|,? and )` // "1m 2s", "1m, 2s", "1m and 2s", "1m, and 2s"
const DURATION = new RegExp(String.raw`${LEAD}(?:${MS}|${HMS}(?:${AND}${HMS})*(?:${AND}${MS}(?!/))?)(?!\w)`, 'g')
const PART = new RegExp(String.raw`(${D}) ?([a-z]+)`, 'g')

function seconds(s: string) {
  let total = 0, prev = Infinity
  for (const [, n = '', u = ''] of s.matchAll(PART)) {
    const per = u.startsWith('d') ? 86400 : u.startsWith('h') ? 3600 : u === 'ms' || u.startsWith('mil') ? 0.001 : u.startsWith('m') ? 60 : 1
    if (per >= prev || (per < 1 && prev < Infinity)) return undefined // out of order, or milliseconds after another part
    prev = per
    total += per < 1 ? Number(n) / 1000 : Number(n) * per // the division keeps 850 ms at 0.85
  }
  return Number.isFinite(total) ? total : undefined
}

// ---- last_number: any number, with a thousands group ("1,234"), a decimal or an exponent ("3.2e-05"), and the unit
// written beside it. A unit is letters or "%" attached ("12.3s", "512MB", "45%"), or after a space a time or size
// symbol ("1.234 s", "512 MB"); any other word after a number is not its unit ("0.5 at step"). A unit before a slash
// belongs to a rate ("5MB/s", "75.1it/s"), and "3rd" is an ordinal: neither is the number's unit.
// Not numbers: part of a date or a clock ("2026-10-12", "12:30:45"), a ratio ("3:1"), a range ("5-10"), a position
// ("foo.js:12:5"): a number is not followed by "-" or ":" and a digit, nor preceded by a digit and ":".
// simplification: crude on purpose, it is the last number and nothing more (tsc's "Found 3 errors in 2 files." is 2; the
// year in "Mon Oct 12 12:30:45 PDT 2026" is 2026); a binding wants a reader that fits its output, or `exit`. A failed call
// reads nothing (extract()): the last number of an error is a line, a code or a count from it.
const LAST = new RegExp(
  String.raw`${LEAD}(?<!\d:)(${SIGN}(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+−]?\d+)?)(?!\d|[.,]\d|[-:]\d)(?:([A-Za-z%]+)| (ms|s|sec|min|h|[KMGT]i?B|%))?(?!\w)`,
  'g',
)
const ORDINAL = /^(?:st|nd|rd|th)$/

/**
 * Reads one number out of a call's output. The window is the last 4,000 characters of the tidied `text` (blanks and
 * escape codes are not text). When `text` was longer, the window's first word is dropped, and a duration or the last
 * count of a pass_fail summary that starts in its first 80 characters is not read: whole or nothing. The last finite
 * match that is valid for the extractor wins; undefined when nothing parses. `failed` is the call's failure (refused,
 * errored or non-zero), which is all `exit` reads. `last_number` reads nothing from a failed call: the output of a
 * failed command is mostly its error, and the last number in an error is a line, a code or a count from it, not the
 * figure the widget is for. The others keep reading: `pass_fail` and `exit` are made for failures, and `duration`,
 * `n_of_m` and `percent` report the last progress the command printed before it failed, which is true as far as it went.
 */
export function extract(kind: Extractor, text: string, failed: boolean): Reading | undefined {
  if (kind === 'exit') return { value: failed ? 1 : 0 }
  if (kind === 'last_number' && failed) return undefined
  const { t, from } = windowOf(text)
  switch (kind) {
    case 'pass_fail':
      return passFail(t, from)
    case 'n_of_m':
      return lastOf(t, FRACTION, ([, a, b]) => {
        const n = num(a), m = num(b)
        return n !== undefined && m !== undefined && m > 0 && n <= m ? { value: n, total: m } : undefined
      })
    case 'percent':
      return lastOf(t, PERCENT, ([, a]) => {
        const n = num(a)
        return n !== undefined && n >= 0 && n <= 100 ? { value: n, unit: '%' } : undefined
      })
    case 'duration':
      return lastOf(t, DURATION, m => {
        const n = m.index < from ? undefined : seconds(m[0]) // a chain that starts before `from` may have lost its head
        return n === undefined ? undefined : { value: n, unit: 's' }
      }, true)
    case 'last_number':
      return lastOf(t, LAST, m => {
        const n = num(m[1])
        const unit = m[2] ?? m[3]
        // a unit before a slash is a rate's, and an ordinal suffix is no unit
        const own = unit && t[m.index + m[0].length] !== '/' && !ORDINAL.test(unit) ? unit : undefined
        return n === undefined ? undefined : own ? { value: n, unit: own } : { value: n }
      })
    default:
      return undefined // a kind this module does not know: the caller validates, and a stray one reads nothing
  }
}
