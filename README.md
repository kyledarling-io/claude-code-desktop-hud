# HUD for Claude Code Desktop

<img src="docs/img/band-prompt.png" width="470" alt="The strip above the prompt during a rollout: 7 of 12 hosts, requests per second, p95 latency, the Rollout step, and a failed health check in its last line">

A progress strip for Claude Code. While Claude works on a long task (a build, a migration, a refactor, a retry loop),
the strip above the prompt shows what is going on: the run's title and goal, how many tests are failing, which files
were edited, commands that keep failing, and a log. **Expand** opens a full dashboard beside the conversation. You
don't have to ask for it, and Claude doesn't have to remember it: the HUD reads Claude's tool calls for the figures it
can see for itself, and starts a run on its own when a message turns into a long task. Claude adds what only it knows:
the title and goal, the phases, and done or failed. It runs in the Code tab of the Claude Desktop app and in the
terminal, and only where someone is watching.

## How well it keeps up

Measured by replaying a set of recorded coding sessions through the HUD's own hooks and checking the board after every
tool call; the recordings aren't published.

| | Fresh | Wrong | Zero setup | First HUD, median s | Tokens /20 prompts | Cached tokens | Churn |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2.0.0, as recorded | 82.6% | 0 | 69.2% | 73.1 | 3401.5 | 2427.5 | 0 |
| 2.0.0, stripped | 50.5% | 0 | 46.2% | 303.4 | 1704.6 | 2427.5 | 0 |

- **As recorded** replays each session as it was. **Stripped** takes out every HUD call Claude made, so it shows what
  the HUD does on its own.
- **Fresh:** of the tool calls where a fact (a test count, the files edited) had a known value, the share where the
  board showed every one.
- **Wrong:** figures the board showed that were never true.
- **Zero setup:** of the long turns (8 or more tool calls, or a minute), the share with a run on screen within 60 s.
- **First HUD:** the median seconds from a long turn's start to a run on screen.
- **Tokens /20 prompts:** the notes the HUD adds to tool results and messages, per 20 turns, at 4 characters a token.
- **Cached tokens:** the tool's description and schema and the HUD's prompt section, sent once and cached.
- **Churn:** figures that leave the strip and come back within 3 boundaries (a message, a turn's end, a phase change,
  a rebuild) without changing.

## Install

In Claude Code, one line does it: `/plugin install hud --marketplace kyledarling-io/claude-code-desktop-hud`

Or in the Claude Desktop app:

1. Open Claude Desktop and click **Customize** in the sidebar.
2. Select **Plugins**, open **Add**, then choose **Add marketplace**.
3. Choose **Add from a repository**.
4. In **URL**, paste the address below. If a picker opens, paste it into the search field and select **Use**
   for that URL. Click **Sync**.

   ```
   https://github.com/kyledarling-io/claude-code-desktop-hud
   ```

5. Find **hud** in the added marketplace and install it. Adding the marketplace alone does not install it.
6. Start a **Code** session. The HUD appears when Claude starts a long task, or ask for one.

If you don't see these controls, update Claude Desktop. On a managed account, your administrator may
control which plugins you can add. Labels may vary slightly by app version.

A new version reaches an installed copy from **Customize → Plugins**, or with `claude plugin update hud`.

## Use it

You don't have to do anything. To ask for one, say "show me a HUD while you do this."

- The strip appears above the prompt when a run starts.
- **Expand** opens the dashboard and **Collapse** closes it. It never opens by itself. While the dashboard
  is open, the strip shrinks to one line, what's running with Collapse and ✕, so the conversation keeps its
  room.
- **✕** hides the strip until the next run. `/hud` brings it back. A run that starts on its own in the same turn
  stays hidden too.
- A long title takes two lines, with the goal on its own line under it. Text that still doesn't fit is
  shortened where it says least: a path keeps its file name and a link keeps its site, then the words are
  cut at a sentence or a word, never mid-word. The dashboard shows the whole title and goal, and `/hud`
  prints them with the facts.
- When the run ends, the strip and dashboard keep the final state, marked done or failed.
- In the terminal the band and the pane are text: the same figures in the same order, each with why it is there, and
  the urgent one on a first line.

| Command | What it does |
| --- | --- |
| `/hud` | Brings back a strip you hid, and prints the run's title, goal and facts, why each figure in the strip is there, and your mode, pins and hides |
| `/hud mode`, `/hud mode <name>` | Lists the five modes (build, debug, review, research, plan) and the current one, or sets one for this session. The mode decides which figures come first. Claude can set one too, until you do: yours holds. |
| `/hud pin <slot>`, `/hud unpin <slot>` | Keeps a figure first, in this session and the next, or stops keeping it |
| `/hud hide <slot>`, `/hud unhide <slot>` | Leaves a figure out of the strip and the dashboard, in this session and the next, or brings it back |
| `/hud sources` | Lists every source of figures by name |
| `/hud mute <name>`, `/hud unmute <name>` | Hides a source's figures, in this session and the next, or brings them back (`/hud mute deploys`, `/hud mute test results`, `/hud mute agents`) |

Name a slot as `hud/tests`, `deploys/prod` or `claude/<widget id>`; a name the HUD doesn't hold is answered with the
ones it does. The dashboard ends with **Showing**, your mode, pins and hides, and **Sources**: everything that sends
the HUD figures, what each says it can access, and its figures. Claude can also name up to three figures that matter
now (its focus). Yours come before them.

## Screenshots

A rollout to 12 hosts where one host fails its health check, in the desktop app. Click an image for full size. These
captures don't show the line under each figure that says why it is there.

<table>
<tr>
<td valign="top" width="480">

**Start**<br>
<a href="docs/img/strip-1-start.png"><img src="docs/img/strip-1-start.png" width="470" alt="The strip at the start of a run: 0 of 12 hosts, Build in progress"></a>

**In progress**<br>
<a href="docs/img/strip-2-canary.png"><img src="docs/img/strip-2-canary.png" width="470" alt="The strip mid-run: 4 of 12 hosts, requests per second, p95 latency, Canary in progress"></a>

**A tool call fails**<br>
<a href="docs/img/strip-3-failure.png"><img src="docs/img/strip-3-failure.png" width="470" alt="The strip after a failed health check: retrying, 7 of 12 hosts, 1 error, p95 latency up 19 ms in red, Rollout in progress"></a>

</td>
<td valign="top">

**Dashboard (Expand)**<br>
<a href="docs/img/dashboard-failure.png"><img src="docs/img/dashboard-failure.png" width="300" alt="The dashboard pane: progress, phases, requests and latency, the host grid with ticks and crosses, counts, what was noticed, and the log"></a>

</td>
</tr>
</table>

The same HUD on a different task, a model training run, with every widget type in use. The conversation is
blurred.

<a href="docs/img/strip-4-training.png"><img src="docs/img/strip-4-training.png" width="470" alt="The strip for a training run"></a>

<a href="docs/img/window-training.png"><img src="docs/img/window-training.png" width="830" alt="The Claude Desktop window with the conversation blurred, the one-line strip above the prompt and the dashboard pane on the right"></a>

## It starts itself

You don't have to ask, and Claude doesn't have to remember. When a turn becomes a long task (Claude's eighth tool
call, or a minute in) and no run is going, the HUD starts one:

- Its title is the first line of your last message, drawn dim until Claude names the run. Claude is told once, in one
  short line, and names it with a title and goal. The log, the counts and the clock carry over.
- When a turn ends and Claude hasn't marked the run done or failed, it reads `waiting for you`, with the last log line.
  While a job Claude left running in the background (a dev server, a long build, a subagent) is still at work, it
  stays running and the header says so: `2 jobs running`.
- After 30 minutes with no turn, it reads `paused`. Your next message, or Claude's next tool call, picks it up again.
- It never finishes on its own. Only Claude marks a run done or failed.
- It starts only where you can see the strip, never from a subagent's work, and at most once a turn.

## It follows the work

The HUD changes as the work does. When the goal or the kind of work changes (you redirect Claude, the
plan changes, or one stage ends and different work starts), Claude rebuilds the dashboard for the new
work. The clock, the log and the tool-call counts carry over. The current goal shows next to the title.

To keep it current:

- If Claude makes a dozen tool calls without updating the HUD, and none of its widgets is filling itself from
  calls Claude has made, the mod asks Claude in one short line whether the HUD still fits the work. Time alone asks
  nothing. While you look at another session the reminder waits, and comes on Claude's next tool call once you're
  back. A reminder Claude doesn't act on makes the next one wait twice as long, up to 48 calls. A run the HUD
  started on its own gets no reminders until Claude names it.
- A message you send during a run reaches Claude with a one-line note of the run's goal and the ids of the
  figures the strip shows, so Claude can tell when a new direction needs a new dashboard. Beside a run the HUD started
  on its own, the note instead says so, until Claude names the run for the work at hand.
- The dashboard's header says `updated 2:10 ago` once it has gone a minute without an update while
  Claude keeps working.
- It dims what hasn't changed. A widget or figure Claude leaves alone for a dozen of its tool calls is
  drawn dim, and the dashboard says when it last changed (`3m ago`, as of Claude's last tool call). The strip shows
  fresh figures first. After two dozen calls Claude is told which ones, once, by name, with the command it ran most
  meanwhile (`your hosts stat hasn't changed in 24 calls while you ran 9 ssh commands`). One still unchanged across
  two more phase changes, rebuilds or turns leaves the board, and the log says it went. Time alone ages nothing: a
  quiet session, or a subagent's calls, leave the board as it is.

## The log writes itself

While a run is live, the HUD adds a line to the log for what Claude's own tool calls did, so the log stays
true without Claude spending words on it:

- `edited svg.ts`, or `edited svg.ts ×3` when the same file is edited in a row
- `npm test failed` when a shell command fails (a test run says its count instead)
- `tests: 3 failed` for the first test summary, and `tests: 2 failed → 0` when the count changes
- `fetched docs.anthropic.com` or `searched “query…”`
- `agent started: …`, `agent finished: …` or `agent failed: …` for a subagent
- `context compacted` (where the app reports a compaction)

These lines are dim, so you can tell them from the ones Claude writes. In the strip's last line, Claude's
newest line stays put until five of the HUD's own lines have come after it. A subagent's own calls are not logged.

## What Claude can show

| Part | What it is |
| --- | --- |
| Progress | A big percentage with a segmented bar, such as `40 of 48 hosts` |
| Phases | A step rail: done, current, to do, failed |
| Figures | Numbers with an optional change (▲ 240), green or red when Claude says which way is good, and a small trend line |
| Grid | Chips for regions, hosts or files: hit, miss, in progress, to do |
| Trend | A line chart of one value over time |
| Counts | A histogram that Claude bumps, such as error types |
| Countdown | "Next attempt in 0:30" during retries |
| Log | Timestamped lines marked ok, warning or error |
| Noticed | One to three short facts Claude derived from the run |
| Widgets | Gauge, ring, meter, line, bars, columns, donut, heatmap, ranked list, checklist, table and callout |

The strip picks two to four items that fit the width: progress, errors, the top figures, then phases
or the trend line. Claude can choose them for a run instead. Tool calls and errors are counted
automatically.

**Widgets that fill themselves.** Claude can bind a figure, gauge, ring, meter, line or callout to its own work and
leave it: a shell command (by words in its name, such as `npm test` or a script of its own), an edited file (by the end
of its path), a fetched site (by the end of its address), a subagent's result, the task list's done of total, or the
context window. A program that runs for anything (`curl`, `tail`, `ssh`, `cat`, `grep` and the like) can't be the
command: it would read every call of it, so the bind is refused and Claude is told to use a script. Each matching call is
read for one number: pass and fail counts, N of M, a percentage, a duration, the last number, or whether it failed. A
call with nothing to read counts against the widget, which dims and, after two dozen such calls, says "no reading"
instead of a number that may no longer be true. A failed call counts against "the last number" too, as the last number
of an error is a line or a code. A widget says "no reading" as well when nothing stands behind its number: before its
first reading, and after Claude rebinds or changes it without sending a value.

**Recipes.** When Claude starts a run or rebuilds it, it can name the kind of work, and the HUD lays the widgets and
the strip that work needs. It guesses no command: Claude is told which widgets to bind and how, and binds each to the
exact command it runs. Until then they say "–", never a figure. Anything Claude sends, in the same call or later,
overrides the recipe.
- `build`: the build command's exit and its last duration, with the progress Claude sends.
- `test-fix`: the HUD's own tests figure, with a point for each run, and the attempts Claude counts.
- `refactor`: the plan, files edited and the tests, all the HUD's own.
- `migration`: the phases, the last "N of M" the migration prints and the errors.
- `rollout`: the last "N of M" the deploy prints, the health check's exit and last number, and the host grid.
- `research`: the open questions Claude sends. The sources fetched are the HUD's own list in the dashboard.
- `remote-job`: the last percent and last number the job's log prints, and the countdown.

**Figures of the HUD's own.** The HUD also keeps figures of its own (tests failing, context, cost, a usage limit past
half, files edited, commands failing in a row, sites fetched, the subagents Claude has at work), and other plugins can
send theirs (see Sources). The dashboard shows each one with a line on what it means now, and the name of any other
plugin that sent it. In the strip they fill the room the run leaves, up to four items in all.

**Agents.** The HUD lists the subagents Claude starts by their descriptions (the last twelve), as at work, done or
failed, and counts those at work. One started in the background also counts among the jobs in the header. Mute it
with `/hud mute agents`. How the Agent tool answers is read from its types and not yet seen in the desktop app.

## What shows

Claude's figures and the sources' share one board, and the HUD decides what goes where, in this order:

1. what you pinned;
2. what Claude says matters now;
3. what the mode puts first (build, the default, puts tests, failing commands and edited files first);
4. the rest by how bad it is and how lately it changed: a failing test count just now beats a cost that hasn't
   moved in an hour. A plugin can say its figure matters, which counts for half a step at most.

Every figure from a source, and every widget of Claude's, says why it's there, under its title: `Pinned by you`,
`Claude's focus`, `Debug mode`, `Changed 2 calls ago · warn`, `Hinted by deploys`. (The run's own figures, its
tiles and the call count, are simply the run's.) `/hud` says it for each figure in the strip, as it is now.

The dashboard shows a new figure at once. The strip changes only when a turn ends, a phase moves, a run starts
or is rebuilt, Claude changes its mode or focus, or you pin, hide, mute or switch the mode, so it doesn't flicker
while Claude works. A first error or a new figure of the run's own takes a place in the strip then too, unless one
is free. A figure that leaves the strip doesn't come back within three of those unless it changed, or you pinned it
or brought it back. What you hide never shows, in the strip or the dashboard.

**What's urgent** leads the strip, in front of everything else, one at a time. Only the HUD's own rules raise it, over
its own figures: a rate-limit window at 85% or more (`5-hour limit 88%; resets in 40m`), the same command failing three
times in a row, tests that were passing and now fail (`Tests: 2 failed (were passing)`), and the context window at 85%
or more. It stays until the next turn's end or phase change after its cause is gone, saying what its figure says now.
No other plugin can raise it, and nothing it says reaches Claude.

## Sources

A source is a plugin that sends the HUD figures of its own: a deploy's state, a queue's length, the last build. It
sends plain data through `$.hud`; the HUD checks it, ranks it and draws it, and shows the source's name and what it
says it can access beside its figures. [SOURCES.md](SOURCES.md) is the guide to writing one: the three calls, what the
HUD accepts, how it ranks what it gets, and what you see and can mute. [examples/source-template](examples/source-template)
is a working source with its test. Version 1 of what a source sends is frozen at 2.0.0: from here, changes only add.

Two source plugins ship in this repository, each its own install beside **hud** (it doesn't load without it):

| Plugin | Shows | It runs |
| --- | --- | --- |
| [**hud-git**](sources/hud-git/README.md) | The branch, files changed, ahead and behind, from session start and after each git command | `git status --porcelain=v2 --branch` |
| [**hud-ci**](sources/hud-ci/README.md) | Whether your branch's GitHub Actions run is running, passed or failed, after a push or a `gh pr` command | `git branch --show-current`, then `gh run list` every 30 s until the run ends |

`/plugin install hud-git --marketplace kyledarling-io/claude-code-desktop-hud` (and `hud-ci`). Each says what it can
access in its own README and in the dashboard's Sources list, and `/hud mute hud-git` or `/hud mute hud-ci` hides its
figure. These two are the only parts of this repository that run commands: the HUD itself still starts no processes.
They work where Claude Code lets a plugin run a process, which isn't confirmed in the desktop app yet. Where they
can't run one, or `gh` isn't signed in, they say nothing.

## What it can access

A mod runs inside Claude Code with your permissions, so here is everything this one does. `claude plugin validate .`
lists every event it handles (`hooks:`) and every call it makes (`calls:`). For 2.0.0 they are (wrapped here, and
without its notes on which function makes each call):

```
hooks: engine.create, hud.declare, hud.push, hud.clear, session.attach, session.start, command.run{command=hud},
       ui.close, ui.render{component=AbovePrompt}, tool.call, turn.complete, session.measure, session.compact,
       prompt.submit, prompt.compose, ui.render{component=Pane, requestId=hud}
calls: $.clock.every, $.clock.now, $.command.register, $.session.surfaces, $.state.get, $.state.set, $.store.get,
       $.store.set, $.tool.register, $.ui.close, $.ui.invalidate, $.ui.open, $.ui.panes, $.ui.resolve
```

What it registers and draws:

- the `/hud` command, and one tool Claude calls to update the HUD, offered once the session is shown in the terminal
  or the desktop app (`session.start`, `session.attach`). It reads which screens the session is shown on
  (`$.session.surfaces`) to offer the tool and its notes only there.
- the strip above the prompt and the dashboard pane (`ui.render`). It opens and closes the pane when you press Expand
  or Collapse, reads which panes the app's dock shows to tell whether the dashboard is open (`$.ui.panes`), and notes
  when you close it (`ui.close`).
- a once-a-second clock while a run is live (`$.clock.every`), to redraw its elapsed time and mark it paused after
  30 minutes with no turn. It reads the time (`$.clock.now`) to stamp what changes.

What it reads:

- the first line of each message you send, to title a run it starts on its own; where a message came from (you, a
  background task's notification or a subagent's report back); and a notification's task id and how it ended, to
  count the jobs still running (`prompt.submit`)
- each finished tool call, for its own figures (`tool.call`): a shell command's name (the program and its subcommand,
  such as `npm test`), the paths of edited files, the sites fetched and the first words of a web search, whether the
  call failed, and a shell run's output for test pass and fail counts. It counts tool calls, and failed ones, while a
  run is live, and Claude's tool calls in each turn, to tell a long one. A subagent's call to the HUD changes nothing.
- for a widget Claude bound to its work, each matching call's output (its last 4,000 characters) for one number
- when Claude starts a subagent and when it ends: the description Claude gave it (never its prompt or its report),
  whether the call came back launched in the background and the agent's id, a background task's notification for that
  id and how it ended, and the agent's own turn ending (`turn.complete`)
- a task-list call (`TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList`), where Claude has that tool, for its items'
  names (40 characters at most) and states. The desktop app gives Claude none today.
- the main loop's turn ending (`turn.complete`), to mark a run waiting for you
- the context, cost and rate-limit figures the app reports after each turn (`session.measure`)
- a compaction of the conversation (`session.compact`), for a log line

What it keeps:

- what it read, in the session's own state (`$.state`), with the run, the board and the plan: counts, names, a
  number read from an output, a message's first line and a subagent's description, never file contents or a
  command's output
- the sources you muted and the figures you pinned or hid in its own store (`$.store`, a file Claude Code keeps for
  it), so they stay that way next time
- data from other plugins that send it through `$.hud` (`engine.create` adds it; `hud.declare`, `hud.push`,
  `hud.clear`): it checks each slot against its schema and keeps it in the session's state under the sender's name
- while a run is live, a log line for an edit, a failed shell command, a change in the test count, a fetch or search,
  a compaction, and a subagent starting, finishing or failing. A line names a file, a command, a site, the first words
  of a search or a subagent's description, and a count. It never holds output or contents.

What it tells Claude:

- while you have the session open, a short note beside each message you send (`prompt.submit`): during a run Claude
  named, the run's goal and the ids of the figures the strip shows (60 characters of goal, 160 in all, never a
  figure's value, note or title); with no run, to start one for a long task
- during such a run, a note after a tool result once the HUD has gone quiet, or naming a widget of Claude's that has
  gone stale, by its id and the command run most (`tool.call`). A run it starts on its own gets one note after a tool
  result, to say so, and the same line beside each message you send, until Claude names it.
- one section of Claude's system prompt, about 200 tokens, the same text every time (so it is cached), only where it
  offers its tool: how the HUD works, and when to start a run, set a mode or name a figure that matters
  (`prompt.compose`). It is fixed text; nothing from your session or from other plugins is in it.
- the tool's answer to each update: `ok`, and what it couldn't take.

Other plugins can send the HUD data to show. Each one says what it reads, and the HUD shows that and its
name beside its slots. You can mute any of them. The HUD checks what they send against its schema but
can't vouch for it: any plugin you install can change what other plugins do, the HUD included.

It reads no files, makes no network requests, starts no processes and calls no model. To check this yourself, clone
the repository and run `claude plugin validate .`.

## Not yet

- **"Needs you."** The strip doesn't say when a permission prompt holds the run: no hook was proved to see one in the
  desktop app, so nothing ships for it.
- **The plan on desktop.** The HUD can show Claude's task list as the plan, but the desktop app gives Claude no
  task-list tool, so there it is idle. It is built from the tools' types and tested in the test kit.
- **The note that asks Claude to start a HUD** still rides beside a message with no run. It goes once a run that
  starts on its own covers 95% of long turns with Claude's HUD calls taken out (46.2% today, in the table above).

## Requirements

- The Claude Desktop app, in a local or SSH session in the Code tab (the terminal works too). Claude Code
  for VS Code and the Claude mobile app don't show the strip yet, so there Claude doesn't get the HUD.
- Claude Code v2.1.295 or later in the app (2.0.0 was tested on 2.1.295 in the desktop app and 2.1.296 in the
  terminal). To check, enter `/status` in a Code tab session and read the **Claude Code** row.

A `claude -p` run, an SDK script or a scheduled task that nobody opens doesn't get the HUD, so Claude spends nothing on
it there.

## Development

See [DEVELOPING.md](DEVELOPING.md). Run the tests with `claude plugin test .`.

## Credits

Created and designed by Kyle Darling. Built with Claude Code.

Released under the [MIT License](LICENSE).
