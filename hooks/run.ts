import type { HudItem, HudLine, HudRun, HudState, HudTone, HudWidget } from '../types'
import { rebind } from './bind'
import { boundary, isLive, life, PAUSED, settle, stamp, WAITING } from './lifecycle'
import { laid, RECIPE_NAMES, RECIPES, recipeOf, widgetsOf } from './recipes'
import { STATES, TONES, TYPES } from './sources/contract'

export { isLive }

export type WidgetInput = Omit<Partial<HudWidget>, 'bind'> & { id: string; push?: number; bind?: unknown }
export type Input = {
  start?: string; goal?: string; rebuild?: boolean; recipe?: string; title?: string; accent?: string; strip?: string[]; set?: Record<string, string | number>; log?: string; level?: HudLine['level']
  status?: string; progress?: string; progress_label?: string
  phase?: { name: string; state: HudState }; cell?: { name: string; state: HudState }
  point?: number; count?: string; count_by?: number; fun?: string[]; next?: number
  /** Claude's intent, applied by register.tsx's intend() to $.state (they are not part of the run). */
  mode?: string; focus?: string[]
  widget?: WidgetInput; widgets?: WidgetInput[]; remove?: string[]
  done?: string; fail?: string
}

// How a goal change reads in the log; the band's last line skips it, as its header shows the goal already.
export const GOAL = 'Goal: '

export const fresh = (title: string, now: number): HudRun => ({
  title, startedAt: now, status: 'running', tiles: {}, phases: [], cells: [],
  points: [], counts: {}, fun: [], log: [], widgets: [], calls: 0, errors: 0,
})

// What a rebuild clears: the layout. The title, goal, clock, log and counts stay.
export const cleared = (): Partial<HudRun> => ({
  tiles: {}, phases: [], cells: [], points: [], counts: {}, fun: [], widgets: [],
  progress: undefined, progressBy: undefined, strip: undefined, nextAt: undefined, tileClock: {}, named: undefined,
})

export const upsert = (list: HudRun['phases'], name: string, state: HudState) =>
  list.some(x => x.name === name)
    ? list.map(x => (x.name === name ? { name, state } : x))
    : [...list, { name, state }]

export const mergeWidget = (list: HudWidget[], { push, ...w }: Omit<WidgetInput, 'bind'>): HudWidget[] => {
  const old = list.find(x => x.id === w.id)
  const merged = { type: 'stat' as const, ...old, ...w }
  if (push !== undefined) merged.points = [...(merged.points ?? []), push].slice(-200)
  return old ? list.map(x => (x.id === w.id ? merged : x)) : [...list, merged]
}

// Tool input is the model's: a field the schema did not declare yet arrives as a JSON string.
const parse = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return undefined }
}
export const asList = (v: unknown): unknown[] => {
  v = parse(v)
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]
}
export const asObject = (v: unknown): Record<string, unknown> | undefined => {
  v = parse(v)
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}
const isString = (x: unknown): x is string => typeof x === 'string'
// A { name, state } pair; anything else is junk.
const asNamed = (v: unknown): { name: string; state: HudState } | undefined => {
  const o = asObject(v)
  return o && isString(o.name) && o.name && STATES.includes(o.state as HudState) ? { name: cap(o.name), state: o.state as HudState } : undefined
}

// ---- The guard every call goes through (apply()). The model's input is any JSON, whatever the schema says, and what the
// run keeps is drawn on every redraw, where a field of another type throws: so each field is made what it is drawn as, or
// dropped (a number where text goes is written out). Claude's text is kept to TEXT characters: more is never drawn whole,
// and what fit() cuts it cuts from that. A colour goes into the image's attributes, so it is a hex or a tone name; progress
// is n of its total, 0 ≤ n ≤ total. A refusal is a line in the tool's answer.
const TEXT = 2000
const cap = (s: string) => s.slice(0, TEXT)
const text = (v: unknown) => (isString(v) ? cap(v) : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined)
const number = (v: unknown) => { const n = parse(v); return typeof n === 'number' && Number.isFinite(n) ? n : undefined }
const listOf = (v: unknown) => { const a = parse(v); return Array.isArray(a) ? a : undefined }
const oneOf = <T>(list: readonly T[], v: unknown) => (list.includes(v as T) ? (v as T) : undefined)
const colour = (v: unknown) => (isString(v) && (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || TONES.includes(v as HudTone)) ? v : undefined)
const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
const quoted = (v: unknown) => JSON.stringify(String(v).slice(0, 20))
const NO_COLOUR = 'is no colour; send a hex like #d97757, or good, bad, warn, info or accent'
const LEVELS: readonly HudLine['level'][] = ['info', 'ok', 'warn', 'err']

function widgetOf(raw: unknown, said: string[]): WidgetInput | undefined {
  const w = asObject(raw)
  if (!w || !isString(w.id)) return undefined
  let refused: unknown // the first item colour that is no colour, named once for the widget
  const items = listOf(w.items)?.flatMap(x => {
    const it = asObject(x), label = text(it?.label)
    if (!it || label === undefined) return []
    if (it.color !== undefined && colour(it.color) === undefined) refused ??= it.color
    return [defined<HudItem>({ label, value: number(it.value), state: oneOf(STATES, it.state), color: colour(it.color), note: text(it.note) })]
  })
  if (refused !== undefined) said.push(`color on ${w.id.length > 60 ? w.id.slice(0, 59) + '…' : w.id}: ${quoted(refused)} ${NO_COLOUR}`)
  return defined<WidgetInput>({
    id: cap(w.id), type: oneOf(TYPES, w.type), title: text(w.title), span: number(w.span),
    value: typeof w.value === 'number' ? number(w.value) : text(w.value), min: number(w.min), max: number(w.max), unit: text(w.unit),
    delta: number(w.delta), better: oneOf(['up', 'down'] as const, w.better), tone: oneOf(TONES, w.tone), items,
    points: listOf(w.points)?.flatMap(n => number(n) ?? []), push: number(w.push),
    rows: listOf(w.rows)?.flatMap(r => { const row = listOf(r); return row ? [row.flatMap(n => number(n) ?? [])] : [] }),
    text: text(w.text), ...('bind' in w ? { bind: w.bind } : {}),
  })
}

/** The input as the run can keep it: each field its type or gone, text kept to 2,000 characters; `said` takes a line for
 * each colour and progress refused. A start stays a start (`Task` when its title is no text). */
export function clean(i: Input, said: string[] = []): Input {
  const o = i as Record<string, unknown>
  if (o.accent !== undefined && o.accent !== '' && colour(o.accent) === undefined) said.push(`accent: ${quoted(o.accent)} ${NO_COLOUR}`)
  let progress: string | undefined
  if (o.progress !== undefined && o.progress !== '') {
    const [n = NaN, total = NaN] = String(o.progress).split('/').map(Number)
    if (Number.isFinite(n) && Number.isFinite(total) && total > 0 && n >= 0 && n <= total) progress = String(o.progress)
    else said.push(`progress: ${quoted(o.progress)} is not n/total with 0 ≤ n ≤ total`)
  }
  return {
    ...i, start: o.start === undefined ? undefined : text(o.start) ?? 'Task', goal: text(o.goal), title: text(o.title),
    accent: colour(o.accent), log: text(o.log), level: oneOf(LEVELS, o.level), status: text(o.status), progress,
    progress_label: text(o.progress_label), point: number(o.point), count: text(o.count), count_by: number(o.count_by),
    next: number(o.next), done: text(o.done), fail: text(o.fail),
    widget: undefined, widgets: [...asList(o.widget), ...asList(o.widgets)].flatMap(w => widgetOf(w, said) ?? []),
  }
}

// A start while the live run started on its own, since the person's last message (`since`), adopts it: Claude names
// the work this turn began, and its log, counts, clock and widgets stay. A start on a run Claude began, or on one an
// earlier message began, starts fresh, for a new task. A title adopts whatever its age: Claude
// claims the run it is looking at.
const ownsTurn = (prev: HudRun | null, since: number) => isLive(prev) && prev.provisional === true && prev.startedAt >= since
export const adopts = (prev: HudRun | null, i: Input, since = -Infinity) => i.start !== undefined && ownsTurn(prev, since)

// `said` takes the lines for the tool's answer: what a recipe left to bind or why it could not be laid (`recipe: unknown "x"
// (…)`), and each binding that could not stand (`bind on <id>: <why>`). `calls`: the session's main-loop tool calls,
// stamped on each widget sent as `n` (the ranker's recency).
export function apply(prev: HudRun | null, sent: Input, now: number, since = -Infinity, said: string[] = [], calls?: number): HudRun {
  const i = clean(sent, said) // every field its type, or gone
  const adopt = adopts(prev, i, since)
  const r = (i.start !== undefined && !adopt) || prev === null ? fresh(i.start ?? 'Task', now) : { ...prev, widgets: (prev.widgets ?? []).filter(w => typeof w.id === 'string') }
  if (adopt && i.start) r.title = i.start
  const say = (text: string, level: HudLine['level'] = 'info') => {
    r.log = [...r.log, { at: now, text: cap(text), level }].slice(-200)
  }
  r.updatedAt = now
  r.sinceUpdate = 0
  r.nudged = undefined
  // simplification: rebuild is a boolean, but arrives as "true" for a schema not declared yet (asList's case)
  const rebuild = String(i.rebuild) === 'true' && i.start === undefined
  if (rebuild) {
    Object.assign(r, cleared())
    // simplification: rebuilding a finished run means the work goes on
    if (!isLive(r)) Object.assign(r, { status: 'running', summary: undefined, endedAt: undefined })
  }
  // A recipe (hooks/recipes.ts) begins a start's or a rebuild's layout and nothing else's: its strip goes in here, its widgets
  // below, ahead of Claude's own, so what Claude sends in the same call overrides them and what it sends later does too.
  const recipe = i.recipe === undefined ? undefined : recipeOf(i.recipe)
  const begins = i.start !== undefined || rebuild
  if (i.recipe !== undefined && !begins) said.push('recipe: send it with start or rebuild')
  else if (i.recipe !== undefined && !recipe) said.push(`recipe: unknown "${String(i.recipe).slice(0, 20)}" (recipes: ${RECIPE_NAMES.join(', ')})`)
  const laying = begins ? recipe : undefined
  const told = said.length // where the recipe's line goes, written once the call is done (it says what the layout is then)
  const strip = laying && RECIPES[laying].strip
  if (strip) r.strip = [...strip]
  if (i.title) r.title = i.title
  // named by Claude, it is no longer provisional (and no longer dim)
  if (adopt || i.title) r.provisional = undefined
  if (i.goal !== undefined && i.goal !== r.goal) {
    r.goal = i.goal || undefined
    if (i.goal) say(GOAL + i.goal)
  } else if (rebuild) say('Dashboard rebuilt')
  if (i.accent) r.accent = i.accent
  if (i.strip) r.strip = asList(i.strip).filter(isString).map(cap)
  const set = asObject(i.set)
  if (set) {
    // each tile Claude sends is stamped with its clock, as a widget is
    const tiles = Object.entries(set).flatMap(([k, v]) => (isString(v) || (typeof v === 'number' && Number.isFinite(v)) ? [[cap(k), isString(v) ? cap(v) : v] as [string, string | number]] : []))
    r.tiles = { ...r.tiles, ...Object.fromEntries(tiles) }
    r.tileClock = { ...r.tileClock, ...Object.fromEntries(tiles.map(([k]) => [k, stamp(r, now)])) }
  }
  // a hud call is Claude at work: a run waiting for the person or paused runs again (a status Claude sends wins)
  if (r.status === WAITING || r.status === PAUSED) r.status = 'running'
  if (i.status) r.status = i.status
  if (i.progress) {
    const [n = NaN, total = 0] = i.progress.split('/').map(Number)
    if (Number.isFinite(n) && total > 0) Object.assign(r, { progress: { n, total, label: i.progress_label }, progressBy: undefined }) // Claude's, as the mirror's no longer is
  }
  const phase = asNamed(i.phase), cell = asNamed(i.cell)
  if (phase) {
    // simplification: one 'now' at a time, matching the old hud.py
    const phases = phase.state === 'now'
      ? r.phases.map(p => (p.state === 'now' ? { ...p, state: 'done' as const } : p))
      : r.phases
    r.phases = upsert(phases, phase.name, phase.state)
  }
  if (cell) r.cells = upsert(r.cells, cell.name, cell.state)
  if (i.point !== undefined) r.points = [...r.points, i.point].slice(-120)
  if (i.count) r.counts = { ...r.counts, [i.count]: (r.counts[i.count] ?? 0) + (i.count_by ?? 1) }
  if (i.fun) {
    // simplification: a real [] still clears the strip; anything else with no line in it (junk) changes nothing
    const fun = asList(i.fun).filter(isString).map(cap), held = parse(i.fun)
    if (fun.length || (Array.isArray(held) && !held.length)) r.fun = fun.slice(0, 3)
  }
  if (i.next !== undefined) r.nextAt = now + i.next * 1000
  // what Claude sends is fresh again: stamped with its clock, no longer stale, and free to be named again. A binding
  // sent with it is checked (hooks/bind.ts); one that can't stand leaves the widget unbound, and the answer says why.
  for (const w of [...(laying ? widgetsOf(RECIPES[laying]) : []), ...asList(i.widget), ...asList(i.widgets)]) {
    if (typeof w !== 'object' || w === null || typeof (w as WidgetInput).id !== 'string') continue
    const { bind, ...sent } = w as WidgetInput
    const was = r.widgets.find(x => x.id === sent.id)
    r.widgets = mergeWidget(r.widgets, { ...sent, ...stamp(r, now), staleAt: undefined, n: calls }).map(x => {
      if (x.id !== sent.id) return x
      const b = rebind(x, was, 'bind' in w ? { ...sent, bind: asObject(bind) ?? bind } : sent)
      if (b.why) said.push(`bind on ${sent.id.length > 60 ? sent.id.slice(0, 59) + '…' : sent.id}: ${b.why}`)
      return b.w
    })
    // named again only once it is fresh: a bound widget still stale (no reading, no value) was named already
    const kept = r.widgets.find(x => x.id === sent.id)
    if (!kept || life(kept, r) !== 'stale') r.named = r.named?.filter(id => id !== sent.id)
  }
  const gone = asList(i.remove).filter(isString)
  if (gone.length) r.widgets = r.widgets.filter(w => !gone.includes(w.id))
  if (laying) said.splice(told, 0, laid(laying, r.widgets))
  if (phase || rebuild) Object.assign(r, boundary(r, now))
  if (i.log) say(i.log, i.level)
  // Finishing closes the step that was running, so a finished run shows no current phase.
  const finish = (status: 'done' | 'failed', summary: string, level: HudLine['level']) => {
    Object.assign(r, { status, summary, endedAt: now, nextAt: undefined })
    r.phases = r.phases.map(p => (p.state === 'now' ? { ...p, state: status } : p))
    say(summary, level)
  }
  // One outcome per call: fail wins over a done sent with it, so a failed run never shows its step done.
  if (i.fail !== undefined) finish('failed', i.fail, 'err')
  else if (i.done !== undefined) finish('done', i.done, 'ok')
  return settle(r)
}
