import type { PluginState } from 'claude-code'

import { tidy } from '../text'
import type { Declaration, Pushes, Slot } from './contract'

// A source of the subagents Claude has at work: a checklist of them and a count of those running. Written as another
// plugin would write it: it reads when a subagent starts and when it ends, and answers in slots, nothing of the HUD's own.
// The hooks (register.tsx) say when: a foreground agent starts before its call and ends with its result; a background
// one starts when its call comes back launched and ends with its task notification or its own turn's end.

export const declaration: Declaration = {
  v: 1,
  name: 'Agents',
  access: 'Reads when Claude starts a subagent and when it finishes: its description and whether it failed. Nothing else.',
  slots: [
    { id: 'agents', pattern: 'checklist', title: 'Agents' },
    { id: 'agents-running', pattern: 'stat', title: 'Agents running' },
  ],
}

/** The subagents of this session, oldest first, the 12 newest kept. Kept in $.state (its shape is there). */
export type AgentsState = PluginState['hud']['agents']
export const init: AgentsState = { list: [] }

/**
 * What happened to one. `rekey` is a foreground agent (known by its call's id) that went to the background, and is now
 * known by its own. `drop` takes one off the list: a call that was at work from its start, and whose result says it was
 * no subagent that finishes there (a teammate joining, a launch in the cloud). `lose` is the session starting again
 * with it at work: failed, but `lost`, as session.start can't say whether the process went (a resume) or stayed (a
 * reload, an enable or a respawn); `live`, a sign of its life after, brings a lost one back to work, and its `end` ends
 * it as it says.
 */
export type AgentEvent =
  | { k: 'start'; id: string; name: string }
  | { k: 'end'; id: string; failed: boolean }
  | { k: 'rekey'; id: string; as: string }
  | { k: 'drop'; id: string }
  | { k: 'lose'; id: string }
  | { k: 'live'; id: string }

// simplification: the 12 newest, as the checklist holds 12; a 13th agent running at once pushes the first off the list and the count
const KEEP = 12
// The gate fits a label to 40; this keeps the state small, not the drawing short. A description is cut before it is
// tidied: plain() is quadratic over a long run of '[', and 400 characters are more than 80 can use.
const clean = (v: unknown) => (typeof v === 'string' ? tidy(v.slice(0, 400)).slice(0, 80) : '')
const FALLBACK = 'agent'

// at work, or lost when the session started again (failed for now: a sign of its life may still come)
type Agent = AgentsState['list'][number]
const running = (a: Agent) => a.state === 'now' || a.lost === true
const set = (list: Agent[], id: string, state: Agent['state']) => list.map(a => (a.id === id ? { id: a.id, name: a.name, state } : a))

const next = (list: Agent[], ev: AgentEvent): Agent[] => {
  switch (ev.k) {
    case 'start': return [...list.filter(a => a.id !== ev.id), { id: ev.id, name: clean(ev.name) || FALLBACK, state: 'now' as const }].slice(-KEEP)
    // only one running (or lost) can end: a late failure does not undo a finish
    case 'end': return list.some(a => a.id === ev.id && running(a)) ? set(list, ev.id, ev.failed ? 'failed' : 'done') : list
    case 'rekey': return list.some(a => a.id === ev.id) ? list.map(a => (a.id === ev.id ? { ...a, id: ev.as } : a)) : list
    case 'drop': return list.some(a => a.id === ev.id) ? list.filter(a => a.id !== ev.id) : list
    case 'lose': return list.some(a => a.id === ev.id && a.state === 'now') ? list.map(a => (a.id === ev.id ? { ...a, state: 'failed' as const, lost: true as const } : a)) : list
    case 'live': return list.some(a => a.id === ev.id && a.lost) ? set(list, ev.id, 'now') : list
  }
}

const slots = ({ list }: AgentsState): Pushes => {
  // no agent ever ran: nothing to draw, not a 0
  if (!list.length) return { push: [], clear: ['agents', 'agents-running'] }
  const count = (state: string) => list.filter(a => a.state === state).length
  const running = count('now'), done = count('done'), failed = count('failed')
  const push: Slot[] = [
    { v: 1, id: 'agents', pattern: 'checklist', title: 'Agents', items: list.map(a => ({ label: a.name, state: a.state })) },
    {
      v: 1, id: 'agents-running', pattern: 'stat', title: 'Agents running', value: running,
      note: [done && `${done} done`, failed && `${failed} failed`].filter(Boolean).join(', ') || undefined,
      tone: failed ? 'warn' : running ? 'info' : undefined,
    },
  ]
  return { push, clear: [] }
}

export function observe(s: AgentsState, ev: AgentEvent): { state: AgentsState } & Pushes {
  const list = next(s.list, ev)
  const state = list === s.list ? s : { list }
  return { state, ...slots(state) }
}

/** What the auto-log says of an event: which agent, and what became of it. Nothing for an event that changed nothing,
 * nor for a lost one coming back (its end says what became of it). */
export function said(s: AgentsState, ev: AgentEvent): { name: string; state: 'started' | 'finished' | 'failed' | 'lost' } | undefined {
  if (ev.k === 'start') return { name: clean(ev.name) || FALLBACK, state: 'started' }
  if (ev.k === 'rekey' || ev.k === 'drop' || ev.k === 'live') return undefined
  const was = s.list.find(a => a.id === ev.id && (ev.k === 'lose' ? a.state === 'now' : running(a)))
  return was && { name: was.name, state: ev.k === 'lose' ? 'lost' : ev.failed ? 'failed' : 'finished' }
}

/** A main-loop Agent call as the source reads it: its name, and whether it may run in the foreground (a call that says it
 * runs in the background, or in the cloud, does not). The result says which it was. */
export const call = (input: Record<string, unknown>): { name: string; foreground: boolean } => ({
  name: clean(input.description) || clean(input.subagent_type) || FALLBACK,
  foreground: input.run_in_background !== true && input.isolation !== 'remote',
})

/** Whether an Agent call's result is the record of a subagent that ran to its end there (`status: 'completed'`). A
 * teammate joining (`teammate_spawned`) or a launch in the cloud (`remote_launched`) is not, nor is a result that is no record. */
export const completed = (result: unknown): boolean => (result as { status?: unknown } | null | undefined)?.status === 'completed'

/** The agent an Agent call's result says was started in the background: `status: 'async_launched'` and its `agentId`. */
export function launched(result: unknown): { id: string; name: string | undefined } | undefined {
  const r = result as { status?: unknown; agentId?: unknown; description?: unknown } | null | undefined
  return typeof r === 'object' && r !== null && r.status === 'async_launched' && typeof r.agentId === 'string' && r.agentId
    ? { id: r.agentId, name: clean(r.description) || undefined }
    : undefined
}
