import type { HudRun, HudState, HudWidget } from '../types'
import { isMirror, PLAN, PLAN_TOOLS, settle } from './lifecycle'
import { asObject } from './run'
import { plain } from './svg'

// The plan mirror: a finished call of the main loop's task-list tool becomes an
// observer-owned checklist with the id `plan`, and its done ÷ total the run's progress when Claude sent none. Pure: it
// reads a call and its result, never the model's words beyond the items' labels. Built against the tool types
// (.claude-plugin/types/claude-code-tools); no session of this repo has had the tool, so it is unverified in the app.

export type PlanItem = { id: string; label: string; state: HudState }

/** The tools that carry the list (lifecycle.ts, where hooks/bind.ts reads them too). */
export const TOOLS = PLAN_TOOLS

// A `Map`, not an object: a status of "constructor" must not find a function.
const STATE = new Map<unknown, HudState>([['pending', 'todo'], ['in_progress', 'now'], ['completed', 'done']])
const LABEL = 40 // the gate's cap on a label (sources/contract.ts)

// One line of plain words, at most the gate's 40, cut where a reader can tell.
const label = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = plain(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return (s.length > LABEL ? s.slice(0, LABEL - 1).trimEnd() + '…' : s) || undefined
}
const idOf = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined)
// A list the tool sent, or the text of one; anything else is not a list.
const listOf = (v: unknown): unknown[] | undefined => {
  try {
    const l = typeof v === 'string' ? JSON.parse(v) : v
    return Array.isArray(l) ? l : undefined
  } catch { return undefined }
}

/**
 * The items after one finished task-list call, given the items before it. `undefined` when there is nothing to mirror:
 * another tool, a list or a result that isn't there, a refused update, or an item this list never held. `input` is the
 * call's arguments, spread flat on the hook's event; `result` is what the tool returned.
 */
export function mirror(items: PlanItem[], tool: string, input: Record<string, unknown>, result: unknown): PlanItem[] | undefined {
  switch (tool) {
    case 'TodoWrite': {
      const todos = listOf(input.todos)
      // the items have no ids of their own: an item's place in the list is its id
      return todos?.flatMap((t, i) => {
        const o = asObject(t), text = label(o?.content)
        return text ? [{ id: String(i), label: text, state: STATE.get(o?.status) ?? 'todo' }] : []
      })
    }
    case 'TaskCreate': {
      const task = asObject(asObject(result)?.task), id = idOf(task?.id), text = label(input.subject) ?? label(task?.subject)
      return id && text ? [...items.filter(x => x.id !== id), { id, label: text, state: 'todo' }] : undefined
    }
    case 'TaskUpdate': {
      const id = idOf(input.taskId)
      if (!id || !items.some(x => x.id === id) || asObject(result)?.success === false) return undefined
      if (input.status === 'deleted') return items.filter(x => x.id !== id)
      return items.map(x => (x.id === id ? { ...x, label: label(input.subject) ?? x.label, state: STATE.get(input.status) ?? x.state } : x))
    }
    case 'TaskList': {
      const tasks = asObject(result)?.tasks
      return Array.isArray(tasks)
        ? tasks.flatMap(t => {
          const o = asObject(t), id = idOf(o?.id), text = label(o?.subject)
          return id && text ? [{ id, label: text, state: STATE.get(o?.status) ?? 'todo' }] : []
        })
        : undefined
    }
    default: return undefined
  }
}

/**
 * The run with the plan in it: the observer's checklist, stamped with the run's clock, and, while the plan leads (Claude
 * has no progress, phases or checklist of its own), the progress done ÷ total (lifecycle.ts settle()). A widget of
 * Claude's by the id `plan` is Claude's: the run is left as it is. No items takes the plan and its progress away.
 * Whether the plan is drawn is the drawing's to say (leadList()): it leads only where Claude has no lead of its own.
 */
export function intoRun(r: HudRun, items: PlanItem[], now: number, n?: number): HudRun {
  const widgets = r.widgets ?? [], held = widgets.find(w => w.id === PLAN)
  if (held && !isMirror(held)) return r
  const plan: HudWidget = {
    id: PLAN, type: 'checklist', title: 'Plan', items: items.map(({ label, state }) => ({ label, state })),
    by: 'observer', at: now, tick: r.ticks ?? 0, n,
  }
  const next = !items.length ? widgets.filter(w => w !== held) : held ? widgets.map(w => (w === held ? plan : w)) : [...widgets, plan]
  return settle({ ...r, widgets: next })
}
