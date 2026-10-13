import type { HudClock, HudLine, HudRun } from '../types'
import { fit, measure, plain } from './text'

// The strip draws on the terminal and the desktop app (VS Code and the phone draw no AbovePrompt), and the
// desktop app detaches a session it stops showing: so a HUD is seen while one of these is attached.
export const DRAWS: readonly string[] = ['terminal', 'desktop']

// simplification: here, not in run.ts (which re-exports it), so run.ts can import boundary() without a cycle
export const isLive = (r: HudRun | null): r is HudRun => r !== null && r.status !== 'done' && r.status !== 'failed'

// A span in words, for "updated … ago": a clock reading there looks like a time of day.
export const span = (ms: number) => {
  const m = Math.max(1, Math.floor(ms / 60_000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// How long a live HUD has gone without an update while Claude kept working: shown once past a minute.
export const quietFor = (r: HudRun, now: number) => {
  const ms = now - (r.updatedAt ?? r.startedAt)
  return isLive(r) && (r.sinceUpdate ?? 0) > 0 && ms >= 60_000 ? ms : undefined
}

// Clocks. Every widget and tile carries when it last changed and the run's ticks then (main-loop tool calls, so a
// quiet session ages nothing and a subagent's calls age nothing). Unchanged for AGING calls it dims; for STALE it is
// named once to Claude; stale across RETIRE_BOUNDARIES boundaries it leaves the board.
// A bound widget (hooks/bind.ts) ages only on the calls it matches: its age is the misses in a row since its last
// reading, so it waits for its own command however long the work goes elsewhere.
export const AGING = 12, STALE = 24, RETIRE_BOUNDARIES = 2
export type Life = 'fresh' | 'aging' | 'stale'
type Clocked = { tick?: number; bind?: unknown; bound?: { misses: number } }
/** The main-loop calls since it last changed. */
export const idle = (w: { tick?: number }, r: HudRun) => (r.ticks ?? 0) - (w.tick ?? r.ticks ?? 0)
export const age = (w: Clocked, r: HudRun) => (w.bind ? w.bound?.misses ?? 0 : idle(w, r))
export function life(w: Clocked, r: HudRun): Life {
  const n = age(w, r)
  return n >= STALE ? 'stale' : n >= AGING ? 'aging' : 'fresh'
}

// The plan the observer mirrors from the task-list tool (hooks/plan.ts) is the widget with this id that the observer
// owns; a widget of Claude's by the same id is Claude's, a bound one too, though the observer fills it.
// PLAN_TOOLS are the tools that carry the list: TaskStop stops a background shell, and TaskGet reads one item.
export const PLAN = 'plan'
export const PLAN_TOOLS: readonly string[] = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList']
export const isMirror = (w: { id: string; by?: string; bind?: unknown }) => w.id === PLAN && w.by === 'observer' && !w.bind

// The checklist that stands in for phases when a run has neither progress nor phases of Claude's: the first with
// items, Claude's before the plan mirrored from the task-list tool (whose progress is not Claude's).
export const leadList = (r: HudRun) => {
  if ((r.progress && r.progressBy !== 'observer') || r.phases.length) return undefined
  const lists = (r.widgets ?? []).filter(w => w.type === 'checklist' && (w.items?.length ?? 0) > 0)
  return lists.find(w => !isMirror(w)) ?? lists[0]
}

// The mirror's progress (done ÷ total, HudRun.progressBy) stands only while the mirror leads: Claude's progress, phases
// or checklist take the lead and the figure goes with the plan (two plans' counts side by side would read as one); it
// returns if Claude's lead goes. Run after anything that changes the widgets, the phases or Claude's progress.
export const settle = (r: HudRun): HudRun => {
  if (r.progress && r.progressBy !== 'observer') return r
  const lead = leadList(r), items = lead && isMirror(lead) ? lead.items ?? [] : []
  if (!items.length) return r.progressBy === 'observer' ? { ...r, progress: undefined, progressBy: undefined } : r
  return { ...r, progress: { n: items.filter(i => i.state === 'done').length, total: items.length, label: 'steps' }, progressBy: 'observer' }
}

// A phase boundary: a phase change, a rebuild, or the main loop's turn ending. What was stale before it is marked
// with the boundaries passed until then; what has been stale across RETIRE_BOUNDARIES of them goes, and the log
// says so in the observer's voice.
export function boundary(r: HudRun, now: number): HudRun {
  const was = r.boundaries ?? 0, boundaries = was + 1, gone: string[] = []
  const mark = <T extends { tick?: number; staleAt?: number }>(x: T, name: string): T | undefined => {
    const staleAt = x.staleAt ?? (life(x, r) === 'stale' ? was : undefined)
    if (staleAt !== undefined && boundaries - staleAt >= RETIRE_BOUNDARIES) {
      gone.push(name)
      return undefined
    }
    return staleAt === x.staleAt ? x : { ...x, staleAt }
  }
  const widgets = (r.widgets ?? []).flatMap(w => mark(w, w.title ?? w.id) ?? [])
  const tiles = { ...r.tiles }, tileClock: Record<string, HudClock> = {}
  for (const [k, c] of Object.entries(r.tileClock ?? {})) {
    const kept = mark(c, k)
    if (kept) tileClock[k] = kept
    else delete tiles[k]
  }
  const said: HudLine[] = gone.map(name => ({ at: now, text: `Retired ${name}`, level: 'info', by: 'observer' }))
  return settle({ ...r, boundaries, widgets, tiles, tileClock, log: [...r.log, ...said].slice(-200) })
}

// The clock an update stamps on what Claude sent.
export const stamp = (r: HudRun, now: number): HudClock => ({ at: now, by: 'claude', tick: r.ticks ?? 0 })

// Auto-run: with no live run, a main-loop turn (whatever began it) that reaches AUTO_CALLS calls, or runs
// AUTO_MS, starts a run of its own while someone watches. A live run with no turn for PAUSE_MS reads paused.
export const AUTO_CALLS = 8, AUTO_MS = 60_000, PAUSE_MS = 30 * 60_000
export const WAITING = 'waiting for you', PAUSED = 'paused'

export const shouldStart = (live: boolean, watching: boolean, turn: { startedAt: number; calls: number } | undefined, now: number): boolean =>
  !live && watching && turn !== undefined && (turn.calls >= AUTO_CALLS || now - turn.startedAt >= AUTO_MS)

// A run that starts on its own is titled from the prompt's first line, plain, fitted to the title's room (60
// characters at 13px); 'Task' when there is none.
// simplification: the room is that line's own first 60 characters, so a line of 60 stays whole and a longer one is cut at a word.
// The first line is taken before plain(), and 2,000 characters of it: plain() is quadratic on a long run of "[".
export function titleOf(prompt: string | undefined): string {
  const first = (prompt ?? '').split('\n').map(l => l.trim()).find(Boolean)
  const line = first && plain(first.slice(0, 2000)).trim()
  return (line && fit(line, measure(line.slice(0, 60), 13), 13)) || 'Task'
}

// A background task's notification, as the prompt that carries it (proved on desktop): which job, and how it ended
// (completed, failed, killed).
export function notification(text: string): { id: string; status: string } | undefined {
  const block = /<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/.exec(text)?.[1] ?? ''
  const id = /<task-id>\s*([^<]*?)\s*<\/task-id>/.exec(block)?.[1], status = /<status>\s*([^<]*?)\s*<\/status>/.exec(block)?.[1]
  return id && status ? { id, status } : undefined
}

// The main loop's background jobs still running: shells, and subagents started in the background (both are in `jobs`).
export const jobsRunning = (s: { jobs?: Record<string, 'shell' | 'agent'> }) => Object.keys(s.jobs ?? {}).length

// The 1-second clock's question: a live run, no turn for PAUSE_MS (from the last sign of one, else the run's own last
// update, as a run from before auto-run has no lastTurnAt), and no job still at work.
export const pauses = (r: HudRun | null, lastTurnAt: number | undefined, jobs: number, now: number): boolean =>
  isLive(r) && r.status !== PAUSED && jobs === 0 && now - (lastTurnAt ?? r.updatedAt ?? r.startedAt) >= PAUSE_MS
