import type { HudHeld, HudLine, HudRun, HudWidget } from '../types'
import { len, take } from './cells'
import { isLive, life, span } from './lifecycle'
import { widgetKey, type Placed } from './rank'
import { GOAL } from './run'
import { fit, fmt, plain, stepNow, type Picked } from './svg'

const BARS = '▁▂▃▄▅▆▇█'
export const spark = (pts: number[]) => {
  const lo = Math.min(...pts), hi = Math.max(...pts)
  return pts.map(p => BARS[hi === lo ? 3 : Math.round(((p - lo) / (hi - lo)) * 7)]).join('')
}
export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
// span() lives with the clocks, as svg.ts reads it too
export { span }
export const COLOR: Record<string, string> = {
  now: 'warning', done: 'success', hit: 'success', ok: 'success',
  failed: 'error', miss: 'error', err: 'error', warn: 'warning',
  running: 'claude', retrying: 'warning', waiting: 'suggestion', 'waiting for you': 'suggestion', paused: 'inactive',
}
export const jobsText = (n: number) => `${n} ${n === 1 ? 'job' : 'jobs'} running`
export const NBSP = '\u00a0' // spaces a desktop row keeps: never collapsed at a box's edge, never a line break
export const BOLD = { bold: true }

const BAR = 16
const bar = (f: number, n: number) => `${'█'.repeat(Math.round(f * n))}${'░'.repeat(n - Math.round(f * n))}`
const fraction = (w: HudWidget) => Math.min(1, Math.max(0, ((Number(w.value) || 0) - (w.min ?? 0)) / ((w.max ?? 100) - (w.min ?? 0) || 1)))
/** A gauge, ring or meter's reading as the desktop headlines it: its value with its unit, and what it is of (`71.5 GB of 80`,
 * `91.2%`), never its share rounded to a percentage that stands in for it. */
const value = (w: HudWidget) => `${fmt(w.value)}${w.unit ? (w.unit === '%' ? '%' : ' ' + w.unit) : ''}`
const reading = (w: HudWidget) => (w.max === undefined || (w.unit === '%' && w.max === 100) ? value(w) : `${value(w)} of ${fmt(w.max)}`)

// Terminal: one or two text lines per widget.
export const widgetText = (w: HudWidget): string => {
  const items = w.items ?? []
  switch (w.type) {
    case 'line': return w.points?.length ? `${fmt(w.points.at(-1))} ${spark(w.points.slice(-40))}` : '…'
    case 'gauge': case 'ring': case 'meter': return `${reading(w)} ${bar(fraction(w), BAR)}`
    case 'heatmap': return `${w.rows?.length ?? 0}×${Math.max(0, ...(w.rows ?? []).map(r => r.length))} matrix`
    case 'text': return w.text ?? ''
    case 'stat': return `${fmt(w.value)}${w.unit ? ' ' + w.unit : ''}${w.delta !== undefined ? ` (${w.delta >= 0 ? '▲' : '▼'}${fmt(Math.abs(w.delta))})` : ''}`
    default: return items.slice(0, 6).map(i => `${i.state === 'done' ? '✓ ' : i.state === 'now' ? '▸ ' : ''}${i.label}${i.value !== undefined ? ' ' + fmt(i.value) : ''}`).join(' · ')
  }
}

// The band's last line. The newest line, except that the newest of Claude's own (no `by`, or 'claude') holds the place
// until HELD observer lines have come after it: a run of edits must not drown what Claude said it meant. Goal changes
// are the header's already, so they are skipped, and neither hold the place nor count.
const HELD = 5
export const lastLine = (log: HudLine[]): HudLine | undefined => {
  const lines = log.filter(l => !l.text.startsWith(GOAL))
  const mine = lines.findLastIndex(l => l.by !== 'observer')
  return mine >= 0 && lines.length - 1 - mine < HELD ? lines[mine] : lines.at(-1)
}

// The header's facts, less what the graphic under it already draws; the step is cut to stepRoom, and left out
// under 60 (in measure()'s units at 13px). Background jobs still at work show while the run is live. `pri`: which a
// narrow terminal band keeps first (fitFacts()): the errors, the step, the progress, the clock, the jobs (what the strip
// draws outranks the clock).
export type Fact = { key: 'clock' | 'jobs' | 'progress' | 'step' | 'errors'; text: string; pri: number }
export const factList = (r: HudRun, now: number, drawn: string[] = [], stepRoom = Infinity, jobs = 0): Fact[] => {
  const step = stepNow(r)
  return [
    { key: 'clock' as const, text: `⏱ ${clock((r.endedAt ?? now) - r.startedAt)}`, pri: 3 },
    ...(jobs && isLive(r) ? [{ key: 'jobs' as const, text: jobsText(jobs), pri: 4 }] : []),
    ...(r.progress && !drawn.includes('progress') ? [{ key: 'progress' as const, text: `${r.progress.n}/${r.progress.total}${r.progress.label ? ' ' + plain(r.progress.label) : ''}`, pri: 2 }] : []),
    ...(step && !drawn.includes(step.key) && stepRoom >= 60 ? [{ key: 'step' as const, text: `▸ ${fit(plain(step.name), stepRoom, 13)}`, pri: 1 }] : []),
    ...(r.errors && !drawn.includes('errors') ? [{ key: 'errors' as const, text: `${r.errors} ${r.errors === 1 ? 'error' : 'errors'}`, pri: 0 }] : []),
  ]
}
const FACT_GAP = '  ·  '
export const factsOf = (r: HudRun, now: number, drawn: string[] = [], stepRoom = Infinity, jobs = 0) =>
  factList(r, now, drawn, stepRoom, jobs).map(f => f.text).join(FACT_GAP)

/** A text's width in terminal columns (a wide character or a pictograph counted as two: cells.ts). */
export { len }

/** The facts a terminal row has room for (`room` columns), as the desktop budgets its step: whole or not at all, never cut
 * ("⏱ 7…" reads as 7 seconds), the ones that matter most kept first and shown in their own order. */
export const fitFacts = (facts: Fact[], room: number, left?: Fact[]): string => {
  const kept = new Set<Fact>()
  let used = 0
  for (const f of [...facts].sort((a, b) => a.pri - b.pri)) {
    const w = len(f.text) + (kept.size ? len(FACT_GAP) : 0)
    if (used + w <= room) (kept.add(f), (used += w))
  }
  left?.push(...facts.filter(f => !kept.has(f))) // what did not fit
  return facts.filter(f => kept.has(f)).map(f => f.text).join(FACT_GAP)
}

// ---- what the terminal draws of the board ----------------------------------------------

// The urgency place's mark takes the slot's tone as it stands now, as the desktop strip's does (c.tone(slot.tone)).
const TONE_COLOR: Record<string, string> = { bad: 'error', warn: 'warning', good: 'success', info: 'suggestion', accent: 'claude' }

/**
 * The urgency place as one line: `⚠` and what it says, in the slot's tone as it stands now (bad red, warn the warning
 * colour, good green, info blue, none or accent the accent), as the desktop's mark is. A held one whose slot is good again
 * is green, never painted as the alarm it was.
 */
export const alarmLine = (u: { slot: HudHeld; says: string }) => ({ text: `⚠ ${plain(u.says)}`, color: TONE_COLOR[u.slot.tone ?? ''] ?? 'claude' })

/** How long ago a widget or tile last changed, as the dashboard's aside says it: as of the run's last main-loop call, never now. Fresh, or with no clock, nothing. */
export const agoOf = (clock: { at?: number; tick?: number } | undefined, r: HudRun) =>
  clock && life(clock, r) !== 'fresh' && clock.at !== undefined && r.tickAt !== undefined ? `${span(r.tickAt - clock.at)} ago` : undefined

/**
 * One board entry as terminal text: its title (signed when another plugin sent it, as the dashboard signs it), its figure,
 * and what the slot says it means; a widget of Claude's that has sat unchanged is `old`, and says how long (`ago`). `w` is
 * the widget the figure is read from.
 */
export type Entry = { title: string; value: string; note?: string; old: boolean; ago?: string; w: HudWidget }
export function entryOf(p: Placed, r: HudRun): Entry {
  const w = (r.widgets ?? []).find(x => widgetKey(x) === p.key)
  if (w) return { title: plain(w.title ?? w.id), value: plain(widgetText(w)), old: life(w, r) !== 'fresh', ago: agoOf(w, r), w }
  const s = p.slot, as = { ...s, type: s.pattern } as HudWidget
  return { title: `${plain(s.title)}${s.from === 'hud' ? '' : ` (from ${s.from})`}`, value: plain(widgetText(as)), ...(s.note ? { note: plain(s.note) } : {}), old: false, w: as }
}

/**
 * A widget's figure for a band line, from the fullest to the barest, each keeping its number whole: the number comes
 * before the spark or the bar, and the spark or bar is what shrinks (a line of points: the last value, then its spark; a
 * gauge, ring or meter: its value, then what it is of, then its bar, as the desktop headlines it; a checklist: done of
 * total, then the step in hand).
 */
export function figuresOf(w: HudWidget, wide = false): string[] {
  const tiers = tiersOf(w)
  // `wide`: the pane's, which opens with the whole of what widgetText() says (a line's forty points, a list's items)
  return wide && !(w.type === 'line' && !w.points?.length) ? [...new Set([widgetText(w), ...tiers])] : tiers
}
function tiersOf(w: HudWidget): string[] {
  switch (w.type) {
    case 'line': {
      const pts = w.points ?? []
      if (!pts.length) return ['no points yet']
      const last = fmt(pts.at(-1))
      return [...new Set([16, 12, 8, 4].map(k => Math.min(k, pts.length)))].map(k => `${last} ${spark(pts.slice(-k))}`).concat(last)
    }
    case 'gauge': case 'ring': case 'meter': {
      const f = fraction(w), full = reading(w)
      return [BAR, 12, 8, 4].map(k => `${full} ${bar(f, k)}`).concat(full === value(w) ? [full] : [full, value(w)])
    }
    case 'checklist': {
      const its = w.items ?? [], done = its.filter(i => i.state === 'done' || i.state === 'hit').length
      const count = `${done} of ${its.length}`, cur = its.find(i => i.state === 'now') ?? its.find(i => i.state !== 'done' && i.state !== 'hit')
      if (!cur) return [count]
      // the step in hand, whole words only: shorter and shorter, down to the count alone
      const words = plain(cur.label).split(/\s+/)
      return words.map((_, k) => `${count}  ▸ ${words.slice(0, words.length - k).join(' ')}`).concat(count)
    }
    case 'stat': {
      const core = `${fmt(w.value)}${w.unit ? ' ' + w.unit : ''}`, full = widgetText(w)
      return full === core ? [core] : [full, core]
    }
    default: return [widgetText(w)]
  }
}

/** Text cut to `room` columns at a word, with "…". Never ends on a digit before it: a cut number reads as a smaller one. */
export const cutText = (s: string, room: number): string => {
  if (len(s) <= room) return s
  let t = take(s, Math.max(0, room - 1))
  if (s[t.length] !== ' ') { // not at a word's end already: back to the last one
    const sp = t.lastIndexOf(' ')
    if (sp >= 3) t = t.slice(0, sp)
  }
  return ellipsis(t)
}
// "…" after text that was cut, but never after a number: "18,2…" reads as 18, so the number goes whole (the word it ends).
const ellipsis = (t: string) => {
  const cut = t.replace(/\S*\d$/, '').replace(/[\s·,;:(\-–—]+$/, '')
  return cut ? `${cut}…` : ''
}

/** A line of raw text (a log line: paths, hashes, URLs) in `cols` columns: first what says least is shortened (a path to its
 * last parts, as the desktop's last line is, by fit()), then it is cut at a clause or a word, and never after a number. */
export const fitText = (s: string, cols: number): string => {
  const t = fit(s, cols * 7.8 + 0.01, 13, { mono: true }) // fit() measures a monospace column as 7.8px at 13px
  return t.endsWith('…') ? ellipsis(t.slice(0, -1)) : t
}

/** One slot line of the band: two columns of indent, `title: figure`, and its why after them. */
export type BandLine = { key: string; title: string; figure: string; why?: string; old: boolean }
const INDENT = 2, WHY_MIN = 12, TITLE_MIN = 6

/**
 * The line in `cols` columns, or none. Never a cut figure: when it is too long the why gives way first (cut, down to two
 * words at least, else dropped), then the figure's own spark or bar shrinks (its number stays), then the title is cut; a figure whose number
 * even then has no room draws nowhere, and the line is dropped whole.
 */
export function fitLine(title: string, figures: string[], why: string | undefined, cols: number, o: { indent?: number; atomic?: boolean; keepTitle?: boolean } = {}): { title: string; figure: string; why?: string } | undefined {
  const indent = o.indent ?? INDENT // `atomic`: the why is whole or gone ("· 3m ago" is no use cut)
  const width = (t: string, f: string, y?: string) => indent + len(t) + 2 + len(f) + (y ? 2 + len(y) : 0)
  const [fullest = ''] = figures
  if (why && width(title, fullest, why) <= cols) return { title, figure: fullest, why }
  const room = cols - width(title, fullest) - 2
  const cutWhy = why && !o.atomic && room >= WHY_MIN ? cutText(why, room) : ''
  if (/\s/.test(cutWhy)) return { title, figure: fullest, why: cutWhy } // one word left ("Changed…") says nothing: dropped
  for (const f of figures) if (width(title, f) <= cols) return { title, figure: f }
  const bare = figures.at(-1) ?? ''
  if (o.keepTitle) return undefined // (the pane gives a figure that will not sit beside its whole title a line of its own)
  const left = cols - indent - 2 - len(bare)
  const t = left >= TITLE_MIN ? cutText(title, left) : ''
  return t ? { title: t, figure: bare } : undefined
}

/**
 * The first line of a pane block (its why is the line under it): `title: figure`, then what the slot says it means or how
 * long a widget has sat, fitted to `cols` as a band line is: the figure whole (number first, its spark or bar shrinking),
 * the tail cut at a word or dropped; the title is never cut. Nothing is left to the terminal to cut. None when even the
 * barest figure has no room beside its whole title: the caller then draws the title on a line and the figure, the fullest
 * that fits, on the next.
 */
export function blockLine(e: Entry, cols: number) {
  const tail = e.note ?? (e.ago ? `· ${e.ago}` : undefined)
  return fitLine(e.title, figuresOf(e.w, true), tail, cols, { indent: 0, atomic: e.note === undefined, keepTitle: true })
}

/**
 * The lines the terminal's band draws under its header: exactly the items the desktop strip chose (`picked`, from
 * svg.ts, in its order), each as it stands now. A slot is the board's entry (its figure, why and tone are the live ones);
 * a tile, the trend and the call count are the run's own. Progress, phases, errors and the urgency place are the header's
 * and the alarm line's. A slot the board no longer holds (hidden, muted) draws nowhere; an item that fits no line is dropped.
 */
export function bandLines(picked: Picked[], board: Placed[], r: HudRun, cols: number): BandLine[] {
  return picked.flatMap(it => {
    const p = it.slot ? board.find(x => x.key === it.slot) : undefined
    if (it.slot && !p) return []
    const e = p ? entryOf(p, r) : it.own && { title: plain(it.own.title), old: life(it.own.clock ?? {}, r) !== 'fresh', w: it.own.w }
    if (!e) return []
    const got = fitLine(e.title, figuresOf(e.w), p?.why, cols)
    return got ? [{ key: it.key, ...got, old: e.old }] : []
  })
}

// What the strip chose of the run's own and the header could not say, as a line of its own (headerOf()).
const OWN: Record<'progress' | 'errors' | 'step', (r: HudRun) => { key: string; title: string; figures: string[] } | undefined> = {
  progress: r => r.progress && { key: 'progress', title: 'Progress', figures: [`${r.progress.n} of ${r.progress.total}${r.progress.label ? ' ' + plain(r.progress.label) : ''}`, `${r.progress.n} of ${r.progress.total}`] },
  errors: r => ({ key: 'errors', title: 'Errors', figures: [`${r.errors} of ${r.calls} calls`, String(r.errors)] }),
  step: r => {
    const at = r.phases.findIndex(p => p.state === 'now')
    if (at < 0) return undefined
    const count = `${at + 1} of ${r.phases.length}`, words = plain(r.phases[at]!.name).split(/\s+/)
    return { key: 'phases', title: 'Phase', figures: words.map((_, k) => `${count}  ▸ ${words.slice(0, words.length - k).join(' ')}`).concat(count) }
  },
}

/** The band's header row: what it says in `cols` columns, every text whole to the column it is given. */
export type Header = { title: string; goal?: string; facts: string; bar: number; own: BandLine[] }

/**
 * The header row, budgeted as the desktop's is: `dot` columns for the mark and status, `buttons` for the two buttons, the
 * title keeping a floor, and then in the order they give way: the progress bar first (what is left once the title and the
 * goal are whole, down to 10 columns, then none: progress is a fact too), the title's goal (cut, then dropped), the title
 * (cut), and last the facts (the errors, the step, the progress, the clock, the jobs, each whole or dropped, never cut). Nothing is left to the terminal to cut, so no number is. What the strip chose
 * (`picked`: progress, errors, phases) and the header has no room for becomes a line of its own, never dropped while the
 * desktop strip shows it. `drawn`: the keys of the lines the band draws, whose step or progress is not also a fact. With
 * the dashboard `open`, the title alone.
 */
export function headerOf(o: { r: HudRun; now: number; jobs: number; cols: number; dot: number; buttons: number; hasBar: boolean; picked: string[]; drawn: string[]; open: boolean }): Header {
  const title = plain(o.r.title), goal = o.r.goal ? plain(o.r.goal) : '', room = o.cols - o.dot - o.buttons
  if (o.open) return { title: cutText(title, room), facts: '', bar: 0, own: [] }
  const floor = Math.min(len(title), Math.max(14, Math.floor(room * 0.4))), left: Fact[] = []
  const facts = fitFacts(factList(o.r, o.now, o.drawn, Infinity, o.jobs), room - floor - 2, left)
  const factW = facts ? len(facts) + 2 : 0, nominal = Math.max(10, Math.min(24, o.cols - 60))
  // the bar is what is left once the title and the goal are whole, 10 columns at least, else none
  const spare = room - factW - len(title) - (goal ? 4 + len(goal) : 0)
  const bar = !o.hasBar ? 0 : spare >= nominal + 2 ? nominal : spare >= 12 ? spare - 2 : 0
  const width = room - factW - (bar ? bar + 2 : 0), shown = len(title) > width ? cutText(title, width) : title
  const rest = width - len(title) - 4 // the goal follows the title as "  → goal"
  const own = ([['progress', 'progress'], ['errors', 'errors'], ['step', 'phases']] as const).flatMap(([fact, key]) => {
    const missing = fact === 'progress' ? !bar && left.some(f => f.key === fact) : left.some(f => f.key === fact)
    const it = o.picked.includes(key) && missing ? OWN[fact](o.r) : undefined
    const line = it && fitLine(it.title, it.figures, undefined, o.cols)
    return it && line ? [{ key: it.key, ...line, old: false }] : []
  })
  const cutGoal = shown === title && goal && rest >= 10 ? cutText(goal, rest) : ''
  return { title: shown, ...(cutGoal ? { goal: cutGoal } : {}), facts, bar, own }
}
