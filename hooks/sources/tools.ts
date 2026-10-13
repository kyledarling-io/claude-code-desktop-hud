import type { PluginState } from 'claude-code'

import type { Declaration, Pushes, Slot } from './contract'

// A source of tool-call signals: failing runs, files edited, sites fetched. Written as another plugin would write
// it: it reads what a tool.call hook sees and answers in slots, nothing of the HUD's own.

/** A finished tool call as a tool.call hook sees it after next(e). `failed`: refused or errored; `denied`: refused, so it
 * never ran. */
export type Call = { tool: string; input: Record<string, unknown>; failed: boolean; denied?: boolean; text?: string }

export const declaration: Declaration = {
  v: 1,
  name: 'Tool signals',
  access: 'Reads each tool call as it finishes: the names of shell commands, edited files and fetched sites, and whether the call failed. Keeps counts, never file contents.',
  slots: [
    { id: 'failing', pattern: 'list', title: 'Failing runs' },
    { id: 'edited', pattern: 'stat', title: 'Files edited' },
    { id: 'fetched', pattern: 'list', title: 'Fetched' },
  ],
}

/** failing: per command, its failures in a row and the shell runs since the last one. Kept in $.state (its shape is there). */
export type ToolsState = PluginState['hud']['toolSignals']
export const init: ToolsState = { failing: {}, edited: {}, fetched: [], fetches: 0 }

export const SHELL = ['Bash', 'PowerShell']
const MOVED_ON = 10
export const EDIT = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const MOVES = /^(cd|pushd|popd|source|\.)$/
const SETUP = /^(export|set|[A-Za-z_]\w*=\S*)$/
const PROGRAM = /^[A-Za-z][\w.-]*$/
const VERB = /^[a-z][a-z-]*$/

/**
 * The commands a shell run is known by, one per step: `cd x && npm test | tail` is `npm test`. A heredoc's body
 * is not commands, and changing folder names no run. Each step is its program and up to two verbs after it
 * (`claude plugin test`, `npm run build`, `npx tsc`).
 * simplification: words, not a shell parser; a quoted `;` splits a step, which only costs a name
 */
const before = (s: string, cut: string | RegExp) => s.split(cut)[0] ?? ''

export function heads(command: string): string[] {
  return before(command, '<<').split(/&&|\|\||;|\n/).flatMap(step => {
    // what's quoted is an argument, never a verb (a commit message, a script)
    const words = before(before(step, '|'), /["']/).trim().split(/\s+/).filter(Boolean)
    const at = words.findIndex(w => !SETUP.test(w))
    const first = words[at]
    if (first === undefined || MOVES.test(first)) return []
    const program = (first.replaceAll('\\', '/').split('/').at(-1) ?? '').replace(/\.exe$/i, '')
    const verbs = words.slice(at + 1, at + 5).filter(w => !w.startsWith('-') && VERB.test(w)).slice(0, 2)
    return PROGRAM.test(program) ? [[program, ...verbs].join(' ')] : []
  })
}

export const basename = (path: string) => path.replaceAll('\\', '/').split('/').at(-1) ?? path
export const host = (url: string) => { try { return new URL(url).hostname } catch { return undefined } }

export function observe(s: ToolsState, c: Call): { state: ToolsState } & Pushes {
  const push: Slot[] = [], clear: string[] = []
  let state = s

  // a call refused never ran: no run, so it neither fails a command nor moves the work on
  if (SHELL.includes(c.tool) && typeof c.input.command === 'string' && !c.denied) {
    // a run is known by its last step: its exit status is the one the call reports
    const name = heads(c.input.command).at(-1)
    if (name) {
      // A command stays failing until it passes, or until the work has moved on: MOVED_ON shell runs without it.
      // (Else a refused `cat` heredoc would read as failing for the rest of the session.)
      const failing: ToolsState['failing'] = {}
      for (const [h, f] of Object.entries(s.failing)) if (h !== name && f.since + 1 < MOVED_ON) failing[h] = { ...f, since: f.since + 1 }
      if (c.failed) failing[name] = { n: (s.failing[name]?.n ?? 0) + 1, since: 0 }
      state = { ...state, failing }
      const runs = Object.entries(failing).sort((a, b) => b[1].n - a[1].n)
      const [top, { n } = { n: 0 }] = runs[0] ?? []
      if (top) {
        push.push({
          v: 1, id: 'failing', pattern: 'list', title: 'Failing runs',
          note: `${top} failed ${n === 1 ? 'once' : `${n} times`} in a row`,
          items: runs.slice(0, 5).map(([label, f]) => ({ label, value: f.n, state: 'failed' as const })),
          tone: n >= 2 ? 'bad' : 'warn',
        })
      } else if (Object.keys(s.failing).length) clear.push('failing')
    }
  }

  const path = c.input.file_path ?? c.input.notebook_path
  if (EDIT.includes(c.tool) && typeof path === 'string' && !c.failed) {
    const edited = { ...s.edited, [path]: (s.edited[path] ?? 0) + 1 }
    state = { ...state, edited }
    const edits = Object.values(edited).reduce((a, b) => a + b, 0)
    push.push({ v: 1, id: 'edited', pattern: 'stat', title: 'Files edited', value: Object.keys(edited).length, unit: 'files', note: `${edits} edits; latest ${basename(path)}` })
  }

  const site = c.tool === 'WebSearch' && typeof c.input.query === 'string'
    ? `“${c.input.query.slice(0, 30)}”`
    : typeof c.input.url === 'string' && /^https?:/.test(c.input.url) ? host(c.input.url) : undefined
  if (site && !c.failed) {
    const fetched = [site, ...s.fetched.filter(f => f !== site)].slice(0, 8)
    state = { ...state, fetched, fetches: s.fetches + 1 }
    push.push({ v: 1, id: 'fetched', pattern: 'list', title: 'Fetched', note: `${state.fetches} fetches and searches`, items: fetched.map(label => ({ label })) })
  }

  return { state, push, clear }
}
