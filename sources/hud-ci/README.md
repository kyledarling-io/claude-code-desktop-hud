# HUD source: CI

Shows whether the GitHub Actions run for your branch is running, passed or failed, in the
[HUD](../../README.md), from the moment you push until it finishes.

| CI | Note |
|---|---|
| `running` | Build and test on feat/x |

It sends the HUD one slot, `hud-ci/run`, a stat. The value is `running`, `passed` or `failed`, with a tone to match
(info, good, bad), and the note names the workflow and the branch.

## What it shows

- **`running`** while the run is in progress, **`queued`** while it waits.
- **`passed`** when it concluded `success`, **`failed`** when it concluded `failure`, `timed_out` or
  `startup_failure`.
- Any other end is named as GitHub names it (`cancelled`, `skipped`, `action required`), in the warning tone. It is
  neither passed nor failed.
- **Nothing** when there is nothing true to say: `gh` isn't installed or signed in, the folder has no branch (a
  detached head, no repository) or the branch has no run of this push's. After a push the slot is taken away and
  nothing is said; after a `gh pr` command the last result stays as it was.

## When it looks

After a finished Bash or PowerShell command that is a `git push` (also `git -C dir push`, in a chain, with options) or
a `gh pr` command. It reads the session folder's repository, so a push from another folder follows the session
folder's branch. A push that failed starts nothing. The command is read word by word, by no pattern that can
backtrack, so a long or odd command costs no more than its length.

1. It reads the branch name once, with `git branch --show-current`.
2. Every 30 seconds it asks GitHub for that branch's latest run.
3. It shows the run only if GitHub created it after the command began (less a minute for clock difference), so last
   night's run is never shown as this push's. Where no such run appears within 2 minutes, which is a repository with
   no CI, it stops, and after a push the slot stays empty.
4. It stops when the run finishes, and the result stays until your next push. A run still going after 20 minutes is
   let go and the slot is taken away, rather than left saying `running`.

A second push ends the first watch and follows the new one. While a watch is live only a push restarts it: `gh pr
view`, `checks`, `status`, `create` and the rest leave it be (it follows the branch's latest run all the same). With
no watch live, any `gh pr` command starts one, which never takes the last result away: only a run GitHub created since
the command began, a newer one (`gh pr create` makes one), replaces it. Only a push starts fresh. The session ending
ends the watch.

## What it can access

Its access line, as the HUD shows it beside the slot and in `/hud sources`:

> Runs `git branch --show-current` and the GitHub CLI (`gh run list`) for this repository's branch after you push or run `gh pr`. Needs `gh` signed in; reads the branch name and run status only.

To check it yourself, run `claude plugin validate sources/hud-ci`, which lists the hooks and calls: `$.process.run`,
`$.clock.every` and `$.clock.now`, and the `$.hud` calls to declare, push and clear its slot.

- It runs two commands, each by its argument list and with no shell: `git branch --show-current` (2-second limit) and
  `gh run list --branch <branch> --limit 1 --json status,conclusion,name,createdAt` (15-second limit). The branch is
  one argument, never parsed by a shell.
- `gh run list` uses the GitHub CLI's own sign-in to ask GitHub for run status over the network. The source holds no
  token and reads no secret.
- It keeps the run's status, conclusion, workflow name and creation time to decide what to show, and sends the HUD the
  state, the workflow name and the branch name. It reads no log, job or commit.
- It writes no file.
- Every call is caught. If the HUD refuses a slot or `gh` fails, the source does nothing and the tool call it followed
  returns as it would have.

## Install

It needs the HUD plugin, and doesn't load without it. It also needs the [GitHub CLI](https://cli.github.com/)
signed in (`gh auth status`). In Claude Code:

```
/plugin install hud --marketplace kyledarling-io/claude-code-desktop-hud
/plugin install hud-ci --marketplace kyledarling-io/claude-code-desktop-hud
```

Or in the Claude Desktop app, add the marketplace as the [README](../../README.md#install) says and install **hud-ci**
beside **hud**.

It works where Claude Code lets a plugin run a process. That isn't confirmed in the desktop app yet. Where it can't
run one, it says nothing and the HUD shows no CI.

## Mute it

`/hud mute hud-ci` hides the run from the strip and the dashboard, now and in later sessions. `/hud unmute hud-ci` brings it
back. `/hud sources` lists every source by name. Muting hides the slot; the source still asks `gh` after a push.
Uninstall it to stop that.

## Develop

`claude plugin validate sources/hud-ci` checks the manifest and hooks. Its tests, `hooks/ci.test.ts`, load it beside the
HUD as another plugin would be, answer `$.process` themselves and move the clock by hand, so they need no `gh`, no
network and no secret, and run with the rest from the repo root: `claude plugin test .`.

The hooks module is one `register` function with everything inside it, because a test loads it as an inline plugin
and an inline plugin is self-contained.
