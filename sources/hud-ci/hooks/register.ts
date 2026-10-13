import type { Register } from 'claude-code'

// The CI source: after a push, the latest GitHub Actions run of the current branch, followed until it finishes, sent
// to the HUD as one slot (`hud-ci/run`). Everything lives inside `register`, because a test loads this function as an
// inline plugin and an inline plugin is self-contained. Every call it makes is caught: a source never throws into its
// own hooks, and a missing `gh`, one that isn't signed in, a folder with no branch or a HUD that refuses means the
// slot goes and nothing is said.
export const register: Register = on => {
  const declaration = {
    v: 1 as const,
    name: 'CI',
    access: "Runs `git branch --show-current` and the GitHub CLI (`gh run list`) for this repository's branch after you push or run `gh pr`. Needs `gh` signed in; reads the branch name and run status only.",
    slots: [{ id: 'run', pattern: 'stat' as const, title: 'CI' }],
  }
  const POLL = 30_000
  const CAP = 20 * 60_000 // follows a run this long at most
  const WAIT = 2 * 60_000 // a push's own run is expected within this; none by then (no CI here) and it stops
  // GitHub stamps a run with its own clock and this machine's may differ; a run counts as the command's if it was created
  // after the command began, less this. simplification: a push a minute after another can show the first one's run until its
  // own appears, and a gh pr command a minute after a run takes that run as newer (shown again, unchanged)
  const SKEW = 60_000

  // simplification: words, not a shell parser, and no pattern that can backtrack (this runs before the person's own command
  // does): the command is cut into steps and each step walked word by word, so a command built to stall a pattern
  // costs only its length. 'push' is a step that is `git push` (global options before the verb; after env assignments,
  // a path or a subshell), 'pr' one that is `gh pr`; a miss only means no watch.
  const kind = (command: string) => {
    let found = ''
    for (const step of command.split(/&&|\|\||[;|\n]/)) {
      const w = step.replace(/^[\s(&]+/, '').split(/\s+/)
      let i = w.findIndex(x => !/^\w+=/.test(x))
      const program = (w[i] ?? '').split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.exe$/, '')
      if (program === 'gh' && w[i + 1] === 'pr') found = 'pr'
      if (program === 'git') {
        for (i++; w[i]?.startsWith('-'); i++) if (w[i] === '-C' || w[i] === '-c') i++ // these two take the next word
        if (w[i] === 'push') return 'push'
      }
    }
    return found
  }

  // `gh run list --json status,conclusion,name,createdAt` → its newest run ([] when there is none), or undefined
  // when it isn't that at all.
  const parse = (out: string) => {
    try {
      const list: unknown = JSON.parse(out)
      if (!Array.isArray(list)) return undefined
      if (list.length === 0) return []
      const r: unknown = list[0]
      if (typeof r !== 'object' || r === null) return undefined
      const { status, conclusion, name, createdAt } = r as Record<string, unknown>
      const at = Date.parse(String(createdAt))
      if (typeof status !== 'string' || Number.isNaN(at)) return undefined
      return [{ status, conclusion: typeof conclusion === 'string' ? conclusion : '', name: typeof name === 'string' && name ? name : 'Workflow run', at }]
    } catch { return undefined }
  }

  // The words are GitHub's own conclusions, not a guess: only success is passed, only a failure of the run itself is
  // failed; cancelled, skipped, neutral and the rest are named as they are.
  const slotOf = (r: { status: string; conclusion: string; name: string }, branch: string) => {
    const [value, tone] = r.status === 'in_progress' ? ['running', 'info' as const]
      : r.status !== 'completed' ? ['queued', 'info' as const]
      : r.conclusion === 'success' ? ['passed', 'good' as const]
      : ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion) ? ['failed', 'bad' as const]
      : [r.conclusion.replaceAll('_', ' ') || 'ended', 'warn' as const]
    return { v: 1 as const, id: 'run', pattern: 'stat' as const, title: 'CI', value, tone, note: `${r.name} on ${branch}` }
  }

  // The watch under way (a timer, or none). Two pushes can come while the first one's branch is still being read, and a
  // poll can be waiting on gh when the next push comes, so whose turn it is lives in this one variable: a watch ends
  // another's in the same breath it registers itself (no await between), and a poll that finds it isn't the one
  // watching drops what it learned. A reload resets it, and takes the timer with it.
  let watching: { cancel: () => void } | undefined

  // try/catch, not .catch on the call: a call that throws before it returns a promise gets past a .catch (SOURCES.md)
  on('session.start', async ($, e, next) => {
    try { await $.hud.declare(declaration) } catch { /* the HUD isn't answering */ }
    // a reload mid-run leaves the HUD holding a run nothing now watches
    try { await $.hud.clear({ id: 'run' }) } catch { /* nor here */ }
    return next(e)
  })

  // the session over, nothing is left asking gh
  on('session.end', async ($, e, next) => {
    watching?.cancel()
    watching = undefined
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const what = e.tool === 'Bash' || e.tool === 'PowerShell' ? kind(e.command) : ''
    // while a watch is live only a push restarts it: `gh pr view`, `checks`, `status` and the rest leave it be, and
    // it follows the branch's latest run all the same. With none live, a gh pr command starts one.
    if (!what || (what === 'pr' && watching)) return next(e)
    // when the command began, to tell this push's run from an older one
    const began = await $.clock.now()
    const ran = await next(e)
    // a push that failed or was denied made no run
    if (ran.deny !== undefined || ran.isError === true) return ran
    const b = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 2000 }).catch(() => undefined)
    const branch = b?.exitCode === 0 ? b.stdout.trim() : ''
    if (what === 'pr' && watching) return ran // a push began a watch while this command ran
    // The newest push is the one followed. The old watch ends and the new one registers with no await between.
    watching?.cancel()
    watching = undefined
    if (branch) {
      let sent = '' // what the HUD was last sent, so an unchanged run isn't pushed again (a push is a change to the HUD)
      // A push's watch owns the slot from the start. A gh pr command's owns it only once it shows a run GitHub created
      // since the command began, a newer one (`gh pr create` makes one): until then the result before it stays, whatever
      // gh answers.
      let owns = what === 'push'
      const timer = $.clock.every(POLL, async () => {
        const elapsed = (await $.clock.now()) - began
        const got = await $.process.run(['gh', 'run', 'list', '--branch', branch, '--limit', '1', '--json', 'status,conclusion,name,createdAt'], { timeoutMs: 15_000 }).catch(() => undefined)
        if (watching !== timer) return // a newer push, or the session's end, came while gh was answering
        const runs = got?.exitCode === 0 ? parse(got.stdout) : undefined
        const mine = runs?.find(r => r.at >= began - SKEW)
        const finished = mine?.status === 'completed'
        if (runs === undefined || (!mine && elapsed >= WAIT) || (mine && !finished && elapsed >= CAP)) {
          timer.cancel()
          watching = undefined
          if (owns) await $.hud.clear({ id: 'run' }).catch(() => undefined)
        } else if (mine) {
          const slot = slotOf(mine, branch)
          if (JSON.stringify(slot) !== sent) sent = (await $.hud.push(slot).catch(() => undefined))?.ok ? JSON.stringify(slot) : ''
          owns ||= sent !== ''
          if (finished) {
            timer.cancel()
            if (watching === timer) watching = undefined
          }
        }
      })
      watching = timer
    }
    // A push starts fresh: the old result goes. (No branch to follow, a detached head, no repository or no git: nothing
    // to say either.) A gh pr command never takes it away.
    if (what === 'push') await $.hud.clear({ id: 'run' }).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e)) // a fault here never costs the call
}
