import type { PluginState } from 'claude-code'

import type { HudHeld, HudRun, HudTone, HudWidget } from '../types'
import { isMirror, leadList, settle } from './lifecycle'
import { MODES, type ModeName } from './modes'

// Who decides what's shown: the person's pins, then Claude's focus, then the mode's slots, then
// the score; a source's hint nudges a slot among equals. Pure: the hooks rank the board for the pane as it is, and the
// strip only at boundaries, where its arrangement is kept (nextArrangement()).

export type Placed = { key: string; slot: HudHeld; why: string }
export type Prefs = { pinned: string[]; hidden: string[] }
export type Arrangement = NonNullable<PluginState['hud']['arrangement']>

export const PINNED = 'Pinned by you'
export const FOCUS = "Claude's focus"

const keyOf = (s: HudHeld) => `${s.from}/${s.id}`
/** A widget's key as a slot: Claude's under `claude` (a bound one too, though the observer fills it), the observer's own
 * (the plan mirror) under the HUD's name. */
export const widgetKey = (w: HudWidget) => `${isMirror(w) ? 'hud' : 'claude'}/${w.id}`

/** The run as it is drawn: without the widgets the person hid, so neither the lead checklist nor the strip's trend
 * (Claude's first line) can bring one back, and a hidden plan mirror takes the progress it brought (settle()); Claude's
 * own progress stays. */
export const unhidden = (r: HudRun, hidden: readonly string[]): HudRun =>
  hidden.length ? settle({ ...r, widgets: (r.widgets ?? []).filter(w => !hidden.includes(widgetKey(w))) }) : r

/** The run's widgets seen as slots: Claude's from sender `claude` (key `claude/<id>`; a bound widget is Claude's, though
 * the observer fills it), the observer's own (the plan mirror) from `hud` (key `hud/<id>`); pattern = type, `n` = the
 * widget's `n`. A mirror kept but not drawn is no slot. */
export function claudeSlots(r: HudRun | null): HudHeld[] {
  if (!r) return []
  const lead = leadList(r)
  return (r.widgets ?? []).filter(w => typeof w.id === 'string' && (!isMirror(w) || w === lead)).map(w => ({
    v: 1, id: w.id, pattern: w.type, title: w.title ?? w.id, value: w.value, unit: w.unit, min: w.min, max: w.max, delta: w.delta,
    better: w.better, tone: w.tone, items: w.items, points: w.points, rows: w.rows, text: w.text,
    from: isMirror(w) ? 'hud' : 'claude', at: w.at ?? 0, n: w.n,
  }))
}

// Recency in main-loop calls, so the same calls rank the same however long they took; a slot from before `n` reads as just now.
const age = (s: HudHeld, calls: number) => Math.max(0, calls - (s.n ?? calls))
const SEVERITY: Record<HudTone, number> = { bad: 3, warn: 2, info: 1, accent: 1, good: 0.5 }

/** score = severity(tone) × 0.5 ^ (calls since change / 12) + 0.5 × hint; severity bad 3, warn 2,
 * info/accent/none 1, good 0.5. */
export function score(s: HudHeld, calls: number): number {
  return (s.tone ? SEVERITY[s.tone] : 1) * 0.5 ** (age(s, calls) / 12) + 0.5 * (s.hint ?? 0)
}

const changed = (s: HudHeld, calls: number) => {
  const n = age(s, calls)
  return `Changed ${n === 0 ? 'just now' : `${n} call${n === 1 ? '' : 's'} ago`} · ${s.tone ?? 'no tone'}`
}

/** Order: pinned (pin order), Claude's focus (its order), the mode's slots (the mode's order), then score; ties by
 * declaration order, then key. Hidden keys never appear (muted senders' slots never reach it). */
export function rank(slots: HudHeld[], o: { mode: ModeName; focus: string[]; prefs: Prefs; calls: number; order: (s: HudHeld) => number }): Placed[] {
  const byKey = new Map(slots.filter(s => !o.prefs.hidden.includes(keyOf(s))).map(s => [keyOf(s), s]))
  const out: Placed[] = []
  const take = (keys: string[], why: string) => {
    for (const key of keys) {
      const slot = byKey.get(key)
      if (slot) out.push({ key, slot, why }), byKey.delete(key)
    }
  }
  take(o.prefs.pinned, PINNED)
  take(o.focus, FOCUS)
  take(MODES[o.mode]?.slots ?? [], `${o.mode[0]!.toUpperCase()}${o.mode.slice(1)} mode`)
  const scored = [...byKey.values()].map(s => ({ s, score: score(s, o.calls) }))
    .sort((a, b) => b.score - a.score || o.order(a.s) - o.order(b.s) || (keyOf(a.s) < keyOf(b.s) ? -1 : 1))
  // the hint says so only where it lifted the slot above one that has none
  // simplification: each scans the ones below it (quadratic); a board holds a few dozen slots at most
  scored.forEach(({ s, score: mine }, i) => {
    const lifted = (s.hint ?? 0) > 0 && scored.slice(i + 1).some(t => !t.s.hint && mine - 0.5 * s.hint! < t.score)
    out.push({ key: keyOf(s), slot: s, why: lifted ? `Hinted by ${s.from}` : changed(s, o.calls) })
  })
  return out
}

/** The urgency place's slot (hooks/urgency.ts) says so, and comes after the pins only: the person outranks the rules. */
export function urgentFirst(placed: Placed[], urgent: { key: string; says: string } | null | undefined): Placed[] {
  const at = placed.findIndex(p => p.key === urgent?.key)
  if (!urgent || at < 0 || placed[at]!.why === PINNED) return placed
  const rest = placed.filter((_, i) => i !== at), pins = rest.filter(p => p.why === PINNED).length
  return [...rest.slice(0, pins), { ...placed[at]!, why: `Urgent: ${urgent.says}` }, ...rest.slice(pins)]
}

// A slot that left the strip waits this many boundaries before it may come back, unless it changed since: so nothing
// leaves and returns within 3 boundaries without a change of its own.
export const WAIT = 3

/**
 * The strip at a boundary: `pick` chooses its keys (svg.ts stripSlots()) from the ranked board, less what waits. What
 * the person pinned, or brought back (`back`, an unmute), never waits.
 */
export function nextArrangement(prev: Arrangement | undefined | null, placed: Placed[], pick: (candidates: Placed[]) => string[], now: number, back: string[] = []): Arrangement {
  const b = (prev?.boundaries ?? 0) + 1, away = { ...prev?.away }
  const of = (k: string) => placed.find(p => p.key === k)
  const waits = (p: Placed) => {
    const gone = away[p.key]
    return gone !== undefined && p.why !== PINNED && !back.includes(p.key) && b - gone.b <= WAIT && gone.at === p.slot.at
  }
  const strip = pick(placed.filter(p => !waits(p)))
  for (const k of prev?.strip ?? []) if (!strip.includes(k)) away[k] = { b, at: of(k)?.slot.at }
  for (const [k, gone] of Object.entries(away)) if (strip.includes(k) || b - gone.b > WAIT) delete away[k]
  return { strip, why: Object.fromEntries(strip.map(k => [k, of(k)!.why])), at: now, boundaries: b, away }
}
