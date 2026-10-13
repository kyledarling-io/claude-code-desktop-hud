import type { HudBind, HudExtractor, HudRun, HudWidget, HudWidgetType } from '../types'
import { extract, type Reading } from './extract'
import { life, PLAN_TOOLS } from './lifecycle'
import { EDIT, heads, host, SHELL, type Call } from './sources/tools'

// Bindings: a widget Claude binds to its own calls is filled by the observer from
// each matching call of the main loop, through the extractors. Pure: the run and a finished call in, the run out.
// A call that matches and parses is a reading (the widget's value, `by: 'observer'`, its clock stamped); one that matches
// and doesn't parse is a miss, and a bound widget's age is its misses in a row (lifecycle.ts). Stale, it is drawn as "no
// reading", never its old number (unread()).

export type Bind = HudBind
export const ON: readonly HudBind['on'][] = ['shell', 'edit', 'fetch', 'measure', 'agents', 'plan']
export const EXTRACTORS: readonly HudExtractor[] = ['pass_fail', 'n_of_m', 'percent', 'duration', 'last_number', 'exit']
const MATCHED: readonly string[] = ['shell', 'edit', 'fetch']
/** The widgets one reading can fill: a value, a point, a line of text. A list, a grid or a checklist holds no one number. */
export const READS: readonly HudWidgetType[] = ['stat', 'gauge', 'ring', 'meter', 'line', 'text']
/** What session.measure is, as a call a binding can match (no tool goes by this name). */
export const MEASURE = 'session.measure'
/**
 * Programs that run for anything: a shell match that is only one of them reads every call of it (a `curl` of any URL, a
 * `tail` of any log), and heads() keeps no flag, path or URL to tell one from another. validBind() refuses them, and the
 * answer says to bind a script of your own. A script is known by its name (`./health-check`, `bash health-check`; a name
 * with a dot is read only when it is run itself, as heads() keeps no word with a dot).
 * simplification: a list, so a reader not on it still matches broadly, and a match with a word beside it (`ssh uptime`) is
 * narrower and stands. Add a reader here when one shows up; a real fix would read the whole command, not its head.
 */
export const READERS: readonly string[] = ['curl', 'wget', 'tail', 'head', 'cat', 'echo', 'printf', 'grep', 'rg', 'jq', 'ssh']

/** A binding as Claude sent it, checked: only `on`, `match` and `extract`, with `match` text where it's needed and absent where it isn't. */
export function validBind(b: unknown): { bind: HudBind } | { why: string } {
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return { why: 'it must be { on, match, extract }' }
  const { on, match, extract: by } = b as Record<string, unknown>
  if (!ON.includes(on as HudBind['on'])) return { why: `on must be one of ${ON.join(', ')}` }
  if (!EXTRACTORS.includes(by as HudExtractor)) return { why: `extract must be one of ${EXTRACTORS.join(', ')}` }
  const named = MATCHED.includes(on as string)
  if (named && (typeof match !== 'string' || !match.trim())) return { why: `match must be text for ${on}` }
  if (!named && match !== undefined) return { why: `${on} takes no match` }
  // a program that runs for anything would read every call of it, and what it prints is anyone's data
  const program = on === 'shell' ? (match as string).trim().toLowerCase() : ''
  if (READERS.includes(program)) return { why: `${program} runs for anything; bind a script of your own, like health-check` }
  // a match the HUD could never see would never read, never age, and keep the general check away for the whole run:
  // a shell run is known by its program and up to two verbs (heads()), a site by its host
  if (on === 'shell' && !heads(match as string).some(h => h.includes(match as string))) return { why: 'match must be a command name, like pytest or npm test' }
  if (on === 'fetch' && /[/:]/.test(match as string)) return { why: 'match must be a host, like example.com' }
  return { bind: { on: on as HudBind['on'], ...(named ? { match: match as string } : {}), extract: by as HudExtractor } }
}

const NONE = { hits: 0, misses: 0, seen: 0 }
// What Claude sends as a reading of its own: a value, points (or one pushed) or text.
const VALUES = ['value', 'points', 'push', 'text']
// What a reading wrote, which goes when nobody stands behind it any more.
const READ = ['value', 'points', 'text', 'unit', 'tone'] as const
/**
 * A widget Claude just sent (`sent`, as it came in), merged with what it held (`was`, before the merge). A `bind` there
 * replaces the binding; with none, the one it has stays. A widget is fresh only with a reading someone stands behind:
 * its misses start over only on a reading, a value of Claude's (`VALUES`) or a changed binding (whose counts start from
 * none: a new command's misses are its own), and the observer's last reading goes when Claude changes the binding or
 * updates the widget without a value of its own (it is drawn "no reading" until the next). The same binding sent again,
 * or a title, keeps the misses: a stale widget stays stale, and named.
 * A binding that can't stand, or a widget that takes no reading, leaves it unbound, and `why` says so.
 */
export function rebind(w: HudWidget, was: HudWidget | undefined, sent: Record<string, unknown>): { w: HudWidget; why?: string } {
  const valued = VALUES.some(k => k in sent)
  if (was?.bind && was.by === 'observer' && !valued) {
    w = { ...w }
    for (const k of READ) if (!(k in sent)) delete w[k]
  }
  const v = 'bind' in sent ? validBind(sent.bind) : w.bind ? { bind: w.bind } : undefined
  if (!v) return { w }
  if ('bind' in v && READS.includes(w.type)) {
    // a changed binding (or a first one) starts over: its counts from none, ageing from zero under it
    const same = w.bind?.on === v.bind.on && w.bind.match === v.bind.match && w.bind.extract === v.bind.extract
    return { w: { ...w, bind: v.bind, bound: !same ? NONE : { ...NONE, ...w.bound, ...(valued ? { misses: 0 } : {}) } } }
  }
  const { bind, bound, ...rest } = w
  return { w: rest, why: 'why' in v ? v.why : `a ${w.type} takes no reading (stat, gauge, ring, meter, line or text do)` }
}

/** Whether a finished call is one the binding reads. Plain text throughout: a substring of a shell step's head, a path's end, a host's end. */
export function matches(b: HudBind, c: Call): boolean {
  const m = b.match ?? ''
  switch (b.on) {
    case 'shell': return SHELL.includes(c.tool) && typeof c.input.command === 'string' && heads(c.input.command).some(h => h.includes(m))
    case 'edit': {
      const path = c.input.file_path ?? c.input.notebook_path
      return EDIT.includes(c.tool) && typeof path === 'string' && path.replaceAll('\\', '/').endsWith(m.replaceAll('\\', '/'))
    }
    case 'fetch': return typeof c.input.url === 'string' && /^https?:/.test(c.input.url) && (host(c.input.url)?.endsWith(m.toLowerCase()) ?? false)
    case 'agents': return c.tool === 'Agent'
    case 'plan': return PLAN_TOOLS.includes(c.tool)
    case 'measure': return c.tool === MEASURE
    default: return false
  }
}

// A reading in words, for a stat's unit and a text widget: "of 938", "failed, 39 passed", "%".
const unitOf = (g: Reading) => (g.total !== undefined ? `of ${g.total}` : g.passed !== undefined ? `failed, ${g.passed} passed` : g.unit)
const outcome = (by: HudExtractor, g: Reading) => (by === 'pass_fail' || by === 'exit' ? { tone: g.value > 0 ? 'bad' as const : 'good' as const } : {})

/** The widget with a reading in it: a line takes a point, a text the reading in words, the rest the value. Claude's change (delta) no longer says how it moved. */
function fill(w: HudWidget, by: HudExtractor, g: Reading): HudWidget {
  const point = (pts: number[] | undefined) => [...(pts ?? []), g.value].slice(-200)
  const u = unitOf(g)
  switch (w.type) {
    case 'line': return { ...w, points: point(w.points), ...outcome(by, g) }
    case 'text': return { ...w, text: `${g.value}${!u ? '' : u === '%' ? u : ' ' + u}`, ...outcome(by, g) }
    case 'stat': return { ...w, value: g.value, unit: u ?? w.unit, delta: undefined, points: w.points && point(w.points), ...outcome(by, g) }
    default: return { ...w, value: g.value, max: g.total ?? w.max, unit: g.total === undefined && g.passed === undefined ? g.unit ?? w.unit : w.unit, delta: undefined, ...outcome(by, g) }
  }
}

/** How many shell runs a run keeps in `ran`. */
export const RAN = 200
/**
 * A finished call of the main loop (not one denied) seen by the run: its shell head kept for the pointed check (`ran`),
 * and each bound widget it matches read. A reading stamps the widget's clock as the observer's and frees it to be named
 * again; a miss counts, and ages it. The run itself when nothing changed.
 */
// `n`: the session's main-loop calls, stamped on a widget a reading fills (the ranker's recency, hooks/rank.ts).
export function observe(r: HudRun, c: Call, now: number, n?: number): HudRun {
  const whole = SHELL.includes(c.tool) && typeof c.input.command === 'string' ? heads(c.input.command).at(-1) : undefined
  const head = whole && whole.length > 30 ? whole.slice(0, 29) + '…' : whole // kept as the pointed check names it
  let named = r.named, touched = false
  const widgets = (r.widgets ?? []).map(w => {
    const v = w.bind && validBind(w.bind)
    if (!v || 'why' in v || !matches(v.bind, c)) return w
    touched = true
    const got = extract(v.bind.extract, c.text ?? '', c.failed), was = { ...NONE, ...w.bound }
    const bound = { hits: was.hits + (got ? 1 : 0), misses: got ? 0 : was.misses + 1, seen: was.seen + 1 }
    if (!got) return { ...w, bound }
    named = named?.filter(id => id !== w.id)
    return { ...fill(w, v.bind.extract, got), bound, at: now, by: 'observer', tick: r.ticks ?? 0, staleAt: undefined, n }
  })
  if (!touched && !head) return r
  return { ...r, widgets, named, ...(head ? { ran: [...(r.ran ?? []), { tick: r.ticks ?? 0, head }].slice(-RAN) } : {}) }
}

/** What a binding on the task list reads: its done of total. */
export const planText = (items: { state: string }[]) => `${items.filter(i => i.state === 'done').length}/${items.length}`
/** What a binding on the measure reads: the context window's fill, when it changed. */
export const measureText = (e: { context: { tokens?: number; window: number; percent?: number }; changed: readonly string[] }) =>
  e.changed.includes('context') && e.context.percent !== undefined
    ? `${e.context.tokens === undefined ? '' : `${e.context.tokens} of ${e.context.window} tokens, `}${e.context.percent}%`
    : undefined

// A bound widget with nothing to show: stale, or with no reading yet (or none since Claude changed it).
const unreadable = (w: HudWidget, r: HudRun) =>
  !!w.bind && (life(w, r) === 'stale' || (w.type === 'line' ? !w.points?.length : w.type === 'text' ? !w.text : w.value === undefined))
/**
 * The run as it is drawn: a bound widget gone stale, or with no reading anyone stands behind, says "no reading", never
 * an old number. It stays in its place, a stat with its title and clock (so a stale one draws dim, with when it last
 * read, and its why counts from that reading) and nothing else of its own.
 */
export function unread<R extends HudRun | null>(r: R): R {
  if (!r || !(r.widgets ?? []).some(w => unreadable(w, r))) return r
  return {
    ...r,
    widgets: r.widgets.map(w => (unreadable(w, r)
      ? { id: w.id, type: 'stat' as const, title: w.title, span: w.span, value: 'no reading', at: w.at, by: w.by, tick: w.tick, staleAt: w.staleAt, bind: w.bind, bound: w.bound, n: w.n }
      : w)),
  } as R
}
