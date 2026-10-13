# Probes

Throwaway mods that prove what the desktop app does, for features the types promise but the app hasn't shown
yet. Run one, write what it saw into DEVELOPING's "Proved in the desktop app" list with the app's Claude Code
version, then unload it.

## platform: turns, subagents, permission waits, compaction, the task list, the description budget

`dev/probes/platform/` logs what these hooks see and changes nothing:
- `turn.start`, `turn.complete` (with `agentId`, `reason`), `agent.spawn` (with the `agentId` it resolves);
- `session.compact` (its `trigger`);
- `tool.check` (the decision: `allow`, `ask` or `deny`), `classic.PermissionRequest`, `classic.PermissionDenied`,
  `classic.Notification`, `classic.SubagentStart`, `classic.SubagentStop`;
- each tool call's tool, `agentId` and whether it went to the background;
- `prompt.submit` (its `origin.kind`), `prompt.compose` (the task-list tools in `e.tools`);
- at `session.start`, the engine's version and any `TodoWrite` or `Task*` tool.

It also registers a `budget` tool whose 4,352-character description carries a marker every 256 characters.

Steps, in a desktop Code session of any folder:
1. Load `dev/probes/platform` as a dev plugin, the way DEVELOPING's "Run it from this folder" loads the HUD (name its
   folder in `CLAUDE_CODE_PLUGIN_DIRS`), and start a new Code session.
2. Send a message so the turn ends and the probe loads. Then ask Claude to:
   - call the `budget` tool and say the last `[M…]` marker its description shows (that is the budget);
   - run a foreground subagent and a background one (`run_in_background`), and a background shell command;
   - run a command that asks for permission (in default mode, a write outside the folder); answer it once with
     **Allow** and once with **Deny**;
   - run `/compact` (you type it).
3. Run `/probe-platform` and read its output, or ask Claude to read it with the `budget` tool.
4. Unload the probe.

What each line answers:
- **Turn and subagent events:** do `turn.start` and `turn.complete` fire on desktop; does a subagent's
  `turn.complete` carry its `agentId` and the main loop's none; does `agent.spawn` resolve an `agentId`?
- **Permission waits:** does `classic.PermissionRequest` fire when the dialog shows, and what follows an Allow
  (the call's `tool.call<` line) and a Deny (`classic.PermissionDenied`)? If it fires, "Needs you" can ship.
- **Compaction:** does `session.compact` fire, with which `trigger`?
- **Task list:** which task-list tool, if any, the session start and `prompt.compose` list.
- **Description budget:** the last marker Claude reads.
