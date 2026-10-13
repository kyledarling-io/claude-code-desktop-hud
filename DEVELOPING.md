# Developing the HUD

The HUD is a Claude Code mod (a plugin of function hooks) for the Code tab of Claude Desktop: a compact
strip above the prompt and a full dashboard pane, both drawn from one run record that Claude updates
through the `hud` tool.

## Run it from this folder

Name the folder in `CLAUDE_CODE_PLUGIN_DIRS`, and set `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` so each edit
reloads, in the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-code-desktop-hud",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

Start a new Code tab session, then ask Claude for a HUD or start a long task. Don't also install the
plugin from the marketplace on the same machine, or two copies load.

## Check it

- Tests: `claude plugin test .`
- Validate (manifest, marketplace file, hooks and calls): `claude plugin validate .`. The source template is a
  plugin of its own: `claude plugin validate examples/source-template`.
- Type-check: `npx -y -p typescript@5.6.3 tsc -p .`. It needs `.claude-plugin/types/`, which Claude
  Code writes the first time it loads the mod. `tsconfig.json` includes the template's hooks too.

## See it without the app: the trial

`node dev/trial.mjs` draws the real band and pane for twenty-eight scenes (a rollout, a training run with every widget,
long text, a plan, the plan mirrored from the task list, a run just started, a failed run, a run beside the sources' slots, a mode with a slot pinned and one
hidden, the slots alone, subagents at work, a log
that mixes Claude's lines and the observer's, a run with an aging and a stale widget, widgets bound to their commands with one
gone stale ("no reading"), the board ranked with why lines, the recipes (the layout laid and nothing bound, "–" under
commands that only look like the work, then one scene for each of the seven, bound by Claude to the exact commands it
runs), the urgency place as the tests go red and held once they are green again, and auto-run's three: a run that
started on its own, one waiting for you, one paused). A scene whose sources report after Claude's calls ends with a last
`hud` call (`then`), a boundary that keeps the run running, so the strip takes them; only auto-run's waiting and paused
scenes end a turn. It draws each scene on both surfaces, the desktop's and the terminal's: the band closed at 60, 105
and 150 columns and open
at 105, the pane at 40, 60 and 80. It copies the mod into a temp folder with `dev/trial-scenes.tsx` as its
only extra test (so the repo's tests stay quiet), runs it with `claude plugin test`, and renders the trees
it prints into `dev/out/trial.html`, light and dark, approximating the app's boxes, text, buttons and SVG
(the SVG as an image, as the app draws it) and the terminal's cells (text in monospace, a column 8px wide, spaces
kept, and a box that shrinks as Yoga's does). Open it in a browser. Use it for every visual change; the app
is for what only it decides (clipping, hover, the dock, its fonts).

## See it in the app

The installed HUD loads above any mod in a session's dev-mods folder and answers the band alone, so a
branch is checked as a dev copy beside it:
1. Copy your checkout into the session's dev-mods folder as `hud-dev`, renaming the plugin, its state, its
   tool's prefix (`mcp__hud-dev__hud`), its command (`/hud-dev`), its pane and its noun (`$.hudDev` and its
   `hudDev.*` events): a second plugin adding `hud` would replace the installed one's, and the engine unloads it.
2. Hide the installed HUD's strip with ✕, so the band passes to the copy. `/hud` brings the installed strip back
   over it. The copy's ✕ is its own, and a new run of the copy (or `/hud-dev`) brings its strip back.
3. Each edit, synced, reloads when the turn ends.

## Files

- `hooks/register.tsx`: the hooks, and every function handed `$`, which stays here at the top level (see
  Constraints). The pane render (desktop: a native header plus one `Svg`; terminal: text), the strip render
  (`AbovePrompt`), the `/hud` command, Expand/Collapse, tool-call counting (and the clocks' `ticks`), the auto-log's
  write (`logObserved()`, from `tool.call` and the one `session.compact` hook), the plan mirror's write
  (`mirrorPlan()`, from `tool.call`), the bound widgets' reading (`seeBound()`, bind.ts's `observe()`, inside the
  `tool.call` hook's count of a main-loop call; `bindMeasure()` from `session.measure`; `unread()` at both renders), the
  main loop's `turn.complete` as a
  boundary, the session's call count (`calls`, which stamps `n` on what changes), the board ranked (`board()`) and the
  strip decided at each boundary (`arrange()`, `crossed()`), auto-run's write (`prompted()` and `endJobs()` from
  `prompt.submit`, `autoRun()` from `tool.call`, `standDown()` from `autoRun()` and the `hud` call, `hideStrip()` from the ✕, `pause()` from the 1-second clock), the Agents
  source's (`watchAgents()`, the one door for an agent's start, end or rekey; `agentCall()` from `tool.call` for the main
  loop's `Agent` and `TaskStop` calls; `endAgent()` from `turn.complete`, with `stopJobs()`; `revive()` from a subagent's
  `tool.call`, for one the session's start left lost), who is watching (`watched()`,
  `offer()`), the one `prompt.compose` hook (the skill section), and the atoms. Also `$.hud`: the noun added in `engine.create`, its hooks on `hud.declare`,
  `hud.push` and `hud.clear`, and the door they open, `declare()`, `push()` and `clear()`, which run the gate
  and keep what passes in `$.state` (`slots`, `sources`). The urgency place: `weighUrgency()` runs the rules after anything
  that changes a slot (the `tool.call` hook after `observeCall()`, `session.measure` after the meter's feed), at a `hud`
  call, at the main loop's `turn.complete` and at a mute or unmute, and keeps the answer in `$.state` (`urgent`). Trust: `setMuted()` (`$.state` `muted`, kept in
  `$.store`), `trust()` (`/hud sources`, `/hud mute`, `/hud unmute`), and the pane's Sources list (read-only).
  What shows first: `control()` (`/hud mode`, `pin`, `unpin`, `hide`, `unhide`), `intend()` (the `hud` tool's `mode`
  and `focus`, and what it names back), `showing()` (the lines `/hud` and the pane's Showing block print), `knownKeys()`,
  and the atoms `mode`, `modeByPerson`, `focus` and `prefs`; `session.start` reads `prefs` back from `$.store`.
  The terminal's band and pane (`ui.render`, surface `terminal`) draw the same board as lines of text: see "The terminal
  draws the board too". Logic that never touches `$` lives in the modules below, so edits to it rarely meet.
- `hooks/run.ts`: the run record and its reducer: `apply()` (it first takes the call through `clean()`, the guard every
  caller goes through: each field made its type or dropped, Claude's text kept to 2,000 characters, `accent` and an item's
  `color` a hex or a tone name and `progress` 0 ≤ n ≤ total, each refused with a line; then it stamps each widget and tile
  Claude sends with its clock, checks a widget's binding with `rebind()` and hands back a `bind on <id>: <why>` line for one it can't take,
  lays a `start`'s or `rebuild`'s `recipe` ahead of Claude's own widgets and says so in a line (see Recipes below),
  and a phase or rebuild is a `boundary()`; a `start` on a provisional run `adopts()` it; a run waiting for you or
  paused runs again unless the call sends a `status`), `fresh()`,
  `cleared()`, `mergeWidget()`, `asList()`, `asObject()`, the `Input` type, and `isLive()` (re-exported from
  `lifecycle.ts`).
- `hooks/tool.ts`: the `hud` tool's surface: the `DESCRIPTION` Claude reads, the `SCHEMA` (the `mode`, `focus` and
  `recipe` fields' vocabulary is in their property descriptions, the seven recipe names an enum, so the description stays
  within 2,048 characters: it is 2,008), the text `BUDGET`, and `answer()` (`ok`, then a line per `mode` or `focus` id it
  couldn't take, and the lines `apply()` has: a colour or a progress it refused, a recipe laid or refused, a binding it
  couldn't take).
- `hooks/recipes.ts`: the seven recipes as data, no `$` and no command: `RECIPES` (each recipe's widgets, unbound, a widget
  meant to be read from a command carrying the binding it `wants`, `on` and `extract`; a `strip` pick; a `note`),
  `RECIPE_NAMES` (the schema's enum), `recipeOf()` (a name as sent, any case, else nothing: `constructor` is no recipe),
  `widgetsOf()` (the widgets as the run holds them, without `wants`) and `laid()` (the answer's line, from the widgets the
  run holds once the call is done: the ids still to bind and how, the ones left to Claude, the note).
- `hooks/modes.ts`: the five modes as data (`MODES`: a label and the slot keys each puts first; `MODE_LINES`, what each
  is for), `modeCommand()` (`/hud mode`), `modeLine()`, `modeOf()` and `focusOf()`, all pure.
- `hooks/prefs.ts`: the person's pins and hides, pure: `prefsCommand()` (`/hud pin`, `unpin`, `hide`, `unhide`: one
  sentence on what it did, or the keys that are held), `prefsOf()` (what the store hands back, junk dropped),
  `prefsLines()`, and `keysOf()`, the keys that can be named: every held slot, the run's widgets as `claude/<id>`
  (a bound one too) and the plan mirror as `hud/plan`.
- `hooks/notes.ts`: the notes that keep the HUD current: `stale()`, `shows()`, `nudge()` (the general check, sent only
  while `isBound()` is false), `pointed()` (and `pointedIds()`, the ids it names: Claude's widgets only, a bound one too,
  never the plan mirror), `steer(r, keys)` (the note beside a message: the goal, else the title, then the arrangement's
  slot keys that fit, 160 characters at most), `autoNote()`, `KICKOFF`.
- `hooks/skill.ts`: `SKILL`, the text of the one section (`hud:skill`) the `prompt.compose` hook adds to the system
  prompt. A constant, never built from the run or a slot; `hooks/skill.test.ts` pins it byte for byte.
- `hooks/bind.ts`: bindings, pure: `validBind()` (a binding as Claude sent it: `on`, `match` and `extract`, or why not),
  `rebind()` (what a widget Claude sent keeps of its binding and of the observer's last reading; a list, grid or
  checklist takes none), `matches()` (each
  `on`, `match` as plain text), `observe()` (a finished main-loop call, or a measure as `MEASURE`: each bound widget it
  matches is read with `extract()` from hooks/extract.ts, a reading stamped as the observer's and a miss counted in
  `bound`; a shell call's head kept in the run's `ran`, the last `RAN`), `planText()`, `measureText()` and `unread()`
  (the run as drawn: a stale bound widget becomes a stat that says "no reading"). `ON`, `EXTRACTORS` and `READS` are
  the vocabulary the schema uses.
- `hooks/extract.ts`: the six extractors a binding names (`pass_fail`, `n_of_m`, `percent`, `duration`, `last_number`,
  `exit`), pure: `extract()` takes one number out of a call's output, from the last 4,000 characters once tidied
  (`windowOf()`: what starts too near a cut edge isn't read), the last valid, finite match winning, and nothing when it
  isn't sure, which the caller counts as a miss. `last_number` reads nothing from a failed call.
- `hooks/plan.ts`: the plan mirror, pure: `mirror()` reads a finished task-list call (`TodoWrite`, `TaskCreate`,
  `TaskUpdate`, `TaskList`) and the items held before it into the items after it, and `intoRun()` writes them into
  a run as the observer's checklist `plan` (and the progress, when Claude sent none). `TOOLS` names the four tools.
  Idle in the desktop app, which offers none of them (see Design).
- `hooks/urgency.ts`: the urgency place, pure: `urgentNow()` runs the four rules (U1 to U4) over the HUD's own slots
  and holds what it raised until the next boundary after its rule stops; `urgentFor()` gives `strip()` the slot and the
  sentence.
- `hooks/board.ts`: the slots' declaration order (`inOrder()`, the ranker's tie-break; the HUD's own are `OWN`) and the
  Sources list (`sourcesOf()`: the HUD's own four, then each plugin that declared itself; `isMuted()`, `whose()`,
  `typed()`).
- `hooks/rank.ts`: who decides what's shown, pure: `claudeSlots()` (the run's widgets as slots, `claude/<id>`, the
  plan mirror `hud/plan`), `score()`, `rank()` (pins, focus, the mode's slots, the score; the why lines),
  `urgentFirst()`, and `nextArrangement()` (the strip at a boundary, and what waits: `WAIT`).
- `hooks/lifecycle.ts`: watching and clocks: `DRAWS` (the surfaces that draw the strip), `isLive()`, `span()`,
  `quietFor()`, the clock thresholds (`AGING`, `STALE`, `RETIRE_BOUNDARIES`), `life()`, `age()` (a bound widget's is its
  misses in a row), `idle()` (the calls since it changed), `boundary()` and `stamp()`; the plan mirror's ownership and
  lead (`PLAN`, `PLAN_TOOLS`, `isMirror()`, `leadList()`, `settle()`); and auto-run's
  decisions: `AUTO_CALLS`, `AUTO_MS`, `PAUSE_MS`, `shouldStart()`, `titleOf()`, `notification()` (a task
  notification's job and status), `jobsRunning()`, `pauses()`, and the statuses `WAITING` and `PAUSED`. It imports
  only `text.ts`, so `run.ts`, `svg.ts` and `plan.ts` all read it without a cycle.
- `hooks/text.ts`: text as the HUD draws it, with no DOM: `plain()`, `measure()`, `tidy()` and `fit()` (which never cuts
  right after a number: "v2…" would read as 2; it measures no more of a text than can fit, as no glyph is narrower than
  0.26em, so a long line costs a redraw what a short one does). A character the terminal gives two columns is an em, and
  two columns in monospace. It imports only `cells.ts`'s widths; `svg.ts` re-exports it.
- `hooks/cells.ts`: the terminal's drawing as the cells it takes, an approximate Yoga/Ink layout of a tree the kit draws
  (`lay()`: its lines, and what overflowed; `flat()`), for the band's and the pane's width tests and `dev/cells.mjs`. The
  band's Text is strict (too wide and not truncating is an overflow); with `wrapText` the pane's wraps as Ink wraps it, at
  spaces, a word wider than the line broken hard. Borders, padding, margins and `flexWrap` are modelled. It holds the
  widths everything the terminal draws counts by: `width()`, `len()` and `take()`, an East Asian wide or fullwidth
  character (the main blocks of Unicode's table) and every `\p{Extended_Pictographic}` code point (⏱, ⚠, ✔, ➡, the
  emoji) counted as 2 columns, the width some terminals give them (counting wide only cuts a column sooner; not proved
  against Ink's own count), a joining mark or a variation selector none. No `$`, no import, erasable types only.
- `hooks/render.ts`: render helpers: `spark()`, `clock()`, `span()` (from `lifecycle.ts`), `COLOR`, `NBSP`, `BOLD`,
  `widgetText()` (a widget in one line of terminal text), `lastLine()` (the band's last line), `factList()` and
  `factsOf()` (the header's facts, whole), `fitFacts()` (the facts a terminal row has room for, whole or not at all) and
  `jobsText()`; `len()` (a text's columns, from `cells.ts`); and what the terminal draws of the board: `entryOf()` (a board entry as text: its title signed when another
  plugin sent it, its figure, its note, and whether and how long a widget has sat), `bandLines()` (the band's slot lines,
  from the items `stripPicked()` gives it), `figuresOf()` (a widget's figure for a line, fullest to barest, its number
  always whole and first), `fitLine()`, `cutText()` and `fitText()` (a line, or a log line, in its columns without cutting
  a number), `headerOf()` (the band's header row, every part given its columns), `blockLine()` (a pane block's first line,
  fitted the same way), `alarmLine()` (the urgency place as one line) and `agoOf()` ("3m ago", as the dashboard's aside
  says it).
- `hooks/autolog.ts`: the auto-log, pure: `said()` reads a finished call (and the tests source's count before and
  after) into what it says (`Said`; a call the person denied says `denied`, never `failed`), `agentSaid()` makes the line
  for a subagent starting, finishing, failing or lost at a reload (the Agents source decides which), and `write()` merges that into the log as an observer line, collapsing edits and
  keeping the 200-line cap.
- `hooks/svg.ts`: `dashboard(run, width, slots, placed)`, the pane's SVG (13 widget types as blocks on a 4-unit grid;
  `rowsOf()` orders them, `headOf()` draws each block's label row and its why), and `strip(run, width, slots, urgent,
  arranged)`, the band (it returns the keys it drew as `shown`; `stripItems()` builds what it could draw, `choose()`
  picks, `fitStrip()` fits). `stripPicked()` is what `choose()` chose, before the fit, which the terminal's band draws;
  `stripSlots()` is the pick at a boundary and `stripFocus()` reads Claude's `strip` as
  slot keys. A slot is drawn as a widget of its pattern (`asWidget()`). `describe(run, slots, placed)` says what both
  draw, in words, for their alt. `hiddenMirror()` says when the plan mirror is kept and not drawn (the checklist that
  leads is `leadList()`, in `lifecycle.ts`). The colour tokens (`TONE` for marks, `TOKENS` for text, to-do and dim marks; a block
  that hasn't changed in a while takes them: `DIM` for its text, `dimmed()` repaints its marks),
  `icon()` and `dot()` for states by shape. Wrapping (`wrapPx`; `measure`, `fit` and `plain` from `text.ts`),
  `sentence()` and `smooth` curves.
- `types/index.d.ts`: `HudRun` (with `ran`, the shell heads the pointed check reads), `HudWidget` (with `bind`, a
  `HudBind`, and its counts in `bound`), the `$.state` contract (`run`, `paneOpen`, `stripHidden`,
  `slots`, `sources`, `agents`, `plan`, `urgent`, `mode`, `modeByPerson`, `focus`, `prefs`, and auto-run's `prompt`, `turn`,
  `lastTurnAt` and `jobs`), and the public v1 slot contract: `Hud` (the noun), `HudSlot`, `HudDeclaration` and `HudHeld`. The engine
  lays this file into every plugin that lists `hud` under `dependencies`. **v1 is frozen at 2.0.0; changes are additive:** a field may be added to
  `HudSlot` or `HudDeclaration`, none removed, renamed or retyped, and anything that breaks a source is v2.
  A change to the contract goes in `SOURCES.md` in the same PR.
- `SOURCES.md`: the public guide for a source's author, in plain words: the three calls and their refusals, the
  gate's limits (copied from `CAP` and `MAX_SLOTS` in `hooks/sources/contract.ts`, so a change there changes the
  table), versioning, a missing HUD, how slots are ranked and when the strip moves, the urgency place, what Claude
  sees of a source (its keys, in `steer()`'s note), and trust. Its ranking and urgency paragraphs follow
  `hooks/rank.ts`, `hooks/urgency.ts` and `hooks/register.tsx` (what makes a boundary): a change there goes into
  `SOURCES.md` in the same PR.
- `examples/source-template/`: a plugin of its own, with `"dependencies": ["hud"]`: `hooks/register.ts` declares
  one slot at `session.start` and pushes a count from a `$.clock.every`, catching every `$.hud` call, and
  `hooks/source.test.ts` runs it inline beside the HUD (see Tests).
- `hooks/sources/`: the 2.0 framework:
  - `contract.ts`: the gate (`accept()`, `acceptDeclaration()`). It also holds the pattern, tone and state
    lists the `hud` tool's schema uses.
  - `tools.ts`, `tests.ts`, `meter.ts`: three sources written as if they were other plugins, as pure
    `observe()` reducers. `register.tsx` feeds them: the tool signals and test results from its `tool.call`
    hook (`observeCall()`), the meter from `session.measure`. Their memory is in `$.state` (`toolSignals`,
    `testResults`).
  - `agents.ts`: the fourth, for the subagents at work. Its `observe()` takes an `AgentEvent` (`start`, `end`, `rekey`,
    `drop`, and `lose` and `live` for an agent the session's start found at work) and answers the checklist `agents` and the stat `agents-running`; `call()` reads an `Agent` call's input,
    `launched()` and `completed()` its result, `said()` the auto-log's words. `register.tsx` feeds it from
    `watchAgents()`, not `observeCall()`: its events come from three hooks. Its memory is in `$.state` (`agents`).
- `sources/hud-git/`, `sources/hud-ci/`: source plugins, each a plugin of its own with
  `"dependencies": ["hud"]`, its own README and its hooks in one self-contained `register` function in
  `hooks/register.ts`. A source may start processes (`$.process.run`), and says what it runs in its access line;
  the core's `calls:` line stays as it is. Their tests (`hooks/git.test.ts`, `hooks/ci.test.ts`) are found by
  `claude plugin test .` from the root: the source loads as an inline plugin beside the HUD under test, the test's
  own `on('process.run', …)` is the world beneath (no `git`, `gh` or network) and `mock.clock` moves the 30 s polls.
  An inline plugin is self-contained, so `register` carries every helper inside it, none at module level.
  `claude plugin validate sources/<name>` checks one.
- `dev/probes/`: the platform probe (`platform/`, a throwaway mod that logs what the desktop app's hooks see) and its steps
  in `README.md`. What it proved is under "Constraints learned the hard way".
- `dev/trial.mjs`, `dev/trial-scenes.tsx`: the trial (see above). Its output, `dev/out/` (`trial.html`, and `trial.json`, the
  views as data), is ignored. `dev/cells.mjs` reads the terminal views in `trial.json` as text lines at their widths.
- Tests (`claude plugin test .` runs 27 files; `sources/hud-git/hooks/git.test.ts` and
  `sources/hud-ci/hooks/ci.test.ts` are described above):
  `hooks/apply.test.ts` (reducer, and the tool description staying within the 2,048 characters
  that reach the model in the desktop app; off-schema widget fields coerced or dropped, Claude's text kept to 2,000
  characters, a colour or a progress out of range refused in a line), `hooks/extract.test.ts` (each extractor's table:
  what it reads and what it must not, ANSI codes and Unicode, non-finite numbers, the last match winning, the
  4,000-character window with a number at every offset of its edge read whole or not at all, a 2 MB output read
  quickly, junk in; `last_number` reading nothing from a failed call), `hooks/svg.test.ts` (every widget renders clean SVG, wrapping,
  strip fit and height, dashboard layout), `hooks/strip.test.tsx` (strip on terminal and desktop,
  Expand, Collapse, Hide, the desktop header row, the pane's summary and width, the band trusting the dock
  over its flag), `hooks/relevance.test.ts`
  (rebuild, staleness on calls only, the short HUD check after a tool result and its back-off, quiet time asking nothing,
  none riding on a denied call, and the note beside a message), `hooks/gate.test.ts`
  (the tool offered only where the strip draws, the note to start a run, subagent calls ignored and kept out
  of the HUD check, no HUD check while nobody watches, a HUD fault never costing another tool's call),
  `hooks/noun.test.ts` (`$.hud` end to end with inline plugins: a source declares, pushes and clears, an
  undeclared push is refused, no source reaches another's slots, a tamperer's rewrite shows under the original
  sender, a reload keeps the slots, a fault answers plainly), `examples/source-template/hooks/source.test.ts` (the
  template as an inline plugin beside the HUD: its slot arrives under its own name and moves in place, a push the
  HUD refuses doesn't stop it, a refused declaration leaves it pushing nothing; it runs in the repo's
  `claude plugin test .` because the HUD is the plugin under test, and can't run from the template's own folder,
  where no HUD loads and `$.hud` is undefined), `hooks/sources/wired.test.ts` (a short session
  through the HUD's own `tool.call` hook holds what the pure sources leave standing; `session.measure` fills
  context, cost and limits), `hooks/slots.test.ts` (slots fill what Claude's items leave of four and drop first,
  the urgency place leads and holds, the dashboard's note and sender, the drawing order, and on terminal and
  desktop a slot another plugin pushes showing in the pane and the desktop strip),
  `hooks/urgency.test.ts` (each rule fires in its own words and needs its threshold, an outside plugin's slots in the
  HUD's own names never fire one, first rule first, the hold across one boundary and no flicker, a held one saying its
  slot's live note and ending with its slot, through the hooks each rule leading the desktop strip and its alt, tests
  going red then green, a turn's end or a phase ending a hold with or without a live run, a muted HUD source raising
  none, a fault in the rules costing no call, and the urgency never reaching a message's or a tool call's context),
  `hooks/lifecycle.test.ts` (widgets and tiles age with main-loop calls only, aging at 12 and stale at 24, an update
  makes them fresh, stale across two boundaries they retire with a log line, a stale widget is named once in a HUD
  check of 160 characters at most), `hooks/bind.test.ts` (bindings: each refusal's words and the tool's answer, each
  `on` matching its own calls with `match` as plain text, a reading filling a stat, a line, a ring and a text as the
  observer's, each `on` through the hooks, a miss ageing a bound widget and nothing else ageing it, stale drawn "no
  reading" on terminal and desktop and never its old number, a rebind or an update without a value drawing "no
  reading", a new binding starting over while a title keeps a stale widget named, the pointed check's words, ids and
  heads only, a head kept in 30 characters, and the general check only while no binding has seen its calls),
  `hooks/oldstate.test.ts` (a 1.4.0 run in `$.state`, missing every newer field,
  in a state with none of auto-run's, draws on terminal and desktop and takes a message, a notification, a `hud`
  call, a tool call and a turn's end, and after a HUD check 1.4.0 sent the next comes 12 calls on, as then; with no
  `bind` or `bound` on its widgets, Claude binds one and a matching call fills it, and a recipe laid by a rebuild over it
  draws unbound with no figure, fills nothing a command only looks like, and takes Claude's bind; one in a state with no
  arrangement is steered by its goal alone; later releases add their fields' absence to it), `hooks/recipes.test.ts`
  (recipes: the seven as data with no binding, match or value anywhere in them, the strip's own keys, `plan` and the HUD's
  own slots' ids never a widget's id, what each wants bound standing once a command is named, and each id, title, want
  and strip pinned; through `apply()` a start or rebuild laying its widgets unbound and its strip, Claude's fields in the
  same call and a later call overriding by id, binding, strip and removal, an unknown name (`constructor` too) named back
  with nothing laid, a recipe on a plain update told where it goes, a binding a recipe carried that cannot stand dropped
  and named as Claude's would be; the answer's line from the layout as it stands after a same-call bind, removal, fill and
  refusal; through the hooks each of the seven laid with no figure and drawn on both surfaces, none of a table of
  commands that only look like the work (`ls build`, `rm -rf build`, `docker build`'s "DONE 0.1s", a fly deploy's
  `[4/4]`, curl on a 503, "50000/120000 rows", a `tail` with `val_acc 91.2%`, `npx jest`) putting a figure in any of
  them, and bound to the command Claude names a widget reading that command and nothing that only looks like it),
  `hooks/autorun.test.tsx` (auto-run: the pure decisions, then through the hooks a long turn starting a run at 8 calls
  or 60 seconds, titled from the prompt and dim on both surfaces, a turn a notification or a hand-back began starting one
  too (titled from the person's last message, `Task` with none; a short one starting nothing; none beginning a second in
  a turn Claude finished; 60 seconds from the notification; a refused notification beginning no turn), a waiting or
  paused run running again on Claude's next main-loop call (a `hud` call too) and not on a notification or a subagent's
  call, calls that finish together each counting, a held
  plan reaching it at once, never while nobody watches or from a subagent's calls, Claude told once in 160 characters and neither checked nor steered until it adopts the run (beside each of the person's messages the note that names it, never the steer), a peer's hand-back leaving the turn alone, a message of the person's refused on its way in changing nothing, a long prompt's title read from its first line,
  a `start` adopting it in its own turn and not after the next message, a `title` adopting it whatever its age, a
  `start` on Claude's own run
  starting fresh, waiting for you at a turn's end, background jobs keeping it running, paused after 30 minutes and
  resumed by the next message on both surfaces, a message landing as the clock pauses it never overwritten, the ✕ in
  the same turn keeping it hidden, and never a finish),
  `hooks/terminal.test.tsx` (the terminal pass, each feature over both surfaces: the pure helpers (the figure tiers, a line
  fitted to its columns, cut text, the facts kept whole, the header budgeted, a last line fitted, `fit()` and `wrapPx()`
  never ending after a number at any px); the urgency place as a first line in its slot's tone, green held once its slot is
  good again, gone at the boundary, drawn at 60, 105 and 150 columns, never raised by a hidden slot or a muted source; the
  band's lines the very items the desktop strip chose, on runs with tiles, a plan, a trend and bound widgets, and the
  default pick before the first boundary; the band swept from 30 to 170 columns (the terminal at every width, the desktop
  at every third) over runs shaped like the trial's, asserting no number cut anywhere (Ink's own cut, as `cells.ts`
  models it, included), no bar or spark without its number, the strip's errors and phase always there, no overflow; the
  pane swept from 30 to 120 columns, a width at a time, over the same runs and a long log, with the same assertions (a
  line with a bar or spark has its number on it); the header's facts whole at 60, 105 and 150; the band with the dashboard open; the strip moving only at boundaries while
  figures, whys and tones change in place; hidden and muted never showing; the mode and a pin as whys; clocks dim in the
  band and the pane with "3m ago" on widgets and tiles; "no reading"; the auto-log's dim lines; a status but running in
  words; no pane buttons and no hover; wide characters at two columns, both sweeps taking a Japanese title and an urgency
  line; a runner's errors and a failed jest suite never reading 0 failed; a denied call logged as denied; off-schema fields
  and a progress out of range never blanking either surface, and a fault after a hud call applied never answering
  "unchanged"; the longest text redrawn in well under 100 ms; Claude's tiles apart from the run's counts; figures as the
  desktop says them, a % of 100 as its value),
  `hooks/trust.test.ts` (on terminal and desktop the pane's Sources list with access lines and slots, and a
  muted source's slots leaving the drawing until unmuted; `/hud sources`, `/hud mute` and `/hud unmute` by name; mutes kept
  in the store applying from the start), `hooks/modes.test.ts` (the five modes' slots; the tool's `mode` and `focus` with
  the description in budget; `/hud mode`, `pin`, `unpin`, `hide` and `unhide` each answering in a sentence, with the store
  round trip and a store that can't be read; the person's mode beating Claude's; focus kept as sent, capped at 3 and an
  unknown id named back with no slot value; a new run clearing Claude's mode and focus; `/hud` and the pane showing the mode,
  pins and hides on terminal and desktop), `hooks/sources/sources.test.ts` (the sources reading a short session's calls, every slot passing the gate,
  command names, test summaries and a note naming only the counts printed, the meter's levels, and what the gate
  drops or refuses). `svg.test.ts`
  also holds markdown drawn plain, the strip's `shown` and text floors, contrast read off the SVG, states by
  shape, the alt in words, and the dashboard's rows and labels. `strip.test.tsx` also holds the header's fit
  with a long step, the goal's "→ …" and `/hud`'s full text. `hooks/autolog.test.ts` holds the auto-log: each
  line's words, edits collapsing, a shell run's output never reaching the log, the band's last-line policy, the
  200-line cap, and through the hooks on terminal and desktop a live run logging a failing build and an edit
  (dim in the pane), a subagent's call and a finished or missing run logging nothing, test counts, and compaction
  logging one line while a precompute logs none; also that lines with no `by` draw as Claude's.
  `hooks/plan.test.ts` holds the plan mirror: each tool's mapping, junk and a refused or unknown update ignored,
  labels plain and cut at 40, the mirror leading with progress done ÷ total, hiding where Claude has phases, a
  checklist or progress of its own (its figure going with it, and back if Claude's lead goes; Claude's progress
  winning in either order), its progress going when it does, and
  through the hooks on terminal and desktop a task-list call of the main loop showing in the strip, the band's step
  and the dashboard, while a subagent's, a failed one or one with no live run does not.
  `hooks/rank.test.ts` holds who decides: the Debug-mode worked example exactly, pins then focus then the mode then
  the score, hidden keys, ties, Claude's widgets as `claude/<id>`, nothing flip-flopping (a slot that left waits 3
  boundaries unless it changed or the person brought it back; a pin storm and a boundary storm scored by the churn
  metric), and through the hooks on terminal and desktop the strip changing only at boundaries (a first failed call or
  a new tile mid-turn waiting for room), every pane block's why line with the alt and `/hud` saying it too (`/hud` the
  live why), a muted sender gone and back, a hidden slot never shown (as the lead checklist or the trend either), one
  boundary counter, the urgency said once, a hinted slot pushed out by a fresh one waiting before it comes back (it
  fails with the wait off or the last arrangement dropped), and a storm of phases, turns and changing slots with no
  flip-flop.
  `hooks/skill.test.ts` holds the skill section and the short steer: the text pinned byte for byte, the section after
  the engine's own as a `session` section and only with the hud tool in `e.tools` (also on the `lean`, `print` and
  `skills` traits, and with a host that sends no tool list), `steer()` in 160 characters for a 60-character goal and
  forty ids, the goal cut at 60, an id with no room left out, no slot value, note or title in it, and through the hooks
  a source that writes an injection into its slot reaching Claude through neither the note beside a message nor the
  skill, with the ids from the arrangement at the last boundary and not the board as it stands.
  `hooks/sources/agents.test.ts` holds the Agents source: the pure reducer (a start, an end done or failed, only a running
  one ending, the 12 newest, a rekey, a drop, a description cut before it is tidied, the gate fitting the names), and
  through the hooks a background subagent running until its notification or its own turn ends (counted among the jobs), a
  foreground one at work from before its call to its result (its end surviving a fault later in the call, and a call that
  never came back failing at the turn's end), one sent to the background keeping its place, a teammate or cloud record
  dropped, a stopped one failing, a resumed session losing the last process's (lost at reload, failed for good when
  nothing comes back), a reload's lost agent back at work with its job on a call of its own, or ended by its notification
  or its own turn, muting leaving the slots out of the
  drawing, the log's three lines, and a subagent's tool calls still counting on the board.

## Release

1. Bump `version` in all three `plugin.json` files, the HUD's (`.claude-plugin/`) and the two sources'
   (`sources/hud-git/.claude-plugin/`, `sources/hud-ci/.claude-plugin/`), which are versioned with the HUD, and add its
   section at the top of `CHANGELOG.md`, in a PR. The template keeps its own 1.0.0: it is a starting point to copy, not
   a release.
2. Once it is merged, tag main with the version and push the tag: `git tag v1.2.3 && git push origin v1.2.3`.
3. The Release workflow runs the tests and the validator (the HUD, both sources and the template), checks the tag
   against all three `plugin.json` versions, and publishes the GitHub release with that version's changelog section as
   its notes. Installed copies pick up the new version from **Customize → Plugins** (or `claude plugin update hud`).

## Design

- **Only where someone watches.** The strip draws on the terminal and the desktop app (`DRAWS`), so the
  `hud` tool is registered once one of them is attached, at `session.start` or a later `session.attach`.
  A `-p` run, an SDK script, or a scheduled run nobody opens never gets it. The notes check
  `$.session.surfaces()` each time: no `KICKOFF`, no HUD check and no run starting on its own while nobody watches
  (the count goes on, so the check comes on the first call after they're back). The HUD belongs to the main conversation:
  a call with an `agentId` changes nothing, and a subagent's other calls count on the board but not toward
  the HUD check. Every gating hook carries a `.catch`, so a fault in the HUD passes the event on.
- **It follows the work.** `rebuild: true` clears the layout (tiles, widgets, phases, grid, trend,
  counts, progress, strip pick, fun, countdown) and keeps the title, goal, clock, log and call counts;
  a finished run comes back to running. `goal` is the current aim, logged when it changes. Two notes
  ask Claude to keep it current: a HUD check as a `tool.call` result's `context` once the run has gone 12 main-loop
  calls without a `hud` call while no bound widget has seen its calls (`isBound()`; once per window; one short line,
  `nudge()`; time alone is no
  drift, so a remote job's few long calls ask nothing), and a `prompt.submit` context on every message while a run is
  live (`steer()`): the goal (else the title), then the strip's slot keys from the arrangement that fit, 160
  characters at most, ids only. It never carries a slot's value, note, title or items, nor `shows()`, so an outside
  source's text can't reach Claude through it; what to do with a changed goal is in the skill section (below). A
  state with no arrangement steers by the goal alone. The check backs off: one that goes unanswered (no `hud` call
  before the next window closes) doubles the next window, 12 → 24 → 48 calls, and no further
  (`DRIFT_MAX_CALLS`; the count is `nudged.n`, and a `nudged` from before it counts none). The pointed
  check waits out the same window while a check is unanswered. Any `hud` call starts over at 12. A run that
  started on its own and that Claude hasn't adopted gets no check at all, generic or pointed: Claude is told of it once
  after a tool result, and the observer keeps it right. Beside each of the person's messages it carries the same note,
  `autoNote()` (160 characters at most), never the `steer()`: it may still hold an earlier task's title, and a `title`
  adopts it whatever its age. Adopted, it is checked and steered like any other run.
- **It starts itself** (auto-run). Auto-run watches every main-loop turn (`turn`: when it began, the
  main loop's calls since), whatever began it. The person's message (`prompt.submit` with `origin.kind` `composer`, or
  no origin, as old hosts send) begins one afresh and keeps its first line as a title (`prompt`, `titleOf()`: its first
  line, 2,000 characters of it, `plain()`, fitted to the title's 60 characters), once it went through: one `next(e)`
  answered with a `drop` keeps no title, begins no turn and resumes nothing. A prompt of any other origin begins one only when none is in hand (`turn` is
  null between turns), and only once it went through (`next(e)` answered no `drop`: a refused one begins nothing, so no
  turn keeps its time); one delivered into a running turn leaves that turn as it is. With no live run, the turn's
  8th main-loop call (`AUTO_CALLS`), or its first call 60 seconds in (`AUTO_MS`), starts a run while someone watches
  (`shouldStart()`): marked `provisional`, its title dim in the band and the pane on both surfaces, its strip shown
  unless the person pressed ✕ in this turn (`hiddenAt`), holding the plan mirror's held plan at once (`intoRun()`). A
  call adds to `turn.calls` inside `update`'s closure, so calls that finish together each count. It counts from the
  next call, whose result carries `autoNote()` once (`told`; 160 characters at most), and no HUD check follows it. It is
  titled from the person's last message, `Task` when there is none. One run a turn: auto-run stands down (`standDown()`:
  `turn.off`, not null, so a prompt delivered into the turn begins no second one) once it starts one and once Claude
  calls the HUD in the turn (so a run Claude finished doesn't come back), until the next turn; the main loop's
  `turn.complete` sets `turn` to null. A `start` on a provisional run that started since the person's last message (`prompt.at`) adopts it
  (`adopts()`: the new title and goal, the same log, counts, clock and widgets, the held plan, the strip as the person
  left it); either drops `provisional`. One an earlier message began is not adopted by a `start`, which begins a fresh
  run, for a new task. A `title` adopts a provisional run whatever its age: Claude claims the
  run it is looking at. A `start` on Claude's own run starts fresh. The main loop's `turn.complete` sets a live run to `waiting for you` (the band's last line says what happened
  last), unless background jobs still run: a shell result's `backgroundTaskId` adds one to `jobs`, a task
  notification naming it (`notification()`) or a `TaskStop` ends it, `session.start` clears them (shells don't outlive
  their process), and the header's facts and the pane say "2 jobs running" (`jobsRunning()`, a count over `jobs`, where a
  subagent started in the background is a job too, `'agent'`, until its end: see the Agents source). The main loop's next
  call, a `hud` call among them (`apply()`, unless it sends a `status`), sets a waiting or paused run back to running,
  whatever began the turn: Claude is at work. A prompt of any other origin (a
  task notification, a subagent's hand-back as a `peer`, the rest) is not the person's: no note, no new title, no
  resume (on its own it changes no status); a task notification still ends the jobs it names, the subagents among them. Any
  finished call, message or turn's end is a sign of a turn
  (`lastTurnAt`); the 1-second clock sets a live run with none for 30 minutes (`PAUSE_MS`), and no job at work, to
  `paused` (`pauses()`, asked again on the run as it is written, and undone if a sign of a turn came after the read),
  and the person's next message or the main loop's next call sets a paused or waiting run back to running. Nothing ever
  finishes a run but Claude's `done` or `fail`. `KICKOFF` stays until a run that starts on its own covers 95% of long
  turns with Claude's HUD calls taken out (46.2% at 2.0.0, the README's zero setup, stripped); with auto-run it is read
  only before a long turn's 8th call. Removing it takes its `prompt.submit` branch and its gate test with it.
- **The skill section** (`hooks/skill.ts`). Claude's half of the framework is one section of
  the system prompt, `hud:skill`: when to start a run, that mode and focus are set at a phase boundary (up to 3 slot
  ids; the note beside each message lists them), that slots fill themselves, that the person's pins, hides and mode
  win, and that every number sent is observed. The `prompt.compose` hook (one, with a `.catch`) appends it after
  `next(e)`'s sections, as a `session` section, only when `e.tools` has the hud tool: where someone watches, the same
  moment the tool appears. The text is a constant, about 210 tokens, cached with the prompt, so it is never built from
  the run, the board or a source, and `hooks/skill.test.ts` pins it byte for byte; changing a word is changing the
  test. Proved in the app (2.1.295): `prompt.compose` fires with `e.tools`, which includes the tool, and its traits are
  `lean`, `print` and `skills`; the section rides on all of them.
- **The log writes itself.** While a run is live, the observer adds a line for what a finished call of the main
  loop did (`said()`, `write()`): `edited svg.ts` (`×3` for edits to one file in a row, the newest line replaced
  with its `at` moved on), `npm test failed` (`npm test denied` for a call the person or a rule denied, which never ran
  and counts as no error in the run's errors),
  `tests: 3 failed` for the first summary and `tests: 2 failed → 0` for
  a change (nothing when the count is the same; the tests source's last count is read before it observes; a call
  that writes a tests line leaves out its `<command> failed`, one line per call), `fetched
  docs.anthropic.com` or `searched “query…”`, and `context compacted` (the one `session.compact` hook, after
  `next(e)` stands, for a trigger other than `precompute` and no `agentId`). Subagents' calls are not logged. A
  line is a name cut by `fit()`: a command's head, a file, a site, a query; a shell run's output only ever gives
  its test counts. Lines carry `by: 'observer'`; a line with no `by` is Claude's. They are dim: the terminal pane's
  `dimColor`, the dashboard's muted token (≥ 4.5:1, in the contrast test). Observer lines must not drown what
  Claude meant, so the band's last line (`lastLine()`) is the newest line, except that Claude's newest line holds
  the place until 5 observer lines have come after it; goal changes are skipped. The log keeps 200 lines.
- **The Agents source** (`hooks/sources/agents.ts`) lists the subagents the main loop starts and counts
  those at work, as a checklist `hud/agents` (the 12 newest, oldest first) and a stat `hud/agents-running`. No new
  hook: it rides `tool.call`, `prompt.submit` and `turn.complete`, and reads whether or not a run is live, whoever
  watches, as slots outlive the run. Where an agent starts and ends depends on how it ran:
  - *Foreground.* The main loop's `Agent` call that does not say `run_in_background: true` (nor `isolation: 'remote'`)
    starts the agent before `next(e)`, known by its call's `tool_use_id` (its own `agentId` comes only in the result).
    The result ends it, and `agentCall()` runs first after `next(e)`, ahead of every other observer, so a fault in them
    cannot skip it: done on a `status: 'completed'` record, failed when the call was denied or errored (`failed` for a
    foreground agent is the call's). Any other record (a teammate joining, `status: 'teammate_spawned'`; a launch in the
    cloud, `remote_launched`, which an agent definition can force; a result that is no record) was no subagent finishing
    there, so its entry is dropped (`drop`), and the slots go if it was the last. Its "started" line stays in the log.
    A foreground agent cannot outlive the main loop's turn: `turn.complete` first fails any entry still at work that is
    not a background job (`sweepAgents()`), as an interrupted call or a fault never brought its result.
  - *Background.* A result with `status: 'async_launched'` and an `agentId` is a launch. The agent is known by its
    `agentId` (a call that started as a foreground one, and was sent to the background while it ran, comes back
    launched too: `rekey` moves its entry to the `agentId`, and no second "started" line is written). It is a job
    (`jobs[agentId] = 'agent'`), so "N jobs running" counts it.
  - *The end of a background agent* is either a task notification (`prompt.submit`, `endJobs()`) whose `<task-id>` is the
    agentId: `completed` is done, `failed` and `killed` are failed; or its own `turn.complete` carrying that `agentId`
    (done when the turn `reason` is `answer`, else failed); or a successful `TaskStop` naming it (failed). Only an agent
    that is running can end, so a late failure does not undo a finish, and an end for an id the source never saw
    (a shell's notification, a subagent's turn from a workflow) changes and writes nothing. Whichever comes first ends it.
    Limit: a background agent that neither channel ever reports stays at work, and as a job it keeps a run "running" and
    never `waiting for you` or `paused`, until `session.start` (a resume) leaves it lost. Both channels are proved in the app,
    so this is rare; nothing sweeps a background agent at a turn's end, as one legitimately outlives it.
  - A subagent's own `Agent` calls (an `agentId` on the call) are not the main loop's and are not listed. A launch with
    `status: 'remote_launched'` or a teammate record is not listed either (see Foreground: dropped when the call was not
    explicitly background).
  - `session.start` marks every agent still at work lost (`lose`: failed, with `lost`) and clears `jobs`, so a resumed
    session never counts one as running. But it carries no reason, and a reload, an enable or a respawn keeps the process
    and its agents, so the sweep's failed is provisional: any later sign of the agent's life undoes it. A tool call of its
    own (`revive()`, by its `agentId`) brings it back to work (`live`) with its job, so the main loop's turn ending reads
    no false `waiting for you`; its notification or its own turn's end ends it as they say. A real resume, where nothing
    comes back, keeps the sweep's result. Only a background agent goes by its own id, so a lost foreground one comes back
    only by its call's result.
  - The auto-log writes `agent started: <description>`, `agent finished: …`, `agent failed: …` and `agent lost at
    reload: …` for a live run only
    (`agentSaid()`); the description is cut by `fit()` there and by the gate (40) in the slots. A subagent's other tool
    calls count on the board as before and write nothing.
  - `/hud mute agents` takes the two slots out of the drawing; the log lines stay, as the observer's, as with every source.
- **Strip first.** A new run shows only the strip, one that started on its own too. The pane opens only from the strip's Expand; `/hud`
  brings back a strip hidden with ✕, and prints the run's full title, goal and facts.
- **Clocks on every item.** Each widget and tile carries when it last changed (`at`), who changed it (`by`: `claude`,
  `observer` or a plugin's name) and the run's `ticks` then (`tick`; a tile's live in `tileClock`). `ticks` counts the
  main loop's tool calls during the run, so a quiet session ages nothing, and neither do a subagent's calls; age is
  `ticks` less `tick` (`life()`). At `AGING` (12) a block draws every mark and text in the dim tokens (`--dim`, 3:1;
  `--dim-t`, 4.5:1. The text by a style rule; the marks repainted by `dimmed()`, every fill and stroke but the quiet
  tokens and a tick's white, a gradient wash kept a wash at .12, so no hue slips past and states still read by
  shape) and the pane's aside says
  when it changed ("3m ago", aging and stale only), as of the run's last main-loop call (`tickAt`), never now: the
  image changes only when a call does, as ticking text stays out of the SVG. The strip's default pick takes fresh
  items first. At `STALE` (24)
  the HUD check after a tool result names the stale widgets of Claude's by id and type, once each (`named`), instead of
  the general check when both are due, in 160 characters: `your hosts stat hasn't changed in 24 calls while you ran 9
  ssh commands`, the calls since any of them changed and the shell head run most in those calls (`ran`; left out when
  the record no longer reaches back that far, or the line would run past 160). Ids and heads only, never a value. While an earlier check is unanswered it waits for that check's backed-off
  window (see "It follows the work"). A phase boundary is a phase change, a rebuild or the main loop's
  `turn.complete`: `boundary()` marks what is stale with the boundaries passed (`staleAt`), and what has been stale
  across `RETIRE_BOUNDARIES` (2) leaves the board with a "Retired …" line by the observer. Any update makes it fresh.
  Slots keep their own `at` and sender and stay fresh; their sources clear them. The thresholds live in
  `lifecycle.ts`. A 1.4.0 run with none of these fields reads as all fresh.
- **Widgets fill themselves** (bindings). A widget Claude sends may carry
  `bind: { on, match?, extract }`; `apply()` checks it (`rebind()`) and keeps it through later updates that don't send
  one. `on` is `shell` (`match` is in one of `heads()`' entries: `cd x && npm test | tail` matches `npm test`), `edit` (the
  path ends with it), `fetch` (the host ends with it), or, with no `match`, `measure` (the context's fill, as `tokens of
  window tokens, percent%`), `agents` (the main loop's `Agent` result) and `plan` (the task list's done/total, as the
  mirror holds it). `match` is plain text, never a pattern. A binding that can't stand, or a widget that holds no one
  number (a list, a grid, a checklist), is left unbound, and the tool's answer says why: `bind on hosts: match must be
  text for shell`. So is a match the HUD could never see, which would never read, never age and keep the general check
  away for the whole run: a shell match that `heads()` itself doesn't keep (`./run-tests.sh`, `pytest tests/unit`,
  `npm test --ci`: `match must be a command name, like pytest or npm test`) and a fetch match with a `/` or `:`
  (`match must be a host, like example.com`). The vocabulary is in the `bind` property's description, said once, on
  `widget` (`widgets` takes the same shape without it); the tool's own stays within 2,048.
  - **What a match can't be.** A head is the program and up to two plain lowercase words after it (of the four that
    follow), so a command is matched by those and by nothing else. A word with a colon, a digit, a dot or a slash is not
    kept: `npm run build:prod` is `npm run`, `rails db:migrate` is `rails`, and `npx sequelize-cli db:migrate` is `npx
    sequelize-cli`, so `build:prod` and `db:migrate` can't be matched (`validBind()` refuses them) and the command is
    bound by its program or its plain words (`rails`, `npm run`). Only two words are kept: `kubectl rollout status
    deployment/web` is `kubectl rollout status`, and has no "deploy" for a `deploy` match. A flag, a path, a quoted word
    and anything after a pipe are not kept either. `heads()` (hooks/sources/tools.ts) says what a command is, and a match
    that isn't in its head never reads.
  - **A program that runs for anything can't be the match.** `heads()` keeps no flag, path or URL, so a match of `curl`
    is every `curl` of any URL, and `tail` every `tail` of any file: what they print is anyone's data, and curl exits 0 on
    a 503. `validBind()` refuses a shell match that is only one of `READERS` (`curl`, `wget`, `tail`, `head`, `cat`,
    `echo`, `printf`, `grep`, `rg`, `jq`, `ssh`; case and spaces ignored) with `curl runs for anything; bind a script of
    your own, like health-check`. A script is found by its name: `health-check` matches `./health-check`, `bash
    health-check` and `/opt/bin/health-check --all`; a name with a dot (`health.sh`) only when run itself
    (`./health.sh`), as `bash health.sh` is `bash`. The list is a list, so a reader not on it still matches broadly, and a
    match with a word beside it (`ssh uptime`) is narrower and stands.
  - Each finished main-loop call that matches is read with `extract()`, but never one denied, a subagent's, a task-list
    call that failed (it changed no list), or a job sent to the background, which has no result yet (a shell's
    `backgroundTaskId`, an `Agent`'s launch: `agents.launched()`). Those are no reading and no miss; a background job's
    real output (its notification, TaskOutput) isn't read. A reading
    fills the widget (a stat's value with its unit, `failed, 39 passed` or `of 938`; a gauge, ring or meter's value and
    range; a line's next point; a text's words), drops Claude's `delta`, colours a pass/fail or exit by its outcome,
    and stamps the clock as `by: 'observer'`. The widget is still Claude's: `claude/<id>` as a key, named in `shows()` and
    the pointed check (only the plan mirror is the observer's, `isMirror()`).
  - **A failed call** (errored or non-zero; a denied one is never read) is read by `exit` (it is 1), `pass_fail`, and by
    `duration`, `n_of_m` and `percent`, which report the last progress the command printed before it failed, true as far
    as it went. **`last_number` reads nothing from it, so it is a miss:** the output of a failed command is mostly its
    error, and the last number in an error is a line, a code or a count from it (`error at line 17` is not 17). `extract()`
    returns nothing for that pair, so the widget keeps its last reading and the call counts against it.
  - A call that matches and doesn't parse is a miss (`bound.misses`). A bound widget's age is its misses in a row, so it
    waits for its own command however long the work goes elsewhere, and dims and goes stale by misses. Stale, both
    surfaces draw it through `unread()` as a stat that says "no reading", in its place with its title and clock, never
    its old number; the run still holds the number, and the next reading brings it back.
  - A bound widget is fresh only with a reading someone stands behind. Its misses start over on a reading, on a value
    of Claude's (a `value`, `points`, `push` or `text` in the same call), or on a changed binding (`on`, `match` or
    `extract` differs, or there was none), whose counts start from none: it ages from zero under its new command. The
    same binding sent again, or a title, keeps them. When Claude changes the binding or updates the widget without a
    value, the observer's last reading (its value, points, text, unit and tone) goes, and `unread()` draws "no reading"
    until the next one, as it does for a bound widget that has never read. A widget still stale after an update stays
    in `named`, so it isn't named again at once; one a new binding made fresh is free to be named when it goes stale.
  - While a bound widget has seen its calls (`bound.seen`: a reading or a miss), the general HUD check never goes; the
    pointed one names a stale bound widget as any. A binding whose command never ran mutes nothing: it never ages, so
    it would never be named, and the run is checked as if nothing were bound.
- **Recipes** (`hooks/recipes.ts`). `recipe` on a `start` or a `rebuild` names one of seven kinds of work
  (`build`, `test-fix`, `refactor`, `migration`, `rollout`, `research`, `remote-job`), and the HUD lays the widgets and the
  strip pick that work needs. They are data; nothing in the module is a number, and **none is a command.**
  - **A recipe guesses no command.** A guess read figures nobody stood behind: `ls build`, `rm -rf build` and `mkdir -p
    build` as a passing build, a docker step's "DONE 0.1s" as its time, a fly deploy's `[4/4]` as hosts done, curl's exit 0
    on a 503 as healthy, "50000/120000 rows" as tables done, "val_acc 91.2%" in any `tail` as progress. So every widget is
    laid unbound and with no value (`RECIPES` holds no `bind` and no `match`, and a test pins that). The one meant to be
    read from a command carries the binding it wants (`wants`: `on: 'shell'` and the `extract`), which `widgetsOf()`
    takes off before it is laid and `laid()` reads for the answer. Claude names the command: it binds each widget to its
    exact command, and the extract is the recipe's. Until then a widget draws "–" (a line "Waiting for data…"), and "no
    reading" once it is bound and has read nothing (`unread()`).
  - **Laid as Claude's own.** `apply()` puts a recipe's strip in ahead of Claude's `strip` and its widgets ahead of Claude's
    `widget` and `widgets`, in the same loop: stamped with the run's clock (`by: 'claude'`), merged by id and checked by
    `rebind()` and `validBind()`. A recipe never bypasses them: a binding that can't stand is dropped and named (`bind on a:
    …`) as Claude's would be, which a test shows by putting one in a recipe. So Claude's fields in the same call override
    the recipe's, field by field (its `bind` binds the widget, its `strip` replaces the pick), and so does any later call by
    id. A recipe on a call that neither starts nor rebuilds lays nothing and is told where it goes; an unknown one
    (`recipe: unknown "bake" (recipes: …)`, cut at 20 characters, case and spaces forgiven) is named back with the seven
    and lays nothing, the call's other fields applying. The run keeps no `recipe` field, so a run from before loads as it
    was.
  - **The answer is the layout as it stands** (`laid()`, built after the call's widgets, removals and bindings, so it
    says what is left, spliced in ahead of any `bind on <id>:` refusal): `Recipe build: bind build exit, build-time
    duration to your exact shell command, e.g. {id: 'build', bind: {on: 'shell', match: 'make', extract: 'exit'}}. Send
    progress yourself.` Ids and kinds only, never a value, under 260 characters. The example is the recipe's own
    (`example`: a widget id and a script's name, never a program in `READERS`): `make` for build, `migrate-tables`,
    `health-check`, `train-status`; it goes once its widget is bound or removed, and a recipe that wants nothing bound has
    none. A widget Claude bound, removed or filled in the same call is out of it; one whose binding was refused is still
    in it. The recipe's `note` ends it: what the HUD already keeps for this work, or what Claude sends itself, and for
    the rollout and the remote job why not `curl` or `tail` (they match every call).
  - **Nothing duplicates the HUD's own.** Tests are `hud/tests`, whose points are the failing count of each run; files
    edited are `hud/edited`; the plan is the task list's mirror or Claude's phases; the sources fetched are `hud/fetched`,
    a list the pane draws. A recipe names them in `strip` and lays no second reader, so `refactor` lays no widget at all,
    `test-fix` only `attempts` (a count no command prints, Claude's to send) and `research` only `questions` (Claude's
    items). The parts of a strip the HUD already has (progress, phases, errors, the
    trend, the plan) are named too; the host grid, the countdown and the phases are Claude's own fields (`cell`, `next`,
    `phase`). The widgets a reading fills are stats and lines, not rings, gauges or meters, which draw "0%" with no value.
  - **Titles say what is read, not what it means**: `Build exit (1 = failed)`, `Build: last duration (s)`, `Migrate: last
    N of M`, `Deploy: last N of M`, `Health exit (1 = failed)`, `Health: last number`, `Job log: last percent`, `Job log:
    last number`. The reading is the command's last exit (1 if it failed), duration, N of M, percent or number, whatever
    command Claude binds; Claude retitles a widget when its command makes the reading mean something (a log that ends in
    its loss).
  - **Limits.** Binding is only as good as the command: a `last_number` on a command that prints something else last
    shows that number (never from a failed call, which is a miss), a bound `duration` reads the last duration printed,
    which can be a step's and not the whole run's (docker's "DONE 0.4s", a "1h" column in a table), and bound to a
    command that prints nothing the widget reads "no reading" and, by misses, stale. The forms a match can't take are
    above (under Widgets fill themselves).
- **The strip** offers small, medium and large variants of each item. A fit pass starts everything at
  its smallest, drops the least important item while the row overflows, then grows items by priority
  per size. Items sit packed from the left, top-aligned, with hairline separators and no card
  backgrounds; a flexible one (a chart, a chain, a list) grows to twice its size at most. Its height is the
  tallest item shown. The pick is progress, errors, figures to fill, and where the work is
  (phases, else the plan checklist, else the trend), which always makes the four; then the slots the arrangement
  placed (see Who decides; with none yet, Claude's figures count among the run's own). Errors outrank the
  work's place only past 5% of calls. The call count is never the only item: a run with nothing to draw
  shows its header alone. Text is 11px at least.
- **The band on desktop** is a header over the strip: the status, the title (two lines at most, wrapped
  and cut in the module) with the goal on a dim line of its own under it, in the room the row leaves, the facts the strip doesn't draw (the clock always; progress, the current phase
  and errors only when `strip()` left them out), a quiet Expand (no `variant`) and the app's own close
  control (`role="dismiss"`, labelled ✕: a desktop that predates the role draws the label). While the dashboard is open it goes minimal: one line of status, title,
  Collapse and ✕, as the pane beside it shows everything else, and the conversation gets the height back. The title keeps a
  floor of the row and the step in hand takes what is left, so the buttons are never cut. Whether the
  dashboard is open is read from the dock (`$.ui.panes()`). The line under the strip skips goal changes,
  which the header shows.
- **Text that fits.** A cut that only the person sees never gets fixed, so the fix starts with the writer:
  - **Claude writes to a budget.** Each text field's description in the schema gives its room (`BUDGET`):
    title and goal 60 characters, a log line or summary 70. That's one line at about 90 columns, read off
    the trial. The tool's answer names any field that ran over, and by how much, so the next one fits
    (`answer()`).
  - **The run keeps the text whole.** The dashboard's native header wraps the title and goal, its log gives
    each line two, and `/hud` prints the title, goal and facts.
  - **Raw text has no writer to ask** (log lines carrying paths, URLs, hashes, terminal output), so
    `fit()` cuts it by its structure:
    - first it tidies colour codes and runs of spaces;
    - then it shortens what says least: a hash to its first 7 characters (a uuid to 8), a URL to its host
      and last part, a path to its last two parts and then its file name;
    - only then does it cut the words: at a sentence's end, else a comma outside brackets, else a word.
      Never just after a colon, which promises what the cut hides, and never on a little word ("on a…").
    - Each softer cut must keep 60% of the harder one. A cut lands mid-word only when one word is wider
      than the room.
  - **The title still wraps to two lines and the goal has its own** (the person's pick over shrinking,
    which native text can't do, or a marquee, which is motion beside the reading and fails WCAG 2.2.2).
    The band's last line is fitted in the module too, because the app's own cut lands mid-word. No hover
    cards: the band doesn't reveal them.
- **Other plugins send slots, and only the HUD draws.** `$.hud` takes one slot per call (a noun's input is
  one object). Each call raises `hud.<method>`, and the HUD's own hook, innermost, runs the gate: plain data,
  declared ids and patterns only, unknown fields dropped, lengths cut, no colours. What passes is held in
  `$.state` as `<plugin>/<id>`, tagged with `next.origin.plugin`, the host's word for the sender, never a field
  the sender sets. The payload is only data: any plugin can hook `hud.push` and change it on the way (proved in the
  desktop app, 2.1.295), so the sender's name is what the HUD can vouch for. A source declaring again replaces its
  declaration, and a slot it no longer declares goes. Slots live in `$.state`, not the module, so a reload
  keeps them. If the HUD's hook fails, the noun's own method answers `{ ok: false, why }`. `SOURCES.md` is what a
  source's author reads; the template shows the code. A source catches every `$.hud` call with `try`/`catch`, not
  `.catch`: with no HUD loaded `$.hud` is undefined and `$.hud.declare(…)` throws before it returns a promise.
- **Slots on screen.** In the pane every slot is a block of its pattern, titled, with why it's there under the title,
  its note under that and `from <plugin>` beside it (the HUD's own go unsigned). In the strip (desktop) slots in the
  strip's patterns (stat, gauge, ring, meter, line, checklist) fill what the run's own items leave of four, and drop
  first when the row is short. Claude can name one in `strip` by its key (`hud/context`). The urgency place leads the
  strip ("⚠ Urgent" and a sentence), never dropped and not one of the four. The terminal draws the same (next item).
- **The terminal draws the board too.** What the desktop strip and dashboard show of
  auto-run, the clocks, the auto-log, the slots with their why, the urgency place and the mode, the terminal's band and
  pane show as text, by the same rules; `hooks/terminal.test.tsx` loops each over both surfaces. The pane (`Pane`, no
  `Svg`) is the whole board, ranked, as it was, plus the urgency line and the tiles' "ago" (Claude's tiles, then the run's
  own counts apart, errors only above 0, as the dashboard draws them). The band (`AbovePrompt`) is a
  header, then lines under it, and with the dashboard open it keeps what the desktop's keeps, a line of status, title and
  its two buttons (no goal, facts, progress bar, urgency line, slot lines or last line):
  - **The urgency place** is the first line of the band and of the pane: `⚠ <says>` (`alarmLine()`), bold, in the colour
    of its slot's tone as it stands now, as the desktop's mark is (`c.tone(slot.tone)`): bad red, warn the warning colour,
    good green (a held one whose slot is good again never wears the alarm of a state that has passed), info blue, none or
    accent the accent. Live, as the strip's, and at no boundary.
  - **The band's lines are exactly the items the desktop strip chose**, in its order, from the same function: `stripPicked()`
    runs `choose()`, so the arrangement's slots, the run's own items (a tile, the trend, Claude's line widget, the plan, the
    call count) and, before the first boundary, the default pick are all there, and nothing is derived twice. Progress,
    phases and errors are the header's (its bar and facts); a step the plan's line says is not also a fact. A slot is the
    board's entry as it stands now (`bandLines()` over `board()`): its figure, its why and the tone word
    (`Changed 2 calls ago · warn`) are never the stored ones, and one hidden or whose sender was muted since the boundary
    draws nowhere. A new slot waits for a boundary, as in the strip.
  - **Nothing is left to the terminal to cut, and no number is cut.** Every text that can be cut is fitted to the columns
    it has, in the module, and never right after a number (`cutText()`: "18,2…" would read as 18). A slot line is `title:
    figure`, then its why (`fitLine()`); when it is too long the why gives way first (cut at a word, and dropped when one
    word is left), then the figure's own spark or bar shrinks (a line: the last value, then its spark; a gauge, ring or
    meter: its value, what it is of and then its bar, the number the desktop headlines, never its share rounded; a
    checklist: done of total, then the step in hand in whole words), then the title is cut; a figure whose number has no
    room even then drops the line whole. The figure is also in a box that never shrinks, so the terminal cuts the title or
    the why first whatever the width math says. The header (`headerOf()`) is budgeted the same way: the buttons take
    theirs, the title keeps a floor, the facts are kept by what matters (the errors, the step, the progress, the clock, the
    jobs: what the strip draws outranks the clock), each whole or dropped, and then what is left goes in the order: the goal
    whole, cut at a word, then dropped; the title cut; the progress bar last, a leftover of 10 columns or more, else none
    (progress is a fact too). What the strip chose of the run's own (progress, errors, the phase) and the facts had no room
    for is a line of its own ("Errors: 1 of 4 calls", "Phase: 3 of 4  ▸ Rollout"), never dropped while the desktop strip
    shows it. The last line is `fitText()`: a path shortened first, as the desktop's is, then a cut at a clause or a word.
    **The pane is the same.** A block's first line is `title: figure` and then its note or its "· 3m ago"
    (`blockLine()`, the figure in a box that never shrinks, number first, a line's forty points and a list's items as the
    fullest figure), its why the line under it (`cutText()`); a block with no room for its figure beside its title gives it a
    line of its own, wrapped, whole. The log's lines are `fitText()` after their stamp, the urgency line `cutText()`, the
    progress line is the number then a bar in what is left, the trend `last 12` then its spark. What is prose (the title,
    the goal, the summary, the Sources list's access lines, which are shown as written, the mode lines) wraps as Ink wraps
    it, whole: nothing the pane draws is left to `truncate-end`. In a band too narrow to hold its status word beside its
    buttons (under about 35 columns), the dot's colour says it, as it does for a running one.
  - **A widget of Claude's that has sat** is dim in the band's line and the pane's, and the pane says `· 3m ago`; a tile
    in the pane says it as a line under its figure, as the dashboard's block does in its aside. Source slots stay fresh.
  - **A status but running** says so in words in the band (`● Waiting for you  …`, `Paused`, `Done`): colour alone was
    its only mark. The provisional title is dim in both, the observer's log lines are dim in the pane, and the band's
    last line is the same `lastLine()`.
  - **The mode** shows as the why of the slots it put first (`Debug mode`) and in the pane's Showing block; the desktop
    band has no label for it either. **No pane buttons and no hover** in either: the band has the two buttons it had.
  - **Hidden never shows**, not even as the urgency place: `heldNow()` leaves out a hidden slot (as it leaves out a muted
    sender's), so the hide of a slot that raised an urgency takes the urgency away at once, on both surfaces. A hidden
    slot is still held and gated, so `/hud unhide` is instant.
  - To read the band where HTML can't say what fits, `node dev/cells.mjs dev/out/trial.json band [scene]` lays the trial's
    terminal views out as text lines at their widths (`hooks/cells.ts`, an approximate Yoga/Ink layout) and flags an
    overflow. The width test sweeps every width from 30 to 170 with the same model.
- **Who decides** (`hooks/rank.ts`). One board: Claude's widgets are slots too (`claude/<id>`;
  the plan mirror `hud/plan`), so they rank beside the sources'. A bound widget is Claude's though the observer fills
  it: `isMirror()` decides, never `by`, so it is `claude/<id>`, ranked and focusable as Claude's, and a reading stamps
  its `n` (`observe()` in bind.ts). The order: the person's pins, then Claude's focus
  (the ids in its `strip` first, then `focus`), then the mode's slots, then the score, `severity × 0.5 ^ (calls since
  it changed / 12) + 0.5 × hint` (bad 3, warn 2, none, info or accent 1, good 0.5); ties go to `inOrder()` (Claude's
  widgets first, then the HUD's own, then each plugin's as it declared them), then the key. Recency is `n`, the
  session's main-loop calls when it changed (`calls`, counted as each call starts, whether or not a run is live; a `hud`
  call isn't counted),
  stamped by `hold()` on a slot and by `apply()` on a widget; none reads as just now. Hidden keys and muted senders
  never show: the run is drawn without the widgets the person hid (`unhidden()`), so neither the lead checklist nor
  the strip's trend brings one back, on either surface, and a hidden plan mirror takes the progress it brought
  (`settle()`; Claude's own progress stays). What is ranked, arranged, printed and drawn is one view of the run
  (`drawable()`: `unread()`, then `unhidden()`), so a bound widget with no reading has no tone, keeps its `n` (it ages
  from its last reading) and holds no place on the strength of an old one. Each placed slot says why, in words fixed here: `Pinned by you`, `Claude's focus`, `Debug mode`,
  `Urgent: …`, `Changed 2 calls ago · warn` (`just now` at 0), `Hinted by deploys` (only where the hint lifted it
  above a slot with none). The pane is the whole board as it stands, in rank order. The strip is decided only at a
  boundary (the main loop's `turn.complete`; a `hud` call with `start`, `phase`, `rebuild`, `mode`, `focus` or
  `strip`, after `intend()` has taken them; a run auto-run starts; the person's `/hud mute` or `unmute`, a repeat too;
  their `/hud mode`, `pin`, `unpin`, `hide` or `unhide` that changed something) and kept in `$.state` (`arrangement`:
  its slot keys, their whys, and the run's own items it gave room to, `frame`). Between boundaries values change in
  place and a new slot waits. At a boundary the run's own items (progress, errors, two tiles, where the work is) lead,
  the ranked slots fill what they leave of four, and pins lead them all; until the next, the run's own items keep the
  room they were given, and a new one (a first failed call, a new tile) takes only room still free, so no slot is
  pushed out: the pane shows it at once, the strip at the next boundary. The urgency place is the one exception. So nothing
  flip-flops, a slot that left the strip waits `WAIT` (3) boundaries before it may come back, unless it changed since,
  the person pinned it, or the person unhid it or unmuted its source. `/hud` prints one line per slot in the strip with its why
  as it is now (the arrangement decides only which slots and in what order), and the alt says each block's why ("… — why"). A run from before the arrangement takes the default pick until its
  first boundary. The urgency place (below) is outside the arrangement: its slot leaves the ranked rest, leads the
  strip from the live `urgent`, and in the pane comes right after the pins with `Urgent: …` as its why
  (`urgentFirst()`); the band's alt, which leads with the urgency, doesn't say it again for the slot. One counter: the
  boundaries the arrangement adds to the run's (a `hud` call's `mode`, `focus` or `strip`, and the person's commands)
  go through `boundary()` too (`crossed()`), once each, so `run.boundaries` counts them: an urgency hold ends on them,
  and a stale widget retires on them. With no live run nothing counts, and the urgency is weighed as at a turn's end.
- **The urgency place** (`hooks/urgency.ts`) is the HUD's alone: four rules over slots whose sender is `hud`, first rule
  first, one at a time, each saying one sentence. `from` is the host's word, so an outside plugin's slot, whatever its
  tone or hint, raises nothing.
  - U1 `hud/limits` at 85% or more: `5-hour limit 88%; resets in 40m` (the title and the note's reset, from the slot).
  - U2 `hud/failing`, its top item failed 3 times in a row: `npm test failed 3 times in a row`. A call the person denied
    never ran, and neither fails a command nor moves the work on (nor counts among the run's errors).
  - U3 `hud/tests` failing, its previous run passing: `Tests: 2 failed (were passing)`. The previous count is the one
    before the last in the slot's `points`, which the tests source publishes from its own `testResults.failed`; no
    second memory.
  - U4 `hud/context` at 85% or more: `Context 87%; compaction is near`.

  It shows at once and holds until the next boundary after its rule stops holding, so it never flickers: `urgent`
  in `$.state` carries `heldTo`, the count of boundaries (`run.boundaries`) that ends it. A boundary is whatever
  counts there (a phase or a rebuild, the main loop's `turn.complete`); with no live run nothing counts, so a main-loop
  turn's end ends the hold. An earlier rule takes the place from a later one at once; a later one waits out an earlier
  one's hold. Muting a source takes its urgency away at once. "None" is `null`: state holds JSON, and has no undefined.
  The desktop strip draws it and the band's alt says it first; the terminal's band and pane lead with it as a line
  (see "The terminal draws the board too").
  - **A held one never claims a state that has passed.** Once its rule stops, the place keeps its position (that is the
    hold) but says the slot's own note as it is now (`npm test: 50 passed, 0 failed`, never "Tests: 2 failed (were
    passing)" after the tests went green; the slot's title when it has no note) and takes the slot's tone as it stands
    (the strip's mark is `c.tone(slot.tone)`). With the slot gone (cleared, or its source muted) the place is empty and
    the hold ends. The sentence reaches no one but the strip: no note to Claude carries it, standing or held.
  - **A fault in it costs nothing else.** `weighUrgency()` swallows its own faults, as it rides the `hud` tool's answer
    and every other tool's finished call: a fault there must not make the `hud` call say "it is unchanged" after the
    run was updated, nor run a finished call again. The place keeps what it had until the next weighing.
- **Trust is attribution.** The pane ends with a Sources list: each source's name, its sender
  ("HUD" or "from deploys"), the access line it declared, shown as written, its slots, "muted" when it is,
  and a line saying how to mute. Muting is by command, which answers with what it did. A mute is kept by key: a plugin's name, or `hud:<source>` for the HUD's own three, which you can mute one at
  a time. It's mirrored in `$.state` (`muted`) for drawing and written to `$.store`, which `session.start`
  reads back (a store that can't be read leaves none muted). A muted source's slots are still gated and
  held, so unmuting is instant; they just aren't drawn. `/hud sources`, `/hud mute <name>` and
  `/hud unmute <name>` take a plugin by its name and the HUD's own by theirs (`test results`).
- **The person decides what shows first, then Claude.** Four values in `$.state`, which the ranker reads
  (absent reads as the default, so an older run loads): `mode` (build until set), `modeByPerson`, `focus` and `prefs`.
  - **Mode.** `/hud mode <name>` sets one of the five (`MODES`), sets `modeByPerson`, and holds for the session (it
    is not kept in `$.store`). Claude's `mode` on a `hud` call applies only while `modeByPerson` is false; once the
    person has chosen, the tool's answer says so, so Claude stops sending it. `/hud mode` alone lists the five and
    the current one. A mode the person didn't set reads "(Claude's pick)" in `/hud` unless it is build.
  - **Focus.** Claude names up to three slot keys that matter now (`hud/tests`, `claude/<widget id>`,
    `<plugin>/<id>`; the plan mirror is `hud/plan`). They are kept as sent, even an id the HUD doesn't hold, as a source's
    slot may not have been raised yet; the answer names an unknown one (`focus: unknown hud/x (known: …)`), ids only,
    never a slot's value or note, so a source's text cannot reach the model through it. An empty list clears
    it; junk changes nothing. A `start` clears Claude's focus and its mode (never the person's): they belong to the task.
  - **Pins and hides** are the person's alone (Claude has no field for them), by slot key, kept in `$.store` under
    `prefs` and mirrored in `$.state`. A key is in one list at most: hiding a pinned slot unpins it, and pinning a hidden
    one shows it. Pin and hide take only a key the HUD holds; an unknown one is answered with the keys it does hold.
    Unpin and unhide take any key in the list, as a slot may be gone by then.
  - **By command only,** no argument completion (`prompt.autocomplete` is unproved on desktop) and no pane buttons.
    `/hud` and the pane's Showing block print the mode, the pins and the hides, with no run live too.
- **The HUD's own sources** are written as if they were other plugins and pass the same gate, under the
  HUD's own name (`hud/tests`, `hud/context`), against their own declarations. They call the gate directly:
  the HUD's call on its own noun isn't proved to reach its own hook. They read every finished call, a
  subagent's too, whether or not a run is live, as slots outlive the run. A call counts as failed when the
  model read an error (a deny or `isError`), and a shell run's result text is read for test counts, from a
  runner's own summary lines only (bun and `claude plugin test`, `node --test`, jest, vitest, pytest, mocha,
  cargo): a count in a log line or in test code is no test run. The tests note names only the counts the run printed (`claude plugin test: 3 failed`
  when a pipe cut the pass count); a runner's errors count as failed (pytest's `3 passed, 2 errors`; an error that
  escaped every passing test, on vitest's `Errors  1 error` line and bun's ` 1 error`), and a jest suite
  or a vitest file that failed beside a tests line with no failed count gives no count, never 0 failed (the `pass_fail`
  extractor reads both the same way); a pass count alone reads as none failed, as jest, pytest and mocha print no fail
  count then.
- **Text is plain.** Claude writes markdown out of habit; `plain()` drops paired inline marks (`` `code` ``,
  `**bold**`, `[text](url)`) wherever the HUD draws text, native or SVG. Lone marks stay (`a ** b`,
  `__init__.py`). The pane's summary is in text colour, with a coloured ✓ or ✕ beside it.
- **A checklist can be the plan.** With no progress or phases, the first checklist with items stands in
  for them (`leadList()`): it leads the dashboard, the strip's default pick shows it, and `stepNow()` gives the
  band's header its current item. Failed calls are a note under the call count, not a figure of their own.
- **The plan mirrors Claude's task list.** A finished call of the main loop's task-list tool (`mirror()`; a subagent's
  or a failed one is skipped) updates the plan, held in `$.state` (`plan`: items with ids, as `TaskUpdate` names an
  item by id, and `TodoWrite` gives the place in its list) whether or not a run is live. A live run takes it as the
  checklist `plan`, owned by the observer (`by: 'observer'`, stamped with the run's clock). Nothing reaches the model.
  Claude's lead wins: where Claude has progress, phases or a checklist of its own, the mirror is kept and not drawn
  (`leadList()` puts Claude's checklist first; `hiddenMirror()` leaves it out of the strip, the dashboard, the alt
  and the terminal pane), and its figure goes too, as two plans' counts side by side would read as one. A widget of
  Claude's by the id `plan` is left alone. While the mirror leads, the run's progress is done ÷ total
  (`label: 'steps'`, marked `progressBy: 'observer'`); `settle()` keeps that true after anything that changes the
  widgets, the phases or Claude's progress (`apply()`, `intoRun()`, `boundary()`), so the figure goes when Claude's
  lead comes, returns if it goes, and goes with the plan when the plan is removed, taken over, rebuilt or retired.
  Claude's own progress is never replaced, and replaces the mirror's when it comes. The mirror ages as any widget does,
  but is never named in the stale-widget check (it is not Claude's to update). A rebuild clears it with the rest of
  the layout; the next task-list call brings it back. A list
  that was written before the run began shows at the first task-list call after. **Idle in the desktop app:** its
  Claude Code (2.1.295) offers no task-list tool (the platform probe: only `TaskStop`), so the mirror is built
  against the tool types in `.claude-plugin/types/claude-code-tools` and proved only in the test kit. The
  README says it is idle on desktop ("Not yet") and makes no claim that it works there.
- **The dashboard** has the same look: no cards, blocks on a 4-unit grid divided by hairlines (vertical
  inside a row, full width between rows), each with a sentence-case label row and a muted aside. Order:
  the progress figure (with phases beside it when 4 units fit; a chain names every step only while each
  name fits whole, else it becomes a segmented track with the current step named under it), the run's figures (its
  tiles and the call count) in balanced rows of at least 150px, the grid, then the trend, counts, Claude's widgets and
  the slots in rank order (see Who decides), noticed, log.
- **Marks:** one colour per series, text in text colours (the mark beside it carries the colour), 2px
  lines, bars with a rounded data end, labels on extremes only. Figures are set in a serif on purpose,
  with lining tabular numerals in the strip and the dashboard alike.
- **Accessible by default.** Status hues (`TONE`) are for marks; text in a status colour takes its `-t`
  token, ≥ 4.5:1 on both backgrounds of its theme, and a to-do mark takes `--todo`, ≥ 3:1. Tracks stay quiet
  as every one has its count in words beside it. A state is told by shape as well as colour: a tick, a
  cross, a warning sign, a bar in hand, a ring to do. A change is green or red only by its figure's
  `better` (up or down); without it, neutral. Both SVGs' alt is `describe(run, slots)`. Dashboard text is 12px
  at least; a block's label wraps to two lines, and its aside moves under it when they don't share one.
- **Chart palette** (`--c1..c6` in the dashboard `<style>`, stepped per theme): clay, blue, ochre, teal,
  violet, rose. It passes colour-blindness, chroma, lightness and contrast checks on both surfaces
  (#FAF9F5 light, #262624 dark); re-check any change with a palette validator. Only the donut uses it;
  the accent is `ACCENT` (#D97757), shared with the strip.

## Constraints learned the hard way

- **Proved in the desktop app (Claude Code 2.1.295 bundled)** with a probe mod, marker runs of the app's own
  `claude.exe` and screen captures. Re-check after the app updates its Claude Code.
  - **Tool description: 2,048 characters reach the model.** Property descriptions arrive whole (8,100
    seen). The separate 2.1.296 CLI sends 4,096, but the app runs its own 2.1.295.
  - **One dock for every mod's pane.** Another mod's pane can take it with no `ui.close` for ours, so
    whether the HUD's pane is open is read from `$.ui.panes()` (`isShown`), not trusted from `paneOpen`.
  - **The band is one plugin's.** The plugin loaded first (the installed HUD, from
    `CLAUDE_CODE_PLUGIN_DIRS`) answers `AbovePrompt` alone; a dev-mods copy draws only when it passes.
  - **Conversation rows.**
    - Wrapping the app's drawing (`<Box>{line}{await next(e)}</Box>`) works on `AssistantMessage`,
      `UserMessage` and `CommandOutput`.
    - On `ToolGroup` it drops the app's row and its chevron, and an `isExpanded` rewrite doesn't unfold the
      group. On desktop every kind of call folds into those groups.
    - `ToolUse` and `ToolResult` rows don't draw while folded, and the edit cards are the app's own.
    - No row reports `onScreen`.
  - **Not drawn on desktop:** a `SessionMode` rewrite, `PromptHint` (never raised). `$.ui.notify` answers
    `no-surface`. `$.command.run` and `$.prompt.submit` from a hook never ran.
  - **Drawn on desktop:** `$.ui.status` (the footer, right side), a `Spinner` rewrite, a hover reveal (keyed
    `Box`, absolute card, `hover: { display: 'flex' }`) over an `Svg` in a **pane**, `Text` hover colour,
    `Client` (boxes and text only; pointer events arrive, key presses never did).
  - **No hover reveal in the band.** The same absolute card in a hover group never showed above the prompt,
    over the title or the strip. The band's cut text goes to `/hud` instead.
  - **A hook's `$.ui.close` and its own `ui.close` hook:** moot now that the band reads the dock.
  - **A noun from `engine.create` (`$.hud` in 2.0)** loads, is typed in the plugins that depend on it,
    and tags each call with its real sender (`next.origin.plugin`). But:
    - any plugin can hook its events and change another's payload;
    - the HUD's `plugin.register` never sees the plugins that depend on it;
    - those plugins don't load without it;
    - `typeof $.noun` fails validation;
    - a reload resets module memory.
- **Proved in the desktop app (Claude Code 2.1.295 bundled)** with the platform probe (`dev/probes/`), loaded as a
  dev mod, logging each event it saw. Re-check after the app updates its Claude Code.
  - The tool description budget is still 2,048 characters.
  - No task-list tool: `session.start` and `prompt.compose` list `TaskStop` and no other task tool.
  - `turn.start` fires for the person's message, and also for a task notification's turn: a turn's start is not
    always the person's, so `prompt.submit`'s origin decides.
  - `prompt.compose` fires with `e.tools` (`mcp__hud__hud` among them) and the traits lean, print and skills.
  - `tool.call` fires for a subagent's calls, with its `agentId`.
  - `agent.spawn` fires before a subagent starts, and `next(e)` resolves `{ model, agentId }`.
  - Classic `SubagentStart` (also when a stopped agent is resumed) and `SubagentStop` fire with `agent_id`.
  - `turn.complete` fires for the main loop (reason `answer`, no `agentId`) and for a subagent (with its `agentId`).
  - `prompt.submit`'s origin is `task-notification` for a notification and `peer` for an agent's hand-back.
  - A background shell's result carries `backgroundTaskId`, and its notification's `<task-id>` is the same id.
  - `tool.check` answers `ask` in auto mode with no dialog shown, so `ask` does not mean the person is waiting.
  - Not proved: classic `PermissionRequest` (it needs a real dialog, and auto mode shows none) and
    `session.compact`. "Needs you" ships nothing.
- **Auto-run in the app (2.0.0).** Proved on desktop (the platform probe): `prompt.submit` fires for a background
  task's notification, whose text carries `<task-notification>`, `<task-id>` and `<status>` (completed, failed or
  killed); the types also say `origin.kind === 'task-notification'`, and the HUD takes either. A subagent's hand-back
  reaches `prompt.submit` with `origin.kind === 'peer'`, its text starting `<agent-message from=…>` (desktop
  2.1.295). The main loop's `turn.complete` fires (reason `answer`, no `agentId`; the platform probe), which is where
  "waiting for you" begins.
- **Agents source (2.0.0), proved and not.** Proved on desktop (2.1.295): a background task's notification
  reaches `prompt.submit` (above), and its `<task-id>` is the subagent's `agentId`; a subagent's `turn.complete` carries
  its `agentId`; `agent.spawn` resolves it. (The source uses the first two, the two ways a background agent ends, and no
  `agent.spawn` hook.) Unverified in the app, built against the types (`BuiltinToolResults['Agent']`) and tested in the
  kit only:
  - the `Agent` call's result record: `status: 'completed'` with an `agentId`; `status: 'async_launched'` with an
    `agentId` and a `description`; and that a teammate (`teammate_spawned`) or a cloud launch (`remote_launched`) is
    answered as the types say, which is how those are told from a finished agent;
  - that `tool_use_id` is on the call before it runs, so a foreground agent is at work for the length of its call.
  Re-check on the next app update.
- **`$.state.set` takes no `undefined`** ("value is not JSON data"): a key that goes empty is written `null` (`turn`).
  `undefined` inside an object is fine.
- **The trial stands in for `session.surfaces`** (someone watching). Without it the HUD's read of who's
  watching throws in the tool.call hook, and every answered call goes uncounted.
- **In `claude plugin test`, inline `plugins` fold in list order** (first = outermost) and load as
  standalone source: a hook there can't use the test file's variables (the engine skips it and says so). The
  plugin under test folds above the inline plugins of its own tier, so one meant to sit above it (a
  tamperer) goes a tier out (`tier: 'prepend'`). A test's own `$` has no `state`: an inline plugin reads it.
- **`$.state.get` and `$.state.set` take a literal `plugin` and `key`** (written there or in a `const` of the file;
  only `id` may be computed), so the values a module reads and writes can be listed. A plugin that reads state by a
  computed key doesn't load, which an inline test plugin shows as "hooks module did not load".
- **A Button in the pane never fired** (desktop, 2.1.295): pressing Mute in the Sources list never ran its
  handler (no store write). Not settled whether the pane or the `:` in its key (`mute:deploys`)
  is to blame; the band's buttons (`toggle`, `hide`) work. So the pane draws no buttons, and muting is by
  command. Prove a pane button with a plain key before adding one.
- **One unmatched hook per event per plugin:** a second `on('tool.call', hook)` stops the module loading
  ("registered twice without a matcher"), so the sources ride the HUD's one `tool.call` hook.
- **A noun's call takes one object** (proved in the test kit): `$.hud.push([...])` or `$.hud.clear('id')`
  is refused before any hook runs ("its input is no object, which the hooks on it take as e").
- **A shell run's exit status hides test failures** (`… | tail` exits 0): read the summary in the output.
- **The desktop app attaches after `session.start`** (it is an SDK host, which draws nowhere yet there)
  **and detaches a session it stops showing:** `surfaces()` is `[]` while the person looks at another
  session, and `["desktop"]` again once they're back. So registration also happens on `session.attach`, and
  "watching" is read live, never cached.
- **A function handed `$` is declared at the top of the file.** The engine follows `$` from the source and
  refuses to load a module that passes it to a closure made inside `register` (hence the module-level
  `offered` flag, which a reload resets with the module).

- **Draw the SVG as an image (no `isInteractive`).** The sandboxed frame reloads blank on every redraw,
  and every scroll step re-runs the pane's render hook, so an interactive dashboard flickers.
- **No play-once SMIL animations (`fill="freeze"`).** The image reloads on each redraw and replays them;
  a test asserts none exist. Looping animations (the pulse) are fine.
- **Ticking text (the elapsed clock) stays native `Text`,** never inside the SVG, or the image redraws
  every second.
- **SVG text never wraps and the module has no DOM.** Width is estimated per glyph in `measure()` (+6%
  slack); labels are measured in the case they are drawn in (`sentence()`).
- **A gradient on a perfectly flat line paints nothing** (its bounding box has zero height): use solid
  strokes there.
- **Width guess:** px ≈ `bodyColumns * 8`. Adjust it if a surface draws differently. A guess that runs
  wide shrinks the Svg to its slot, labels with it, so the pane's floor is 240px, under the narrowest
  dock, not 340.
- **A desktop row wraps a long `Text` instead of cutting it** (the 1.0 band's header broke over two lines
  and split "● done" from its word), and native text has no size to shrink. The header lays out its own
  lines (`wrapPx`) and draws each as one `Text`. The header's text box has `minWidth={0}` so it can shrink, and the
  title and goal are cut in the module too, with `fit()` against the row's room: a column counted as 7px
  and `measure()` scaled by 0.85 for the app's 13px text (its SVG estimate runs wide). Spaces in that row
  are no-break spaces: plain ones at a box's edge collapse, and between the dot and the status they break.
- **Tool input can arrive as JSON strings** for fields the schema hasn't declared yet (for example during
  a reload): `asList()` and `asObject()` parse them (`set`, `phase` and `cell` through `asObject`; `fun`,
  `remove` and `widgets` through `asList`). Junk is ignored, never thrown on: a widget without a string id,
  a tile that is not text or a number, a phase or cell without a name and a known state, a list entry
  that is not a string. An empty `fun` list still clears the fun strip.
- **A plugin's own `$.ui.close` never reaches its own `ui.close` hook,** so `collapse()` sets `paneOpen`
  itself.
- **`{ tool: ... }` matchers over ~1000 MCP tool names are too deep for tsc:** the `tool.call` hook is
  unmatched and compares `String(e.tool)`.
- **Previewing:** the trial (above) draws the real band and pane in a browser. In one HTML page, inline
  SVGs share one stylesheet, so their theme rules clash: draw each as an image (`data:` URL), as the app
  does, with `@media (prefers-color-scheme: dark)` replaced by `@media all` for dark or `@media not all`
  for light. The README images in `docs/img/` are captures from the desktop app, cropped to the band and
  the pane; the window image blurs the conversation and leaves out the sidebar.
