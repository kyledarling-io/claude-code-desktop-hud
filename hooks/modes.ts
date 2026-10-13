import type { HudMode } from '../types'

// The five modes, as data: the slots each puts first, after the
// person's pins and Claude's focus. The ranker reads this; nothing else decides what a mode means.
export type ModeName = HudMode
export const MODES: Record<ModeName, { label: string; slots: string[] }> = {
  build: { label: 'Build', slots: ['hud/tests', 'hud/failing', 'hud/edited'] },
  // tests and failing runs, not context: Debug mode places context by its score (the worked example in rank.test.ts)
  debug: { label: 'Debug', slots: ['hud/tests', 'hud/failing'] },
  review: { label: 'Review', slots: ['hud/edited', 'hud/tests'] },
  research: { label: 'Research', slots: ['hud/fetched', 'hud/context'] },
  plan: { label: 'Plan', slots: ['hud/plan', 'hud/agents-running', 'hud/agents'] },
}
export const MODE_NAMES = Object.keys(MODES) as ModeName[]

// What each is for, in the words the person and Claude read (the tool's property description, and /hud mode).
export const MODE_LINES: Record<ModeName, string> = {
  build: 'writing code: tests, failing commands, edited files',
  debug: 'chasing a failure: tests, failing commands',
  review: 'reading a change: edited files, tests',
  research: 'reading and searching: sites fetched, context',
  plan: 'planning: the plan, agents running',
}

// A mode named by Claude or the person: any case, nothing else.
export const modeOf = (v: unknown): ModeName | undefined => (typeof v === 'string' ? MODE_NAMES.find(m => m === v.trim().toLowerCase()) : undefined)

// "Mode: Debug (set by you)": the person's holds for the session; a mode that isn't the default is Claude's pick.
export const modeLine = (mode: ModeName, byPerson: boolean) =>
  `Mode: ${MODES[mode].label}${byPerson ? ' (set by you)' : mode === 'build' ? '' : " (Claude's pick)"}`

// /hud mode, /hud mode <name>: no name lists the five and the current one.
export function modeCommand(arg: string, mode: ModeName, byPerson: boolean): { mode?: ModeName; text: string } {
  const name = arg.trim()
  if (!name) return { text: [modeLine(mode, byPerson), ...MODE_NAMES.map(m => `  ${m}: ${MODE_LINES[m]}`), 'Switch with /hud mode <name>.'].join('\n') }
  const m = modeOf(name)
  if (!m) return { text: `No mode "${name}". Name one of: ${MODE_NAMES.join(', ')}.` }
  return { mode: m, text: `Mode is ${MODES[m].label} for this session; Claude's mode no longer applies.` }
}

// Claude's focus: up to FOCUS_MAX slot keys that matter now. Anything but a string is junk; a repeat counts once.
export const FOCUS_MAX = 3
export const focusOf = (raw: unknown[]): string[] => [...new Set(raw.filter((k): k is string => typeof k === 'string').map(k => k.trim()).filter(Boolean))]
