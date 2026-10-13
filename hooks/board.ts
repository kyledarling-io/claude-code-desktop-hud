import type { HudDeclaration, HudHeld } from '../types'
import * as agents from './sources/agents'
import * as meter from './sources/meter'
import * as testRuns from './sources/tests'
import * as toolSignals from './sources/tools'

// The slots in their declared order, which the ranker breaks ties by: the HUD's own first, the ones that most need
// seeing first, then each plugin's in the order it declared them, plugins in the order they declared.
export const OWN = ['tests', 'failing', 'agents', 'agents-running', 'limits', 'context', 'cost', 'edited', 'fetched']
export const inOrder = (held: Record<string, HudHeld>, decls: Record<string, HudDeclaration>): HudHeld[] => {
  const senders = ['hud', ...Object.keys(decls)]
  const place = (s: HudHeld) => [senders.indexOf(s.from), s.from === 'hud' ? OWN.indexOf(s.id) : decls[s.from]?.slots.findIndex(d => d.id === s.id) ?? 0]
  return Object.values(held).sort((a, b) => { const [p = 0, q = 0] = place(a), [x = 0, y = 0] = place(b); return p - x || q - y })
}

// Who sends, as the person sees and mutes them: the HUD's own four by name, then each plugin
// that declared itself.
export type Source = { key: string; name: string; access: string; from: string; ids: string[]; slots: string[] }
export const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-')
export const sourcesOf = (decls: Record<string, HudDeclaration>): Source[] =>
  [...[testRuns.declaration, toolSignals.declaration, meter.declaration, agents.declaration].map(d => ['hud', d] as const), ...Object.entries(decls)].map(([from, d]) => ({
    key: from === 'hud' ? `hud:${slug(d.name)}` : from, name: d.name, access: d.access, from, ids: d.slots.map(s => s.id), slots: d.slots.map(s => s.title),
  }))
export const isMuted = (s: HudHeld, list: Source[], off: readonly string[]) => list.some(src => off.includes(src.key) && src.from === s.from && src.ids.includes(s.id))

// /hud sources, /hud mute <name>, /hud unmute <name>: a plugin by its name, the HUD's own by theirs ("test results").
export const whose = (s: Source) => (s.from === 'hud' ? 'HUD' : `from ${s.from}`)
export const typed = (s: Source) => (s.from === 'hud' ? slug(s.name) : s.key)
