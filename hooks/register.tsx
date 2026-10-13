import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Hud, HudRun } from '../types'
import { agentSaid, said, write, type Said } from './autolog'
import { MEASURE, measureText, observe as seeBound, planText, unread } from './bind'
import { inOrder, isMuted, slug, sourcesOf, typed, whose } from './board'
import { boundary, DRAWS, jobsRunning, life, notification, PAUSED, pauses, quietFor, shouldStart, titleOf, WAITING } from './lifecycle'
import { FOCUS_MAX, focusOf, MODE_NAMES, modeCommand, modeLine, modeOf, MODES } from './modes'
import { autoNote, isBound, KICKOFF, nudge, pointed, pointedIds, stale, steer } from './notes'
import { intoRun, mirror, TOOLS as PLAN_TOOLS, type PlanItem } from './plan'
import { keyList, keysOf, NO_PREFS, prefsCommand, prefsLines, prefsOf } from './prefs'
import { claudeSlots, nextArrangement, rank, unhidden, urgentFirst, type Placed } from './rank'
import { agoOf, alarmLine, BOLD, bandLines, blockLine, clock, COLOR, cutText, entryOf, factsOf, figuresOf, fitText, headerOf, jobsText, lastLine, len, NBSP, span, spark } from './render'
import { adopts, apply, asList, fresh, isLive, type Input } from './run'
import { SKILL } from './skill'
import * as agents from './sources/agents'
import { accept, acceptDeclaration, type Declaration, type Pushes } from './sources/contract'
import * as meter from './sources/meter'
import * as testRuns from './sources/tests'
import * as toolSignals from './sources/tools'
import type { Call } from './sources/tools'
import { dashboard, describe, fit, fmt, measure, plain, sentence, strip, stripFocus, stripPicked, stripSlots, wrapPx } from './svg'
import { answer, DESCRIPTION, SCHEMA } from './tool'
import { urgentFor, urgentNow, type Urgent } from './urgency'

const PANE = 'hud'
const TOOL = 'mcp__hud__hud'
const run = atom({ plugin: 'hud', key: 'run' } as const, null)
const paneOpen = atom({ plugin: 'hud', key: 'paneOpen' } as const, false)
const stripHidden = atom({ plugin: 'hud', key: 'stripHidden' } as const, false)
// The sources' slots and declarations live in the session's state, not module memory: a reload resets the module.
const slots = atom({ plugin: 'hud', key: 'slots' } as const, {})
const sources = atom({ plugin: 'hud', key: 'sources' } as const, {})
// The main loop's tool calls this session, live run or not (a hud call isn't one): a slot's and a widget's `n` (when it
// changed) count in these.
const calls = atom({ plugin: 'hud', key: 'calls' } as const, 0)
const callsNow = async ($: EngineInterface) => (await read($, calls)) ?? 0

// $.hud's door. `from` is the host's word for the sender (`next.origin.plugin`); what it sends is
// data that passed the gate, never proof: another plugin may have changed it on the way. The HUD's own sources
// call these directly.
type Answer<M extends keyof Hud> = Awaited<ReturnType<Hud[M]>>
export async function declare($: EngineInterface, from: string, raw: unknown): Promise<Answer<'declare'>> {
  const d = acceptDeclaration(raw)
  if (typeof d === 'string') return { ok: false, why: d }
  await update($, sources, all => ({ ...all, [from]: d }))
  // a slot no longer declared, or declared another pattern, goes with the old declaration
  await update($, slots, all => Object.fromEntries(Object.entries(all).filter(([, s]) => s.from !== from || d.slots.some(x => x.id === s.id && x.pattern === s.pattern))))
  return { ok: true, v: 1 }
}

const hold = async ($: EngineInterface, from: string, decl: Declaration | undefined, raw: unknown): Promise<Answer<'push'>> => {
  const h = accept(raw, from, decl, await $.clock.now())
  if (typeof h === 'string') return { ok: false, why: h }
  const n = await callsNow($)
  await update($, slots, all => ({ ...all, [`${from}/${h.id}`]: { ...h, n } }))
  return { ok: true }
}

export async function push($: EngineInterface, from: string, raw: unknown): Promise<Answer<'push'>> {
  return hold($, from, (await read($, sources))[from], raw)
}

export async function clear($: EngineInterface, from: string, raw: unknown): Promise<Answer<'clear'>> {
  const gone = `${from}/${String((raw as { id?: unknown } | null)?.id)}`
  await update($, slots, all => Object.fromEntries(Object.entries(all).filter(([k]) => k !== gone)))
  return { ok: true }
}

// The noun's own answers, reached only when the HUD's hook on the call failed: the gate runs in those hooks, where
// the host names the sender.
const UNHEARD = 'the HUD could not take it'
const HUD: Hud = {
  declare: async () => ({ ok: false, why: UNHEARD }),
  push: async () => ({ ok: false, why: UNHEARD }),
  clear: async () => ({ ok: false, why: UNHEARD }),
}

// The HUD's own sources (hooks/sources/), written as if they were other plugins. Their slots
// pass the same gate, under the HUD's own name, against their own declarations: the HUD's call on its own noun isn't
// proved to reach its own hook, so they call the gate directly. Their memory lives in $.state, as a source's must.
const toolsSeen = atom({ plugin: 'hud', key: 'toolSignals' } as const, toolSignals.init)
const testsSeen = atom({ plugin: 'hud', key: 'testResults' } as const, testRuns.init)
const agentsSeen = atom({ plugin: 'hud', key: 'agents' } as const, agents.init)
const feed = async ($: EngineInterface, decl: Declaration, p: Pushes) => {
  for (const s of p.push) await hold($, 'hud', decl, s)
  for (const id of p.clear) await clear($, 'hud', { id })
}

// A mute is kept by key across sessions in $.store, mirrored in $.state for drawing. A muted
// source's slots are still gated and held, so unmuting is instant, but they're never drawn.
const muted = atom({ plugin: 'hud', key: 'muted' } as const, [])
// The slots shown: not a muted sender's, and not one the person hid (their word outranks the urgency rules, so a hidden
// slot raises no urgency and draws nowhere). A slot is still held and gated either way, so unmuting or unhiding is instant.
const heldNow = async ($: EngineInterface) => {
  const decls = await read($, sources), off = await read($, muted), list = sourcesOf(decls), hidden = (await prefsNow($)).hidden
  return inOrder(await read($, slots), decls).filter(s => !isMuted(s, list, off) && !hidden.includes(`${s.from}/${s.id}`))
}

// The urgency place (hooks/urgency.ts): the HUD's own rules over the slots shown, weighed after anything that changes a
// slot and at every boundary, and kept in $.state so a reload keeps it. A boundary is what counts in run.boundaries.
// `forget` drops the standing one first: a mute silencing it, or a main-loop turn's end with no run to count a boundary.
// It rides calls that must go on, so a fault in it is swallowed: the place keeps what it had and the next weighing tries again.
// simplification: `held` is read before update's retry, so two weighings finishing together may land in either order; the next one corrects it
const urgent = atom({ plugin: 'hud', key: 'urgent' } as const, null)
const weighUrgency = async ($: EngineInterface, forget?: (u: Urgent) => boolean) => {
  try {
    const boundaries = (await read($, run))?.boundaries ?? 0, held = await heldNow($)
    await update($, urgent, prev => urgentNow(held, prev && !forget?.(prev) ? prev : undefined, boundaries) ?? null)
  } catch { /* a fault in the urgency place costs nothing else */ }
}
// A boundary the arrangement adds to the run's (a hud call's mode, focus or strip; the person's /hud commands) counts
// in run.boundaries as a phase does, once: stale widgets retire and an urgency hold ends on it too. With no live run
// nothing counts, as at a turn's end; the urgency is weighed either way.
const crossed = async ($: EngineInterface, forget?: (u: Urgent) => boolean) => {
  if (isLive(await read($, run))) {
    const now = await $.clock.now()
    await update($, run, r => (isLive(r) ? boundary(r, now) : r))
  }
  await weighUrgency($, forget)
}
const setMuted = async ($: EngineInterface, key: string, on: boolean) => {
  let now: string[] = [] // set inside update's closure
  await update($, muted, m => (now = on ? [...new Set([...m, key])] : m.filter(k => k !== key)))
  await $.store.set('muted', now)
}

const trust = async ($: EngineInterface, sub: string, name: string): Promise<string> => {
  const list = sourcesOf(await read($, sources)), off = await read($, muted)
  if (sub === 'sources') {
    return [...list.map(s => `${s.name} · ${whose(s)}${off.includes(s.key) ? ' · muted' : ''}\n  ${s.access}\n  ${s.slots.join(', ')}`),
      'Hide one with /hud mute <name>, such as /hud mute ' + typed(list.at(-1)!) + '.'].join('\n')
  }
  const s = list.find(x => name && [x.key, typed(x)].includes(slug(name)))
  if (!s) return `No source "${name}". Name one of: ${list.map(typed).join(', ')}.`
  await setMuted($, s.key, sub === 'mute')
  // a mute is the person's word, not a boundary to wait for: what it silenced leaves the urgency place at once, and
  // an unmuted source's rule is weighed again
  const ids = s.ids.map(id => `${s.from}/${id}`)
  await crossed($, u => sub === 'mute' && ids.includes(u.key))
  await arrange($, sub === 'mute' ? [] : ids) // brought back, its slots don't wait
  return sub === 'mute' ? `${s.name} is muted: its figures are hidden until /hud unmute ${typed(s)}.` : `${s.name} is back.`
}

// What shows first, kept in $.state for the ranker to read. The person's word is the mode they
// set with /hud mode (it holds for the session) and their pins and hides (kept by key across sessions in $.store,
// mirrored here for drawing); Claude can only say its mode (while the person has not set one) and its focus.
const mode = atom({ plugin: 'hud', key: 'mode' } as const, 'build')
const modeByPerson = atom({ plugin: 'hud', key: 'modeByPerson' } as const, false)
const focus = atom({ plugin: 'hud', key: 'focus' } as const, [])
const prefs = atom({ plugin: 'hud', key: 'prefs' } as const, NO_PREFS)

// A state older than these keys has none of them: build, nobody's, none, none.
const modeNow = async ($: EngineInterface) => (await read($, mode)) ?? 'build'
const personsMode = async ($: EngineInterface) => (await read($, modeByPerson)) === true
const focusNow = async ($: EngineInterface) => (await read($, focus)) ?? []
const prefsNow = async ($: EngineInterface) => (await read($, prefs)) ?? NO_PREFS

// The keys a person or Claude may name: every slot held, and the run's widgets.
const knownKeys = async ($: EngineInterface) => keysOf(await read($, run), await read($, slots))

// /hud mode, pin, unpin, hide and unhide, each answering with what it did.
const control = async ($: EngineInterface, sub: string, arg: string): Promise<string> => {
  if (sub === 'mode') {
    const said = modeCommand(arg, await modeNow($), await personsMode($))
    const chosen = said.mode
    if (chosen) {
      await update($, mode, () => chosen)
      await update($, modeByPerson, () => true)
      await crossed($) // a boundary: counted, the urgency weighed and the strip decided again
      await arrange($)
    }
    return said.text
  }
  // simplification: read, decide, write; only the person's typing writes prefs, one command at a time
  const held = await prefsNow($), said = prefsCommand(held, sub as 'pin' | 'unpin' | 'hide' | 'unhide', arg, await knownKeys($))
  if (said.prefs !== held) {
    await update($, prefs, () => said.prefs)
    await $.store.set('prefs', said.prefs)
    // a boundary; a slot the person unhid comes back at once (a pin never waits)
    await crossed($)
    await arrange($, held.hidden.filter(k => !said.prefs.hidden.includes(k)))
  }
  return said.text
}

// The lines /hud and the pane show of that: the mode, and what the person pinned or hid.
const showing = async ($: EngineInterface): Promise<string[]> =>
  [modeLine(await modeNow($), await personsMode($)), ...prefsLines(await prefsNow($))]

// Who decides what's shown (hooks/rank.ts): the mode, Claude's focus, the person's pins and hides
// as above, and the urgency place (above), read as they stand.
const arrangement = atom({ plugin: 'hud', key: 'arrangement' } as const, undefined)
// The board ranked: Claude's widgets beside every unmuted slot, the pane's order and why each is there. Claude's
// `strip` counts as its focus, ahead of `focus`.
const board = async ($: EngineInterface, r: HudRun | null): Promise<Placed[]> => {
  const all = [...claudeSlots(r), ...(await heldNow($))], at = new Map(all.map((s, i) => [s, i]))
  const placed = rank(all, {
    mode: await modeNow($), focus: [...stripFocus(r), ...(await focusNow($))], prefs: await prefsNow($),
    calls: await callsNow($), order: s => at.get(s) ?? 0,
  })
  return urgentFirst(placed, await read($, urgent))
}
// One view of the run for what is ranked, arranged, printed and drawn: a bound widget with no reading anyone stands
// behind says "no reading" (no old number, no old tone; it ages from its last reading), and what the person hid never
// shows, on any surface (the run without those widgets; the slots without them are heldNow()'s).
const drawable = async ($: EngineInterface) => {
  const hidden = (await prefsNow($)).hidden
  return { run: (r: HudRun) => unhidden(unread(r), hidden), held: () => heldNow($) }
}
// A boundary (a main-loop turn's end; a hud call with start, phase, rebuild, mode, focus or strip; the person's mute,
// unmute or a /hud command that changed something): the strip is decided again and kept until the next, with the room
// it gave the run's own items. `back`: keys the person brought back, which never wait.
// simplification: the board is ranked before update's closure (ranking reads $), so a pin landing between the two can be lost
// from the strip until the next boundary
const arrange = async ($: EngineInterface, back: string[] = []) => {
  const raw = await read($, run)
  if (raw === null) return
  const r = (await drawable($)).run(raw)
  const u = await read($, urgent), placed = (await board($, r)).filter(p => p.key !== u?.key) // the urgency place is its own
  const now = await $.clock.now()
  await update($, arrangement, prev => {
    let frame: string[] = [] // set by the pick
    const next = nextArrangement(prev, placed, c => { const p = stripSlots(r, c); frame = p.frame; return p.slots }, now, back)
    return { ...next, frame }
  })
}

// What Claude says of its work, which is not the run: its `mode` (applied only while the person has not set one) and
// its `focus` (up to 3 keys, kept as sent: a slot the HUD's own source has not raised yet may come). A new run starts
// from none of Claude's. Returns the lines after the tool's `ok`: a mode or id it could not take, named back (ids and
// modes only, never a slot's value or note).
async function intend($: EngineInterface, i: Input): Promise<string[]> {
  const notes: string[] = [], byPerson = await personsMode($)
  if (i.start !== undefined) {
    if ((await focusNow($)).length) await update($, focus, () => [])
    if (!byPerson && (await modeNow($)) !== 'build') await update($, mode, () => 'build')
  }
  if (i.mode !== undefined) {
    const sent = modeOf(i.mode), now = await modeNow($)
    if (!sent) notes.push(`mode: unknown "${String(i.mode).slice(0, 20)}" (modes: ${MODE_NAMES.join(', ')})`)
    else if (!byPerson) await update($, mode, () => sent)
    else if (sent !== now) notes.push(`mode: the person chose ${MODES[now].label}, so yours was not applied`)
  }
  if (i.focus !== undefined) {
    const sent = focusOf(asList(i.focus)), kept = sent.slice(0, FOCUS_MAX)
    // only a real empty list clears it; junk changes nothing
    const clears = !sent.length && asList(i.focus).length === 0 && (Array.isArray(i.focus) ? i.focus.length === 0 : String(i.focus).trim() === '[]')
    if (sent.length || clears) {
      await update($, focus, () => kept)
      if (sent.length > kept.length) notes.push(`focus: only ${FOCUS_MAX} count; kept ${kept.join(', ')}`)
      const known = await knownKeys($), unknown = kept.filter(k => !known.includes(k))
      if (unknown.length) notes.push(`focus: unknown ${unknown.join(', ')} (known: ${keyList(known)})`)
    }
  }
  return notes
}

// simplification: read, observe, write with update's retry; two calls finishing together may push in either order
// Answers what the tests source saw, for the auto-log: its last failed count before this call, and the counts of the
// summary it took from it (none, when it took none).
const observeCall = async ($: EngineInterface, c: Call) => {
  let t: Pushes = { push: [], clear: [] }, r: Pushes = t // set inside update's closure
  const tests: { before?: number; after?: ReturnType<typeof testRuns.counts> } = {} // set inside update's closure
  await update($, toolsSeen, s => { const o = toolSignals.observe(s, c); t = o; return o.state })
  await update($, testsSeen, s => {
    const o = testRuns.observe(s, c)
    r = o
    tests.before = s.failed.at(-1)
    tests.after = o.push.length ? testRuns.counts(c.text ?? '') : undefined
    return o.state
  })
  await feed($, toolSignals.declaration, t)
  await feed($, testRuns.declaration, r)
  return tests
}

// The auto-log's write (hooks/autolog.ts): a line goes in only while a run is live. The observer's lines are not
// Claude's, so they leave updatedAt, sinceUpdate and the nudge alone.
const logObserved = async ($: EngineInterface, lines: Said[]) => {
  if (!lines.length) return
  const now = await $.clock.now()
  await update($, run, r => (isLive(r) ? { ...r, log: lines.reduce((log, s) => write(log, s, now), r.log) } : r))
}

// The plan mirror (hooks/plan.ts): a finished task-list call of the main loop updates the plan, which a live run shows.
// The plan is held in $.state whether or not a run is live, as TaskUpdate names an item the list already holds.
// A run that starts on its own, or that Claude adopts, takes the held plan at once (autoRun(), the hud call).
// simplification: a run Claude starts fresh takes it only at the next list call
const plan = atom({ plugin: 'hud', key: 'plan' } as const, [])
const mirrorPlan = async ($: EngineInterface, tool: string, input: Record<string, unknown>, result: unknown) => {
  if (!PLAN_TOOLS.includes(tool)) return
  let items = undefined as PlanItem[] | undefined // set inside update's closure
  await update($, plan, held => (items = mirror(held ?? [], tool, input, result)) ?? held ?? [])
  if (!items) return
  const shown = items, now = await $.clock.now(), n = await callsNow($)
  await update($, run, r => (isLive(r) ? intoRun(r, shown, now, n) : r))
}

// A measure (the context's fill, when it changed) fills the widgets bound to it (hooks/bind.ts).
const bindMeasure = async ($: EngineInterface, e: meter.Measure, now: number) => {
  const text = measureText(e)
  if (text === undefined || !(await read($, run))?.widgets?.some(w => w.bind?.on === 'measure')) return
  const n = await callsNow($)
  await update($, run, r => (isLive(r) ? seeBound(r, { tool: MEASURE, input: {}, failed: false, text }, now, n) : r))
}

const watched = async ($: EngineInterface) => (await $.session.surfaces()).some(s => DRAWS.includes(s))

// Auto-run: a long turn starts its own run. Its memory is in the session's state: the person's last
// message (its first line, as a title), their turn while auto-run watches it, the last sign of a turn, and the main
// loop's background jobs still running.
const prompt = atom({ plugin: 'hud', key: 'prompt' } as const, undefined)
const turn = atom({ plugin: 'hud', key: 'turn' } as const, null)
const lastTurnAt = atom({ plugin: 'hud', key: 'lastTurnAt' } as const, undefined)
const jobs = atom({ plugin: 'hud', key: 'jobs' } as const, {})

// The Agents source (hooks/sources/agents.ts): an event it takes becomes slots, and a line in the log while a run is live.
// One that changes nothing (an end for an agent that is not running) writes nothing.
const watchAgents = async ($: EngineInterface, ev: agents.AgentEvent) => {
  const held = await read($, agentsSeen)
  if (agents.observe(held, ev).state === held) return
  let o: Pushes = { push: [], clear: [] }, line = undefined as ReturnType<typeof agents.said>, changed = false as boolean // set inside update's closure
  await update($, agentsSeen, s => { const r = agents.observe(s, ev); o = r; line = agents.said(s, ev); changed = r.state !== s; return r.state })
  if (!changed) return
  await feed($, agents.declaration, o)
  if (line) await logObserved($, [agentSaid(line)])
}

// Jobs of the main loop that have ended, by task id (a shell's or a subagent's).
const stopJobs = async ($: EngineInterface, ids: string[]) => {
  const held = (await read($, jobs)) ?? {}
  if (!ids.some(id => id in held)) return
  await update($, jobs, j => Object.fromEntries(Object.entries(j ?? {}).filter(([id]) => !ids.includes(id))))
}

// A background subagent has ended: a job no more, and done or failed in the Agents source.
const endAgent = async ($: EngineInterface, id: string, failed: boolean) => {
  await stopJobs($, [id])
  await watchAgents($, { k: 'end', id, failed })
}

// The main loop's finished Agent call, or TaskStop. A foreground agent (`local`: the call's id, which it goes by until it
// has one of its own) ends with its result: done on a completed record, failed on an error or a refusal. One that came back
// launched is a background job until its notification (or its own turn's end) and, if it began in the foreground, keeps
// its place under its own id: a person can send a foreground agent to the background. Any other record (a teammate
// joining, a launch in the cloud) was no subagent finishing there, so its entry is dropped. Stopping a task ends the agent
// it names.
const agentCall = async ($: EngineInterface, e: Record<string, unknown>, ran: { result?: unknown }, failed: boolean, asked: { name: string } | undefined, local: string | undefined) => {
  if (e.tool === 'TaskStop') {
    const id = e.task_id ?? e.shell_id
    if (!failed && typeof id === 'string') await endAgent($, id, true)
    return
  }
  if (!asked) return
  const bg = agents.launched(ran.result)
  if (bg) {
    await update($, jobs, j => ({ ...j, [bg.id]: 'agent' as const }))
    await watchAgents($, local ? { k: 'rekey', id: local, as: bg.id } : { k: 'start', id: bg.id, name: bg.name ?? asked.name })
  } else if (local) await watchAgents($, failed || agents.completed(ran.result) ? { k: 'end', id: local, failed } : { k: 'drop', id: local })
}

// A sign of life from an agent the session's start left lost (a call of its own): it was at work after all, and a job
// again. Only a background agent goes by its own id, so only one comes back this way; a foreground one ends with its call.
const revive = async ($: EngineInterface, id: string) => {
  if (!(await read($, agentsSeen)).list.some(a => a.id === id && a.lost)) return
  await update($, jobs, j => ({ ...j, [id]: 'agent' as const }))
  await watchAgents($, { k: 'live', id })
}

// A foreground agent can't outlive the main loop's turn: one still at work at its end never had its result (an interrupted
// call, a fault). Failed, as it never finished. A background agent is a job, and ends by its notification or its own turn.
const sweepAgents = async ($: EngineInterface) => {
  const away = (await read($, jobs)) ?? {}
  for (const a of (await read($, agentsSeen)).list) if (a.state === 'now' && !(a.id in away)) await watchAgents($, { k: 'end', id: a.id, failed: true })
}

// A background task's notification arrives as a prompt (proved on desktop), but it is no message of the person's.
const NOTICE = /<task-notification>[\s\S]*?(?:<\/task-notification>|$)/g
const isNotice = (e: { text: string; origin?: { kind: string } }) =>
  e.origin?.kind === 'task-notification' || e.text.trimStart().startsWith('<task-notification>')
// It ends the jobs it names, the subagents among them (completed is done; failed and killed are failed), and nothing
// else: no note, no new turn, no resume.
const endJobs = async ($: EngineInterface, text: string) => {
  const told = (text.match(NOTICE) ?? []).flatMap(b => notification(b) ?? [])
  if (!told.length) return
  await stopJobs($, told.map(n => n.id))
  for (const n of told) await watchAgents($, { k: 'end', id: n.id, failed: n.status !== 'completed' })
}

// The person's message: their turn begins, auto-run watches it from here, and a run waiting for them or paused picks up.
// Only the first line is kept, as the title a run started in this turn takes.
const prompted = async ($: EngineInterface, text: string) => {
  const now = await $.clock.now()
  await update($, prompt, () => ({ text: titleOf(text), at: now }))
  await update($, turn, () => ({ startedAt: now, calls: 0 }))
  await update($, lastTurnAt, () => now) // before the run: pause() reads it to tell a message landed meanwhile
  await update($, run, r => (isLive(r) && (r.status === WAITING || r.status === PAUSED) ? { ...r, status: 'running' } : r))
}

// Auto-run stands down for the rest of the turn: off, not null, so a notification or a hand-back delivered into the turn
// doesn't begin another. The next turn, whatever begins it, starts over.
const standDown = ($: EngineInterface, now: number) => update($, turn, () => ({ startedAt: now, calls: 0, off: true as const }))

// Auto-run's watch on a finished call. Any call is a sign of a turn, which the pause reads. The main loop's background
// shells are jobs until a notification or a TaskStop ends them. And a main-loop turn, whatever began it, that runs long
// with no live run starts one, provisional, titled from the person's last message, while someone watches; shown, unless
// the person pressed ✕ in this turn. Answers whether it started one.
const autoRun = async ($: EngineInterface, e: Record<string, unknown>, ran: { result?: unknown; deny?: string }, now: number) => {
  await update($, lastTurnAt, () => now)
  if (e.agentId !== undefined) return false // a subagent's shells and calls are its own
  const begun = (ran.result as { backgroundTaskId?: unknown } | null | undefined)?.backgroundTaskId
  const stopped = e.tool === 'TaskStop' && ran.deny === undefined ? e.task_id ?? e.shell_id : undefined
  if (typeof begun === 'string' || typeof stopped === 'string') {
    await update($, jobs, j => {
      const at = { ...j }
      if (typeof stopped === 'string') delete at[stopped]
      if (typeof begun === 'string') at[begun] = 'shell'
      return at
    })
  }
  // counted inside update's closure, which retries on a clash: calls that finish together each count. A turn it stood
  // down in (off) or none in hand counts nothing.
  let t = null as { startedAt: number; calls: number; hiddenAt?: number } | null // set inside update's closure
  await update($, turn, w => ((t = w && !w.off ? { ...w, calls: w.calls + 1 } : null), t ?? w))
  if (!t) return false
  // simplification: asks who's watching only once the rest holds: a turn under 8 calls and 60 seconds reads none, and a long one
  // reads them once, when its run starts; while nobody watches (a -p run, the SDK) it asks again at each call past that
  if (!shouldStart(isLive(await read($, run)), true, t, now) || !(await watched($))) return false
  // titled from the message; a plan already held reaches the run the moment it exists
  const title = titleOf((await read($, prompt))?.text), held = (await read($, plan)) ?? [], n = await callsNow($)
  await update($, run, r => (isLive(r) ? r : intoRun({ ...fresh(title, now), provisional: true as const }, held, now, n)))
  if (t.hiddenAt === undefined) await update($, stripHidden, () => false)
  await standDown($, now) // one run a turn
  return true
}

// The person's ✕: the strip hides until the next run, and a run auto-run starts in this same turn stays hidden too.
const hideStrip = async ($: EngineInterface) => {
  await update($, stripHidden, () => true)
  if (!(await read($, turn))) return
  const now = await $.clock.now()
  await update($, turn, t => t && { ...t, hiddenAt: now })
}

// The 1-second clock: a live run with no turn for 30 minutes, and no job at work, reads paused until the next message.
// A message can land between the reads and the write: the decision is taken again on the run as it stands when written
// (update retries on a clash), and if a sign of a turn came after the read, the status goes back to what it was (a
// message's own resume then holds: prompted() writes lastTurnAt before it touches the run).
// simplification: most seconds end at the first look (the run the clock just read, and the time), so a tick costs two reads
const pause = async ($: EngineInterface, seen: HudRun) => {
  const now = await $.clock.now(), last = await read($, lastTurnAt)
  if (!pauses(seen, last, 0, now)) return
  const n = jobsRunning({ jobs: await read($, jobs) })
  if (n > 0) return
  let from: string | undefined // set inside update's closure
  await update($, run, r => ((from = r && pauses(r, last, n, now) ? r.status : undefined), from !== undefined && r ? { ...r, status: PAUSED } : r))
  if (from !== undefined && (await read($, lastTurnAt)) !== last) {
    const was = from
    await update($, run, r => (r?.status === PAUSED ? { ...r, status: was } : r))
  }
}

const expand = async ($: EngineInterface) => {
  await $.ui.open({ id: PANE, title: 'HUD' })
  await update($, paneOpen, () => true)
}

// A plugin's own $.ui.close never reaches its own ui.close hook, so the flag is set here too.
const collapse = async ($: EngineInterface) => {
  await $.ui.close({ id: PANE })
  await update($, paneOpen, () => false)
}

// The tool is offered once a surface that draws the strip is attached: nobody sees a HUD under -p, the SDK,
// or a scheduled run nobody opened. The desktop app attaches after session.start, so attach offers it too.
// simplification: this load's registration; a reload is a fresh module, which registers again
let offered = false
const offer = async ($: EngineInterface) => {
  if (offered) return
  await $.tool.register({ name: 'hud', description: DESCRIPTION, inputSchema: SCHEMA, isDeferred: false })
  offered = true
}

export const register: Register = on => {
  // $.hud: other plugins (those that list "hud" under "dependencies") send slots through it. Each call raises
  // hud.<method>, which any plugin may hook; the HUD's own hooks sit innermost, beneath its dependents (proved in the app).
  on('engine.create', async ($, e, next) => ({ ...(await next(e)), hud: HUD }))
  // No .catch on these three, on purpose: they fail closed, so a fault in the gate refuses a source's slot (the noun's
  // own answer, UNHEARD) rather than letting it through unchecked.
  on('hud.declare', async ($, e, next) => ({ value: await declare($, next.origin.plugin, e) }))
  on('hud.push', async ($, e, next) => ({ value: await push($, next.origin.plugin, e) }))
  on('hud.clear', async ($, e, next) => ({ value: await clear($, next.origin.plugin, e) }))

  on('session.attach', async ($, e, next) => {
    const joined = await next(e)
    if (DRAWS.includes(e.surface)) await offer($)
    return joined
  })

  on('session.start', async ($, e, next) => {
    if (await watched($)) await offer($)
    await $.command.register({ name: 'hud', description: 'Show the task HUD strip; mode, pin or hide a slot, sources, mute or unmute a source' })
    // the person's mutes, pins and hides, from past sessions; a store that can't be read leaves none
    const kept = await $.store.get('muted').catch(() => undefined)
    if (Array.isArray(kept)) await update($, muted, () => kept.filter((k): k is string => typeof k === 'string'))
    const keptPrefs = await $.store.get('prefs').catch(() => undefined)
    if (typeof keptPrefs === 'object' && keptPrefs !== null) await update($, prefs, () => prefsOf(keptPrefs))
    // background shells don't outlive the process that ran them: a resumed session's are gone, never "1 job running".
    // Subagents at work read lost: failed, as on a resume, until a sign of their life (their call, notification or own
    // turn's end) says the process stayed, as on a reload, an enable or a respawn, which session.start can't tell apart.
    await update($, jobs, () => ({}))
    for (const a of (await read($, agentsSeen)).list) if (a.state === 'now') await watchAgents($, { k: 'lose', id: a.id })
    // simplification: 1s redraw for elapsed/countdown, and the pause; only while a run is live
    $.clock.every(1000, async () => {
      const r = await read($, run)
      if (!isLive(r)) return
      await pause($, r)
      await $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  // simplification: the strip only; the full pane opens from the strip's Expand, never by itself. It also says in full what
  // the header cut ("…"): the band can't reveal it on hover.
  on('command.run', { command: 'hud' }, async ($, e) => {
    const [sub = '', ...rest] = (e.args ?? '').trim().split(/\s+/)
    if (['sources', 'mute', 'unmute'].includes(sub)) return { text: await trust($, sub, rest.join(' ')) }
    if (['mode', 'pin', 'unpin', 'hide', 'unhide'].includes(sub)) return { text: await control($, sub, rest.join(' ')) }
    const raw = await read($, run)
    const shown = await showing($)
    if (raw === null) return { text: ['No HUD yet. Claude starts one for a long task, or ask for one.', ...shown].join('\n') }
    await update($, stripHidden, () => false) // brings back a strip the person hid with ✕
    const r = (await drawable($)).run(raw), now = await $.clock.now(), n = jobsRunning({ jobs: await read($, jobs) })
    // one line per slot in the strip: the boundary decided which and in what order; the why (and its tone) is as it is now
    const arranged = await read($, arrangement), placed = await board($, r)
    const inStrip = (arranged?.strip ?? []).flatMap(k => {
      const p = placed.find(x => x.key === k)
      return p ? [`${plain(p.slot.title)} — ${p.why}`] : []
    })
    return {
      text: [plain(r.title), r.goal && `Goal: ${plain(r.goal)}`, `${sentence(r.status)}  ·  ${factsOf(r, now, [], Infinity, n)}`, ...inStrip, ...shown,
        'The strip is back above the prompt. Expand opens the dashboard.'].filter(Boolean).join('\n'),
    }
  })

  // The person's close (the pane's mark, ctrl+x x) flips the strip's button back to Expand.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) await update($, paneOpen, () => false)
    return closed
  }).catch(($, e, next) => next(e)) // a fault in the HUD never stands in the way of the close (replay-safe)

  // The compact strip above the prompt; Expand opens the full dashboard pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const raw = await read($, run)
    if (raw === null || e.props.hasSurvey || (await read($, stripHidden))) return next(e)
    const view = await drawable($), r = view.run(raw) // the one view: no reading where none, nothing hidden
    // Every mod's pane shares one dock: another's can take it with no ui.close for ours, so the flag alone
    // goes stale. Shown is what the dock says.
    const isOpen = (await read($, paneOpen)) && (await $.ui.panes()).some(p => p.id === PANE && p.isShown)
    const now = await $.clock.now(), n = jobsRunning({ jobs: await read($, jobs) })
    const last = lastLine(r.log)
    const factsBut = (drawn: string[], stepRoom = Infinity) => factsOf(r, now, drawn, stepRoom, n)
    const title = plain(r.title), goal = r.goal && plain(r.goal)
    // a run that started on its own draws its title dim until Claude names it
    const dim = r.provisional ? { dimColor: true } : {}
    const toggle = { key: 'toggle', label: isOpen ? 'Collapse' : 'Expand ⤢', onPress: () => void (isOpen ? collapse($) : expand($)) }
    const hide = { key: 'hide', label: '✕', plain: true as const, dimColor: true, onPress: () => void hideStrip($) }

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      const cols = e.props.bodyColumns
      const f = r.progress ? Math.min(1, Math.max(0, r.progress.n / r.progress.total)) : undefined // (clamped: a run from before)
      // With the dashboard open beside the band it keeps what the desktop's keeps, a line of status, title and its buttons:
      // the pane has the rest. Closed: the urgency place first, live as it stands; then the very items the desktop strip
      // chose (stripPicked(), the arrangement's slots and the run's own, or the default pick with no arrangement), one line
      // each, a slot as the board has it now with its why, so a hidden or muted one draws nowhere and a figure, why and tone
      // are never the stored ones. Nothing is left to the terminal to cut: every text is fitted to the columns it has
      // (fitLine(), headerOf(), cutText()), so no number is cut, and a figure sits in a box that never shrinks.
      const held = await view.held(), urgency = isOpen ? undefined : urgentFor(held, (await read($, urgent)) ?? undefined)
      const alarm = urgency && alarmLine(urgency)
      const picked = isOpen ? [] : stripPicked(r, held, urgency, (await read($, arrangement)) ?? undefined)
      const lines = isOpen ? [] : bandLines(picked, await board($, r), r, cols)
      // a status other than the usual says so in words: colour alone is no reading ("Waiting for you")
      // (and in a band too narrow to hold the word beside its buttons, by the colour of the dot, as a running one is)
      const said = r.status === 'running' ? '' : `${sentence(r.status)}  `
      const word = cols - len(`● ${said}`) - (len(toggle.label) + len(hide.label) + 8) >= 10 ? said : ''
      const head = headerOf({ r, now, jobs: n, cols, dot: len(`● ${word}`), buttons: len(toggle.label) + len(hide.label) + 8, hasBar: f !== undefined, picked: picked.map(p => p.key), drawn: lines.map(l => l.key), open: isOpen })
      return (
        <Box flexDirection="column">
          {alarm && <Text color={alarm.color} bold wrap="truncate-end">{cutText(alarm.text, cols)}</Text>}
          <Box flexDirection="row">
            <Text color={COLOR[r.status] ?? 'text'} bold>● {word}</Text>
            <Box flexGrow={1} flexShrink={1}><Text bold wrap="truncate-end">{r.provisional ? <Text dimColor>{head.title}</Text> : head.title}{head.goal && <Text bold={false}>  → {head.goal}</Text>}</Text></Box>
            {head.facts && <Box flexShrink={0}><Text dimColor>  {head.facts}</Text></Box>}
            {head.bar > 0 && f !== undefined && <Text> <Text color="claude">{'█'.repeat(Math.round(f * head.bar))}</Text><Text dimColor>{'░'.repeat(head.bar - Math.round(f * head.bar))} </Text></Text>}
            <Button {...toggle} variant="primary" />
            <Button {...hide} />
          </Box>
          {[...head.own, ...lines].map(l => (
            <Box flexDirection="row">
              <Box flexShrink={1}><Text wrap="truncate-end">  <Text dimColor>{l.title}: </Text></Text></Box>
              <Box flexShrink={0}><Text dimColor={l.old}>{l.figure}</Text></Box>
              {l.why && <Box flexShrink={3}><Text dimColor italic wrap="truncate-end">  {l.why}</Text></Box>}
            </Box>
          ))}
          {!isOpen && last && <Text dimColor wrap="truncate-end">  {fitText(last.text, cols - 2)}</Text>}
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const held = await view.held(), placed = await board($, r)
    // simplification: ~8px per column, as the pane; the Svg scales down to its slot if that guess is wide
    const width = Math.min(1400, Math.max(320, e.props.bodyColumns * 8 - 8))
    // With the dashboard open beside the conversation the band keeps its header row alone: the pane
    // draws all of it, and the conversation gets the height back.
    // a run with nothing to draw yet (just started: no figures, no plan) shows its header alone
    // The slots it draws are the ones decided at the last boundary, their values as they are now (a run from before
    // there was one takes its default pick).
    const urgency = urgentFor(held, (await read($, urgent)) ?? undefined)
    const drawnStrip = isOpen ? undefined : strip(r, width, held, urgency, (await read($, arrangement)) ?? undefined)
    const graphic = drawnStrip?.shown.length ? drawnStrip : undefined
    // the alt leads with the urgency, so the slot's own entry doesn't say it again
    const lead = urgency && `${urgency.slot.from}/${urgency.slot.id}`
    const told = lead ? placed.map(p => (p.key === lead ? { ...p, why: '' } : p)) : placed
    const alt = (urgency ? `Urgent: ${plain(urgency.says)}. ` : '') + describe(r, held, told)
    const drawn = graphic?.shown ?? []
    // simplification: no-break spaces inside the status too ("Waiting for you" never breaks)
    const status = `●${NBSP}${sentence(r.status).replace(/ /g, NBSP)}${NBSP}${NBSP}`
    // The title and goal are laid out here, in measure()'s units (its SVG widths run wide: ×0.85 still leaves the
    // app's 13px text slack), so the desktop never wraps them on its own (the 1.0 band split "● done" that way).
    // A column is 7px, under any code font's advance; the two buttons take their labels and 64px.
    // The title keeps a floor and the step in hand takes what is left, so a long step never pushes the title
    // or the buttons out of the row (seen live with the dashboard open).
    const row = (e.props.bodyColumns * 7 - 64) / 0.85 - measure(status, 13, BOLD) - measure(toggle.label, 13)
    const titleFloor = Math.min(measure(title, 13, BOLD), Math.max(120, row * 0.35))
    const pad = measure(`${NBSP}${NBSP}${NBSP}${NBSP}`, 13)
    // With the dashboard open beside it, the band goes minimal (the person's ask): one line of status, title,
    // Collapse and ✕. The pane right there shows the clock, goal, progress, step and errors.
    const facts = isOpen ? '' : factsBut(drawn, row - titleFloor - pad - measure(factsBut(drawn, 0), 13) - measure('  ·  ▸ ', 13))
    const room = row - (facts ? pad + measure(facts, 13) : 0)
    // Long text wraps rather than vanishing (the person's pick over shrinking or a marquee; native text has no
    // size to shrink): the title takes two lines at most, cut after, and the goal a dim line of its own under it.
    // /hud prints both whole. (No hover cards: the band never reveals them, proved in the app.)
    const titleLines = isOpen ? [fit(title, room, 13, BOLD)] : wrapPx(title, room, 13, 2, BOLD)
    const shownGoal = goal && !isOpen ? fit(goal, room - measure('→ ', 13), 13) : ''
    // the band's whole width, less the clock in front
    const stamp = last ? `${clock(last.at - r.startedAt)}${NBSP}${NBSP}` : ''
    const lastText = last ? stamp + fit(last.text, (e.props.bodyColumns * 7 - 16) / 0.85 - measure(stamp, 13), 13) : ''
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="flex-start">
          <Box flexShrink={0}><Text color={COLOR[r.status] ?? 'text'} bold>{status}</Text></Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
            {titleLines.map(l => <Text bold wrap="truncate-end" {...dim}>{l}</Text>)}
            {shownGoal ? <Text dimColor wrap="truncate-end">→ {shownGoal}</Text> : null}
          </Box>
          {facts ? <Box flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{NBSP}{NBSP}{facts}{NBSP}{NBSP}</Text></Box> : null}
          <Button {...toggle} />
          {/* the surface's own close control at the band's trailing edge. simplification: the label is ✕, not words, as a
              desktop that predates role="dismiss" draws the label itself ("Hide HUD strip" as a text chip) */}
          <Button {...hide} role="dismiss" />
        </Box>
        {/* the alt says in words all the run holds, as a reader of it can't see what the header leaves to the graphic */}
        {graphic && <Svg source={graphic.source} alt={alt} width={graphic.width} height={graphic.height} />}
        {/* the last line is cut here too, by fit(): the app's own cut lands mid-word ("hides t…") */}
        {!isOpen && last && <Text dimColor wrap="truncate-end">{lastText}</Text>}
      </Box>
    )
  })

  // Answers the hud tool; feeds every other call to the HUD's own sources; counts it and its error while a run is
  // live (a main-loop call also ticks the clocks widgets age by), and once the HUD has gone quiet, has Claude check
  // it still fits the work (a reminder after the result). Widgets gone stale are named in that check instead.
  // simplification: one unmatched hook, as a { tool } matcher over ~1000 MCP names is too deep for tsc
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) === TOOL) {
      // The HUD is the main conversation's: nobody watches a subagent's, and its start or done would end the main run.
      if (e.agentId !== undefined) return { result: 'The HUD shows the main conversation only; this call changed nothing.' }
      const now = await $.clock.now(), n = await callsNow($)
      const input = e as unknown as Input
      // a run started on its own is adopted only in the turn of the message that began it (since that message)
      const since = (await read($, prompt))?.at, held = (await read($, plan)) ?? []
      let adopted = false, counted = false // set inside update's closure
      const lines: string[] = [] // what apply() has for the answer: a recipe's line, a binding it could not take; set inside update's closure
      await update($, run, prev => {
        adopted = adopts(prev, input, since)
        lines.length = 0
        const r = apply(prev, input, now, since, lines, n)
        // apply() counts a phase or a rebuild as a boundary itself, and a start is a run of its own
        counted = input.start !== undefined || (r.boundaries ?? 0) !== (prev?.boundaries ?? 0)
        return adopted ? intoRun(r, held, now, n) : r // the held plan, the moment the run is Claude's
      })
      // The run took the call. What follows rides its answer, so a fault in it is swallowed, as weighUrgency()'s is: the
      // answer never says "unchanged" of a call that applied (the .catch would), and the strip waits for the next boundary.
      let notes: string[] = []
      try {
        // simplification: a new run shows the strip, not the pane; only the strip's Expand opens the full view. A start that
        // adopts the run begun on its own is no new run: the strip stays as the person left it.
        if (input.start !== undefined && !adopted) await update($, stripHidden, () => false)
        // Claude has the HUD in hand: auto-run stands down until the next turn
        await standDown($, now)
        await update($, lastTurnAt, () => now)
        // a call that says what matters (mode, focus, strip) is a boundary too, counted once beside a phase or a rebuild
        const sent = e as unknown as Record<string, unknown>, says = ['mode', 'focus', 'strip'].some(k => sent[k] !== undefined)
        if (says && !counted) await update($, run, r => (isLive(r) ? boundary(r, now) : r))
        await weighUrgency($) // a boundary ends a hold
        notes = await intend($, input)
        // the strip is decided again at any of them, and at a start
        if (says || counted) await arrange($)
      } catch { /* the run stands as the call left it */ }
      return { result: answer(input, [...notes, ...lines]) }
    }
    // counted as it starts, so what changes during it (a source's push, the HUD's own sources after) is stamped with it
    if (e.agentId === undefined) await update($, calls, k => (k ?? 0) + 1)
    else await revive($, e.agentId) // a subagent at work: one the session's start left lost is back
    // The main loop's Agent call: a foreground agent is at work from here to its result (hooks/sources/agents.ts), known
    // by its call's id until it has one of its own
    const asked = e.agentId === undefined && String(e.tool) === 'Agent' ? agents.call(e as unknown as Record<string, unknown>) : undefined
    const local = asked?.foreground && typeof e.tool_use_id === 'string' ? e.tool_use_id : undefined
    if (asked && local) await watchAgents($, { k: 'start', id: local, name: asked.name })
    const ran = await next(e)
    const failed = ran.deny !== undefined || ran.isError === true
    // First, before anything that could fault: a foreground agent at work since the call began ends with its result
    if (e.agentId === undefined) await agentCall($, e as unknown as Record<string, unknown>, ran, failed, asked, local)
    // The tool signals and test results read every finished call, whoever made it and whether or not a run is
    // live: slots outlive the run. (One unmatched tool.call hook per plugin, so they ride this one.)
    const finished = { tool: String(e.tool), input: e as unknown as Record<string, unknown>, failed, denied: ran.deny !== undefined, text: ran.text }
    const tests = await observeCall($, finished)
    await weighUrgency($)
    // The auto-log: what the main loop's call did becomes a line (a subagent's work is the subagent's, not the run's)
    if (e.agentId === undefined) await logObserved($, said(finished, tests.before, tests.after))
    if (e.agentId === undefined && !failed) await mirrorPlan($, finished.tool, finished.input, ran.result)
    const now = await $.clock.now()
    // a run that starts on its own counts from the next call, which tells Claude of it
    if (await autoRun($, finished.input, ran, now)) {
      await arrange($) // a run's start is a boundary, whoever starts it
      return ran
    }
    if (!isLive(await read($, run))) return ran
    // simplification: only the main loop is reminded, and only while someone watches; the count goes on, so a person
    // who comes back finds it checked on the next call. A subagent's calls count on the board but not toward
    // the main loop's check: three subagents at work would otherwise have it checked every couple of calls.
    const main = e.agentId === undefined
    const remind = main && ran.deny === undefined && (await watched($))
    // The main loop's call fills the widgets bound to it (hooks/bind.ts); one denied never ran, and a task-list call that
    // failed changed no list. A task-list call is read as the plan's done of total, as the mirror holds it now.
    // simplification: a job sent to the background (a shell's backgroundTaskId, an Agent's launch) has no result yet, so it is no
    // reading and no miss; its real output (the notification, TaskOutput) isn't read. A later task can bind to it.
    const away = typeof (ran.result as { backgroundTaskId?: unknown } | null | undefined)?.backgroundTaskId === 'string' || (asked && agents.launched(ran.result))
    const seen = main && ran.deny === undefined && !away && !(failed && PLAN_TOOLS.includes(finished.tool))
      ? { ...finished, text: PLAN_TOOLS.includes(finished.tool) ? planText((await read($, plan)) ?? []) : finished.text }
      : undefined
    let note: string | undefined // set inside update's closure
    const stampN = await callsNow($) // a bound widget's reading is stamped with it
    await update($, run, r => {
      note = undefined
      if (!r) return r
      // a main-loop call is Claude at work: a run waiting for the person or paused runs again, whatever began the turn
      const tallied = {
        ...r, ...(main && (r.status === WAITING || r.status === PAUSED) ? { status: 'running' } : {}), calls: r.calls + 1, errors: r.errors + (failed && ran.deny === undefined ? 1 : 0), // a denial is a refusal, not the command failing
        sinceUpdate: (r.sinceUpdate ?? 0) + (main ? 1 : 0), ticks: (r.ticks ?? 0) + (main ? 1 : 0), tickAt: main ? now : r.tickAt,
      }
      const counted = seen ? seeBound(tallied, seen, now, stampN) : tallied
      if (!remind) return counted
      // A run that started on its own: Claude is told once (it names it with title and goal), and never checked on.
      // The observer keeps it right; a check on a run Claude didn't start is noise. Adopted, it is checked as any.
      if (counted.provisional) {
        if (counted.told) return counted
        note = autoNote(counted.title)
        return { ...counted, told: true as const }
      }
      // One HUD check per call: the pointed one when widgets of Claude's went stale, else the general one when it's due
      // and no binding has seen its calls (isBound(): a bound widget keeps itself, and is named when it goes stale). While a check waits on an
      // answer, the next (pointed too) waits for its window, which doubles for each gone unanswered.
      const ids = pointedIds(counted), due = stale(counted)
      const naming = ids.length > 0 && (!counted.nudged || due)
      note = naming ? pointed(counted) : due && !isBound(counted) ? nudge(counted) : undefined
      if (note === undefined) return counted
      const n = counted.nudged ? (counted.nudged.n ?? 0) + 1 : 1
      return { ...counted, nudged: { at: now, calls: counted.sinceUpdate ?? 0, n }, ...(naming ? { named: [...(counted.named ?? []), ...ids] } : {}) }
    })
    if (note === undefined || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) =>
    // a fault in the HUD never costs the call: another tool runs as if the HUD weren't there (replay-safe),
    // and a HUD update that failed says so instead of reading as done
    String(e.tool) === TOOL ? { deny: 'The HUD could not apply that update; it is unchanged.' } : next(e))

  // The main loop's turn ending is a phase boundary: what has been stale across two of them leaves the board, and the
  // strip is decided again. A held urgency goes. Auto-run's watch on the turn ends, and a live run Claude didn't finish
  // waits for the person, unless background jobs still work.
  // Never a finish: only Claude sends done or fail. A background subagent's own turn ending (it carries its `agentId`:
  // proved in the app) is its end: done if it answered, failed if it was interrupted, refused or errored. The main loop's
  // turn ending first fails any foreground agent still at work (sweepAgents()): its call never came back. (The main
  // loop's own turn.complete is proved in the app too: reason answer, no agentId; see DEVELOPING.)
  // simplification: one turn.complete hook; later observers ride it
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) await endAgent($, e.agentId, e.reason !== 'answer')
    else {
      await sweepAgents($)
      const now = await $.clock.now()
      await update($, turn, () => null)
      await update($, lastTurnAt, () => now)
      const live = isLive(await read($, run))
      if (live) {
        const waits = jobsRunning({ jobs: await read($, jobs) }) === 0
        await update($, run, r => (isLive(r) ? { ...boundary(r, now), ...(waits ? { status: WAITING } : {}) } : r))
      }
      // no run counts boundaries, so then the turn's end is one: it ends a hold
      await weighUrgency($, live ? undefined : u => u.heldTo !== undefined)
      await arrange($)
    }
    return done
  }).catch(($, e, next) => next(e)) // the turn ends as it would without the HUD

  // Context, cost and the rate-limit windows: the figures the app measures after each turn, pushed, never polled.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    const now = await $.clock.now()
    await feed($, meter.declaration, meter.observe(e, now))
    await bindMeasure($, e, now)
    await weighUrgency($)
    return measured
  }).catch(($, e, next) => next(e))

  // A compaction of the main conversation, once it stands, is a line in the log. A precompute only prepares one, a veto
  // changes nothing, and a subagent's is its own transcript's.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (done.skip === undefined && e.trigger !== 'precompute' && e.agentId === undefined) await logObserved($, [{ kind: 'compact' }])
    return done
  }).catch(($, e, next) => next(e))

  // A message that arrives mid-run may move the goal: Claude reads the goal and the ids the strip shows beside it
  // (steer(): the arrangement's keys, ids only, never a slot's words); beside a run that started on its own and that Claude
  // has not named, the note that names it (autoNote()). With no run live, a message someone is watching carries the note
  // to start one for a long task. Any prompt begins a turn auto-run watches; only the person's begins one afresh, titles a
  // run and resumes one, and only once it went through. A background task's notification also ends the jobs it names.
  on('prompt.submit', async ($, e, next) => {
    // Only the person's own typing (origin composer; none, as old hosts send) is their message: it gets a note, titles a
    // run and resumes a paused one. Any other origin (a task notification, a subagent's hand-back as a peer, the rest)
    // leaves the prompt and a paused run alone, and a task notification ends the jobs it names; but it begins a main-loop
    // turn all the same, which auto-run watches from here when it has none in hand (one delivered into a running turn
    // leaves that turn as it is) once it went through: a refused one begins nothing.
    if (isNotice(e)) await endJobs($, e.text)
    if (isNotice(e) || (e.origin?.kind ?? 'composer') !== 'composer') {
      const entered = await next(e)
      try {
        if (entered.drop === undefined) {
          const now = await $.clock.now()
          await update($, turn, t => t ?? { startedAt: now, calls: 0 })
        }
      } catch { /* past next(e): a fault here must not deliver it again */ }
      return entered
    }
    const r = await read($, run)
    // a run that started on its own and that Claude has not named carries the note that names it, never the steer: it may
    // hold an earlier task's title, and Claude can name it for this one (a title adopts it whatever its age)
    const note = isLive(r) ? (r.provisional ? autoNote(r.title) : steer(r, (await read($, arrangement))?.strip)) : offered && (await watched($)) ? KICKOFF : undefined
    const entered = await next(note ? { ...e, context: [...(e.context ?? []), note] } : e)
    // only a message that went through is the person's turn: one refused on its way in keeps no title, begins no turn
    // and resumes nothing. (Past next(e), a fault here must not send the message again: the .catch would.)
    try {
      if (entered.drop === undefined) await prompted($, e.text)
    } catch { /* the message went on: a fault in the HUD costs it nothing */ }
    return entered
  }).catch(($, e, next) => next(e)) // the message goes on without the note

  // What Claude needs to know about the HUD (hooks/skill.ts), once per session and then cached with the system prompt:
  // one constant section after the engine's own, only where the hud tool is offered, which is where someone watches.
  // Never built from the run or a slot.
  on('prompt.compose', async (_$, e, next) => {
    const composed = await next(e)
    return e.tools.includes(TOOL) ? { sections: [...composed.sections, { id: 'hud:skill', text: SKILL, scope: 'session' as const }] } : composed
  }).catch((_$, e, next) => next(e)) // the prompt goes on as the engine made it

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // the one view: a bound widget gone stale says "no reading"; what the person hid isn't drawn
    const view = await drawable($), raw = await read($, run), r = raw && view.run(raw)
    const now = await $.clock.now()
    const cols = e.props.bodyColumns ?? 60

    // Sources: who sends what the HUD shows, what each says it can access (as it wrote it), its slots, and whether
    // it's muted. Muting is by command: a Mute button in the pane never fired in the app (DEVELOPING, Constraints).
    const { Box, Text } = $.ui.resolve(e)
    const off = await read($, muted)
    const sourceList = (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Sources</Text>
        {sourcesOf(await read($, sources)).map(src => (
          <Box flexDirection="column" marginTop={1}>
            <Text><Text bold>{plain(src.name)}</Text><Text dimColor>{` · ${whose(src)}`}</Text>{off.includes(src.key) && <Text color="warning"> · muted</Text>}</Text>
            <Text dimColor>{plain(src.access)}</Text>
            <Text dimColor>{src.slots.map(plain).join(', ')}</Text>
          </Box>
        ))}
        <Box marginTop={1}><Text dimColor>{'Hide one with /hud mute <name> and bring it back with /hud unmute <name>. /hud sources lists the names.'}</Text></Box>
      </Box>
    )
    // What decides the order: the mode, and what the person pinned or hid. Set by command, as a pane button never fired.
    const controls = (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Showing</Text>
        {(await showing($)).map(l => <Text>{plain(l)}</Text>)}
        <Text dimColor>{'Switch with /hud mode <name>. /hud pin <slot> keeps one first, /hud hide <slot> leaves it out.'}</Text>
      </Box>
    )
    const none = <Box flexDirection="column"><Text dimColor>No run yet. Ask Claude for a HUD on a long task.</Text>{controls}{sourceList}</Box>
    // a run that started on its own: its title dim until Claude names it; background jobs at work, while it's live
    const dim = r?.provisional ? { dimColor: true } : {}
    const n = r && isLive(r) ? jobsRunning({ jobs: await read($, jobs) }) : 0

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      if (r === null) return none
      // simplification: ~8px per column; the Svg scales down to its slot if that guess is wide. The floor is low
      // on purpose: a docked pane is often under 340px, and drawing wider shrinks every label below the app's text.
      const width = Math.min(1400, Math.max(240, cols * 8))
      // the pane is the full board, ranked as it stands: a slot shows here at once, the strip waits for a boundary
      const held = await view.held(), placed = await board($, r)
      const { source, height } = dashboard({ ...r, widgets: r.widgets ?? [] }, width, held, placed)
      const quiet = quietFor(r, now)
      return (
        <Box flexDirection="column">
          <Text bold {...dim}>{plain(r.title)}</Text>
          {r.goal && <Text><Text dimColor>Goal  </Text>{plain(r.goal)}</Text>}
          <Text>
            <Text color={COLOR[r.status] ?? 'text'} bold>● {sentence(r.status)}</Text>
            <Text dimColor>  ⏱ {clock((r.endedAt ?? now) - r.startedAt)}</Text>
            {n > 0 && <Text dimColor>  · {jobsText(n)}</Text>}
            {isLive(r) && r.nextAt !== undefined && r.nextAt > now && (
              <Text color="suggestion">  ↻ next in {clock(r.nextAt - now)}</Text>
            )}
            {quiet !== undefined && <Text dimColor>  · updated {span(quiet)} ago</Text>}
          </Text>
          {/* the text in text colour; the mark beside it carries the outcome */}
          {r.summary !== undefined && <Text><Text color={COLOR[r.status]} bold>{r.status === 'failed' ? '✕' : '✓'} </Text>{plain(r.summary)}</Text>}
          <Svg source={source} alt={describe(r, held, placed)} width={width} height={height} />
          {/* simplification: no isInteractive; its sandboxed frame reloads blank on every redraw (each scroll step re-asks the hook) */}
          {controls}
          {sourceList}
        </Box>
      )
    }

    if (r === null) return none
    // Nothing is left to the terminal to cut: a line that holds a number is fitted to `cols` here (blockLine(), cutText(),
    // fitText()), and the rest wraps as Ink wraps it, whole.
    // Claude's tiles, then the run's own counts apart, as the dashboard draws them (errors only above 0): a tile of Claude's
    // named "errors" or "tool calls" is its own figure, never the run's count
    const tiles = [...Object.entries(r.tiles).map(([k, v]) => ({ k, v, at: r.tileClock?.[k] })), { k: 'tool calls', v: r.calls, at: undefined }, ...(r.errors ? [{ k: 'errors', v: r.errors, at: undefined }] : [])]
    // the board as it stands, ranked; the urgency place leads the pane as a line of its own, as it leads the band
    const ranked = await board($, r), urgency = urgentFor(await view.held(), (await read($, urgent)) ?? undefined)
    const alarm = urgency && alarmLine(urgency)
    const counts = Object.entries(r.counts).sort((a, b) => b[1] - a[1])
    const top = Math.max(1, ...counts.map(c => c[1]))
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 20)
    const quiet = quietFor(r, now)

    return (
      <Box flexDirection="column">
        {alarm && <Text color={alarm.color} bold>{cutText(alarm.text, cols)}</Text>}
        <Text bold {...dim}>{plain(r.title)}</Text>
        {r.goal && <Text><Text dimColor>goal </Text>{plain(r.goal)}</Text>}
        <Text>
          <Text color={COLOR[r.status] ?? 'text'}>● {r.status}</Text>
          <Text dimColor> · {clock((r.endedAt ?? now) - r.startedAt)}</Text>
          {n > 0 && <Text dimColor> · {jobsText(n)}</Text>}
          {isLive(r) && r.nextAt !== undefined && r.nextAt > now && (
            <Text color="suggestion"> · next in {clock(r.nextAt - now)}</Text>
          )}
          {quiet !== undefined && <Text dimColor> · updated {span(quiet)} ago</Text>}
        </Text>
        {r.summary !== undefined && <Text color={COLOR[r.status]}>{plain(r.summary)}</Text>}

        <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
          {tiles.map(({ k, v, at }) => (
            <Box flexDirection="column" borderStyle="round" paddingX={1} marginRight={1}>
              <Text dimColor>{k}</Text>
              <Text bold dimColor={life(at ?? {}, r) !== 'fresh'}>{fmt(v)}</Text>
              {/* when it last changed, as the dashboard's block says it */}
              {agoOf(at, r) && <Text dimColor>{agoOf(at, r)}</Text>}
            </Box>
          ))}
        </Box>

        {r.progress && (() => {
          // the number first, then the bar in what is left of the line
          const { n, total, label } = r.progress, head = `${n}/${total}${label ? ` ${plain(label)}` : ''}`, room = cols - len(head) - 2
          const fill = Math.round((Math.max(0, Math.min(n, total)) / total) * room) // (clamped: a run from before)
          return (
            <Text>
              {head}
              {room >= 5 && <Text> <Text color="success">{'█'.repeat(fill)}</Text><Text dimColor>{'░'.repeat(room - fill)}</Text></Text>}
            </Text>
          )
        })()}

        {r.phases.length > 0 && (
          <Text>
            {r.phases.map((p, idx) => (
              <Text color={COLOR[p.state] ?? 'inactive'}>{idx ? ' → ' : ''}{plain(p.name)}</Text>
            ))}
          </Text>
        )}

        {r.cells.length > 0 && (
          <Text>
            {r.cells.map(c => (
              <Text color={COLOR[c.state] ?? 'inactive'}>■ {c.name}  </Text>
            ))}
          </Text>
        )}

        {r.points.length > 1 && (() => {
          const head = `last ${fmt(r.points.at(-1))}`, k = Math.min(r.points.length, cols - len(head) - 2)
          return (
            <Text>
              <Text dimColor>{head}</Text>
              {k >= 4 && <Text> <Text color="claude">{spark(r.points.slice(-k))}</Text></Text>}
            </Text>
          )
        })()}

        {counts.length > 0 && (
          <Box flexDirection="column">
            {counts.slice(0, 6).map(([k, n]) => (
              <Text>
                <Text color="error">{'▇'.repeat(Math.max(1, Math.round((n / top) * 12)))}</Text> {n} {k}
              </Text>
            ))}
          </Box>
        )}

        {/* Claude's widgets and the slots, ranked, each with why it's there on a dim line under it. A widget that hasn't
            changed in a while is dim, and says when it did */}
        {ranked.map(p => {
          const en = entryOf(p, r), line = blockLine(en, cols), stand = (w: typeof en.w) => figuresOf(w, true).find(f => len(f) <= cols) ?? figuresOf(w, true).at(-1)
          return (
            <Box flexDirection="column">
              {line ? (
                // the figure in a box that never shrinks: the tail, then the title, give way to the room first
                <Box flexDirection="row">
                  <Box flexShrink={1}><Text dimColor>{line.title}: </Text></Box>
                  <Box flexShrink={0}><Text dimColor={en.old}>{line.figure}</Text></Box>
                  {line.why && <Box flexShrink={3}><Text dimColor>  {line.why}</Text></Box>}
                </Box>
              ) : (
                // no room for the figure beside its title: the title whole on a line (wrapped, if it must), the fullest figure
                // that fits on the next, or the barest wrapped whole
                <Box flexDirection="column">
                  <Text dimColor>{en.title}:</Text>
                  <Text dimColor={en.old}>{stand(en.w)}</Text>
                </Box>
              )}
              <Text dimColor italic>  {cutText(p.why, cols - 2)}</Text>
            </Box>
          )
        })}

        {r.fun.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {r.fun.map(f => <Text italic color="claude">{plain(f)}</Text>)}
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          {r.log.slice(-room).map(l => {
            const stamp = `${clock(l.at - r.startedAt)} `
            return (
              <Text>
                <Text dimColor>{stamp}</Text>
                {/* the observer's lines dim; a line with no by is Claude's */}
                <Text color={COLOR[l.level] ?? 'text'} dimColor={l.by === 'observer'}>{fitText(l.text, cols - len(stamp))}</Text>
              </Text>
            )
          })}
        </Box>
        {controls}
        {sourceList}
      </Box>
    )
  })
}
