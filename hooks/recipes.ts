import type { HudExtractor, HudWidget } from '../types'
import type { WidgetInput } from './run'

// Recipes: a `recipe` on a start or a rebuild names the kind of work, and the HUD lays the
// widgets and the strip pick that work needs. Data only. apply() (run.ts) sends each widget through the checks Claude's
// own pass (`rebind()`, `validBind()`), so a recipe never bypasses them; Claude's fields in the same call, and any later
// call, override what a recipe laid.
//
// A recipe guesses no command. A command is Claude's to name, and a guess reads figures nobody stood behind: `ls build`
// as a build, a docker step's "DONE 0.1s" as its time, "[4/4]" as hosts, curl's exit 0 on a 503 as healthy. So every
// widget is laid unbound and with no value, and the one meant to be read from a command carries the binding it wants
// (`wants`: `on` and `extract`, never `match`). The tool's answer names those ids and how to bind them, and Claude binds
// each to its exact command. Until then a widget draws "–", and "no reading" once it is bound and has read nothing.
//
// Nothing here duplicates what the HUD already keeps. Tests, files edited and the plan are its own slots and mirror, so
// they are named in `strip` (`hud/tests`, `hud/edited`, `plan`) and not laid; the same for fetched sources, a list the
// pane draws. A ring, gauge or meter would draw "0%" with no value, so the figures that wait for a reading are stats and
// lines. The built-in parts of a strip (progress, phases, errors, the trend) are named in `strip`.

export const RECIPE_NAMES = ['build', 'test-fix', 'refactor', 'migration', 'rollout', 'research', 'remote-job'] as const
export type RecipeName = (typeof RECIPE_NAMES)[number]
/** The binding a widget is meant to have, without the command: its `match` is Claude's to name. */
export type Want = { on: 'shell'; extract: HudExtractor }
export type RecipeWidget = WidgetInput & { wants?: Want }
export type Recipe = {
  widgets: RecipeWidget[]
  /** What the strip shows, in order, as Claude's own `strip` names it. Absent, the strip picks as it does for any run. */
  strip?: string[]
  /** A sentence for the answer: what the HUD already keeps for this work, or what Claude sends itself. */
  note?: string
  /**
   * The example the answer gives of a binding, for one widget it wants bound: the name of a script to bind it to. It is never
   * a program that runs for anything (validBind() refuses those) and has no dot, so heads() finds it run itself or by a
   * shell. Present when the recipe wants anything bound. It is for the answer; nothing binds to it.
   */
  example?: { id: string; script: string }
}

// A title says what is read, not what it means: the reading is the command's last exit (1 if it failed), its last
// duration, its last N of M, its last percent or its last number, whatever the command is.
export const RECIPES: Record<RecipeName, Recipe> = {
  build: {
    widgets: [
      { id: 'build', type: 'stat', title: 'Build exit (1 = failed)', wants: { on: 'shell', extract: 'exit' } },
      { id: 'build-time', type: 'line', title: 'Build: last duration (s)', better: 'down', wants: { on: 'shell', extract: 'duration' } },
    ],
    strip: ['progress', 'build', 'errors', 'trend'],
    note: 'Send progress yourself.',
    example: { id: 'build', script: 'make' },
  },
  'test-fix': {
    // the tests and their failing count of each run are the HUD's own Tests figure (hud/tests, with a point for each run)
    widgets: [{ id: 'attempts', type: 'stat', title: 'Attempts' }],
    strip: ['hud/tests', 'attempts'],
    note: "Tests and the failing count of each run are the HUD's own Tests figure.",
  },
  refactor: {
    // the plan is the task list's mirror or Claude's phases, files edited and tests are the HUD's own slots
    widgets: [],
    strip: ['plan', 'phases', 'hud/edited', 'hud/tests'],
    note: "Plan, files edited and tests are the HUD's own. Send phase for your steps.",
  },
  migration: {
    widgets: [{ id: 'tables', type: 'stat', title: 'Migrate: last N of M', wants: { on: 'shell', extract: 'n_of_m' } }],
    strip: ['phases', 'plan', 'tables', 'errors'],
    note: 'Send phase as each step starts.',
    example: { id: 'tables', script: 'migrate-tables' },
  },
  rollout: {
    widgets: [
      { id: 'hosts-done', type: 'stat', title: 'Deploy: last N of M', wants: { on: 'shell', extract: 'n_of_m' } },
      { id: 'health', type: 'stat', title: 'Health exit (1 = failed)', wants: { on: 'shell', extract: 'exit' } },
      { id: 'latency', type: 'line', title: 'Health: last number', better: 'down', wants: { on: 'shell', extract: 'last_number' } },
    ],
    strip: ['hosts-done', 'health', 'trend'],
    // curl would read every curl of any URL, and it exits 0 on a 503: the check is a script that runs curl -f
    note: 'Send cell per host. curl matches every call: wrap curl -f in a script.',
    example: { id: 'health', script: 'health-check' },
  },
  research: {
    // the sources fetched are the HUD's own Fetched list (hud/fetched), which the pane draws
    widgets: [{ id: 'questions', type: 'checklist', title: 'Open questions' }],
    note: "Sources fetched are the HUD's own list in the pane. Send the questions as items.",
  },
  'remote-job': {
    widgets: [
      { id: 'job-progress', type: 'stat', title: 'Job log: last percent', wants: { on: 'shell', extract: 'percent' } },
      { id: 'job-metric', type: 'line', title: 'Job log: last number', wants: { on: 'shell', extract: 'last_number' } },
    ],
    strip: ['job-progress', 'trend'],
    // tail would read every tail of any file: the job's status is a script
    note: 'Send next for the countdown. tail matches every call: use a script.',
    example: { id: 'job-progress', script: 'train-status' },
  },
}

/** The recipe a call named: its name as sent, forgiving case and spaces. Nothing for a name that isn't one of the seven (`constructor` included). */
export function recipeOf(sent: unknown): RecipeName | undefined {
  const name = typeof sent === 'string' ? sent.trim().toLowerCase() : undefined
  return RECIPE_NAMES.find(n => n === name)
}

/** A recipe's widgets as the run is to hold them: without the binding it only wants. */
export const widgetsOf = (recipe: Recipe): WidgetInput[] => recipe.widgets.map(({ wants, ...widget }) => widget)

const filled = (w: HudWidget) => w.value !== undefined || !!w.points?.length || !!w.items?.length || !!w.text

/**
 * The tool's answer to a recipe, from the widgets the run holds once the call is done (so what the same call removed,
 * bound or refused shows as it stands): the ids still to bind and how, the ones left to Claude, and the recipe's note.
 * Ids and kinds only. One line, once.
 */
export function laid(name: RecipeName, held: HudWidget[]): string {
  const { widgets, note, example } = RECIPES[name]
  const there = widgets.flatMap(spec => { const w = held.find(x => x.id === spec.id); return w ? [{ spec, w }] : [] })
  const toBind = there.filter(({ spec, w }) => spec.wants && !w.bind)
  const toFill = there.filter(({ spec, w }) => !spec.wants && !filled(w))
  // the example is for the widget it names, and goes once that one is bound or taken out
  const eg = example && toBind.find(({ spec }) => spec.id === example.id)?.spec
  return [
    `Recipe ${name}:`,
    toBind.length
      ? `bind ${toBind.map(({ spec }) => `${spec.id} ${spec.wants!.extract}`).join(', ')} to your exact shell command${eg?.wants && example ? `, e.g. {id: '${eg.id}', bind: {on: '${eg.wants.on}', match: '${example.script}', extract: '${eg.wants.extract}'}}` : ''}.`
      : '',
    toFill.length ? `Yours to fill: ${toFill.map(({ spec }) => spec.id).join(', ')}.` : '',
    note ?? '',
  ].filter(Boolean).join(' ')
}
