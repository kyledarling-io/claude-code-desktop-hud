# HUD source template

The smallest working source for the HUD: it declares one slot, **Ticks**, and sends it a count every 5 seconds. The
guide is [SOURCES.md](../../SOURCES.md); this is the code beside it.

- `.claude-plugin/plugin.json` lists `hud` under `dependencies`. Without the HUD this plugin doesn't load.
- `hooks/register.ts` is the whole source: a `session.start` hook that declares, then arms a `$.clock.every` that
  pushes. Every `$.hud` call is caught, and a refused declaration leaves it quiet.
- `hooks/source.test.ts` loads that `register` as an inline plugin beside the HUD and checks that the slot arrives
  under the sender's name, that a refused push doesn't stop it, and that a refused declaration leaves it quiet.

## Make your own

1. Copy this folder and rename the plugin in `plugin.json`. The name is how the person sees and mutes you, and with a
   slot's id it is what Claude sees of you (`source-template/ticks`, in the note beside the person's messages), so keep
   both plain and short.
2. In `register.ts`, change the declaration: your `name`, an `access` line that says what your plugin reads, and your
   slots (an id, a pattern and a title each).
3. Replace the clock with whatever your plugin learns things from, and change the `push` to send what it learned. When
   it has nothing to say, `$.hud.clear({ id })`.
4. Keep the source's code inside `register`. The test loads it inline, which keeps only that function's text.

## Check it

- `claude plugin validate examples/source-template` from the repository root: the manifest, the hooks and the calls.
- `claude plugin test .` from the repository root runs the test with the rest of the suite. It needs the repository
  root because the HUD is the plugin under test: run from this folder alone, `claude plugin test` loads no HUD, and
  there is no `$.hud`. To test your own source the same way, put its folder under `examples/` in a checkout of this
  repository, with a test like this one, and run it there.

Don't install this plugin for its own sake: it puts a counter in your HUD.
