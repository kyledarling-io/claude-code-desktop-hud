import type { Register } from 'claude-code'

// The git source: the session's branch, how many files changed and how far ahead or behind, sent to the HUD as one
// slot (`hud-git/branch`). Everything lives inside `register`, because a test loads this function as an inline plugin and
// an inline plugin is self-contained. Every call it makes is caught: a source never throws into its own hooks, and
// a folder that isn't a repository, a missing git or a HUD that refuses means the slot goes and nothing is said.
export const register: Register = on => {
  const declaration = {
    v: 1 as const,
    name: 'Git',
    access: "Runs `git status` in the session's folder at session start and after git commands. Reads the branch and counts; never file contents.",
    slots: [{ id: 'branch', pattern: 'stat' as const, title: 'Branch' }],
  }
  // GIT_OPTIONAL_LOCKS=0: reading status must not take the index lock a command of Claude's or the person's may want
  const status = ['git', 'status', '--porcelain=v2', '--branch']
  const limits = { env: { GIT_OPTIONAL_LOCKS: '0' }, timeoutMs: 2000 }
  const VALUE = 24 // the HUD cuts a value here, silently; a branch name is cut with … instead

  // simplification: words, not a shell parser, and no pattern that can backtrack (this runs on every shell command): the
  // command is cut into steps and the first word of each is compared. A step that starts with git (after env
  // assignments, a path or a subshell); a miss only means the slot waits for the next git command, a false hit costs
  // one status.
  const ranGit = (command: string) =>
    command.split(/&&|\|\||[;|\n]/).some(step => {
      const w = step.replace(/^[\s(&]+/, '').split(/\s+/)
      return /^git(?:\.exe)?$/i.test(w[w.findIndex(x => !/^\w+=/.test(x))]?.split(/[\\/]/).at(-1) ?? '')
    })

  // `git status --porcelain=v2 --branch` → the slot, or undefined when the text is not status. Files are counted
  // (changed, renamed, unmerged, untracked; ignored ones are not): their names are never read out, let alone sent.
  // simplification: an untracked folder is one entry in git's own count, so it is one here
  const slotOf = (out: string) => {
    let head: string | undefined, oid = '', ab: RegExpMatchArray | null = null, files = 0
    for (const line of out.split('\n')) {
      if (line.startsWith('# branch.head ')) head = line.slice(14).trim()
      else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
      else if (line.startsWith('# branch.ab ')) ab = line.match(/\+(\d+) -(\d+)/)
      else if (/^[12u?] /.test(line)) files++
    }
    if (!head) return undefined
    const name = head === '(detached)' ? `detached ${oid.slice(0, 7)}` : head
    const long = name.length > VALUE
    // the counts first, the long name (if any) last: the HUD cuts a note at 120 characters, from the end
    const note = [
      files ? `${files} file${files === 1 ? '' : 's'} changed` : 'clean',
      // no upstream, no line: the counts it can't know are not 0
      ab && Number(ab[1]) > 0 && `${ab[1]} ahead`, ab && Number(ab[2]) > 0 && `${ab[2]} behind`,
      long && name,
    ].filter(Boolean).join(' · ')
    return { v: 1 as const, id: 'branch', pattern: 'stat' as const, title: 'Branch', value: long ? `${name.slice(0, VALUE - 1)}…` : name, note }
  }

  // what the HUD was last sent, so a status that hasn't changed isn't pushed again (a push is a change to the HUD).
  // A reload resets it, which costs one push.
  let sent = ''

  // try/catch, not .catch on the call: a call that throws before it returns a promise ($.process on a host without it,
  // which its types call CLI only) gets past a .catch (SOURCES.md)
  on('session.start', async ($, e, next) => {
    try { await $.hud.declare(declaration) } catch { /* the HUD isn't answering */ }
    const started = await next(e)
    let got
    try { got = await $.process.run(status, limits) } catch { /* no git, or no $.process here: nothing to say */ }
    const slot = got?.exitCode === 0 ? slotOf(got.stdout) : undefined
    sent = ''
    try {
      if (slot) sent = (await $.hud.push(slot)).ok ? JSON.stringify(slot) : ''
      else await $.hud.clear({ id: 'branch' })
    } catch { /* the next git command sends it again */ }
    return started
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if ((e.tool !== 'Bash' && e.tool !== 'PowerShell') || ran.deny !== undefined || !ranGit(e.command)) return ran
    const got = await $.process.run(status, limits).catch(() => undefined)
    const slot = got?.exitCode === 0 ? slotOf(got.stdout) : undefined
    if (slot) {
      if (JSON.stringify(slot) !== sent) sent = (await $.hud.push(slot).catch(() => undefined))?.ok ? JSON.stringify(slot) : ''
    } else { sent = ''; await $.hud.clear({ id: 'branch' }).catch(() => undefined) }
    return ran
  }).catch(($, e, next) => next(e)) // a fault here never costs the call
}
