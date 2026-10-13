# HUD source: git

Shows the session's git branch in the [HUD](../../README.md), with how many files changed and how far the branch
is ahead of or behind its upstream.

| Branch | Note |
|---|---|
| `feat/x` | 3 files changed · 2 ahead |

It sends the HUD one slot, `hud-git/branch`, a stat: the branch name is the value and the note says the rest.

## What it shows

- **The branch** as the value. On a detached head it reads `detached 1a2b3c4`. A name longer than 24 characters is
  cut with `…`, and the note then ends with the whole name, after the counts (the HUD cuts a note at 120 characters
  from the end, so a long name can never push the counts out).
- **Files changed**: changed, renamed, unmerged and untracked files, counted as `git status` lists them (an untracked
  folder is one). Ignored files are not counted. With none it says `clean`.
- **Ahead and behind** its upstream (`2 ahead`, `1 behind`), only when the branch has an upstream and the count is
  above 0. With no upstream the note leaves them out, because it doesn't know them.
- **Nothing** when the folder isn't a git repository, git isn't installed or `git status` takes more than 2 seconds.
  The slot is taken away and nothing is said.

It reads at session start and after each finished Bash or PowerShell command that runs `git` (`git commit`,
`cd app && git switch main`, `git -C ../other pull`). It doesn't poll, so a change made outside Claude shows at the
next git command.

## What it can access

Its access line, as the HUD shows it beside the slot and in `/hud sources`:

> Runs `git status` in the session's folder at session start and after git commands. Reads the branch and counts; never file contents.

To check it yourself, run `claude plugin validate sources/hud-git`, which lists the hooks and calls:
`$.process.run`, and the `$.hud` calls to declare, push and clear its slot.

- It runs one command, `git status --porcelain=v2 --branch`, in the session's folder, with a 2-second limit.
  `GIT_OPTIONAL_LOCKS=0` is set so reading never takes git's index lock. The `$.process.run` call runs git with
  repository hooks off.
- It reads the branch and the number of ahead, behind and changed entries from the output. File names, paths and
  contents are never kept or sent: only the branch name and counts reach the HUD.
- It makes no network request and writes no file.
- Every call is caught. If the HUD refuses a slot or git fails, the source does nothing and the tool call it
  followed returns as it would have.

## Install

It needs the HUD plugin, and doesn't load without it. In Claude Code:

```
/plugin install hud --marketplace kyledarling-io/claude-code-desktop-hud
/plugin install hud-git --marketplace kyledarling-io/claude-code-desktop-hud
```

Or in the Claude Desktop app, add the marketplace as the [README](../../README.md#install) says and install **hud-git**
beside **hud**.

It works where Claude Code lets a plugin run a process. That isn't confirmed in the desktop app yet. Where it can't
run one, it says nothing and the HUD shows no branch.

## Mute it

`/hud mute hud-git` hides the branch from the strip and the dashboard, now and in later sessions. `/hud unmute hud-git`
brings it back. `/hud sources` lists every source by name.

## Develop

`claude plugin validate sources/hud-git` checks the manifest and hooks. Its tests, `hooks/git.test.ts`, load it beside
the HUD as another plugin would be and answer `$.process` themselves, so they need no repository and run with the
rest from the repo root: `claude plugin test .`.

The hooks module is one `register` function with everything inside it, because a test loads it as an inline plugin
and an inline plugin is self-contained.
