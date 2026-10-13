// The trial's scenes: real runs through the real module, drawn by the test kit at the widths and states that
// matter, each tree printed as one TRIAL line for dev/trial.mjs to render. Not a test of its own: the runner
// copies it into a temp copy of the mod, so the repo's tests stay quiet.
import type { On, Register } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'

type Handle = { drawn: () => Promise<unknown>; press: (t: { key: string }) => Promise<unknown>; unmount: () => Promise<void> }
type Call = (i: object) => Promise<unknown>

// the app's one dock, as the strip tests stand it in
const dock = (on: On) => {
  const shown = new Set<string>()
  on('ui.open', ($, e) => (shown.add(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($, e) => (shown.delete(e.id), { value: undefined }))
  on('ui.panes', () => ({ value: [...shown].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
}

const band = { hasSurvey: false, isWorking: true, maxRows: 6, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const pane = { title: 'HUD', isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 56 }, view: {} }

// Another plugin sending a slot, when its tool is called: what an outside source looks like beside the HUD's own.
const deploys: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'deploys') return next(e)
    await $.hud.declare({ v: 1, name: 'Deploys', access: 'Reads deploy states from the hosting API with your token.', slots: [{ id: 'prod', pattern: 'stat', title: 'Production' }] })
    await $.hud.push({ v: 1, id: 'prod', pattern: 'stat', title: 'Production', value: 'failed', tone: 'bad', note: 'build 1432 failed 2m ago', hint: 1 })
    return { result: 'ok' }
  })
}

// The HUD's own sources, fed as a session feeds them: tool calls answered as the engine would, and a measure.
const TESTS_RAN = { tool: 'Bash', command: 'npm test', answer: { result: '', text: 'Tests:       2 failed, 39 passed, 41 total' } }
const TESTS_PASSED = { tool: 'Bash', command: 'npm test', answer: { result: '', text: 'Tests:       0 failed, 41 passed, 41 total' } }
const EDITED = [1, 2, 3].map(n => ({ tool: 'Edit', file_path: `/src/billing/ledger-${n}.ts`, answer: { result: 'ok' } }))
const MEASURE = { context: { percent: 72, tokens: 720_000, window: 1_000_000 }, cost: { usd: 4.82 }, rateLimits: [{ kind: 'five_hour', percentUsed: 62, resetsAt: '1970-01-01T00:40:00Z' }], changed: ['context', 'cost', 'rateLimits'] }

// Main-loop calls that age the widgets Claude leaves alone.
const BENCH = (n: number) => Array.from({ length: n }, () => ({ tool: 'Bash', command: 'npm run bench', answer: { result: 'ok' } }))

// Auto-run: the person's message, then a long turn with no hud call: at its 8th call a run starts on its own, titled
// from the message and drawn dim, and the observer logs what follows.
const AUTO = [
  { say: 'Migrate the auth tables to the new schema and fix whatever breaks\nThe old ones are in db/legacy.' },
  ...Array.from({ length: 8 }, (_, i) => ({ tool: 'Read', file_path: `/src/db/legacy/table-${i}.sql`, answer: { result: 'ok' } })),
  ...[1, 2].map(() => ({ tool: 'Edit', file_path: '/src/db/migrations/0042_auth.sql', answer: { result: 'ok' } })),
  { tool: 'Bash', command: 'npm test', answer: { result: '', text: 'Tests:       4 failed, 31 passed, 35 total' } },
]

// each scene: the hud calls that build the run (a call carrying its own tool is that tool's, { wait } moves the clock,
// { say } is the person's message and { end } the turn's end), how many tool calls fail along the way, and what the
// sources see; then is Claude's hud calls after the sources reported (a boundary, so the strip takes them); { start }
// starts the session first, for its 1-second clock; commands are /hud commands, run last
const SCENES: Record<string, { calls: object[]; failed?: number; tools?: object[]; measure?: object; then?: object[]; start?: boolean; commands?: string[] }> = {
  rollout: {
    failed: 1,
    calls: [
      { start: 'Deploy v2.4 to 12 hosts', goal: 'Roll out with a canary, then the rest in batches', progress: '7/12', progress_label: 'hosts', phase: { name: 'Build', state: 'done' }, log: 'Starting rollout of v2.4' },
      { phase: { name: 'Canary', state: 'done' }, log: 'Build passed; canary live on web-01 to web-04', level: 'ok' },
      { phase: { name: 'Rollout', state: 'now' } },
      { phase: { name: 'Verify', state: 'todo' }, widgets: [{ id: 'rps', type: 'stat', title: 'Requests/s', value: 8950, delta: 950, better: 'up', points: [7400, 7520, 7590, 7800, 8000, 8950] }, { id: 'p95', type: 'stat', title: 'p95 latency', value: 231, unit: 'ms', delta: 19, better: 'down', points: [218, 216, 214, 212, 231] }], count: 'health check failed', next: 180, status: 'retrying', fun: ['p95 stayed within 25 ms of baseline through the canary.', 'web-08 is the only host still on the older kernel.'], log: 'web-08 failed its health check: connection refused', level: 'err' },
      ...Array.from({ length: 12 }, (_, i) => ({ cell: { name: `web-${String(i + 1).padStart(2, '0')}`, state: i < 7 ? 'hit' : i === 7 ? 'miss' : i === 8 ? 'now' : 'todo' } })),
    ],
  },
  training: {
    calls: [
      { start: 'Train support-ticket classifier v7', goal: "Beat v6's 89.4% validation accuracy within 10 epochs", progress: '4/10', progress_label: 'epochs', phase: { name: 'Prepare', state: 'done' }, set: { 'learning rate': '2.4e-4', 'grad norm': 0.83 }, accent: '#5B8DD6' },
      { phase: { name: 'Train', state: 'now' } }, { phase: { name: 'Evaluate', state: 'todo' } },
      { phase: { name: 'Export', state: 'todo' }, strip: ['progress', 'acc', 'trend', 'phases'], next: 791, log: 'Epoch 4/10 done: val acc 91.2%, checkpoint saved', level: 'ok', widgets: [
        { id: 'sps', type: 'stat', title: 'Samples/s', value: 18420, delta: 310, better: 'up', points: [17600, 17900, 18110, 18420] },
        { id: 'acc', type: 'gauge', title: 'Val accuracy', value: 91.2, unit: '%', min: 0, max: 100, tone: 'good' },
        { id: 'gpuh', type: 'ring', title: 'GPU-hours used', value: 38, max: 96, unit: 'h', tone: 'info' },
        { id: 'mem', type: 'meter', title: 'GPU memory', value: 71.5, max: 80, unit: 'GB', tone: 'warn' },
        { id: 'loss', type: 'line', title: 'Training loss', better: 'down', tone: 'info', points: [1.92, 1.41, 1.08, 0.86, 0.71, 0.62, 0.55, 0.49, 0.47, 0.5, 0.44, 0.4, 0.37, 0.35, 0.34] },
        { id: 'cls', type: 'bars', title: 'Tickets by class (thousands)', tone: 'info', items: [{ label: 'billing', value: 312 }, { label: 'shipping', value: 268 }, { label: 'refund', value: 196 }, { label: 'login', value: 154 }] },
        { id: 'f1', type: 'table', title: 'Per-class F1', items: [{ label: 'billing', value: 0.95, state: 'done' }, { label: 'feature request', value: 0.81, state: 'failed', note: 'below 0.85' }] },
      ] },
      { count: 'grad clipped', count_by: 14 },
    ],
  },
  long: {
    failed: 2,
    calls: [
      { start: 'Migrate the billing and invoicing subsystem to the event-sourced ledger', goal: 'Move every invoice and payment record into the append-only ledger and verify balances per customer account', phase: { name: 'Backfill', state: 'done' }, set: { 'invoices backfilled so far': 1300000, 'customer accounts reconciled': 18200 } },
      // raw output as a log line: a deep path, then more prose than any band holds
      { phase: { name: 'Reconcile per-customer balances against the ledger', state: 'now' }, log: 'Wrote /srv/billing/ledger/backfill/shard-07/reconcile-report.json; 18,200 accounts reconciled, 0 mismatches. Next: shards 8 to 12, then the per-customer balance check', level: 'ok' },
    ],
  },
  plan: {
    calls: [{ start: 'Refactor auth module', goal: 'Move token refresh behind one interface', widget: { id: 'plan', type: 'checklist', title: 'Plan', items: [{ label: 'Map the call sites', state: 'done' }, { label: 'Add the interface', state: 'done' }, { label: 'Move refresh logic behind it', state: 'now' }, { label: 'Delete the old path', state: 'todo' }, { label: 'Run the auth tests', state: 'todo' }] } }],
  },
  // the plan mirror (hooks/plan.ts): Claude's task list, as the tool carries it, drawn as the plan with done of total as
  // the progress, though Claude sent neither
  mirror: {
    calls: [
      { start: 'Refactor auth module', goal: 'Move token refresh behind one interface' },
      { tool: 'TodoWrite', answer: { result: 'ok' }, todos: [
        { content: 'Map the call sites', status: 'completed', activeForm: 'Mapping the call sites' },
        { content: 'Add the interface', status: 'completed', activeForm: 'Adding the interface' },
        { content: 'Move refresh logic behind it', status: 'in_progress', activeForm: 'Moving refresh logic' },
        { content: 'Delete the old path', status: 'pending', activeForm: 'Deleting the old path' },
        { content: 'Run the auth tests', status: 'pending', activeForm: 'Running the auth tests' },
      ] },
    ],
  },
  started: { calls: [{ start: 'Upgrade the build to Node 22', goal: 'Green CI on Node 22' }] },
  // slots: Claude's progress and phases, then the sources' slots fill the four; the pane has every one
  slots: {
    calls: [
      { start: 'Ship the billing service', goal: 'Green tests, then deploy to production', progress: '3/8', progress_label: 'tasks', phase: { name: 'Build', state: 'done' } },
      { phase: { name: 'Test', state: 'now' } },
    ],
    tools: [...EDITED, TESTS_RAN, { tool: 'deploys' }],
    measure: MEASURE,
    then: [{ phase: { name: 'Deploy', state: 'todo' } }],
  },
  // the Agents source (hooks/sources/agents.ts): subagents at work. Two in the background, one finished and one failed in
  // the foreground; "2 jobs running" in the header
  agents: {
    calls: [{ start: 'Migrate the auth tables', goal: 'Green auth tests on the new schema', progress: '3/8', progress_label: 'tasks', phase: { name: 'Migrate', state: 'now' } }],
    tools: [
      { tool: 'Agent', description: 'Map the legacy tables', prompt: 'p', run_in_background: false, answer: { result: { status: 'completed', agentId: 'f1', prompt: 'p', content: [] } } },
      { tool: 'Agent', description: 'Draft the rollback plan', prompt: 'p', run_in_background: false, answer: { result: 'The agent timed out', isError: true } },
      ...[['b1', 'Write the migration'], ['b2', 'Run the auth tests']].map(([id, description]) => ({
        tool: 'Agent', description, prompt: 'p', run_in_background: true, answer: { result: { status: 'async_launched', agentId: id, description, prompt: 'p', outputFile: `/tmp/${id}.out` } },
      })),
    ],
  },
  // the urgency place (hooks/urgency.ts): the tests were passing and went red, so the HUD's own rule leads the strip with
  // it, in front of the four, and the tests figure does not also sit among them
  'urgent: tests went red': {
    calls: [
      { start: 'Ship the billing service', goal: 'Green tests, then deploy to production', progress: '3/8', progress_label: 'tasks', phase: { name: 'Build', state: 'done' } },
      { phase: { name: 'Test', state: 'now' } },
    ],
    tools: [TESTS_PASSED, ...EDITED, TESTS_RAN],
    measure: MEASURE,
    then: [{ phase: { name: 'Deploy', state: 'todo' } }],
  },
  // the same place once its rule has stopped: the tests went red, then green again. It keeps its position until the next
  // boundary, saying what the figure says now and not the state that raised it, in the figure's colour (the terminal's
  // line goes green)
  'urgent: held, tests green again': {
    calls: [
      { start: 'Ship the billing service', goal: 'Green tests, then deploy to production', progress: '3/8', progress_label: 'tasks', phase: { name: 'Build', state: 'done' } },
      { phase: { name: 'Test', state: 'now' } },
    ],
    tools: [TESTS_PASSED, ...EDITED, TESTS_RAN, TESTS_PASSED],
    measure: MEASURE,
  },
  // the person's say in what shows (hooks/modes.ts, prefs.ts): a mode they set, a slot pinned and one hidden, as /hud
  // commands; the pane's "Showing" block says so
  modes: {
    calls: [{ start: 'Ship the billing service', goal: 'Green tests, then deploy to production', progress: '3/8', progress_label: 'tasks', phase: { name: 'Test', state: 'now' }, mode: 'review', focus: ['deploys/prod'] }],
    tools: [...EDITED, TESTS_RAN, { tool: 'deploys' }],
    measure: MEASURE,
    commands: ['mode debug', 'pin hud/tests', 'pin deploys/prod', 'hide hud/cost'],
  },
  // a run with nothing of its own to draw yet: the sources' slots alone
  sources: {
    calls: [{ start: 'Look into the flaky ledger test', goal: 'Find why it fails one run in five' }],
    tools: [TESTS_RAN, { tool: 'deploys' }],
    measure: MEASURE,
    then: [{ focus: ['hud/tests'] }],
  },
  // the auto-log: a log that mixes Claude's lines with the observer's (dim): edits collapsing, a failing build, the
  // test count moving, a fetch and a search. Tool calls among the hud calls pass through as the session makes them.
  autolog: {
    calls: [
      { start: 'Move billing onto the event-sourced ledger', goal: 'Green tests, then open the PR', progress: '3/8', progress_label: 'tasks', phase: { name: 'Backfill', state: 'now' }, log: 'Plan: ledger schema first, then the backfill' },
      ...[1, 2, 3].map(() => ({ tool: 'Edit', file_path: '/src/billing/ledger-schema.ts', answer: { result: 'ok' } })),
      { tool: 'Edit', file_path: '/src/billing/backfill.ts', answer: { result: 'ok' } },
      { tool: 'Bash', command: 'npm test', answer: { result: '', text: 'Tests:       3 failed, 36 passed, 39 total' } },
      { tool: 'Bash', command: 'cd /src && npm run build | tail' },
      { log: 'Schema written; backfill next', level: 'ok' },
      { tool: 'WebFetch', url: 'https://docs.anthropic.com/en/docs/claude-code/hooks', answer: { result: 'ok' } },
      { tool: 'WebSearch', query: 'idempotent ledger backfill with retries', answer: { result: 'ok' } },
      { tool: 'Edit', file_path: '/src/billing/ledger.ts', answer: { result: 'ok' } },
      { tool: 'Bash', command: 'npm test', answer: { result: '', text: 'Tests:       0 failed, 39 passed, 39 total' } },
      { log: 'All green; opening the PR', level: 'ok' },
      { tool: 'Edit', file_path: '/README.md', answer: { result: 'ok' } },
      { tool: 'Bash', command: 'npm run lint' },
    ],
  },
  // Recall, the docs tile, the index-time line (the strip's trend) and the query mix left alone 24 calls (stale), Heap 12
  // (aging), p95 and the replay tile just sent (fresh)
  aging: {
    calls: [
      { start: 'Tune the search index', goal: 'p95 under 120 ms on the replay set', progress: '2/5', progress_label: 'shards', set: { 'docs indexed': 41200 }, widgets: [
        { id: 'recall', type: 'stat', title: 'Recall@10', value: 0.91 },
        { id: 'build', type: 'line', title: 'Index build time', unit: 's', better: 'down', tone: 'info', points: [212, 198, 187, 176, 171] },
        { id: 'mix', type: 'donut', title: 'Query mix', items: [{ label: 'keyword', value: 52 }, { label: 'semantic', value: 31 }, { label: 'hybrid', value: 17 }] },
      ] },
      { wait: 3 * 60_000 }, ...BENCH(12),
      { widget: { id: 'heap', type: 'meter', title: 'Heap', value: 5.1, max: 8, unit: 'GB', tone: 'warn' } },
      { wait: 4 * 60_000 }, ...BENCH(12),
      { progress: '3/5', set: { 'queries replayed': 1800 }, widget: { id: 'p95', type: 'line', title: 'p95 latency', unit: 'ms', better: 'down', tone: 'info', points: [168, 151, 140, 131, 128] }, log: 'Shard 3 rebuilt; p95 at 128 ms' },
    ],
  },
  // the board ranked, with why each is there: Claude's figures beside the sources', its focus on one, a deploy that
  // failed long ago lifted by its source's hint, an edit just now
  ranked: {
    calls: [{ start: 'Ship the billing service', goal: 'Green tests, then deploy to production', progress: '3/8', progress_label: 'tasks', widgets: [
      { id: 'p95', type: 'stat', title: 'p95 latency', value: 212, unit: 'ms', tone: 'warn' },
      { id: 'heap', type: 'meter', title: 'Heap', value: 5.1, max: 8, unit: 'GB' },
    ] }],
    tools: [{ tool: 'deploys' }, ...BENCH(20), TESTS_RAN, ...EDITED],
    measure: MEASURE,
    then: [{ focus: ['claude/p95'] }],
  },
  // bindings (hooks/bind.ts): widgets Claude bound to its commands, filled by the observer: the tests and the bench read,
  // and coverage, whose command stopped printing a figure 24 runs ago, stale: "no reading", never its old 81%
  bound: {
    calls: [
      { start: 'Fix the flaky ledger suite', goal: 'Green tests on three runs in a row', widgets: [
        { id: 'tests', type: 'stat', title: 'Tests', bind: { on: 'shell', match: 'npm test', extract: 'pass_fail' } },
        { id: 'p95', type: 'line', title: 'Bench p95', unit: 'ms', better: 'down', tone: 'info', points: [212, 205], bind: { on: 'shell', match: 'bench', extract: 'last_number' } },
        { id: 'cov', type: 'ring', title: 'Coverage', bind: { on: 'shell', match: 'coverage', extract: 'percent' } },
      ] },
      { tool: 'Bash', command: 'npm run coverage', answer: { result: '', text: 'All files | 81.4%' } },
      ...Array.from({ length: 24 }, () => ({ tool: 'Bash', command: 'npm run coverage', answer: { result: '', text: 'coverage: no data' } })),
      ...[201, 198, 194].map(ms => ({ tool: 'Bash', command: 'npm run bench', answer: { result: '', text: `p95: ${ms}ms` } })),
      { tool: 'Bash', command: 'npm test', answer: { result: '', text: 'Tests:       2 failed, 39 passed, 41 total' } },
    ],
  },
  // recipes (hooks/recipes.ts): the layout a `recipe` lays guesses no command, so nothing in it is bound or has a figure: it
  // draws "–" and an empty line, never a number nobody read. Then one scene a recipe, each bound by Claude to the exact
  // command it runs (the answer asks it to), as Claude would after the answer.
  'recipe: laid, nothing bound': {
    calls: [{ start: 'Deploy v2.4 to 12 hosts', goal: 'Roll out in batches, with health checks', recipe: 'rollout' }],
    // commands that carry a recipe's old default words and are not the work: they fill nothing
    tools: [
      { tool: 'Bash', command: 'git log deploy', answer: { result: '', text: 'a1b2c3d deploy step 3/12' } },
      { tool: 'Bash', command: 'curl -s https://api.example.com/health', answer: { result: '', text: '503 Service Unavailable' } },
    ],
  },
  'recipe: build': {
    calls: [{ start: 'Build the billing service', goal: 'A green build on Node 22', recipe: 'build', progress: '5/8', progress_label: 'packages', widgets: [
      { id: 'build', bind: { on: 'shell', match: 'npm run build', extract: 'exit' } }, { id: 'build-time', bind: { on: 'shell', match: 'npm run build', extract: 'duration' } },
    ] }],
    // two builds that fail: the exit, the durations and the log's last line say the same
    tools: [4.1, 3.8].map(s => ({ tool: 'Bash', command: 'npm run build', answer: { result: 'x', isError: true, text: `error TS2345: Argument of type string; failed after ${s}s` } })),
  },
  // no widget of the recipe's own: the tests and their failing count of each run are the HUD's own Tests figure
  'recipe: test-fix': {
    calls: [{ start: 'Fix the flaky ledger suite', goal: 'Green tests on three runs in a row', recipe: 'test-fix', widget: { id: 'attempts', value: 3 }, log: 'Third pass at the retry logic' }],
    tools: [5, 3, 1].map(n => ({ tool: 'Bash', command: 'npm test', answer: { result: '', text: `Tests:       ${n} failed, ${41 - n} passed, 41 total` } })),
  },
  // none of its own either: the plan is Claude's phases, files edited and tests the HUD's
  'recipe: refactor': {
    calls: [
      { start: 'Refactor auth module', goal: 'Move token refresh behind one interface', recipe: 'refactor', phase: { name: 'Map', state: 'done' } },
      { phase: { name: 'Move', state: 'now' } }, { phase: { name: 'Delete the old path', state: 'todo' } },
    ],
    tools: [...EDITED, TESTS_RAN],
  },
  'recipe: migration': {
    failed: 1,
    calls: [
      { start: 'Migrate the auth tables to the new schema', goal: 'Every table moved, with row counts matching', recipe: 'migration', phase: { name: 'Map', state: 'done' }, widget: { id: 'tables', bind: { on: 'shell', match: 'migrate', extract: 'n_of_m' } } },
      { phase: { name: 'Move', state: 'now' } }, { phase: { name: 'Verify', state: 'todo' } },
    ],
    tools: [{ tool: 'Bash', command: './migrate --all', answer: { result: '', text: 'migrated 412/938 tables' } }],
  },
  'recipe: rollout': {
    calls: [
      { start: 'Deploy v2.4 to 12 hosts', goal: 'Roll out in batches, with health checks', recipe: 'rollout', phase: { name: 'Rollout', state: 'now' }, widgets: [
        { id: 'hosts-done', bind: { on: 'shell', match: 'deploy-hosts', extract: 'n_of_m' } }, { id: 'health', bind: { on: 'shell', match: 'health-check', extract: 'exit' } }, { id: 'latency', bind: { on: 'shell', match: 'health-check', extract: 'last_number' } },
      ] },
      ...Array.from({ length: 12 }, (_, i) => ({ cell: { name: `web-${String(i + 1).padStart(2, '0')}`, state: i < 7 ? 'hit' : i === 7 ? 'miss' : i === 8 ? 'now' : 'todo' } })),
    ],
    tools: [
      { tool: 'Bash', command: './deploy-hosts web-07', answer: { result: '', text: 'deployed 7/12 hosts' } },
      ...['0.231', '0.219', '0.254'].map(ms => ({ tool: 'Bash', command: './health-check web-07', answer: { result: '', text: ms } })),
    ],
  },
  // the questions are Claude's to send; the sources fetched are the HUD's own Fetched list, and nothing else counts them
  'recipe: research': {
    calls: [
      { start: 'Compare three queue libraries', goal: 'Pick one for the billing events', recipe: 'research' },
      { widget: { id: 'questions', items: [{ label: 'Does it keep order per key?', state: 'done' }, { label: 'What does a retry cost?', state: 'now' }, { label: 'Is it maintained?', state: 'todo' }] } },
    ],
    tools: ['https://bullmq.io/docs', 'https://docs.nats.io/jetstream'].map(url => ({ tool: 'WebFetch', url, answer: { result: 'ok' } })),
  },
  'recipe: remote-job': {
    calls: [{ start: 'Train classifier v8 on the pod', goal: 'Finish 1,000 steps under a loss of 0.4', recipe: 'remote-job', next: 300, widgets: [
      { id: 'job-progress', bind: { on: 'shell', match: 'train-status', extract: 'percent' } }, { id: 'job-metric', title: 'Training loss', better: 'down', bind: { on: 'shell', match: 'train-status', extract: 'last_number' } },
    ] }],
    tools: ['step 120/1000 12% loss 1.92', 'step 450/1000 45% loss 0.61', 'step 700/1000 70% loss 0.43'].map(text => ({ tool: 'Bash', command: './train-status pod-7', answer: { result: '', text } })),
  },
  failed: {
    failed: 3,
    calls: [
      { start: 'Deploy v2.4 to 12 hosts', progress: '7/12', progress_label: 'hosts', phase: { name: 'Build', state: 'done' } },
      { phase: { name: 'Rollout', state: 'now' } },
      { fail: 'Health checks failed on 3 hosts; rolled back to v2.3', log: 'Rolled back' },
    ],
  },
  // a run that started on its own: its title dim until Claude names it
  provisional: { calls: AUTO },
  // the turn ended with no done or fail: waiting for you, with the last log line
  waiting: { calls: [...AUTO, { end: true }] },
  // and half an hour on with no turn: paused
  paused: { start: true, calls: [...AUTO, { end: true }, { wait: 31 * 60_000 }] },
}

for (const [scene, { calls, failed = 0, tools = [], measure, then = [], start, commands = [] }] of Object.entries(SCENES)) {
  test(`trial: ${scene}`, { plugins: [{ name: 'deploys', register: deploys }] }, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    dock(on)
    // tool calls beneath the plugin answer as the scene says, else fail, for the scene's errors
    on('tool.call', ($, e) => (e as unknown as { answer?: { result: unknown } }).answer ?? { isError: true, result: 'failed' }) // (a denial is no error: a failure is)
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('session.surfaces', () => ({ value: ['desktop'] })) // someone watches, as in the app: calls count
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
    on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.register', ($, e) => ({ value: { tool: `mcp__hud__${e.name}` } }))
    const call = $.tool.call as unknown as Call
    if (start) await ($.session.start as unknown as Call)({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (const c of calls) {
      if ('wait' in c) await clock.advance(Number(c.wait))
      else if ('say' in c) await ($.prompt.submit as unknown as Call)({ text: c.say, wait: false, origin: { kind: 'composer' } })
      else if ('end' in c) await ($.turn.complete as unknown as Call)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
      else await call({ tool: 'mcp__hud__hud', ...c })
    }
    // a real command, as the failing-runs list names the command: one called `false` read as a boolean printed as text
    for (let n = 0; n < failed; n++) await call({ tool: 'Bash', command: 'npm run lint' })
    for (const t of tools) await call(t)
    if (measure) await ($.session.measure as unknown as Call)(measure)
    // Claude's last calls, after the sources reported: a boundary, so the strip takes what came, and the run runs on
    for (const c of then) await call({ tool: 'mcp__hud__hud', ...c })
    for (const args of commands) await ($.command.run as unknown as Call)({ command: 'hud', args })
    const print = (surface: string, view: string, cols: number, tree: unknown, open = false) =>
      console.log('TRIAL ' + JSON.stringify({ scene, surface, view, cols, open, tree }))
    const mount = (surface: string, component: string, props: object) =>
      ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component, ...(component === 'Pane' ? { requestId: 'hud' } : {}), props })
    // the same run on both surfaces: the desktop's image and native header, the terminal's text
    for (const surface of ['desktop', 'terminal']) {
      for (const cols of [60, 105, 150]) {
        const ui = await mount(surface, 'AbovePrompt', { ...band, bodyColumns: cols })
        print(surface, 'band', cols, await ui.drawn())
        if (cols === 105) {
          await ui.press({ key: 'toggle' })
          print(surface, 'band', cols, await ui.drawn(), true)
          await ui.press({ key: 'toggle' })
        }
        await ui.unmount()
      }
      for (const cols of [40, 60, 80]) {
        const p = await mount(surface, 'Pane', { ...pane, bodyColumns: cols })
        print(surface, 'pane', cols, await p.drawn())
        await p.unmount()
      }
    }
    expect(true).toBe(true)
  })
}
