import { EXTRACTORS, ON } from './bind'
import { FOCUS_MAX, MODE_LINES, MODE_NAMES } from './modes'
import { RECIPE_NAMES } from './recipes'
import type { Input } from './run'
import { STATES, TONES, TYPES } from './sources/contract'
import { plain } from './svg'

export const named = { type: 'object', properties: { name: { type: 'string' }, state: { enum: STATES } }, required: ['name', 'state'] }
export const ITEM = {
  type: 'object',
  properties: { label: { type: 'string' }, value: { type: 'number' }, state: { enum: STATES }, color: { type: 'string' }, note: { type: 'string' } },
  required: ['label'],
}
// A widget's binding (hooks/bind.ts). Its words are said once, on `widget`: `widgets` takes the same shape without them,
// as the schema reaches the model whole on every request.
const BIND = { type: 'object', properties: { on: { enum: ON }, match: { type: 'string' }, extract: { enum: EXTRACTORS } }, required: ['on', 'extract'] }
export const WIDGET = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Stable id; sending the same id again merges into that widget' },
    type: { enum: TYPES },
    title: { type: 'string' },
    span: { type: 'number', description: 'Width in grid units of 4 (stat/gauge/ring default 1, charts 2)' },
    value: { type: ['number', 'string'] },
    min: { type: 'number' }, max: { type: 'number' }, unit: { type: 'string' },
    delta: { type: 'number', description: 'stat: change shown as ▲/▼ pill' },
    better: { enum: ['up', 'down'], description: 'stat, line: which way is good (latency, loss: down), so the change reads green or red; omit and it reads neutral' },
    tone: { enum: TONES },
    items: { type: 'array', items: ITEM, description: 'bars/columns/donut/list/checklist/table rows (replaces)' },
    points: { type: 'array', items: { type: 'number' }, description: 'line/stat series (replaces)' },
    push: { type: 'number', description: 'Append one point to points' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'heatmap matrix' },
    text: { type: 'string' },
    bind: { ...BIND, description: 'Fills it from your calls. match is plain text: a command name (npm test), a path end, a host end; measure, agents, plan take none' },
  },
  required: ['id'],
}

// Only the first 2,048 characters reach the model in the desktop app (its Claude Code, 2.1.295, measured);
// apply.test.ts holds it there.
export const DESCRIPTION = `Live task HUD: a compact strip above the prompt, and a full dashboard the person opens from it. Use it when the person asks for a HUD, a dashboard, or stats to watch, and start one on your own for any task that will take more than about a minute of tool calls (builds, migrations, multi-file refactors, retry loops, remote jobs). Skip it for quick answers and one-shot edits.
Call with start (title) and goal first, then feed it as work happens; one call may carry several fields. Size it to the task: micro (phases or progress + log), standard (3-5 stats that actually change, progress/phases, log, one chart), full (gauges, charts, checklist, countdowns, fun lines).
Keep it relevant as the work moves. When the goal or the kind of work changes (the person redirects, the plan changes, one stage ends and different work starts), call with rebuild: true, the new goal, and the fields for what you are doing now. In between, remove widgets that stopped mattering. Use start only for a new task. If the HUD goes quiet while you work, a HUD check after a tool result asks for an update.
Widgets (widget: {...} or widgets: [...], upserted by id; remove: [ids]; bind fills one from calls):
- stat: value, unit, delta (▲/▼), points sparkline · gauge: value/min/max semicircle · ring: value/max percent ring · meter: value/max bar
- line: points (or push one at a time) area chart · bars: items horizontal ranking · columns: items vertical bars · donut: items share
- heatmap: rows matrix · list: items leaderboard with notes · checklist: items with state todo/now/done/failed · table: items label → value/note · text: callout
tone: good|bad|warn|info|accent colors a widget; item.color overrides one row.
Keep the strip sparse: 2-4 things that matter now, or leave it out for the default.
Every number must be observed or computed from observed numbers; label estimates "(est.)". Fun lines are 1-3 dry facts from real data. Finish with done or fail. Tool calls and errors during the run are counted automatically.`

// The text Claude writes has a budget: what the band shows on one line at the app's usual width (about 90 columns
// and up; measured in the trial). Claude writes to it, and the tool's answer says when a field ran over and by
// how much, so the next one fits: a cut that only the person sees never gets fixed. The run keeps the text whole
// (the dashboard's header wraps the title and goal, and /hud prints them); what the band cuts, fit() cuts.
export const BUDGET = { start: 60, title: 60, goal: 60, log: 70, done: 70, fail: 70 } as const
export const ONGOING: readonly string[] = ['start', 'title', 'goal']

// `notes` are the lines after it, one per field the HUD could not take whole (register.tsx's intend()): a mode or
// focus id it names back. They name ids and modes only, never a slot's value or note.
export function answer(i: Input, notes: string[] = []): string {
  const over = Object.entries(BUDGET).flatMap(([k, room]) => {
    const v = i[k as keyof typeof BUDGET]
    if (typeof v !== 'string') return []
    // plain() is quadratic on a long run of "[": it reads no more than the run keeps (2,000), and a longer text is told
    // its whole length
    const shown = plain(v.slice(0, 2001)).length
    return shown > room ? [{ k, n: v.length > 2001 ? v.length : shown, room }] : []
  })
  const now = over.filter(o => ONGOING.includes(o.k)), later = over.filter(o => !ONGOING.includes(o.k))
  const first = !over.length ? 'ok' : [
    `ok, but the strip cuts ${over.map(o => `${o.k} at ${o.room} characters (yours is ${o.n})`).join(' and ')}.`,
    now.length ? `Send a shorter ${now.map(o => o.k === 'start' ? 'title' : o.k).join(' and ')} now, most important words first.` : '',
    later.length ? `Keep the next ${later.map(o => o.k === 'log' ? 'log line' : 'summary').join(' and ')} under ${later[0]!.room}.` : '',
  ].filter(Boolean).join(' ')
  return [first, ...notes].join('\n')
}

export const SCHEMA = {
  type: 'object',
  properties: {
    start: { type: 'string', description: `Title; starts a fresh run. Up to ${BUDGET.start} characters` },
    goal: { type: 'string', description: `What the work is aiming at now, shown under the title; change it when the aim changes. One line, up to ${BUDGET.goal} characters` },
    rebuild: { type: 'boolean', description: 'The work changed: clears the layout (stats, widgets, phases, grid, trend, counts, progress, strip, fun, countdown) and builds it from this call; keeps the clock, log and counts' },
    recipe: { enum: RECIPE_NAMES, description: 'The kind of work. With start or rebuild it lays widgets and a strip, then asks you to bind them to your exact command. Your fields in the same call and later calls override it.' },
    title: { type: 'string', description: `Renames the run; keeps everything else. Up to ${BUDGET.title} characters` },
    accent: { type: 'string', description: 'Accent color (hex) for this run' },
    strip: { type: 'array', items: { type: 'string' }, description: 'What the compact strip above the prompt shows, in order (few is better): progress, phases, trend, calls, errors, a set-tile key, or a stat/gauge/ring/meter widget id. Omit for the default: progress ring, two stats, phases or trend.' },
    set: { type: 'object', additionalProperties: { type: ['string', 'number'] }, description: 'Stat tiles, key -> value' },
    log: { type: 'string', description: `One event, up to ${BUDGET.log} characters: the strip shows the latest on one line` },
    level: { enum: ['info', 'ok', 'warn', 'err'] },
    status: { type: 'string', description: 'running | retrying | waiting | ...' },
    progress: { type: 'string', description: '"7/12"' },
    progress_label: { type: 'string' },
    phase: { ...named, description: "Setting one 'now' completes the previous 'now'" },
    cell: { ...named, description: 'Chip grid (regions, hosts, files): now|hit|miss|todo' },
    point: { type: 'number', description: 'Trend line sample' },
    count: { type: 'string', description: 'Histogram bucket to bump' },
    count_by: { type: 'number' },
    fun: { type: 'array', items: { type: 'string' }, description: 'Replaces the fun strip' },
    next: { type: 'number', description: 'Countdown: next attempt in N seconds' },
    mode: { enum: MODE_NAMES, description: `Your read of the work now; the person's /hud mode wins. ${MODE_NAMES.map(m => `${m}: ${MODE_LINES[m]}`).join(' · ')}. Send at a phase boundary only.` },
    focus: { type: 'array', items: { type: 'string' }, description: `Up to ${FOCUS_MAX} slot keys that matter now (hud/tests, claude/<widget id>, <plugin>/<id>). Send at a phase boundary only; [] clears.` },
    widget: WIDGET,
    widgets: { type: 'array', items: { ...WIDGET, properties: { ...WIDGET.properties, bind: BIND } } },
    remove: { type: 'array', items: { type: 'string' }, description: 'Widget ids to drop' },
    done: { type: 'string', description: `Finish with a one-line result, up to ${BUDGET.done} characters` },
    fail: { type: 'string', description: `Finish with what went wrong, up to ${BUDGET.fail} characters` },
  },
}
