import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'
import type { HudBind, HudRun, HudWidget } from '../types'
import { matches, READS, validBind } from './bind'
import { RECIPE_NAMES, RECIPES, type RecipeName } from './recipes'
import { apply, type Input } from './run'
import { DESCRIPTION, SCHEMA } from './tool'

// Recipes: a `recipe` on a start or a rebuild lays the widgets and the strip pick for a kind of
// work, through the checks Claude's own widgets pass. Claude's fields in the same call, and any later call, override it.
// A recipe guesses no command: its widgets are laid unbound and with no value, the ones meant to be read from a command
// carry the binding they want (`wants`: on and extract), and the answer asks Claude to bind each to its exact command.

const BUILTIN = ['progress', 'phases', 'trend', 'errors', 'calls'] // the strip's own keys; a widget by one of these ids would hide behind own:<id>
const OURS = ['tests', 'failing', 'failing-runs', 'edited', 'fetched', 'sources', 'steps', 'context', 'cost', 'limits', 'agents'] // ids of what the HUD already keeps

test('the seven recipes are data in one module: no command guessed, no value, nothing the HUD already keeps', async () => {
  expect(RECIPE_NAMES).toEqual(['build', 'test-fix', 'refactor', 'migration', 'rollout', 'research', 'remote-job'])
  expect(Object.keys(RECIPES)).toEqual([...RECIPE_NAMES])
  // the tool names the same seven, as an enum
  expect((SCHEMA.properties.recipe as unknown as { enum: string[] }).enum).toEqual([...RECIPE_NAMES])
  // a recipe guesses no command: no binding and no match anywhere in it
  expect(JSON.stringify(RECIPES)).not.toMatch(/"(bind|match)"/)
  for (const name of RECIPE_NAMES) {
    const { widgets, strip = [] } = RECIPES[name]
    const ids = widgets.map(w => w.id)
    expect(widgets.length > 0 || strip.length > 0).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    for (const w of widgets) {
      // never a placeholder figure: no value, point, row or word until a reading or Claude brings one
      for (const k of ['value', 'delta', 'text', 'rows', 'push', 'min', 'max', 'unit', 'bind'] as const) expect(w).not.toHaveProperty(k)
      expect(w.points ?? []).toEqual([])
      expect(w.items ?? []).toEqual([])
      // the mirror's id, the strip's own keys and the HUD's own slots' ids are not ours to take
      expect([...BUILTIN, 'plan', ...OURS]).not.toContain(w.id)
      // the binding it wants stands, once Claude names the command, on a widget that takes a reading
      if (w.wants) {
        expect(READS).toContain(w.type)
        const bind = { ...w.wants, match: 'make' }
        expect(validBind(bind)).toEqual({ bind })
      }
    }
    // the strip names the recipe's own ids, the strip's keys, the plan mirror or one of the HUD's own slots
    for (const k of strip) expect(ids.includes(k) || [...BUILTIN, 'plan'].includes(k) || /^hud\/[a-z-]+$/.test(k)).toBe(true)
    // what it wants bound has an example command for the answer: a script that stands as a binding (never a general
    // reader like curl or tail), is found when it is run itself or by a shell, and is for a widget it wants bound
    const wanted = widgets.filter(w => w.wants), eg = RECIPES[name].example
    expect(wanted.length > 0).toBe(eg !== undefined)
    if (eg) {
      expect(wanted.map(w => w.id)).toContain(eg.id)
      const bind = { ...wanted.find(w => w.id === eg.id)!.wants, match: eg.script }
      expect(validBind(bind)).toEqual({ bind })
      for (const command of [`./${eg.script}`, `bash ${eg.script}`]) expect(matches(bind as HudBind, { tool: 'Bash', input: { command }, failed: false, text: '' })).toBe(true)
    }
  }
})

test('what each recipe lays, what it wants bound and what its strip shows are these', async () => {
  const laid = RECIPE_NAMES.flatMap(name => RECIPES[name].widgets.map(w =>
    `${name}/${w.id} (${w.type}): ${w.title}, ${w.wants ? `wants ${w.wants.on} ${w.wants.extract}` : 'yours to fill'}`))
  expect(laid).toEqual([
    'build/build (stat): Build exit (1 = failed), wants shell exit',
    'build/build-time (line): Build: last duration (s), wants shell duration',
    'test-fix/attempts (stat): Attempts, yours to fill',
    'migration/tables (stat): Migrate: last N of M, wants shell n_of_m',
    'rollout/hosts-done (stat): Deploy: last N of M, wants shell n_of_m',
    'rollout/health (stat): Health exit (1 = failed), wants shell exit',
    'rollout/latency (line): Health: last number, wants shell last_number',
    'research/questions (checklist): Open questions, yours to fill',
    'remote-job/job-progress (stat): Job log: last percent, wants shell percent',
    'remote-job/job-metric (line): Job log: last number, wants shell last_number',
  ])
  // the example the answer gives for each: a script's name, never a program that runs for anything
  expect(Object.fromEntries(RECIPE_NAMES.map(n => [n, RECIPES[n].example]))).toEqual({
    build: { id: 'build', script: 'make' },
    'test-fix': undefined,
    refactor: undefined,
    migration: { id: 'tables', script: 'migrate-tables' },
    rollout: { id: 'health', script: 'health-check' },
    research: undefined,
    'remote-job': { id: 'job-progress', script: 'train-status' },
  })
  expect(Object.fromEntries(RECIPE_NAMES.map(n => [n, RECIPES[n].strip]))).toEqual({
    build: ['progress', 'build', 'errors', 'trend'],
    'test-fix': ['hud/tests', 'attempts'],
    refactor: ['plan', 'phases', 'hud/edited', 'hud/tests'],
    migration: ['phases', 'plan', 'tables', 'errors'],
    rollout: ['hosts-done', 'health', 'trend'],
    research: undefined,
    'remote-job': ['job-progress', 'trend'],
  })
})

// ---- the reducer

const lineOf = (name: RecipeName, i: Input = {}) => {
  const said: string[] = []
  const run = apply(null, { start: 'Job', recipe: name, ...i }, 0, -Infinity, said)
  return { run, said }
}

test('a start with a recipe lays its widgets unbound and its strip as Claude\'s own, and the answer says what to bind', async () => {
  const said: string[] = []
  const r = apply(null, { start: 'Ship it', recipe: 'build' }, 1000, -Infinity, said)
  expect(r.widgets.map(w => w.id)).toEqual(['build', 'build-time'])
  expect(r.widgets[0]).toMatchObject({ type: 'stat', title: 'Build exit (1 = failed)', by: 'claude', at: 1000, tick: 0 })
  // unbound, with no value; the binding it wants is not on the run
  for (const w of r.widgets) for (const k of ['bind', 'bound', 'wants', 'value', 'points'] as const) expect(w).not.toHaveProperty(k)
  expect(r.strip).toEqual(RECIPES.build.strip)
  expect(r.strip).not.toBe(RECIPES.build.strip) // the run's own copy
  expect(r).not.toHaveProperty('recipe')
  expect(said).toEqual([
    "Recipe build: bind build exit, build-time duration to your exact shell command, e.g. {id: 'build', bind: {on: 'shell', match: 'make', extract: 'exit'}}. Send progress yourself.",
  ])
  // each of the seven says what is Claude's to bind, to fill or to send, in a line kept short (it comes with every such call)
  for (const name of RECIPE_NAMES) {
    const { run, said: lines } = lineOf(name)
    expect(run.widgets.map(w => w.id)).toEqual(RECIPES[name].widgets.map(w => w.id))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(new RegExp(`^Recipe ${name}: `))
    expect(lines[0]!.length).toBeLessThanOrEqual(260)
    for (const w of RECIPES[name].widgets) expect(lines[0]).toContain(w.wants ? `${w.id} ${w.wants.extract}` : `Yours to fill: ${w.id}`)
    // the example is the recipe's own, a script (never curl or tail, which match every call of them)
    const eg = RECIPES[name].example
    if (eg) expect(lines[0]).toContain(`{id: '${eg.id}', bind: {on: 'shell', match: '${eg.script}', extract: '`)
    else expect(lines[0]).not.toContain('e.g.')
  }
  expect(lineOf('rollout').said[0]).toBe(
    "Recipe rollout: bind hosts-done n_of_m, health exit, latency last_number to your exact shell command, e.g. {id: 'health', bind: {on: 'shell', match: 'health-check', extract: 'exit'}}. Send cell per host. curl matches every call: wrap curl -f in a script.")
  expect(lineOf('remote-job').said[0]).toBe(
    "Recipe remote-job: bind job-progress percent, job-metric last_number to your exact shell command, e.g. {id: 'job-progress', bind: {on: 'shell', match: 'train-status', extract: 'percent'}}. Send next for the countdown. tail matches every call: use a script.")
  expect(lineOf('migration').said[0]).toContain("e.g. {id: 'tables', bind: {on: 'shell', match: 'migrate-tables', extract: 'n_of_m'}}.")
  expect(lineOf('test-fix').said[0]).toBe("Recipe test-fix: Yours to fill: attempts. Tests and the failing count of each run are the HUD's own Tests figure.")
  expect(lineOf('refactor').said[0]).toBe("Recipe refactor: Plan, files edited and tests are the HUD's own. Send phase for your steps.")
})

test("Claude's fields in the same call override the recipe's, field by field", async () => {
  const r = apply(null, {
    start: 'Ship it', recipe: 'build', strip: ['build-time'],
    widget: { id: 'build', title: 'Make', bind: { on: 'shell', match: 'make', extract: 'exit' } },
    widgets: [{ id: 'build-time', unit: 's' }, { id: 'lint', type: 'stat', title: 'Lint' }],
  }, 0)
  expect(r.widgets.map(w => w.id)).toEqual(['build', 'build-time', 'lint'])
  // its own title and binding win; what it didn't send is the recipe's
  expect(r.widgets[0]).toMatchObject({ type: 'stat', title: 'Make', bind: { on: 'shell', match: 'make', extract: 'exit' }, bound: { hits: 0, misses: 0, seen: 0 } })
  expect(r.widgets[1]).toMatchObject({ type: 'line', title: 'Build: last duration (s)', unit: 's', better: 'down' })
  expect(r.widgets[1]).not.toHaveProperty('bind')
  expect(r.strip).toEqual(['build-time'])
  // it can take a recipe's widget out in the same call
  expect(lineOf('rollout', { remove: ['latency'] }).run.widgets.map(w => w.id)).toEqual(['hosts-done', 'health'])
  // and its own type: the binding it then sends is checked for that type
  const typed = lineOf('build', { widget: { id: 'build', type: 'bars', bind: { on: 'shell', match: 'make', extract: 'exit' } } })
  expect(typed.run.widgets[0]).not.toHaveProperty('bind')
  expect(typed.said.at(-1)).toBe('bind on build: a bars takes no reading (stat, gauge, ring, meter, line or text do)')
})

test('the answer says what the layout is once the call is done: what it bound, removed or refused', async () => {
  const make = (id: string, extract: string) => ({ id, bind: { on: 'shell', match: 'make', extract } })
  // bound in the same call: only the other is left to bind, and the example, which was for the one bound, goes
  expect(lineOf('build', { widget: make('build', 'exit') }).said[0])
    .toBe('Recipe build: bind build-time duration to your exact shell command. Send progress yourself.')
  // both bound: nothing left to bind, the note stays
  expect(lineOf('build', { widgets: [make('build', 'exit'), make('build-time', 'duration')] }).said).toEqual(['Recipe build: Send progress yourself.'])
  // removed in the same call: gone from the line
  const removed = lineOf('build', { remove: ['build-time'] }).said[0]!
  expect(removed).toContain('bind build exit to your exact shell command')
  expect(removed).not.toContain('build-time')
  expect(lineOf('test-fix', { remove: ['attempts'] }).said[0]).toBe("Recipe test-fix: Tests and the failing count of each run are the HUD's own Tests figure.")
  // filled in the same call: no longer Claude's to fill
  expect(lineOf('test-fix', { widget: { id: 'attempts', value: 3 } }).said[0]).not.toContain('Yours to fill')
  // a binding refused: the widget is still unbound, so it is still to bind, and the refusal follows the line
  const refused = lineOf('build', { widget: { id: 'build', bind: { on: 'shell', extract: 'exit' } } }).said
  expect(refused[0]).toContain('bind build exit, build-time duration')
  expect(refused[1]).toBe('bind on build: match must be text for shell')
  expect(refused).toHaveLength(2)
  // a binding the HUD could never see is refused too, and named the same way
  const never = lineOf('migration', { widget: { id: 'tables', bind: { on: 'shell', match: 'build:prod', extract: 'n_of_m' } } }).said
  expect(never[0]).toContain('bind tables n_of_m')
  expect(never[1]).toBe('bind on tables: match must be a command name, like pytest or npm test')
  // and so is a program that runs for anything: curl is no health check, tail is no job log
  const reader = lineOf('rollout', { widget: { id: 'health', bind: { on: 'shell', match: 'curl', extract: 'exit' } } }).said
  expect(reader[0]).toContain('bind hosts-done n_of_m, health exit, latency last_number')
  expect(reader[1]).toBe('bind on health: curl runs for anything; bind a script of your own, like health-check')
  expect(reader).toHaveLength(2)
  // nothing left at all
  expect(lineOf('rollout', { remove: ['hosts-done', 'health', 'latency'] }).said).toEqual(['Recipe rollout: Send cell per host. curl matches every call: wrap curl -f in a script.'])
})

test('a later call overrides the recipe too: a binding, a title, the strip, a removal, a value', async () => {
  let r = apply(null, { start: 'Ship it', recipe: 'build' }, 0)
  r = apply(r, { widget: { id: 'build', bind: { on: 'shell', match: 'make', extract: 'exit' } } }, 1)
  expect(r.widgets[0]).toMatchObject({ bind: { on: 'shell', match: 'make', extract: 'exit' } })
  // a title keeps the binding
  r = apply(r, { widget: { id: 'build', title: 'Make' } }, 2)
  expect(r.widgets[0]).toMatchObject({ title: 'Make', bind: { on: 'shell', match: 'make', extract: 'exit' } })
  // a binding of its own replaces it
  r = apply(r, { widget: { id: 'build', bind: { on: 'shell', match: 'cargo build', extract: 'exit' } } }, 3)
  expect(r.widgets[0]).toMatchObject({ bind: { on: 'shell', match: 'cargo build', extract: 'exit' } })
  r = apply(r, { strip: ['build'] }, 4)
  expect(r.strip).toEqual(['build'])
  r = apply(r, { remove: ['build-time'] }, 5)
  expect(r.widgets.map(w => w.id)).toEqual(['build'])
  // a recipe sent on a plain update lays nothing and is told where it goes
  const said: string[] = []
  const same = apply(r, { recipe: 'rollout', log: 'hello' }, 6, -Infinity, said)
  expect(same.widgets.map(w => w.id)).toEqual(['build'])
  expect(said).toEqual(['recipe: send it with start or rebuild'])
  // an unbound recipe widget is Claude's to fill
  const t = apply(apply(null, { start: 'Fix', recipe: 'test-fix' }, 0), { widget: { id: 'attempts', value: 3 } }, 1)
  expect(t.widgets.find(w => w.id === 'attempts')?.value).toBe(3)
})

test('a rebuild with a recipe clears the old layout and lays the recipe; a start adopts a run begun on its own', async () => {
  let r = apply(null, { start: 'Old job', widgets: [{ id: 'old', type: 'stat', value: 7 }], strip: ['old'], phase: { name: 'Plan', state: 'now' } }, 0)
  r = apply(r, { rebuild: true, recipe: 'rollout', goal: 'Roll v2 out' }, 10)
  expect(r.widgets.map(w => w.id)).toEqual(['hosts-done', 'health', 'latency'])
  expect(r.phases).toEqual([])
  expect(r.strip).toEqual(RECIPES.rollout.strip)
  expect(r.goal).toBe('Roll v2 out')
  // a rebuild with none lays nothing: it clears, as before
  expect(apply(r, { rebuild: true }, 20).widgets).toEqual([])
  // a start on a run begun on its own keeps what the observer put there and lays the recipe beside it
  const own = { ...apply(null, { start: 'Fix the flaky suite' }, 0), provisional: true as const, widgets: [{ id: 'plan', type: 'checklist' as const, by: 'observer', items: [{ label: 'Map', state: 'done' as const }] }] }
  const adopted = apply(own, { start: 'Fix the flaky suite', recipe: 'test-fix' }, 5, 0)
  expect(adopted.widgets.map(w => w.id)).toEqual(['plan', 'attempts'])
})

test('an unknown recipe is named back with the seven, and nothing is laid', async () => {
  const names = RECIPE_NAMES.join(', ')
  for (const [sent, shown] of [['bake', 'bake'], ['x'.repeat(60), 'x'.repeat(20)], ['constructor', 'constructor'], ['__proto__', '__proto__'], ['toString', 'toString'], ['', ''], [7, '7'], [null, 'null']] as const) {
    const said: string[] = []
    const r = apply(null, { start: 'Job', recipe: sent as never }, 0, -Infinity, said)
    expect(r.title).toBe('Job') // the run still starts
    expect(r.widgets).toEqual([])
    expect(r.strip).toBeUndefined()
    expect(said).toEqual([`recipe: unknown "${shown}" (recipes: ${names})`])
  }
  // on a rebuild the layout is cleared as always, and the unknown one adds nothing
  const kept = apply(null, { start: 'Job', recipe: 'build' }, 0)
  const said: string[] = []
  const r = apply(kept, { rebuild: true, recipe: 'bake' }, 1, -Infinity, said)
  expect(r.widgets).toEqual([])
  expect(said).toHaveLength(1)
  // the case and the spaces round a real name are forgiven
  expect(apply(null, { start: 'Job', recipe: ' Remote-Job ' }, 0).widgets).toHaveLength(2)
})

test('a recipe never bypasses the checks: a binding it carried that cannot stand is dropped and named, as for Claude', async () => {
  const keep = RECIPES.build
  try {
    RECIPES.build = {
      widgets: [
        { id: 'a', type: 'bars', bind: { on: 'shell', match: 'x', extract: 'exit' } },
        { id: 'b', type: 'stat', bind: { on: 'shell', match: '  ', extract: 'exit' } },
        { id: 'c', type: 'stat', bind: { on: 'shell', match: 'x', extract: 'regex' } },
        { id: 'd', type: 'stat', bind: { on: 'plan', match: 'x', extract: 'n_of_m' } },
        { id: 'e', type: 'stat', bind: { on: 'shell', match: 'x', extract: 'exit', every: 5 }, wants: { on: 'shell', extract: 'exit' } },
        { id: 'f', type: 'stat', bind: { on: 'shell', match: 'build:prod', extract: 'exit' } },
        { id: 7 as never, type: 'stat' },
      ],
    }
    const said: string[] = []
    const r = apply(null, { start: 'x', recipe: 'build' }, 0, -Infinity, said)
    expect(r.widgets.map(w => [w.id, w.bind?.extract])).toEqual([['a', undefined], ['b', undefined], ['c', undefined], ['d', undefined], ['e', 'exit'], ['f', undefined]])
    expect(r.widgets.some(w => 'wants' in w)).toBe(false) // what it wants never reaches the run
    expect(said.slice(1)).toEqual([
      'bind on a: a bars takes no reading (stat, gauge, ring, meter, line or text do)',
      'bind on b: match must be text for shell',
      'bind on c: extract must be one of pass_fail, n_of_m, percent, duration, last_number, exit',
      'bind on d: plan takes no match',
      'bind on f: match must be a command name, like pytest or npm test',
    ])
  } finally {
    RECIPES.build = keep
  }
})

// ---- through the hooks

// The run as $.state holds it, read by an inline plugin (a test's own $ has no state).
const peek: Register = on => {
  on('command.run', { command: 'peek' }, async $ => ({ text: JSON.stringify((await $.state.get({ plugin: 'hud', key: 'run' })).value ?? null) }))
}
const PEEK = { plugins: [{ name: 'peek', register: peek }], timeoutMs: 60_000 }
type Loose = (i: object) => Promise<{ context?: readonly string[]; text?: string; result?: unknown }>
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }

// A session beneath the plugin: someone watching on desktop, and each call answering with the text it carries.
const world = ($: Engine, on: On) => {
  mock.clock(on, { now: 0 })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('tool.call', ($, e) => {
    const { says, answer } = e as unknown as { says?: string; answer?: { result: unknown } }
    return answer ?? { result: says ?? 'done', text: says }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.panes', () => ({ value: [] }))
  const loose = (f: unknown) => f as Loose
  const run = async () => JSON.parse(String((await loose($.command.run)({ command: 'peek', args: '' })).text)) as HudRun
  return {
    hud: (i: Input | object) => loose($.tool.call)({ tool: 'mcp__hud__hud', ...i }),
    call: (tool: string, i: object = {}) => loose($.tool.call)({ tool, ...i }),
    bash: (command: string, says?: string, more: object = {}) => loose($.tool.call)({ tool: 'Bash', command, says, ...more }),
    run,
    widget: async (id: string) => (await run()).widgets.find(w => w.id === id) as HudWidget,
    mount: (surface: string, component: string) =>
      (($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component, ...(component === 'Pane' ? { requestId: 'hud' } : {}), props: component === 'Pane' ? pane : band })),
  }
}
// The widgets of a recipe bound as the answer asks: to the command Claude names for each, with the binding the recipe wants.
const bound = (name: RecipeName, matches: Record<string, string>) =>
  Object.entries(matches).map(([id, match]) => ({ id, bind: { ...RECIPES[name].widgets.find(w => w.id === id)!.wants, match } }))
const NOTHING = (w: HudWidget) => w.value === undefined && !w.points?.length && !w.items?.length && !w.text && !w.bind && !w.bound

test('each recipe through the tool: laid unbound with no figure, answered in its ids, and drawn on both surfaces', PEEK, async ($, on) => {
  const { hud, run, mount } = world($, on)
  for (const name of RECIPE_NAMES) {
    const answer = String((await hud({ start: `Job: ${name}`, recipe: name })).result)
    expect(answer.split('\n')[0]).toBe('ok')
    expect(answer.split('\n')).toHaveLength(2)
    expect(answer).toContain(`Recipe ${name}: `)
    const held = await run()
    const { widgets } = RECIPES[name]
    expect(held.widgets.map(w => w.id)).toEqual(widgets.map(w => w.id))
    expect(held.strip).toEqual(RECIPES[name].strip)
    expect(held.widgets.every(NOTHING)).toBe(true)
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const component of surface === 'desktop' ? ['Pane', 'AbovePrompt'] : ['Pane']) {
        const ui = await mount(surface, component)
        const drawn = JSON.stringify(await ui.drawn())
        await ui.unmount()
        expect(drawn).toContain(`Job: ${name}`)
        // the pane names every widget the recipe laid, by its title (an empty checklist draws nothing yet); none says it
        // read something, as none is bound
        if (component === 'Pane') for (const w of widgets.filter(x => x.type !== 'checklist')) expect(drawn).toContain(w.title)
        expect(drawn).not.toContain('no reading')
      }
    }
  }
})

// What the old defaults took for the work: commands that carry the word, or that print a number, and are not the thing.
const NOT_THE_WORK: [command: string, text: string, more?: object][] = [
  ['ls build', 'build\nbuild.log'],
  ['rm -rf build dist', ''],
  ['mkdir -p build', ''],
  ['git checkout -b build-fix', "Switched to a new branch 'build-fix'"],
  ['docker build -t app .', '#12 DONE 0.1s\n#13 exporting to image 12.3s'],
  ['fly deploy', '[4/4] Pushing image\nError: deploy failed', { answer: { result: 'x', isError: true, text: '[4/4] Pushing image\nError: deploy failed' } }],
  ['git log deploy', 'a1b2c3d deploy step 3/12'],
  ['curl -s https://api.example.com/health', '503 Service Unavailable 0.4s'],
  ['curl -s https://api.example.com/version', '{"version":"2.1","hosts":12}'],
  ['npm run migrate', 'copying users: 50000/120000 rows'],
  ['tail -n 20 train.log', 'epoch 3 val_acc 91.2% loss 0.31'],
  ['tail -n 3 app.log', 'GET /status 200 mem 71%'],
  ['ssh gpu-1 tail -n 5 train.log', 'GPU util 98%'],
  ['kubectl rollout status deployment/web', 'deployment "web" successfully rolled out 3/3'],
  ['npx jest', 'Tests: 2 failed, 39 passed, 41 total'],
]

test('after a recipe alone, no command puts a figure in any widget: it guessed none', PEEK, async ($, on) => {
  const { hud, bash, run } = world($, on)
  for (const name of RECIPE_NAMES) {
    await hud({ start: `Job: ${name}`, recipe: name })
    for (const [command, text, more] of NOT_THE_WORK) await bash(command, text, more)
    const held = await run()
    expect(held.widgets.map(w => w.id)).toEqual(RECIPES[name].widgets.map(w => w.id))
    expect(held.widgets.every(NOTHING)).toBe(true)
    expect(held.widgets.every(w => w.by === 'claude')).toBe(true)
  }
})

test('bound to the command Claude names, a recipe widget reads that command and nothing that only looks like it', PEEK, async ($, on) => {
  const { hud, bash, widget } = world($, on)
  await hud({ start: 'Ship it', recipe: 'build' })
  expect((await hud({ widgets: bound('build', { build: 'make', 'build-time': 'make' }) })).result).toBe('ok')
  for (const [command, text, more] of NOT_THE_WORK) await bash(command, text, more)
  expect(await widget('build')).not.toHaveProperty('value')
  expect(await widget('build-time')).not.toHaveProperty('points')
  await bash('make all', 'built in 4.5s')
  expect(await widget('build')).toMatchObject({ value: 0, tone: 'good', by: 'observer' })
  expect(await widget('build-time')).toMatchObject({ points: [4.5], by: 'observer' })
  await bash('cd app && make all | tail', 'error: no rule after 1.5s', { answer: { result: 'x', isError: true, text: 'error: no rule after 1.5s' } })
  expect(await widget('build')).toMatchObject({ value: 1, tone: 'bad' })
  expect((await widget('build-time')).points).toEqual([4.5, 1.5])
  await bash('ls build', 'build.log')
  await bash('docker build .', '#12 DONE 0.1s')
  expect((await widget('build-time')).points).toEqual([4.5, 1.5])
})

// each recipe's widgets, bound as the answer asks to the exact command Claude runs, read that command
const FILLS: [RecipeName, Record<string, string>, [tool: string, input: object][], Record<string, Partial<HudWidget>>][] = [
  ['migration', { tables: 'prisma migrate' },
    [['Bash', { command: 'npx prisma migrate deploy', says: 'migrated 412/938 tables' }]],
    { tables: { value: 412, unit: 'of 938', by: 'observer' } }],
  ['rollout', { 'hosts-done': 'deploy-hosts', health: 'health-check', latency: 'health-check' },
    [['Bash', { command: './deploy-hosts web-03', says: 'deployed 3/12 hosts' }], ['Bash', { command: 'bash health-check web-01', says: '0.231' }]],
    { 'hosts-done': { value: 3, unit: 'of 12' }, health: { value: 0, tone: 'good' }, latency: { points: [0.231] } }],
  ['remote-job', { 'job-progress': 'train-status', 'job-metric': 'train-status' },
    [['Bash', { command: './train-status pod-7', says: 'step 450/1000 45% loss 0.123' }]],
    { 'job-progress': { value: 45, unit: '%', by: 'observer' }, 'job-metric': { points: [0.123], by: 'observer' } }],
]
for (const [name, matches, calls, expected] of FILLS) {
  test(`the ${name} recipe's widgets, bound as the answer asks, are filled by the command`, PEEK, async ($, on) => {
    const { hud, call, widget } = world($, on)
    await hud({ start: `Job: ${name}`, recipe: name })
    expect((await hud({ widgets: bound(name, matches) })).result).toBe('ok')
    for (const [tool, input] of calls) await call(tool, input)
    for (const [id, want] of Object.entries(expected)) expect(await widget(id)).toMatchObject(want)
  })
}

test("a failed health check fails the health widget and gives the latency line no point: an error's number is not a latency", PEEK, async ($, on) => {
  const { hud, bash, widget } = world($, on)
  await hud({ start: 'Roll out', recipe: 'rollout' })
  await hud({ widgets: bound('rollout', { health: 'health-check', latency: 'health-check' }) })
  await bash('./health-check web-01', '0.231')
  await bash('./health-check web-02', 'curl: (7) Failed to connect to web-02 port 443', { answer: { result: 'x', isError: true, text: 'curl: (7) Failed to connect to web-02 port 443' } })
  expect(await widget('health')).toMatchObject({ value: 1, tone: 'bad' })
  expect(await widget('latency')).toMatchObject({ points: [0.231], bound: { hits: 1, misses: 1, seen: 2 } })
})

test('curl and tail cannot be bound: the bind is refused and the widget stays unbound, and an unrelated one fills nothing', PEEK, async ($, on) => {
  const { hud, bash, widget } = world($, on)
  await hud({ start: 'Roll out', recipe: 'rollout' })
  // the answer to the bind says why, and says what to do
  expect((await hud({ widgets: bound('rollout', { health: 'curl', latency: 'curl' }) })).result)
    .toBe('ok\nbind on health: curl runs for anything; bind a script of your own, like health-check\nbind on latency: curl runs for anything; bind a script of your own, like health-check')
  for (const id of ['health', 'latency']) expect(await widget(id)).not.toHaveProperty('bind')
  // an unrelated curl, which prints a number and exits 0 on a 503, fills nothing
  await bash('curl -s https://api.example.com/version', '{"version":"2.1","hosts":12}')
  await bash('curl -s https://web-01/health', '503 Service Unavailable')
  for (const id of ['health', 'latency']) expect(await widget(id)).toMatchObject({ by: 'claude' })
  expect((await widget('health')).value).toBeUndefined()
  expect((await widget('latency')).points).toBeUndefined()
  // the same for the job: a tail that prints a percent is not the job's
  await hud({ start: 'Train', recipe: 'remote-job' })
  expect((await hud({ widgets: bound('remote-job', { 'job-progress': 'tail' }) })).result).toBe('ok\nbind on job-progress: tail runs for anything; bind a script of your own, like health-check')
  await bash('tail -n 3 app.log', 'GET /status 200 mem 71%')
  expect((await widget('job-progress')).value).toBeUndefined()
  // a script of its own is read, run itself or by a shell, and a curl is still not it
  await hud({ start: 'Roll out', recipe: 'rollout' })
  expect((await hud({ widgets: bound('rollout', { health: 'health-check' }) })).result).toBe('ok')
  await bash('curl -s https://web-01/health', '503 Service Unavailable')
  expect((await widget('health')).value).toBeUndefined()
  await bash('bash health-check web-01', 'ok')
  expect(await widget('health')).toMatchObject({ value: 0, by: 'observer' })
})

test('a recipe alone mutes no HUD check: nothing in it is bound, so Claude is checked as in any run', PEEK, async ($, on) => {
  const { hud, bash } = world($, on)
  await hud({ start: 'Roll out', recipe: 'rollout' })
  const said: (readonly string[] | undefined)[] = []
  for (let n = 0; n < 12; n++) said.push((await bash('true')).context)
  expect(said.slice(0, 11).every(c => c === undefined)).toBe(true)
  expect(said[11]?.join('\n')).toContain('HUD check: 12 tool calls')
})

test('what a recipe leaves to Claude is Claude\'s: the attempts, the questions, the plan and the strip', PEEK, async ($, on) => {
  const { hud, widget, run } = world($, on)
  await hud({ start: 'Fix the suite', recipe: 'test-fix' })
  await hud({ widget: { id: 'attempts', value: 3 } })
  expect(await widget('attempts')).toMatchObject({ type: 'stat', title: 'Attempts', value: 3, by: 'claude' })
  expect((await run()).strip).toEqual(['hud/tests', 'attempts'])
  await hud({ start: 'Research the API', recipe: 'research' })
  await hud({ widget: { id: 'questions', items: [{ label: 'Which API version?', state: 'now' }, { label: 'Rate limits?', state: 'todo' }] } })
  expect(await widget('questions')).toMatchObject({ type: 'checklist', title: 'Open questions', items: [{ label: 'Which API version?', state: 'now' }, { label: 'Rate limits?', state: 'todo' }] })
  // refactor lays no widget: its plan, files edited and tests are the HUD's own
  await hud({ start: 'Refactor auth', recipe: 'refactor' })
  const held = await run()
  expect([held.widgets, held.strip]).toEqual([[], ['plan', 'phases', 'hud/edited', 'hud/tests']])
})

test('an unknown recipe through the tool is named back, and a known one never costs the call its other fields', PEEK, async ($, on) => {
  const { hud, run } = world($, on)
  const bad = String((await hud({ start: 'Roll out', goal: 'v2', recipe: 'bake' })).result)
  expect(bad).toBe(`ok\nrecipe: unknown "bake" (recipes: ${RECIPE_NAMES.join(', ')})`)
  const none = await run()
  expect([none.title, none.goal, none.widgets, none.strip]).toEqual(['Roll out', 'v2', [], undefined])
  // a recipe and Claude's own widget and strip in one call, with a bind it could not take: ok, the recipe line, then the why
  const mixed = String((await hud({ start: 'Roll out', recipe: 'rollout', widget: { id: 'health', bind: { on: 'shell', extract: 'exit' } }, strip: ['hosts-done'] })).result)
  expect(mixed.split('\n').map(l => l.slice(0, 20))).toEqual(['ok', 'Recipe rollout: bind', 'bind on health: matc'])
  expect(mixed.split('\n')[1]).toContain('health exit') // still unbound, so still to bind
  const held = await run()
  expect(held.strip).toEqual(['hosts-done'])
  expect(held.widgets.find(w => w.id === 'health')).not.toHaveProperty('bind')
  // bound in the same call, it is left out of the line
  const ok = String((await hud({ start: 'Roll out', recipe: 'rollout', widget: { id: 'health', bind: { on: 'shell', match: 'health-check', extract: 'exit' } } })).result)
  expect(ok.split('\n')).toHaveLength(2)
  expect(ok).toContain('bind hosts-done n_of_m, latency last_number to your exact shell command.')
  expect(ok).not.toContain('health')
})

test('the description is what it was; the recipe names are in the schema, not in the 2,048 characters', async () => {
  expect(DESCRIPTION.length).toBeLessThanOrEqual(2048)
  expect(DESCRIPTION).not.toContain('test-fix')
  const recipe = SCHEMA.properties.recipe as unknown as { enum: string[]; description: string }
  expect(recipe.description.length).toBeLessThanOrEqual(240) // the schema is sent whole and cached: short
  // the property says what a recipe is, what it lays, that Claude then binds it to its own command, and who overrides
  expect(recipe.description).toMatch(/kind of work/)
  expect(recipe.description).toMatch(/start or rebuild/)
  expect(recipe.description).toMatch(/widgets and a strip/)
  expect(recipe.description).toMatch(/bind them to your exact command/)
  expect(recipe.description).toMatch(/override/)
})
