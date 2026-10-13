# Changelog

Each version's section is its release notes: the Release workflow publishes it when the version's tag
is pushed.

## 2.0.0

A progress strip and dashboard for Claude Code. While Claude works on a long task, the strip above the prompt shows
the run's title and goal, its figures and a log, and **Expand** opens a full dashboard beside the conversation. The
HUD reads Claude's tool calls for what it can see for itself, starts a run on its own when a message turns into a long
task, and ranks everything on one board, saying why each figure is shown. Other plugins can send it figures through a
versioned API. It runs in the Code tab of the Claude Desktop app and in the terminal, with Claude Code 2.1.295 or later.

### The run

- A run has a title and goal, phases, progress, figures, a log and a clock. Claude builds it with the `hud` tool and
  rebuilds it when the work changes; the clock, the log and the counts carry over.
- Widgets: progress, a phase rail, figures with changes and sparklines, a grid, a trend line, counts, a countdown, a
  log, noticed facts, and gauge, ring, meter, line, bars, columns, donut, heatmap, ranked list, checklist, table and
  callout.
- The strip picks two to four items that fit the width. **Expand** opens the dashboard, **✕** hides the strip until
  the next run, and `/hud` brings it back and prints the run in full.
- Text is fitted to the room it has: a path keeps its file name, a link its site, and words are cut at a sentence or
  a word, never mid-word. The dashboard and `/hud` show it whole.
- In the terminal, the band and the pane show the same figures as lines of text, by the same rules, fitted to their
  columns without ever cutting a number to a smaller one.
- State is shown by shape as well as colour, text meets contrast in the light and dark themes, and screen readers hear
  the strip and the dashboard in words.

### It keeps itself

- **It starts itself.** When a turn becomes a long task (Claude's 8th tool call, or a minute in) and no run is going,
  a run starts, titled from your last message and drawn dim until Claude names it. Only where someone is watching,
  never from a subagent's work, and at most once a turn.
- A turn that ends without done or failed reads `waiting for you`. While background jobs are still at work it stays
  running and says so (`2 jobs running`). After 30 minutes with no turn it reads `paused`. Only Claude ends a run.
- **The log writes itself.** While a run is live, edits, failed commands, changes in the test count, fetches and
  searches, subagents starting and finishing, and compactions are logged, dim beside Claude's own lines. A line names
  a file, a command or a site, never output.
- **It dims what hasn't changed.** A figure left alone for 12 of Claude's tool calls is drawn dim with its age. At 24,
  Claude is told which ones, once; still unchanged two boundaries later, a figure leaves the board.
- **It asks little of Claude.** Claude is asked whether the HUD still fits the work only after 12 calls with no update
  and no widget filling itself, and a check left unanswered makes the next wait twice as long, up to 48 calls.

### Figures of its own

- Tests failing, read only from a test runner's own summary line (bun and `claude plugin test`, `node --test`, jest,
  vitest, pytest, mocha, cargo); files edited; commands failing in a row; sites fetched; context, cost and a usage
  limit past half.
- The subagents Claude has at work, done or failed, with background ones counted among the jobs in the header.
- Claude's task list as the plan, where Claude has a task-list tool.
- **Widgets that fill themselves.** Claude can bind a figure, gauge, ring, meter, line or callout to a shell command,
  an edited file, a fetched site, a subagent's result, the task list or the context window. Each matching call is read
  for one number: pass and fail counts, N of M, a percentage, a duration, the last number, or whether it failed. With
  nothing behind it, a widget says "no reading", never an old number.
- **Recipes.** `build`, `test-fix`, `refactor`, `migration`, `rollout`, `research` and `remote-job` lay out the
  widgets and the strip for that kind of work, and Claude binds each to the exact command it runs.

### What shows

- Claude's widgets and the sources' figures share one board, ranked: what you pinned, what Claude says matters now,
  what the mode puts first, then the rest by how bad it is and how lately it changed.
- Every figure says why it is there (`Pinned by you`, `Changed 2 calls ago · warn`, `Hinted by deploys`).
- The strip changes only at a boundary (a turn's end, a phase, a rebuild, a change of mode or focus, a pin, hide or
  mute), so it holds still while Claude works. The dashboard shows a new figure at once.
- **What's urgent** leads the strip, raised only by the HUD's own rules: a rate-limit window at 85% or more, the same
  command failing three times in a row, tests that were passing and now fail, and the context window at 85% or more.
- `/hud mode` (build, debug, review, research, plan), `/hud pin <slot>` and `/hud hide <slot>`, and their undo
  commands. Pins and hides last into later sessions, and your mode outranks Claude's.

### Sources

- Any plugin can send the HUD figures through `$.hud`. Version 1 of what a source sends is frozen: from here, changes
  only add. `SOURCES.md` is the guide, and `examples/source-template` is a working source with its test.
- Every slot is checked: plain data, declared slots only, text cut, and every control character made a space.
- The dashboard lists every source with what it says it can access. `/hud sources` lists them, and
  `/hud mute <name>` hides one.
- Two source plugins ship beside the HUD: **hud-git** (the branch, files changed, ahead and behind) and **hud-ci**
  (the branch's latest GitHub Actions run). They work where Claude Code lets a plugin run a process, and say nothing
  where it can't.

### Access and cost

- The HUD reads no files, makes no network requests, starts no processes and calls no model.
  `claude plugin validate .` lists every hook it handles and every call it makes.
- Claude gets one cached section of its system prompt (about 200 tokens) and, during a run, a note of 160 characters
  at most beside your messages. Nothing another plugin sends reaches Claude.
- Claude gets the tool only in a session someone can see: a `claude -p` run or a scheduled task spends nothing on it.

### Not yet

- The strip doesn't say when a permission prompt holds the run.
- The desktop app gives Claude no task-list tool, so the plan is idle there.
- Not yet seen in the desktop app: a source plugin running a process, the compaction log line, and how the Agent tool
  answers. Each is built from the types and tested in the test kit.
