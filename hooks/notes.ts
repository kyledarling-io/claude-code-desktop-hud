import type { HudRun, HudWidget } from '../types'
import { RAN } from './bind'
import { idle, isMirror, life } from './lifecycle'

// A live HUD goes stale when Claude keeps working without updating it: a dozen tool calls with nothing sent. Counted
// again from the last HUD check, so each one is a fresh window. A check Claude leaves unanswered (no hud call before the
// next window closes) doubles the next window, to 48 calls at most; any hud call starts over at 12 (apply() clears
// nudged). Time alone is no drift: a remote job's few long calls are not a quiet HUD.
export const DRIFT_CALLS = 12
export const DRIFT_MAX_CALLS = 48
export function stale(r: HudRun): boolean {
  const twice = 2 ** (r.nudged?.n ?? 0)
  return (r.sinceUpdate ?? 0) - (r.nudged?.calls ?? 0) >= Math.min(DRIFT_CALLS * twice, DRIFT_MAX_CALLS)
}

// Claude's own widgets: every one but the plan the observer mirrors, a bound one too (the observer fills it; it is
// Claude's to keep, rebind or remove).
const claudes = (r: HudRun) => (r.widgets ?? []).filter(w => !isMirror(w))
/**
 * Whether any widget fills itself from calls it has seen (a reading or a miss: `bound.seen`): then the general check
 * never goes, only the pointed one. A binding whose command never ran has proved nothing (it never ages, so it is never
 * named), so until then the run is checked as if nothing were bound.
 */
export const isBound = (r: HudRun) => (r.widgets ?? []).some(w => w.bind && (w.bound?.seen ?? 0) > 0)

// What the dashboard shows, in one line Claude can act on (ids to remove, fields to send).
export function shows(r: HudRun): string {
  const phaseNow = r.phases.find(p => p.state === 'now')?.name
  const phasesDone = r.phases.filter(p => p.state === 'done').length
  const sent = claudes(r)
  const parts = [
    // the observer's progress and widgets (the plan mirror) are not Claude's to send or remove, and cost it no tokens
    r.progress && r.progressBy !== 'observer' && `progress ${r.progress.n}/${r.progress.total}${r.progress.label ? ' ' + r.progress.label : ''}`,
    r.phases.length > 0 && `phases ${phasesDone}/${r.phases.length} done${phaseNow ? `, now "${phaseNow}"` : ''}`,
    Object.keys(r.tiles).length > 0 && `stats ${Object.keys(r.tiles).join(', ')}`,
    r.cells.length > 0 && `grid of ${r.cells.length}`,
    r.points.length > 0 && 'trend',
    Object.keys(r.counts).length > 0 && `counts ${Object.keys(r.counts).join(', ')}`,
    sent.length > 0 && `widgets ${sent.map(w => `${w.id} (${w.type})`).join(', ')}`,
  ].filter((p): p is string => typeof p === 'string')
  const line = parts.length ? parts.join('; ') : 'nothing but the clock'
  return line.length > 400 ? line.slice(0, 399) + '…' : line
}

export const about = (r: HudRun) => `"${r.title}"${r.goal ? ` (goal: ${r.goal})` : ''}`

// Read after a tool result once the HUD has gone quiet and !isBound(): 160 characters at most, naming nothing
// but the count (what it shows is the steer's to say, beside each message).
export const nudge = (r: HudRun) =>
  `HUD check: ${r.sinceUpdate ?? 0} tool calls since your last HUD update. Send what moved or bind it; rebuild: true if the work changed; done or fail if finished.`

// Read after a tool result when widgets of Claude's have gone stale (a bound one too, by its misses): named once each, by
// id and type, with the calls since any of them changed and the shell head run most in those calls, in 160 characters
// at most (ids cut to 40, heads to 30). What ran is said only while `ran` reaches back over every call it counts, and
// left out when the note would run past 160; widgets that don't fit are named on the next check.
const POINTED = 160
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
function busiest(r: HudRun, since: number): { head: string; k: number } | undefined {
  const ran = r.ran ?? []
  if (ran.length >= RAN && ran[0]!.tick - 1 > since) return undefined // a call it counts has gone from the record
  const k = new Map<string, number>()
  for (const x of ran) if (x.tick > since) k.set(x.head, (k.get(x.head) ?? 0) + 1)
  const [head, n] = [...k].sort((a, b) => b[1] - a[1])[0] ?? []
  return head && n ? { head, k: n } : undefined
}
function pointedText(r: HudRun, ws: HudWidget[]): string {
  const one = ws.length === 1, n = Math.min(...ws.map(w => idle(w, r))), busy = busiest(r, (r.ticks ?? 0) - n)
  const said = `HUD check: your ${ws.map(w => `${cut(w.id, 40)} ${w.type}`).join(', ')} ${one ? "hasn't" : "haven't"} changed in ${n} call${n === 1 ? '' : 's'}`
  const end = `. Update, bind or remove ${one ? 'it' : 'them'}.`
  const ran = busy ? ` while you ran ${busy.k} ${cut(busy.head, 30)} command${busy.k === 1 ? '' : 's'}` : ''
  return (said + ran + end).length <= POINTED ? said + ran + end : said + end
}
export function pointedIds(r: HudRun): string[] {
  const due = claudes(r).filter(w => life(w, r) === 'stale' && !(r.named ?? []).includes(w.id))
  const ws: HudWidget[] = []
  for (const w of due) if (!ws.length || pointedText(r, [...ws, w]).length <= POINTED) ws.push(w)
  return ws.map(w => w.id)
}
export function pointed(r: HudRun): string | undefined {
  const ids = pointedIds(r)
  return ids.length ? pointedText(r, claudes(r).filter(w => ids.includes(w.id))) : undefined
}

// Read beside a message that arrives while a run is live: the goal (else the title) and the ids of the slots the strip
// shows, which Claude may name in `focus`. 160 characters (40 tokens) at most: the goal is cut at 60, and an id with no
// room is left out, not cut. Ids only, never a slot's value, note, title or items, so a source's words don't reach
// Claude here (the skill section tells it what to do with a message).
const STEER = 160
export function steer(r: HudRun, keys: readonly string[] = []): string {
  const goal = (r.goal || r.title).replace(/\s+/g, ' ').trim()
  const head = `HUD: "${goal.length > 60 ? goal.slice(0, 59) + '…' : goal}".`
  const named = (ids: string[]) => `${head} Focus ids: ${ids.join(', ')}.`
  const ids: string[] = []
  for (const k of keys) if (named([...ids, k]).length <= STEER) ids.push(k)
  return ids.length ? named(ids) : head
}

// Read once, after the tool result that follows a run starting on its own: 40 tokens or fewer for a 60-character title.
export const autoNote = (title: string) => `HUD: a run "${title}" started on its own. Name it with title and goal when you know them.`

// Read beside a message while no run is live and someone is watching.
// simplification: KICKOFF goes (its prompt.submit branch and its gate test too) once a run that starts on its own covers 95%
// of long turns with Claude's HUD calls taken out (46.2% at 2.0.0); until then it stays, and the skill (hooks/skill.ts)
// says the same once, cached, beside it.
export const KICKOFF = 'If this task will take more than about a minute of tool calls (builds, migrations, multi-file refactors, retry loops, remote jobs), start the HUD first (start: a short title, and goal), keep it current as the work moves, and finish it with done or fail. Do the same when the person asks for a HUD or a dashboard. Skip it for quick answers and one-shot edits.'
