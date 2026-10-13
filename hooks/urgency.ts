import type { PluginState } from 'claude-code'

import type { HudHeld } from '../types'

// The urgency place: the one slot that leads the strip, raised by the HUD's own rules over the
// HUD's own slots. `from` is the host's word for who sent a slot, so no outside plugin can raise one, whatever its tone
// or hint. It shows at once and holds until the next boundary after its rule stops holding, so it never flickers.
export type Urgent = NonNullable<PluginState['hud']['urgent']>

const LIMIT = 85, FAILS = 3, CONTEXT = 85
const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

// First rule first. Each reads one slot of the HUD's own and says what it found, or nothing.
const RULES: { rule: Urgent['rule']; key: string; says: (s: HudHeld) => string | undefined }[] = [
  // the window's name is the slot's title; "resets in 40m" is what its note gives after the percentage
  { rule: 'U1', key: 'hud/limits', says: s => {
    const v = num(s.value), reset = s.note?.split('; ').slice(1).join('; ')
    return v !== undefined && v >= LIMIT ? `${s.title} ${v}%${reset ? `; ${reset}` : ''}` : undefined
  } },
  { rule: 'U2', key: 'hud/failing', says: s => {
    const top = s.items?.[0] // the worst run leads the list
    return top && (top.value ?? 0) >= FAILS ? `${top.label} failed ${top.value} times in a row` : undefined
  } },
  // the tests source publishes its failed counts as the slot's points, so the one before the last is the previous run
  { rule: 'U3', key: 'hud/tests', says: s => {
    const v = num(s.value)
    return v !== undefined && v > 0 && s.points?.at(-2) === 0 ? `Tests: ${v} failed (were passing)` : undefined
  } },
  { rule: 'U4', key: 'hud/context', says: s => {
    const v = num(s.value)
    return v !== undefined && v >= CONTEXT ? `Context ${v}%; compaction is near` : undefined
  } },
]

/**
 * The urgency now, given the slots shown, the one standing and the boundaries passed (`run.boundaries`). The first rule
 * that holds takes the place at once if it is the standing one's rule or an earlier one. When the standing one's rule
 * has stopped, it stays (with `heldTo`, the count that ends it) until the count moves, saying its slot's note as it is
 * now rather than the state that raised it; a later rule waits for it. A hold ends with its slot, too. `since` is the
 * count when it began. A count that went back (a new run) ends a hold as well.
 */
export function urgentNow(held: HudHeld[], prev: Urgent | undefined, boundaries: number): Urgent | undefined {
  const own = new Map(held.filter(s => s.from === 'hud').map(s => [`hud/${s.id}`, s]))
  const hit = RULES.flatMap(({ rule, key, says }) => {
    const text = own.has(key) ? says(own.get(key)!) : undefined
    return text ? [{ key, says: text, rule }] : []
  })[0]
  // 'U1' < 'U2' < 'U3' < 'U4': the rules' order
  if (hit && (!prev || hit.rule <= prev.rule)) return { ...hit, since: prev?.rule === hit.rule ? prev.since : boundaries }
  if (!prev) return undefined
  // Held, it keeps its place but never claims the state that raised it, which has passed: it says what its slot says
  // now. With the slot gone (cleared, or its source muted) there is nothing to say, and the hold ends.
  const live = own.get(prev.key), heldTo = prev.heldTo ?? boundaries + 1
  return live && boundaries === heldTo - 1 ? { ...prev, says: live.note ?? live.title, heldTo } : hit && { ...hit, since: boundaries }
}

/** What `strip()` takes: the slot as held, which it leaves out of the rest by identity and takes the tone of, and what to say; nothing once the slot is gone. */
export function urgentFor(held: HudHeld[], u: Urgent | undefined) {
  const slot = u && held.find(s => `${s.from}/${s.id}` === u.key)
  return u && slot ? { slot, says: u.says } : undefined
}
