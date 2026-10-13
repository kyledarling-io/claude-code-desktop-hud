# Sources: send the HUD your own figures

A source is a plugin that sends the HUD something to show: a deploy's state, a queue's length, the last build's
result. You send plain data. The HUD checks it, keeps it, ranks it and draws it, in its own colours and type.
Nothing a source sends can draw, run or change how anything else looks.

This is the contract for version 1 of that data. **v1 is frozen at 2.0.0; changes are additive** (see
[Versioning](#versioning)). The types are [`types/index.d.ts`](types/index.d.ts), and the code that enforces them,
the gate, is [`hooks/sources/contract.ts`](hooks/sources/contract.ts). A working source of about 30 lines, with its
test, is in [`examples/source-template`](examples/source-template).

## In short

- List `hud` under `dependencies` in your `plugin.json`.
- At `session.start`, `declare` yourself once: your name, what you can access, and up to 8 slots.
- When you learn something, `push` a slot. When you have nothing to say, `clear` it.
- One slot per call. Catch every call.
- The HUD decides where a slot goes. You never learn whether anyone sees it.

## Your plugin.json

```json
{ "name": "deploys", "dependencies": ["hud"] }
```

Your plugin's `name` is how the HUD knows you. The host sets it, not you: it keys your slots (`deploys/prod`),
it is the "from deploys" beside them, and it is what the person types to mute you (`/hud mute deploys`).

When Claude Code loads your plugin from a folder you own, it lays the HUD's types into
`.claude-plugin/types/`. `$.hud` is then typed, and a wrong call fails `tsc`.

## The three calls

Each call takes one object. `$.hud.push([a, b])` is refused before any hook runs, so a source with three slots calls
`push` three times.

| Call | You send | You get |
| --- | --- | --- |
| `$.hud.declare(d)` | A declaration, once per load (at `session.start`). Declaring again replaces the last one: a slot you no longer declare goes, and so does one you now declare with another pattern. | `{ ok: true, v: 1 }` or `{ ok: false, why }` |
| `$.hud.push(slot)` | One slot. It is added, or replaces the one held under the same id. | `{ ok: true }` or `{ ok: false, why }` |
| `$.hud.clear({ id })` | The id of one of your own slots, to take it away. You can't name anyone else's. | `{ ok: true }`, also when it wasn't there; `{ ok: false, why }` only when the HUD itself fails (`the HUD could not take it`) |

A refusal is an answer, not an error. `why` is plain words for you, never for the person. These are the ones you can
meet, as the HUD writes them (`<you>` is your plugin's name):

| `why` | It means |
| --- | --- |
| `a declaration is a plain object`, `a slot is a plain object` | You sent something that isn't plain data, such as a class instance. (An array fails earlier, as above: the engine refuses it before the HUD hears it.) |
| `speaks v2; this HUD reads v1` | `v` isn't a version this HUD reads. |
| `a declaration names itself and says what it can access` | `name` or `access` is missing or blank. |
| `a declaration names at least one slot: an id (a-z, 0-9, -), a pattern and a title` | None of the slots you declared was valid. |
| `<you> has not declared itself` | You pushed before a declaration was accepted. |
| `<you> declared no slot "x"` | You pushed an id you didn't declare. |
| `"x" is declared a stat` | You pushed a different pattern from the one you declared for that id. |
| `the HUD could not take it` | The HUD itself failed on the call. Try again later. |

Catch every call anyway. A fault, or the HUD reloading mid-session, must never reach your own hook. Use `try`/`catch`
around the `await`, not `.catch` on the call: a call that throws before it returns a promise gets past `.catch`.

## The declaration

```ts
{
  v: 1,
  name: 'Deploys',
  access: 'Reads deploy states from the hosting API with your token.',
  slots: [{ id: 'prod', pattern: 'stat', title: 'Production' }],
}
```

- **`name`** is how the Sources list shows you (up to 40 characters).
- **`access`** is a line, in your own words, on what your plugin can reach (up to 200 characters). The HUD shows
  it as written, in the pane's Sources list and in `/hud sources`, and the person reads it when deciding whether to
  mute you. Say what you read and where it goes. If `claude plugin validate` lists a call your line doesn't mention
  (`$.http.fetch`, `$.process`), the line is incomplete.
- **`slots`** are up to 8. Each has an **`id`** (a-z, 0-9 and `-`, starting with a letter or digit, up to 32
  characters; Claude sees it, so pick a plain one: [What Claude sees of you](#what-claude-sees-of-you)), a
  **`pattern`** (one of the 13 below) and a **`title`**. If an id repeats, the first is kept; a slot
  that isn't valid is dropped; none valid and the declaration is refused.

## A slot

```ts
{ v: 1, id: 'prod', pattern: 'stat', title: 'Production', value: 'failed', tone: 'bad', note: 'build 1432 failed 2m ago' }
```

| Field | What it is |
| --- | --- |
| `v` | `1`. |
| `id`, `pattern` | The id you declared and the pattern you declared for it. |
| `title` | The block's title. Missing or blank, it falls back to the declared title. |
| `note` | One line: what the value means now. Why the slot is on screen is the HUD's to say, not yours. |
| `value` | A number, or text. |
| `unit` | `ms`, `%`, `MB`. |
| `min`, `max` | Numbers, for gauge, ring and meter (`min` 0 and `max` 100 when left out). |
| `delta`, `better` | A change, and `'up'` or `'down'` for which way is good. Without `better` the change is neutral. |
| `tone` | `good`, `bad`, `warn`, `info` or `accent`: a reading of the value (a failing run is bad). The HUD picks the colours. |
| `items` | `{ label, value?, state?, note? }`, where `state` is `todo`, `now`, `done`, `failed`, `hit` or `miss`. No colour. |
| `points` | Numbers, for a trend. |
| `rows` | Rows of numbers, for a heatmap. |
| `text` | A sentence or two, for a text block. |
| `hint` | `0` to `1`: how much you think it matters. See [How the HUD ranks](#how-the-hud-ranks-what-you-send). |

### The 13 patterns

Each draws from some of those fields.

| Pattern | Draws |
| --- | --- |
| `stat` | `value` and `unit`, a `delta`, a sparkline from `points`, a dot from `tone` |
| `gauge` | `value` between `min` and `max`, a semicircle |
| `ring` | `value` as a share of `max`, a percent ring |
| `meter` | `value` of `max`, a bar |
| `line` | `points`, a trend |
| `bars` | `items`, a ranking (the first 10) |
| `columns` | `items`, vertical bars |
| `donut` | `items` as shares (past 6, the tail folds into "Other") |
| `heatmap` | `rows` |
| `list` | `items`, a leaderboard with their notes (the first 10) |
| `checklist` | `items` with their `state` |
| `table` | `items` as a label and its `note` or `value` |
| `text` | `text` |

The pane draws all of them. The strip above the prompt (desktop) draws `stat`, `gauge`, `ring`, `meter`, `line` and
`checklist`, in the room Claude's own items leave of its four. The terminal draws slots as text. There are no other
patterns: a source can't add one, and can't send colours, components, buttons or callbacks.

## The limits

The gate checks every call before the HUD holds anything, and holds only what passes:

- A slot and a declaration are **plain objects**. Functions and class instances never pass.
- **Declared only**: an undeclared id, or the wrong pattern for its id, is refused with the reason.
- **Unknown fields are dropped**, and so are numbers that aren't finite (`NaN`, `Infinity`).
- **Text is cut** to what the patterns can draw, and **control characters become spaces**, a run of them one space:
  the C0 and C1 controls (line breaks among them) and DEL, the line and paragraph separators (U+2028, U+2029), and
  the bidi controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069), which can make text read as other
  text.
- An item's `color` isn't a field: colours are the HUD's.
- `hint` is held between 0 and 1.

| Thing | Limit |
| --- | --- |
| Slots a source declares | 8 |
| `id` | 32 characters |
| `name`, `title` | 40 |
| `access` | 200 |
| `note` | 120 |
| `unit` | 12 |
| `value` as text | 24 |
| `text` | 280 |
| `items` | 12 (a label with no text is dropped) |
| An item's `label`, `note` | 40, 60 |
| `points` | 120 (the newest are kept) |
| `rows` | 12 rows of 24 numbers (a row keeps its newest) |

The numbers come from `CAP` and `MAX_SLOTS` in [`hooks/sources/contract.ts`](hooks/sources/contract.ts), and are sized
to what the strip and the dashboard can draw. If you need more, open an issue and say what for.

A slot stays until you clear it or the session ends, and it outlives the run it arrived in. When a value stops being
true, clear it.

## How the HUD ranks what you send

The HUD, not the source, decides what is shown and where. In order of who wins:

1. **The person** pins a slot (it goes first, in the order pinned), hides one (it never shows), mutes a source (none of
   its slots show) and sets the mode, which holds for the session and beats Claude's.
2. **The HUD's urgency rules** put one slot in the urgency place, at once ([below](#the-urgency-place)).
3. **Claude** names up to three slots that matter now, its focus (by key, such as `deploys/prod`), and a mode. Slots
   it names in its own `strip` count as focus, ahead of the rest.
4. **The score** orders everything else.
5. **Hints** nudge a slot among equals.

The pane shows the whole board in that order, at once: the pinned slots, then the urgency place, then Claude's focus,
then the mode's slots, then everything else by score. Claude's own widgets are on the same board, as slots from
`claude`. In the strip, the urgency place leads, ahead of everything, and is never dropped.

A mode names the HUD's own slots (tests, failing runs, files edited, sites fetched, context, the plan, agents), so a
mode never puts a source's slot ahead of the rest. Claude's focus or a pin can.

### The score

What nobody has placed is scored:

```
score = severity × 0.5 ^ (calls since the slot was pushed ÷ 12) + 0.5 × hint
```

- **`severity`** comes from your `tone`: `bad` 3, `warn` 2, `info`, `accent` or none 1, `good` 0.5.
- **Calls** are Claude's own tool calls in the main conversation, not minutes, so the same work ranks the same
  however long it took. A slot loses half its weight every 12 of them.
- **Every push counts as a change**, even of the same value. Push when something changes, not on a timer, unless the
  slot should stay fresh.
- **`hint`** is held between 0 and 1, so it is worth at most half a severity step. It breaks ties among near-equals and
  never outweighs a clear difference in tone. It is the only say a source has beyond `tone`.
- **Ties** go to the slot that comes first on the board (Claude's widgets, the HUD's own slots, then each source in
  the order it declared, and its slots in the order it declared them), then to the earlier key.

### Why a slot is where it is

Every slot carries a line saying why. It shows under the slot's title in the pane, in the text that describes the
drawing, and in `/hud`. The HUD writes it, and a source can't:

- `Pinned by you`, `Claude's focus`, or the mode's name (`Debug mode`);
- `Urgent: ` and what the rule found;
- `Hinted by deploys`, only where your hint lifted the slot above one with no hint that it would otherwise have trailed;
- otherwise `Changed 2 calls ago · bad` (`Changed just now`, and `no tone` when you set none).

Your `note` says what the value means, and that is all it does.

### When the strip moves

The pane shows the board as it stands, so a new slot appears there at once. The strip is quiet. It moves only at a
**boundary**, and until the next it keeps the slots it chose, drawn with their values as they are now. A boundary is:

- the main conversation's turn ending (a subagent's doesn't count);
- a `hud` call from Claude carrying `start`, `phase`, `rebuild`, `mode`, `focus` or `strip`;
- the person muting or unmuting a source, setting the mode, or pinning, unpinning, hiding or unhiding a slot;
- a run starting on its own.

A slot that leaves the strip waits 3 boundaries before it may come back, unless you pushed it again since, the person
pinned it, or the person brought it back (an unmute or an unhide). So nothing leaves and returns within 3 boundaries
without a change of its own. The urgency place is the one thing that moves between boundaries.

### The urgency place

One place leads the strip, and it shows at once. Four rules fill it, one slot at a time, first rule first:

1. a rate-limit window at 85% or more (`hud/limits`);
2. the same command failing 3 times in a row (`hud/failing`);
3. tests going from passing to failing (`hud/tests`);
4. context at 85% or more (`hud/context`).

Once its rule stops holding, the place keeps its slot until the next boundary, so it never flickers.

**Only the HUD's own sources can take it, and only the HUD's own rules raise it.** The rules read those four slots by
key, and only when their sender is `hud`, which the host sets. A slot of yours, in any pattern, with any id, tone or
hint, can't raise urgency, and neither can Claude's widgets. A bad slot of yours ranks high through its tone, in an
ordinary place. A source the person muted raises none, and a slot the person hid is never drawn, the urgency place
included.

## Versioning

- Every call carries `v`. This HUD reads `v: 1` and nothing else, and answers any other with the version it saw, such as
  `speaks v2; this HUD reads v1`.
- **Within v1, changes are additive only.** A field may be added to a slot or a declaration; none is removed, renamed
  or retyped. The HUD drops fields it doesn't know, so a newer source works with an older HUD, minus the new field.
  A new value for an existing field (a pattern, tone or state) isn't additive: an older HUD refuses a slot in a pattern
  it doesn't know and drops a tone or state it doesn't know.
- **A breaking change is v2.** The HUD would then read v1 and v2 for at least one release, and refuse an unknown
  major with `speaks v3; this HUD reads v1–2`.
- You can't check the version before you call (see below). `declare`'s answer carries it: `{ ok: true, v: 1 }`.

## If the HUD isn't there

**Your source doesn't load.** A plugin that lists `hud` under `dependencies` is not loaded at all without it: no
hooks, no tools, nothing (proved in the desktop app, Claude Code 2.1.295). In the same probe a HUD that
was removed and then restored in the middle of a session brought its sources back at the turn's end, with no restart.
Installing the HUD for the first time in the middle of a session wasn't tried; start a new session to be sure.

That holds for the whole plugin. If yours does other work that should run without the HUD, put the HUD part in its
own small plugin that depends on `hud`, and leave the rest with no dependency. Don't call `$.hud` without the
dependency: it isn't proved to work.

You can't ask whether the HUD is there. `typeof $.hud` fails validation, because a noun can't be read as a value
(proved in the app). So you call, and you catch. A HUD that reloads mid-session loses its own module memory (proved in
the app), and calls kept working in the probe. It holds your slots in the session's state, not in that memory, so they
stay (shown in the test kit, `hooks/noun.test.ts`).

If your plugin reloads, its own module memory resets. Anything your source must remember across a reload belongs in
your own `$.state`. (The template keeps its count in the hook, to stay short, so a reload starts it again.)

## What you don't get

- **Whether anyone is watching**, or where your slot landed. That is the HUD's.
- **Other sources' slots.** There is no `list`, and the API won't hand them out.
- **Control of the person's choices**: pins, hides, mutes, modes and Claude's focus are not yours to set.

## What Claude sees of you

Claude, the model, is told which slots are on the strip, so it can name the ones that matter now (its focus). While a
run is live, the short note beside each of the person's messages carries their keys, `<your plugin's name>/<id>`:

```
HUD: "Roll out the canary". Focus ids: deploys/prod, hud/tests.
```

That is all of yours the HUD puts in front of the model: never a title, a note, a value or an item. The note is 160
characters at most, and a key that doesn't fit the room is left out. So:

- **Your plugin's name and your slot ids are visible to the model.** Pick plain names. An id is a-z, 0-9 and `-`,
  starting with a letter or digit, up to 32 characters.
- Keep them short. A long key may not make the note.
- Your words are for the person: the HUD sends none of them to Claude, so don't write them for Claude.

## Trust

The HUD shows who sent each slot and lets the person mute any sender. It checks what a source sends. It can't vouch
for it.

**What holds**
- The sender is the host's word. Every slot is keyed and tagged by the plugin that made the call, which the host
  sets. A source can't write into another's namespace through the API.
- The gate above: plain data, declared slots only, lengths cut, no colours, no callbacks.
- The person sees each sender: "from deploys" under every slot that isn't the HUD's own, in the pane, in the text
  that describes the drawing and in `/hud sources`.
- The person reads your `access` line as you wrote it, in the Sources list and in `/hud sources`.
- Mute is per sender, by plugin name, and kept across sessions (`/hud mute deploys`, `/hud unmute deploys`). A muted
  sender's pushes are still checked and held, so unmuting is instant, but they are never drawn or ranked.
- The urgency place is the HUD's alone, and a hint is capped.

**What can't be guaranteed**
- Any installed plugin can hook `hud.push` and change another source's slot before the HUD sees it. The HUD then shows
  the changed slot under the original sender's name. The name is the host's word; the payload is only data. (Proved in
  the app, Claude Code 2.1.295.)
- The HUD can't refuse a plugin that depends on it. Only managed settings could. (Proved in the same probe: the HUD's
  `plugin.register` never sees its dependents.)
- Any plugin can read the slots the HUD holds, because they sit in the session's state. That is how the HUD is built, and
  `hooks/noun.test.ts` reads them so; it wasn't probed in the app.
- Any plugin can also hook `state.set` and rewrite what the HUD itself writes, so the slots it holds are no safer
  from that than from a hook on `hud.push`. The plugin API's documentation for `$.state.set` describes this; the
  probes didn't try it.

This isn't new: any plugin can already rewrite any tool call. Installing a plugin trusts it with the session.

**So, for you**
- Write an honest `access` line and keep it true.
- Send only what you'd be content to see under your name, and nothing secret: other plugins can read it.
- Don't treat a slot you pushed as proof of anything later.

## An example

The declaration, at the start of the session:

```ts
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.hud.declare({
        v: 1,
        name: 'Deploys',
        access: 'Reads deploy states from the hosting API with your token.',
        slots: [{ id: 'prod', pattern: 'stat', title: 'Production' }],
      })
    } catch { /* the HUD isn't answering: send nothing */ }
    return next(e)
  })
  // ...and wherever the source learns something, a push (below)
}
```

When a deploy fails, and when it is fine again:

```ts
try {
  await $.hud.push({ v: 1, id: 'prod', pattern: 'stat', title: 'Production', value: 'failed', tone: 'bad', note: 'build 1432 failed 2m ago' })
} catch { /* the next change sends it again */ }
// ...
try {
  await $.hud.clear({ id: 'prod' })
} catch { /* the slot stays until the next clear, or the session ends */ }
```

That declaration and that slot are the ones `hooks/trust.test.ts` sends the HUD, and `hooks/noun.test.ts` runs the same
shapes end to end. The template adds a clock that sends a count every 5 seconds, and sends nothing if its declaration
is refused.

## Checking your source

- `claude plugin validate <your folder>` checks the manifest and lists the events your hooks handle and every call they
  make. Compare its `calls:` line with your `access` line.
- Test it against the real HUD by loading its `register` as an inline plugin beside the HUD, as the template's test
  does. The HUD has to be the plugin under test, so run your test from a checkout of this repository: put your plugin's
  folder under `examples/`, with a test like the template's, and run `claude plugin test .` at the checkout's root.
  From a folder of your own, `claude plugin test` loads no HUD, so `$.hud` isn't there. An inline plugin keeps only the
  text of its `register`, so keep a source's code inside it.
