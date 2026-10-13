import type { HudHeld, HudRun } from '../types'
import { isMirror } from './lifecycle'

// The person's pins and hides: pinned slots stay first, in pin order; hidden ones never show.
// Kept by slot key in $.store (`prefs`) and mirrored in $.state. A key is in one list at most, and only the person
// writes them: Claude can only focus (hooks/modes.ts).
export type Prefs = { pinned: string[]; hidden: string[] }
export const NO_PREFS: Prefs = { pinned: [], hidden: [] }

// Prefs as the store hands them back: only strings count, and a key is in one list at most.
export function prefsOf(raw: unknown): Prefs {
  const list = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && k !== ''))] : [])
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as { pinned?: unknown; hidden?: unknown }
  const pinned = list(o.pinned)
  return { pinned, hidden: list(o.hidden).filter(k => !pinned.includes(k)) }
}

// What a person or Claude can name: every slot held, then the run's widgets under the keys the ranker gives them
// (Claude's are claude/<id>, a bound one too, though the observer fills it; the plan mirror is hud/plan).
export const keysOf = (r: HudRun | null, held: Record<string, HudHeld>): string[] =>
  [...new Set([...Object.keys(held), ...(r?.widgets ?? []).map(w => `${isMirror(w) ? 'hud' : 'claude'}/${w.id}`)])]

const SHOWN = 20
export const keyList = (keys: string[]) => keys.slice(0, SHOWN).join(', ') + (keys.length > SHOWN ? ', …' : '')
const find = (keys: string[], typed: string) => keys.find(k => k === typed) ?? keys.find(k => k.toLowerCase() === typed.toLowerCase())

// /hud pin|unpin|hide|unhide <key>: what it did, in one sentence; or, for a key that isn't held, the keys that are.
// A key that has gone (its run ended) can still be unpinned or unhidden, as the lists hold it.
export function prefsCommand(prefs: Prefs, sub: 'pin' | 'unpin' | 'hide' | 'unhide', key: string, known: string[]): { prefs: Prefs; text: string } {
  const typed = key.trim()
  if (sub === 'pin' || sub === 'hide') {
    const k = find(known, typed)
    if (!k) return { prefs, text: !known.length ? `No slots to ${sub} yet.` : typed ? `No slot "${typed}". Name one of: ${keyList(known)}.` : `Name a slot to ${sub}: ${keyList(known)}.` }
    const [mine, other] = sub === 'pin' ? [prefs.pinned, prefs.hidden] : [prefs.hidden, prefs.pinned]
    if (mine.includes(k)) return { prefs, text: `${k} is already ${sub === 'pin' ? 'pinned' : 'hidden'}.` }
    const was = other.includes(k)
    return sub === 'pin'
      ? { prefs: { pinned: [...prefs.pinned, k], hidden: prefs.hidden.filter(x => x !== k) }, text: `Pinned ${k}: it stays first${was ? ', and is no longer hidden' : ''}.` }
      : { prefs: { pinned: prefs.pinned.filter(x => x !== k), hidden: [...prefs.hidden, k] }, text: `Hid ${k}${was ? ' (it was pinned)' : ''}: /hud unhide ${k} brings it back.` }
  }
  const [list, state] = sub === 'unpin' ? [prefs.pinned, 'pinned'] : [prefs.hidden, 'hidden']
  if (!typed) return { prefs, text: list.length ? `Name one to ${sub}: ${keyList(list)}.` : `Nothing is ${state}.` }
  const k = find(list, typed)
  if (!k) return { prefs, text: `${typed} isn't ${state}.` }
  return sub === 'unpin'
    ? { prefs: { pinned: prefs.pinned.filter(x => x !== k), hidden: prefs.hidden }, text: `Unpinned ${k}.` }
    : { prefs: { pinned: prefs.pinned, hidden: prefs.hidden.filter(x => x !== k) }, text: `${k} is shown again.` }
}

// "Pinned: a, b" and "Hidden: c" for /hud and the pane; nothing when there are none.
export const prefsLines = (p: Prefs): string[] =>
  [p.pinned.length > 0 && `Pinned: ${p.pinned.join(', ')}`, p.hidden.length > 0 && `Hidden: ${p.hidden.join(', ')}`].filter((l): l is string => typeof l === 'string')
