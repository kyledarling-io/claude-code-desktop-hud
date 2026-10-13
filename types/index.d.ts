export type HudState = 'todo' | 'now' | 'done' | 'failed' | 'hit' | 'miss'
export type HudTone = 'good' | 'bad' | 'warn' | 'info' | 'accent'
export type HudLine = {
  at: number
  text: string
  level: 'info' | 'ok' | 'warn' | 'err'
  /** Who wrote the line: Claude through the hud tool, or the HUD's observer; absent reads as Claude. */
  by?: 'claude' | 'observer'
}
export type HudItem = { label: string; value?: number; state?: HudState; color?: string; note?: string }
export type HudWidgetType =
  | 'stat' | 'gauge' | 'ring' | 'meter' | 'line' | 'bars' | 'columns'
  | 'donut' | 'heatmap' | 'list' | 'checklist' | 'table' | 'text'
/** The readers a binding takes a number with (hooks/extract.ts). */
export type HudExtractor = 'pass_fail' | 'n_of_m' | 'percent' | 'duration' | 'last_number' | 'exit'
/**
 * Claude's binding of a widget to its own calls (hooks/bind.ts): the observer fills the widget from each matching call of
 * the main loop. `match` is plain text, never a pattern: in a shell command's head, at a path's end, at a host's end.
 * measure, agents and plan take none.
 */
export type HudBind = { on: 'shell' | 'edit' | 'fetch' | 'measure' | 'agents' | 'plan'; match?: string; extract: HudExtractor }
export type HudWidget = {
  id: string
  type: HudWidgetType
  title?: string
  span?: number
  value?: number | string
  min?: number
  max?: number
  unit?: string
  delta?: number
  /** stat, line: which way is good, so its change reads good or bad; absent, the change is neutral */
  better?: 'up' | 'down'
  tone?: HudTone
  items?: HudItem[]
  points?: number[]
  rows?: number[][]
  text?: string
  /** When it last changed (ms), who changed it ('claude', 'observer' or a plugin's name), and the run's ticks then. */
  at?: number
  by?: string
  tick?: number
  /** The run's boundaries when it went stale; it retires RETIRE_BOUNDARIES later (hooks/lifecycle.ts). */
  staleAt?: number
  /** The session's main-loop tool calls when it last changed (PluginState hud.calls): the ranker's recency. */
  n?: number
  /** Claude's binding: the observer fills it from matching calls. Absent (as in any run from before), Claude fills it. */
  bind?: HudBind
  /** The binding's counts: readings taken, matching calls in a row that gave none (a bound widget's age), and matching
   * calls in all. Absent reads as none. */
  bound?: { hits: number; misses: number; seen: number }
}
/** A tile's clock, as a widget's: when it last changed, who changed it, the run's ticks then, and when it went stale. */
export type HudClock = { at: number; by: string; tick: number; staleAt?: number }
export type HudRun = {
  title: string
  /** What the work is aiming at now; Claude changes it as the work moves. */
  goal?: string
  startedAt: number
  endedAt?: number
  /** The last hud call, and the other tool calls made since. */
  updatedAt?: number
  sinceUpdate?: number
  /** The last HUD check sent to Claude: when, at which sinceUpdate, and how many have gone unanswered in a row (the
   * next window doubles for each; absent, as from before the back-off, it counts none). A hud call clears it. */
  nudged?: { at: number; calls: number; n?: number }
  status: string
  summary?: string
  accent?: string
  strip?: string[]
  tiles: Record<string, string | number>
  progress?: { n: number; total: number; label?: string }
  /** Set to 'observer' when the progress is the plan mirror's (hooks/plan.ts); absent, it is Claude's. */
  progressBy?: 'observer'
  phases: { name: string; state: HudState }[]
  cells: { name: string; state: HudState }[]
  points: number[]
  counts: Record<string, number>
  fun: string[]
  nextAt?: number
  log: HudLine[]
  widgets: HudWidget[]
  calls: number
  errors: number
  /** Main-loop tool calls during the run: a widget's age is counted in these, so a quiet session ages nothing. */
  ticks?: number
  /** When the last of those calls was counted: an aging block's "ago" is measured to it, so the image changes only
   * when a call does. Absent (a run from before), no "ago" shows. */
  tickAt?: number
  /** Phase boundaries passed: a phase change, a rebuild, the main loop's turn ending. */
  boundaries?: number
  /** Each tile's clock, by its key. */
  tileClock?: Record<string, HudClock>
  /** The widget ids a pointed HUD check already named; an update clears its id. */
  named?: string[]
  /** Started on its own by a long turn, titled from the prompt and drawn dim, until Claude names it (start or title). */
  provisional?: true
  /** Claude has been told, once, that the run started on its own. */
  told?: true
  /** The main loop's shell runs, the last 200, each by its head and the run's ticks then: the pointed HUD check says what
   * ran while a widget sat still. Absent reads as none. */
  ran?: { tick: number; head: string }[]
}

// The slot contract, version 1 (SOURCES.md): what another plugin sends the HUD through `$.hud`.
// A plugin that lists "hud" under "dependencies" gets this file laid into its types.
// v1 frozen at 2.0.0; changes are additive. A field may be added to HudSlot or HudDeclaration, never removed, renamed
// or retyped; anything that breaks a source is v2. The HUD drops fields it doesn't know, so a newer source works with
// an older HUD.

/** One slot's data, in one of the HUD's patterns. `note` says what the value means now; why it's on screen is the HUD's to say. */
export type HudSlot = {
  v: 1
  /** a-z, 0-9 and -, up to 32; one the sender declared. The HUD keys it `<plugin>/<id>`, the plugin being the host's word. */
  id: string
  /** The pattern declared for this id. */
  pattern: HudWidgetType
  title: string
  /** One line: what the value means now. */
  note?: string
  value?: number | string
  unit?: string
  min?: number
  max?: number
  delta?: number
  better?: 'up' | 'down'
  /** A reading of the value (a failing run is bad); the HUD picks the colours. */
  tone?: HudTone
  items?: { label: string; value?: number; state?: HudState; note?: string }[]
  points?: number[]
  rows?: number[][]
  text?: string
  /** 0 to 1: how much the source thinks it matters. The ranker gives it the least say. */
  hint?: number
}

/** What a source says about itself once a load: its name, what it can access (shown as written), and its slots, 8 at most. */
export type HudDeclaration = {
  v: 1
  name: string
  access: string
  slots: { id: string; pattern: HudWidgetType; title: string }[]
}

/** A slot as the HUD holds it: accepted, tagged with its sender by the host's word, and when it changed (`n`: the
 * session's main-loop tool calls then, the ranker's recency; absent, it reads as just now). */
export type HudHeld = HudSlot & { from: string; at: number; n?: number }

/** `$.hud`. A noun's call takes one object, so each call carries one slot. A source can't ask whether the HUD is there. */
export type Hud = {
  /** Once per load (session.start); again replaces the last. A slot no longer declared goes. */
  declare: (d: HudDeclaration) => Promise<{ ok: true; v: 1 } | { ok: false; why: string }>
  /** Upserts the slot by id, or says why it was refused. */
  push: (slot: HudSlot) => Promise<{ ok: true } | { ok: false; why: string }>
  /** Takes one of the sender's own slots away, for when it has nothing to say. */
  clear: (slot: { id: string }) => Promise<{ ok: true } | { ok: false; why: string }>
}

/** The HUD's modes (hooks/modes.ts says what each puts first). */
export type HudMode = 'build' | 'debug' | 'review' | 'research' | 'plan'

declare module 'claude-code' {
  interface EngineInterface {
    hud: Hud
  }
  interface PluginState {
    hud: {
      run: HudRun | null
      paneOpen: boolean
      stripHidden: boolean
      /** `<plugin>/<id>` → the slot; they outlive the run, and go with the session. */
      slots: Record<string, HudHeld>
      /** plugin → its declaration */
      sources: Record<string, HudDeclaration>
      /** The HUD's own sources' memory between observations (hooks/sources/tools.ts, tests.ts). */
      toolSignals: { failing: Record<string, { n: number; since: number }>; edited: Record<string, number>; fetched: string[]; fetches: number }
      testResults: { failed: number[] }
      /** The subagents Claude started this session, oldest first, the 12 newest kept (hooks/sources/agents.ts). `id` is the agent's own once it has one; a foreground agent is known by its call's until it ends. `lost`: failed when the session started again with it at work, until a sign of its life (absent reads as not). */
      agents: { list: { id: string; name: string; state: 'now' | 'done' | 'failed'; lost?: true }[] }
      /** The sources the person muted, by key (a plugin's name, or hud:<source> for the HUD's own); kept in $.store too. */
      muted: string[]
      /** The person's last message (never a background task's notification): a run that starts on its own is titled from it. */
      prompt?: { text: string; at: number }
      /** The main loop's turn while auto-run watches it, whatever began it: when it began, the main loop's calls since,
       * and when the person pressed ✕ in it. `off` once a run starts or Claude calls the HUD in it (auto-run stands down
       * until the next turn); null between turns ($.state.set takes no undefined). */
      turn?: { startedAt: number; calls: number; hiddenAt?: number; off?: true } | null
      /** The last sign of a turn (a message, a finished call, a turn's end): 30 minutes past it a live run reads paused. */
      lastTurnAt?: number
      /** The main loop's background jobs still running, by task id: shells, and subagents started in the background. */
      jobs?: Record<string, 'shell' | 'agent'>
      /** The task list the observer mirrors from the main loop's task-list tool (hooks/plan.ts), held whether or not a run is live. */
      plan?: { id: string; label: string; state: HudState }[]
      /** Main-loop tool calls this session (not hud calls), whether or not a run is live: what a slot's `n` counts in. */
      calls?: number
      /** What the strip shows, decided at the last boundary (hooks/rank.ts): its slot keys in order and why each is
       * there, and the run's own items it gave room to (`frame`, their item keys), which keep it until the next.
       * `boundaries` counts those decisions, and `away` holds when each key left and its `at` then: a key waits WAIT
       * boundaries before it comes back, unless it changed. */
      arrangement?: { strip: string[]; why: Record<string, string>; at: number; frame?: string[]; boundaries?: number; away?: Record<string, { b: number; at?: number }> }
      /**
       * The urgency place (hooks/urgency.ts): the one slot the HUD's own rules raised, leading the strip. `key` is the slot
       * (`hud/tests`), `says` the sentence, `rule` which of its four. `since` is the run's boundaries when it
       * began; `heldTo` is set once its rule stops holding: it goes when the boundaries reach it. `null` once there is
       * none (state holds JSON, which has no undefined to write).
       */
      urgent?: { key: string; says: string; rule: 'U1' | 'U2' | 'U3' | 'U4'; since: number; heldTo?: number } | null
      /** The mode the ranker uses; absent reads as build. The person's (`/hud mode`) holds for the session, Claude's applies only until then. */
      mode?: HudMode
      /** True once the person set the mode: Claude's `mode` then changes nothing. */
      modeByPerson?: boolean
      /** Claude's focus: up to 3 slot keys that matter now, as it sent them (a key not held yet may come); absent reads as none. A new run clears it. */
      focus?: string[]
      /** The person's pins (in pin order) and hides, by slot key (`hud/tests`, `claude/<widget id>`, `<plugin>/<id>`); kept in `$.store` too. A key is in one list at most; absent reads as none. */
      prefs?: { pinned: string[]; hidden: string[] }
    }
  }
}
