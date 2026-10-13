import type { HudDeclaration, HudHeld, HudSlot, HudState, HudTone, HudWidgetType } from '../../types'

// The gate a slot passes on the way in. The slot contract itself (v1) is `types/index.d.ts`, laid into every plugin
// that depends on the HUD as `$.hud`: a source sends plain data in the HUD's own patterns, and only the HUD draws.
// The HUD's own sources are written against it as if they were someone else's.
export const VERSION = 1 as const

export const STATES: readonly HudState[] = ['todo', 'now', 'done', 'failed', 'hit', 'miss']
export const TONES: readonly HudTone[] = ['good', 'bad', 'warn', 'info', 'accent']
export const TYPES: readonly HudWidgetType[] = ['stat', 'gauge', 'ring', 'meter', 'line', 'bars', 'columns', 'donut', 'heatmap', 'list', 'checklist', 'table', 'text']

export type Slot = HudSlot
export type Declaration = HudDeclaration
export type Held = HudHeld

/** What a source asks for after one observation. */
export type Pushes = { push: Slot[]; clear: string[] }

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/
// simplification: fixed caps, sized to what the strip and the dashboard can draw; a source that needs more says so
const CAP = { title: 40, note: 120, unit: 12, value: 24, label: 40, itemNote: 60, text: 280, items: 12, points: 120, rows: 12, cols: 24 }
const MAX_SLOTS = 8

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))
// Each run of control characters is a space: C0 and C1 and DEL (Cc), the line and paragraph separators (Zl, Zp), and
// the bidi controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069), which can make text read as other text
const CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]+/gu
const str = (v: unknown, cap: number) => (typeof v === 'string' ? v.replace(CONTROLS, ' ').trim().slice(0, cap) || undefined : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const oneOf = <T>(list: readonly T[], v: unknown) => (list.includes(v as T) ? (v as T) : undefined)
const nums = (v: unknown, cap: number) => (Array.isArray(v) ? v.filter((n): n is number => num(n) !== undefined).slice(-cap) : undefined)
const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

/** A declaration as the HUD keeps it, or why it was refused. */
export function acceptDeclaration(raw: unknown): Declaration | string {
  if (!isPlain(raw)) return 'a declaration is a plain object'
  if (raw.v !== VERSION) return `speaks v${String(raw.v)}; this HUD reads v${VERSION}`
  const name = str(raw.name, CAP.title), access = str(raw.access, 200)
  if (!name || !access) return 'a declaration names itself and says what it can access'
  const slots = (Array.isArray(raw.slots) ? raw.slots : []).filter(isPlain).map(s => ({ id: str(s.id, 32), pattern: oneOf(TYPES, s.pattern), title: str(s.title, CAP.title) }))
  const ok = slots.filter((s): s is Declaration['slots'][number] => !!s.id && ID.test(s.id) && !!s.pattern && !!s.title)
  if (ok.length === 0) return 'a declaration names at least one slot: an id (a-z, 0-9, -), a pattern and a title'
  return { v: VERSION, name, access, slots: ok.filter((s, i) => ok.findIndex(o => o.id === s.id) === i).slice(0, MAX_SLOTS) }
}

/**
 * A pushed slot as the HUD holds it, or why it was refused. Unknown fields are dropped, text is cut to what can be
 * drawn, and the slot must be one its sender declared, with the declared pattern. `from` is `next.origin.plugin`:
 * the host's word for who sent it. The payload is the sender's word, and another plugin may have changed it on the
 * way (proved in the app), so nothing here treats it as more than data.
 */
export function accept(raw: unknown, from: string, decl: Declaration | undefined, now: number): Held | string {
  if (!decl) return `${from} has not declared itself`
  if (!isPlain(raw)) return 'a slot is a plain object'
  if (raw.v !== VERSION) return `speaks v${String(raw.v)}; this HUD reads v${VERSION}`
  const slot = decl.slots.find(s => s.id === raw.id)
  if (!slot) return `${from} declared no slot "${String(raw.id)}"`
  if (raw.pattern !== slot.pattern) return `"${slot.id}" is declared a ${slot.pattern}`
  const items = Array.isArray(raw.items)
    ? raw.items.filter(isPlain).map(i => defined({ label: str(i.label, CAP.label) ?? '', value: num(i.value), state: oneOf(STATES, i.state), note: str(i.note, CAP.itemNote) })).filter(i => i.label).slice(0, CAP.items)
    : undefined
  const rows = Array.isArray(raw.rows) ? raw.rows.slice(0, CAP.rows).map(r => nums(r, CAP.cols) ?? []) : undefined
  const value = num(raw.value) ?? str(raw.value, CAP.value)
  const hint = num(raw.hint)
  return defined({
    v: VERSION, id: slot.id, pattern: slot.pattern, title: str(raw.title, CAP.title) ?? slot.title,
    note: str(raw.note, CAP.note), value, unit: str(raw.unit, CAP.unit), min: num(raw.min), max: num(raw.max), delta: num(raw.delta),
    better: oneOf(['up', 'down'] as const, raw.better), tone: oneOf(TONES, raw.tone), items, points: nums(raw.points, CAP.points), rows,
    text: str(raw.text, CAP.text), hint: hint === undefined ? undefined : Math.min(1, Math.max(0, hint)),
    from, at: now,
  })
}
