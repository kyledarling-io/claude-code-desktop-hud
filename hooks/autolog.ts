import type { HudLine } from '../types'
import { basename, EDIT, heads, host, SHELL, type Call } from './sources/tools'
import { fit } from './svg'

// The auto-log: while a run is live, what a finished main-loop call did becomes a log line
// tagged `by: 'observer'`. Pure: it reads a call and the test counts around it, never the call's output beyond those
// counts. What reaches the log is a name (a command's head, a file, a site), cut by fit(): raw shell output, with its
// colour codes, paths and quotes, is never a line.

export type Said =
  | { kind: 'edit'; file: string }
  | { kind: 'failed' | 'denied'; command: string }
  | { kind: 'tests'; failed: number; passed?: number; was?: number }
  | { kind: 'fetch'; site: string }
  | { kind: 'compact' }
  | { kind: 'agent'; name: string; state: 'started' | 'finished' | 'failed' | 'lost' }

const CAP = 200
// A name's room in a log line, px at the 13px the band is drawn in: about 30 characters.
const ROOM = 220
const name = (s: string) => fit(s, ROOM, 13)

/**
 * What one finished main-loop call says. `testsBefore` is the tests source's last failed count and `testsAfter` the
 * counts of the summary it just took (undefined when it took none), so a summary says something only when the count
 * moved, or is the first.
 */
export function said(c: Call, testsBefore: number | undefined, testsAfter: { passed?: number; failed?: number } | undefined): Said[] {
  const out: Said[] = []
  // simplification: a summary with neither count says nothing, as 0 failed would be a number nobody read
  const failed = testsAfter && (testsAfter.failed ?? testsAfter.passed) !== undefined ? (testsAfter.failed ?? 0) : undefined
  const tests = failed !== undefined && failed !== testsBefore ? { kind: 'tests' as const, failed, passed: testsAfter?.passed, was: testsBefore } : undefined
  // a shell run is known by its last step: its exit status is the one the call reports. When the run also gives a
  // tests line, that line carries the meaning and "failed" is left out
  const command = SHELL.includes(c.tool) && typeof c.input.command === 'string' ? heads(c.input.command).at(-1) : undefined
  if (command && c.failed && !tests) out.push({ kind: c.denied ? 'denied' : 'failed', command: name(command) }) // a refused one never ran

  const path = c.input.file_path ?? c.input.notebook_path
  const file = EDIT.includes(c.tool) && typeof path === 'string' && !c.failed ? name(basename(path)) : ''
  if (file) out.push({ kind: 'edit', file })

  if (tests) out.push(tests)

  // a search names its query in curly quotes, a fetch its host
  const query = c.tool === 'WebSearch' && typeof c.input.query === 'string' ? name(c.input.query) : ''
  const site = query ? `“${query}”`
    : typeof c.input.url === 'string' && /^https?:/.test(c.input.url) ? name(host(c.input.url) ?? '') : ''
  if (site && !c.failed) out.push({ kind: 'fetch', site })
  return out
}

/** What a subagent's start, finish or failure says: the Agents source (sources/agents.ts) decides which; the name is cut here. */
export const agentSaid = (a: { name: string; state: 'started' | 'finished' | 'failed' | 'lost' }): Said => ({ kind: 'agent', name: name(a.name), state: a.state })

const words = (s: Said): string => {
  switch (s.kind) {
    case 'edit': return `edited ${s.file}`
    case 'failed': return `${s.command} failed`
    case 'denied': return `${s.command} denied`
    case 'tests': return s.was === undefined ? `tests: ${s.failed} failed` : `tests: ${s.was} failed → ${s.failed}`
    case 'fetch': return s.site.startsWith('“') ? `searched ${s.site}` : `fetched ${s.site}`
    case 'compact': return 'context compacted'
    case 'agent': return `agent ${s.state === 'lost' ? 'lost at reload' : s.state}: ${s.name}`
  }
}
// Marks as well as colour: a failed run is a cross, a failing summary a warning, a clean one or a finished agent a tick.
const level = (s: Said): HudLine['level'] => {
  switch (s.kind) {
    case 'failed': return 'err'
    case 'tests': return s.failed ? 'warn' : 'ok'
    case 'agent': return s.state === 'failed' ? 'err' : s.state === 'finished' ? 'ok' : s.state === 'lost' ? 'warn' : 'info'
    default: return 'info'
  }
}

// simplification: the newest line's own text is the collapse's memory ("edited svg.ts ×3"), so nothing else is kept
const EDITED = /^edited (.+?)(?: ×(\d+))?$/

/** The log with one more line from the observer. An edit to the file the newest line (the observer's) is about makes that line ×N. */
export function write(log: HudLine[], s: Said, now: number): HudLine[] {
  const last = log.at(-1)
  if (s.kind === 'edit' && last?.by === 'observer') {
    const [, file, n] = EDITED.exec(last.text) ?? []
    if (file === s.file) return [...log.slice(0, -1), { ...last, at: now, text: `edited ${file} ×${Number(n ?? 1) + 1}` }]
  }
  return [...log, { at: now, text: words(s), level: level(s), by: 'observer' as const }].slice(-CAP)
}
