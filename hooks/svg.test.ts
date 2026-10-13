import { test, expect } from 'claude-code/testing'
import { AGING, STALE } from './lifecycle'
import { apply } from './run'
import { dashboard, describe, fit, measure, pct, plain, smooth, stepNow, strip, wrapPx } from './svg'

test('every widget type renders clean svg', async () => {
  const types = ['stat', 'gauge', 'ring', 'meter', 'line', 'bars', 'columns', 'donut', 'heatmap', 'list', 'checklist', 'table', 'text'] as const
  const items = [{ label: 'a & b', value: 3, state: 'done' as const }, { label: 'c', value: 1, state: 'now' as const }]
  let r = apply(null, { start: 'T', set: { x: 1 }, progress: '1/2', phase: { name: 'p', state: 'now' }, cell: { name: 'us-1', state: 'hit' }, point: 1, count: 'e', fun: ['f'], log: 'l' }, 0)
  r = apply(r, { point: 2, widgets: types.map(type => ({ id: type, type, value: 40, max: 100, delta: -2, items, points: [1, 3, 2], rows: [[1, 2], [3, 4]], text: 'hello <world>' })) }, 1000)
  r = apply(r, { widget: { id: 'line', push: 9 } }, 2000)
  expect(r.widgets.find(w => w.id === 'line')?.points).toEqual([1, 3, 2, 9])
  for (const width of [240, 340, 600, 1200]) {
    const { source, height } = dashboard(r, width)
    expect(source.startsWith('<svg')).toBe(true)
    expect(height).toBeGreaterThan(200)
    expect(source.includes('fill="freeze"')).toBe(false)
    expect(/NaN|undefined|Infinity|<world>|a & b/.test(source)).toBe(false)
  }
  expect(apply(r, { remove: ['text'] }, 3000).widgets.length).toBe(types.length - 1)
  // percentages never claim done or empty early
  expect([0, 0.001, 0.5, 0.996, 1].map(pct)).toEqual([0, 1, 50, 99, 100])
  // dashboard layout: flat (no cards), every block starts inside the width, figures in balanced rows
  for (const width of [340, 560, 900]) {
    const { source } = dashboard(r, width)
    expect(source.includes('class="card"')).toBe(false)
    expect([...source.matchAll(/<g transform="translate\(([\d.]+) ([\d.]+)\)">/g)].every(m => Number(m[1]) < width)).toBe(true)
  }
  const figures = apply(null, { start: 'f', set: { a: 1, b: 2, c: 3, d: 4 } }, 0) // 4 tiles + tool calls = 5
  const tops = (src: string) => [...src.matchAll(/<g transform="translate\(\d+\.\d (\d+\.\d)\)">/g)].map(m => m[1]) // a block's own box; its body's is translate(0 26)
  const rowSizes = (src: string) => Object.values(tops(src).reduce<Record<string, number>>((n, y) => ({ ...n, [y!]: (n[y!] ?? 0) + 1 }), {}))
  expect(rowSizes(dashboard(figures, 560).source)).toEqual([3, 2])
  const slices = Array.from({ length: 8 }, (_, i) => ({ label: `s${i}`, value: 8 - i }))
  expect(dashboard(apply(null, { start: 'd', widget: { id: 'pie', type: 'donut', items: slices } }, 0), 900).source.includes('>Other<')).toBe(true)
  // smoothing: cubic segments, control points kept inside the box
  const d = smooth([[0, 50], [10, 0], [20, 100], [30, 40]], 0, 100)
  expect(d.startsWith('M0.0 50.0C')).toBe(true)
  expect((d.match(/C/g) ?? []).length).toBe(3)
  expect(d.match(/-?\d+\.\d/g)!.map(Number).every(n => n >= 0 && n <= 100)).toBe(true)
  // wrapping: lines stay within the width, never more than asked, overflow ends in …
  const lines = wrapPx('smooth curves (Catmull-Rom) for line and sparklines and the trend card', 160, 13, 2)
  expect(lines.length).toBe(2)
  expect(lines.every(l => measure(l, 13) <= 160)).toBe(true)
  expect(lines[1]!.endsWith('…')).toBe(true)
  expect(wrapPx('short', 160, 13, 2)).toEqual(['short'])
  // the band's strip: clean at every width, and an empty run still draws
  for (const width of [320, 700, 1300]) {
    for (const run of [r, apply(null, { start: 'empty' }, 0)]) {
      const { source } = strip(run, width)
      expect(/NaN|undefined|Infinity/.test(source)).toBe(false)
    }
  }
  // sparse by default: ring + 2 stats + phases-or-trend at most, and the panel hugs them
  const sections = (src: string) => (src.match(/font-size="11" font-weight="500"/g) ?? []).length
  const wide = strip(r, 1400)
  expect(sections(wide.source)).toBeLessThanOrEqual(4)
  expect(wide.width).toBe(1400) // fills the room it is given
  // `strip` picks exactly what shows, in order
  const picked = strip(apply(r, { strip: ['gauge', 'trend'] }, 0), 1400)
  expect(sections(picked.source)).toBe(2)
  // adaptive: never wider than the room, and more room never means a smaller strip
  let prev = 0
  for (const room of [260, 420, 640, 900, 1400]) {
    const { width } = strip(r, room)
    expect(width).toBeLessThanOrEqual(Math.max(room, 200))
    expect(width).toBeGreaterThanOrEqual(prev)
    prev = width
  }
  // the phase step follows the run: finished reads 4 / 4, not 1 / 4
  const phasesAt = (states: Array<'done' | 'failed' | 'todo'>) =>
    strip(states.reduce((run, state, i) => apply(run, { phase: { name: 'abcd'[i]!, state } }, 0), apply(null, { start: 'p' }, 0)), 1400).source
  expect(phasesAt(['done', 'done', 'done', 'done'])).toContain('Phase 4 / 4')
  expect(phasesAt(['done', 'done', 'failed', 'todo'])).toContain('Phase 3 / 4')
  // phases never clip a name to "R…": a chain names every step while each fits, else a track names the current one
  const chainOf = (n: number) => Array.from({ length: n }, (_, i) => `Build ${i + 1}`).reduce((run, name) => apply(run, { phase: { name, state: 'now' } }, 0), apply(null, { start: 'c', progress: `${n - 1}/${n}` }, 0))
  const texts = (src: string) => [...src.matchAll(/<text[^>]*>([^<]*)</g)].map(m => m[1]!)
  for (const width of [340, 800, 1200]) {
    const long = texts(dashboard(chainOf(12), width).source)
    expect(long).toContain('Build 12')
    expect(long).toContain('after Build 11')
    expect(long.filter(t => t.startsWith('Build') && t.endsWith('…'))).toEqual([])
  }
  expect(texts(dashboard(chainOf(4), 1200).source).filter(t => /^Build \d$/.test(t)).length).toBe(4)
  // and beside the progress figure, a long chain still shares its row
  expect(new Set(tops(dashboard(chainOf(12), 900).source)).size).toBe(2) // progress + phases, then figures
  // height follows the content: plain numbers sit lower than a labelled phase chain
  const flat = strip(apply(null, { start: 'n', set: { files: 3, lines: 40 } }, 0), 800)
  expect(flat.height).toBeLessThan(strip(r, 1400).height)
})

test('a change of nothing is never coloured good or bad', async () => {
  const r = apply(null, { start: 'T', widget: { id: 'fails', type: 'stat', title: 'Failures', value: 2, delta: 0, better: 'down' } }, 0)
  const { source } = strip(r, 900)
  expect(source).toContain('▲ 0')
  expect(source).not.toMatch(/fill="var\(--bad-t\)">▲ 0/)
})

test('markdown Claude writes is drawn as plain text', async () => {
  expect(plain('CI `test` is **green**, see [PR #5](https://github.com/o/r/pull/5)')).toBe('CI test is green, see PR #5')
  // lone or code-like marks stay as written
  expect(plain('a ** b, `x, __init__.py, *args')).toBe('a ** b, `x, __init__.py, *args')
  const r = apply(null, { start: 'Ship **it**', progress: '1/2', set: { '`branch`': 'main' }, phase: { name: '`lint`', state: 'now' }, log: 'CI `test` check **pending** on [#5](https://x.y/5)' }, 0)
  const nodes = (src: string) => [...src.matchAll(/>([^<>]+)</g)].map(m => m[1]!).join(' ')
  for (const src of [dashboard(r, 600).source, strip(r, 900).source]) expect(nodes(src)).not.toMatch(/[`*]|\]\(/)
  expect(nodes(dashboard(r, 600).source)).toContain('CI test check pending on #5')
})

test('the strip says which items it drew', async () => {
  const r = apply(apply(null, { start: 'T', progress: '1/4', phase: { name: 'a', state: 'done' } }, 0), { phase: { name: 'b', state: 'now' }, set: { files: 3 } }, 0)
  expect(strip(r, 1400).shown).toEqual(['progress', 'files', 'phases'])
  expect(strip(r, 120).shown).toEqual(['progress']) // the least important go first when room runs out
  // nothing else yet: no graphic at all, never a lone "Tool calls 0" in the middle of the band
  expect(strip(apply(null, { start: 'empty' }, 0), 900).shown).toEqual([])
  // a long step at a narrow band keeps the step (cut) over a few errors in many calls (seen: "Errors 2" alone)
  const long = { ...apply(null, { start: 'L', phase: { name: 'Backfill', state: 'done' } }, 0), calls: 512, errors: 2 }
  const longer = apply(long, { phase: { name: 'Reconcile per-customer balances against the ledger', state: 'now' } }, 0)
  expect(strip(longer, 360).shown).toContain('phases')
  expect(strip(longer, 360).source).toContain('Reconcile per')
  expect(strip({ ...longer, errors: 60 }, 360).shown).toContain('errors') // past 5% of calls they lead
  // text floors: 11px in the strip, 12px in the dashboard
  for (const svg of [strip(longer, 360).source, strip(r, 1400).source, strip(r, 120).source]) expect(Math.min(...[...svg.matchAll(/font-size="([\d.]+)"/g)].map(m => Number(m[1])))).toBeGreaterThanOrEqual(11)
  expect(Math.min(...[...dashboard(longer, 900).source.matchAll(/font-size="([\d.]+)"/g)].map(m => Number(m[1])))).toBeGreaterThanOrEqual(12)
  // a tile Claude named "errors" is its own item, never taken for the counted tool errors
  const clash = { ...apply(null, { start: 'c', set: { errors: 5 } }, 0), errors: 2 }
  expect(strip(clash, 1400).shown).toEqual(['errors', 'own:errors'])
  expect(strip({ ...clash, strip: ['own:errors'] }, 1400).shown).toEqual(['own:errors'])
  // with no progress or phases, a checklist is the plan: the strip shows it beside the errors, never errors alone
  const plan = { ...apply(null, { start: 'p', widget: { id: 'plan', type: 'checklist', title: 'Plan', items: [{ label: 'Probe', state: 'done' }, { label: 'Spawn', state: 'now' }, { label: 'Ship', state: 'todo' }] } }, 0), calls: 133, errors: 6 }
  const band = strip(plan, 860)
  expect(band.shown).toEqual(['errors', 'plan'])
  expect(band.source).toContain('of 133 calls')
})

test('a checklist leads the dashboard when there are no phases, and failed calls sit under the call count', async () => {
  const r = { ...apply(null, { start: 'p', widget: { id: 'plan', type: 'checklist', title: 'Plan', items: [{ label: 'Probe', state: 'done' }, { label: 'Spawn', state: 'now' }, { label: 'Ship', state: 'todo' }] } }, 0), calls: 133, errors: 6 }
  const texts = [...dashboard(r, 352).source.matchAll(/<text[^>]*>([^<]*)</g)].map(m => m[1]!)
  expect(texts.indexOf('Plan')).toBeLessThan(texts.indexOf('Tool calls'))
  expect(texts).toContain('1 of 3 done')
  expect(texts).toContain('6 failed')
  expect(texts).not.toContain('Errors')
  // with phases, the checklist stays among the widgets
  const phased = apply(r, { phase: { name: 'Build', state: 'now' } }, 0)
  const order = [...dashboard(phased, 352).source.matchAll(/<text[^>]*>([^<]*)</g)].map(m => m[1]!)
  expect(order.indexOf('Tool calls')).toBeLessThan(order.indexOf('Plan'))
  // the checklist's item in hand is the run's step while it is live, and none once it is finished
  expect(stepNow(r)).toEqual({ name: 'Spawn', key: 'plan' })
  expect(stepNow(apply(r, { done: 'shipped' }, 0))).toBeUndefined()
  expect(stepNow(apply(r, { fail: 'crashed' }, 0))).toBeUndefined()
})

// WCAG relative luminance and contrast, for the colour checks
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

test('status colours as text pass 4.5:1, a to-do mark 3:1, and no state is told by colour alone', async () => {
  let r = apply(null, { start: 'Deploy', progress: '7/12', set: { rps: 1840 }, cell: { name: 'host-01', state: 'hit' }, phase: { name: 'Build', state: 'done' }, log: 'built', level: 'ok' }, 0)
  r = apply(r, { cell: { name: 'host-02', state: 'miss' }, phase: { name: 'Canary', state: 'failed' }, log: 'slow', level: 'warn', widget: { id: 'p95', type: 'stat', value: 212, unit: 'ms', delta: -14, points: [1, 3, 2] } }, 1000)
  r = apply(r, { cell: { name: 'host-03', state: 'todo' }, log: 'health check failed', level: 'err', point: 3, widgets: [{ id: 't', type: 'table', items: [{ label: 'a', value: 1, state: 'failed' }] }] }, 2000)
  r = apply(r, { point: 5 }, 3000)
  const sources = [dashboard(r, 900).source, strip(r, 1300).source, strip(r, 560).source]
  for (const svg of sources) {
    // the theme's text tokens, read off the svg itself, on both of its backgrounds
    const light = svg.match(/svg\{[^}]*\}/)![0], dark = svg.match(/prefers-color-scheme: dark\)\{svg\{[^}]*\}/)![0]
    for (const [css, bgs] of [[light, ['#FAF9F5', '#FFFFFF']], [dark, ['#262624', '#30302E']]] as const) {
      // muted is the text token of the observer's log lines and of every aside, dim-t of a block that hasn't changed in
      // a while: ≥ 4.5:1 like the status text
      for (const name of ['good-t', 'bad-t', 'warn-t', 'info-t', 'muted', 'dim-t']) {
        const hex = css.match(new RegExp(`--${name}:(#[0-9A-F]{6})`))![1]!
        for (const bg of bgs) expect(contrast(hex, bg)).toBeGreaterThanOrEqual(4.5)
      }
      // marks: a to-do ring, and every mark of a block that hasn't changed in a while
      for (const name of ['todo', 'dim']) {
        const mark = css.match(new RegExp(`--${name}:(#[0-9A-F]{6})`))![1]!
        for (const bg of bgs) expect(contrast(mark, bg)).toBeGreaterThanOrEqual(3)
      }
    }
    // no text is filled with a status hue: those are for marks
    expect(svg).not.toMatch(/<text[^>]*fill="#(788C5D|BF4D43|C7963E|6A9BCC)"/)
  }
  // hit and miss, ok and err: a tick and a cross, not two dots of colour
  const d = dashboard(r, 900).source
  expect(d.match(/stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/g)?.length).toBeGreaterThanOrEqual(2)
  expect(d.match(/stroke="#fff" stroke-width="2" stroke-linecap="round"\/>/g)?.length).toBeGreaterThanOrEqual(2)
})

test('dashboard: balanced figure rows, labels and asides that wrap, changes coloured by meaning, units as written', async () => {
  const seven = apply(null, { start: 'Backfill', set: { rps: 1840, p95: '212 ms', 'invoices backfilled so far': 1300000, 'customer accounts reconciled': 18200, 'balance mismatches found': 17, 'average backfill batch time': '4.2 s' } }, 0)
  // seven figures with the call count: at 520 (three across) they split 3 + 2 + 2 or so, never leaving one alone
  const rowsOf = (svg: string) => [...svg.matchAll(/<g transform="translate\(\d+\.\d (\d+\.\d)\)">/g)].map(m => Number(m[1])) // a block's own place (one decimal)
  const ys = rowsOf(dashboard(seven, 520).source), perRow = new Map<number, number>()
  for (const y of ys) perRow.set(y, (perRow.get(y) ?? 0) + 1)
  expect(Math.min(...perRow.values())).toBeGreaterThanOrEqual(2)
  // long labels wrap whole instead of "Invoices backf…", and short keys stay as written
  const d = dashboard(seven, 340).source
  expect(d).toContain('>Invoices backfilled so<')
  expect(d).not.toMatch(/>Invoices backf…</)
  expect(d).toContain('>rps<')
  expect(d).toContain('>p95<')
  // the grid's aside goes under its label at 240 rather than "4 t…"
  let grid = apply(null, { start: 'G' }, 0)
  for (let i = 0; i < 12; i++) grid = apply(grid, { cell: { name: `host-${i}`, state: i < 7 ? 'hit' : i === 7 ? 'miss' : 'todo' } }, 0)
  expect(dashboard(grid, 240).source).toContain('7 hit · 1 miss · 4 to go')
  // latency down is good: green when better is down, neutral when nobody said
  const lat = (better?: 'up' | 'down') => dashboard(apply(null, { start: 'L', widget: { id: 'p95', type: 'stat', value: 198, unit: 'ms', delta: -14, ...(better ? { better } : {}) } }, 0), 600).source
  expect(lat('down')).toContain('fill="var(--good-t)">▼ 14')
  expect(lat('up')).toContain('fill="var(--bad-t)">▼ 14')
  expect(lat()).toContain('fill="var(--muted)">▼ 14')
  // a line's change in the strip too: a falling loss is good (seen red in the app before)
  const loss = (better?: 'up' | 'down') => strip(apply(null, { start: 'T', strip: ['trend'], widget: { id: 'loss', type: 'line', points: [0.5, 0.4, 0.35], ...(better ? { better } : {}) } }, 0), 600).source
  expect(loss('down')).toContain('fill="var(--good-t)">▼')
  expect(loss()).toContain('fill="var(--muted)">▼')
  // totals only where values add up, and one percent style
  const ms = dashboard(apply(null, { start: 'B', widgets: [{ id: 'lat', type: 'bars', unit: 'ms', items: [{ label: 'a', value: 400 }, { label: 'b', value: 532 }] }, { id: 'n', type: 'bars', items: [{ label: 'a', value: 4 }, { label: 'b', value: 5 }] }, { id: 'cpu', type: 'gauge', value: 72, unit: '%' }, { id: 'disk', type: 'ring', value: 81, max: 100, unit: '%' }] }, 0), 900).source
  expect(ms).not.toContain('932 total')
  expect(ms).toContain('9 total')
  expect(ms).not.toMatch(/> %</)
  expect(ms.match(/>81</g)?.length ?? 0).toBeLessThanOrEqual(1) // the ring says its percent once
})

test('the alt says in words what the graphics draw', async () => {
  let r = apply(null, { start: 'Deploy', progress: '7/12', progress_label: 'hosts', set: { rps: 1840 }, phase: { name: 'Build', state: 'done' } }, 0)
  r = apply(r, { phase: { name: 'Rollout', state: 'now' }, cell: { name: 'host-01', state: 'miss' }, widget: { id: 'plan', type: 'checklist', title: 'Checks', items: [{ label: 'tests', state: 'done' }, { label: 'types', state: 'now' }] }, log: 'canary **healthy**' }, 1000)
  expect(describe(r)).toBe('Progress 7 of 12 hosts, 58%. Phases: Build done, Rollout in progress (step 2 of 2). rps 1,840. Tool calls 0. Grid of 1: 1 missed. Checks: 1 of 2 done, now types. Last: canary healthy.')
})

test('a lead checklist named after the run reads as its plan, and counts read "x of n" everywhere', async () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((label, i) => ({ label, state: i === 0 ? 'done' as const : i === 1 ? 'now' as const : 'todo' as const }))
  // "Phase 0" over the plan of "Billing 2.0 — Phase 0 audit" would read as an echo of the title
  const echo = apply(null, { start: 'Billing 2.0 — Phase 0 audit', widget: { id: 'steps', type: 'checklist', title: 'Phase 0', items } }, 0)
  for (const svg of [strip(echo, 900).source, dashboard(echo, 900).source]) {
    expect(svg).toContain('>Plan<')
    expect(svg).not.toContain('>Phase 0<')
  }
  expect(strip(echo, 900).source).toContain('>1 of 6<')
  expect(strip(echo, 900).source).not.toContain('1/6')
  expect(dashboard(echo, 900).source).toContain('1 of 6 done')
  // a title that says something the run's doesn't stays
  const own = apply(null, { start: 'API Phase 1', widget: { id: 'checks', type: 'checklist', title: 'Routes to check', items } }, 0)
  expect(strip(own, 900).source).toContain('>Routes to check<')
})

test('a long line loses what says least first, then is cut where a reader can tell', async () => {
  const at = (line: string, px: number) => fit(line, px, 13)
  // raw output: colour codes and runs of spaces don't draw
  expect(at('\x1b[31mFAIL\x1b[0m   hooks/svg.test.ts   (3 tests)', 400)).toBe('FAIL hooks/svg.test.ts (3 tests)')
  // a path keeps its file name, a URL its host and its end, a hash its first 7 (a uuid its first 8); dates and numbers stay
  expect(at('Wrote ~/work/acme/billing-service/packages/api/v2.0/hooks/sources/contract.ts; 31 tests pass, tsc clean', 420)).toBe('Wrote …/sources/contract.ts; 31 tests pass, tsc clean')
  expect(at("Error: ENOENT: no such file or directory, open '/Users/me/projects/app/src/components/Header.tsx'", 420)).toBe("Error: ENOENT: no such file or directory, open '…/Header.tsx'")
  expect(at('fetched https://docs.example.com/guides/mods/hooks?x=1 and https://www.aitmpl.com/mods/ for ideas', 420)).toBe('fetched docs.example.com/…/hooks and www.aitmpl.com/mods…')
  expect(at('reset to 3f2a9c1e-7b4d-4e8a-9c6f-2d1b0a5e8f73 at 1791756557301 on 2026/10/11', 420)).toBe('reset to 3f2a9c1e at 1791756557301 on 2026/10/11')
  // prose: at a sentence's end, else a comma outside brackets, else a word; never after a colon or on a little word
  const log = 'Parsers written (json, yaml, toml) + v1 check; 30/31 tests pass on the samples. Two real findings: exit status hides test failures'
  expect(at(log, 700)).toBe('Parsers written (json, yaml, toml) + v1 check; 30/31 tests pass on the samples…')
  expect(at(log, 420)).toBe('Parsers written (json, yaml, toml) + v1 check…')
  expect(at(log, 260)).toBe('Parsers written (json, yaml, toml)…')
  expect(at('Three in-house parsers plus the v1 file format, tested on a sample project; then rework the plan', 420)).toBe('Three in-house parsers plus the v1 file format…')
  // a word wider than the room is the one cut mid-word, and every cut fits
  expect(at('Supercalifragilisticexpialidocious', 120)).toMatch(/^Supercal\w+…$/)
  for (const px of [120, 260, 420]) expect(measure(at(log, px), 13)).toBeLessThanOrEqual(px)
})

test('a block that has not changed in a while is drawn dim with when it changed, and the strip prefers what is fresh', async () => {
  // recall, heap and the rps tile set at 0; qps and p95 set AGING calls and 4 minutes later
  let r = apply(null, { start: 'Tune the index', set: { rps: 1840 }, widgets: [{ id: 'recall', type: 'stat', title: 'Recall', value: 0.91 }, { id: 'heap', type: 'meter', title: 'Heap', value: 5, max: 8, tone: 'warn' }] }, 0)
  r = apply({ ...r, ticks: AGING }, { set: { qps: 120 }, widget: { id: 'p95', type: 'line', title: 'p95', points: [140, 131, 128] } }, 4 * 60_000)
  const d = dashboard({ ...r, tickAt: 5 * 60_000 }, 900).source // the last call 5 minutes in
  expect(d.match(/<g class="dim"/g)?.length).toBe(3)
  // "5m ago" on the aging blocks alone, beside what their aside said already
  expect(d.match(/>[^<]*\d+m ago</g)).toEqual(['>5m ago<', '>5m ago<', '>63% · 5m ago<']) // the rps tile and recall among the figures, then heap
  // the dim tokens colour every mark and text inside, whatever hue it was drawn in
  expect(d).toMatch(/\.dim text,\.dim tspan\{fill:var\(--dim-t\)\}/)
  // stale draws the same way; with no call's time to say (a run from before), no aside
  const stale = dashboard({ ...r, ticks: STALE }, 900).source
  expect(stale.match(/<g class="dim"/g)?.length).toBe(5)
  expect(stale).not.toContain(' ago<')
  // the strip: a fresh figure before an aging one of higher rank, and the aging one drawn dim
  const band = strip(r, 1400)
  expect(band.shown).toEqual(['qps', 'recall', 'trend'])
  expect(band.source.match(/<g class="dim"/g)?.length).toBe(1)
  // with nothing fresh to take the place, the aging ones still show
  expect(strip({ ...r, ticks: STALE * 2 }, 1400).shown).toEqual(['recall', 'rps', 'trend'])
})

// Each dim group's markup, matched to its own </g>.
const dimGroups = (svg: string) => [...svg.matchAll(/<g class="dim"/g)].map(m => {
  let depth = 0
  for (const t of svg.slice(m.index).matchAll(/<g[\s>]|<\/g>/g)) {
    depth += t[0] === '</g>' ? -1 : 1
    if (depth === 0) return svg.slice(m.index, m.index! + t.index! + 4)
  }
  return svg.slice(m.index)
})
// What a dim block may still paint: quiet tokens, the white of a tick, and the dim token itself
const KEPT = ['none', '#fff', 'var(--track)', 'var(--card)', 'var(--bg)', 'var(--todo)', 'var(--line)', 'var(--line2)', 'var(--muted)', 'var(--dim)']
const hues = (g: string) => [...g.matchAll(/ (fill|stroke)="([^"]*)"/g)].map(m => m[2]!).filter(v => !KEPT.includes(v))

test('an aged block of every widget type paints no hue: its marks take the dim token, and a wash stays a wash', async () => {
  const types = ['stat', 'gauge', 'ring', 'meter', 'line', 'bars', 'columns', 'donut', 'heatmap', 'list', 'checklist', 'table', 'text'] as const
  const items = [{ label: 'a', value: 3, state: 'done' as const }, { label: 'b', value: 1, state: 'now' as const }, { label: 'c', value: 2, state: 'failed' as const }, { label: 'd', value: 1, color: '#FF0000' }]
  const widgets = types.map(type => ({ id: type, type, title: type, value: 40, max: 100, delta: -2, better: 'up' as const, tone: 'good' as const, items, points: [1, 3, 2], rows: [[1, 2], [3, 4]], text: 'hello' }))
  const r = { ...apply(null, { start: 'Aged', widgets }, 0), ticks: STALE, tickAt: 60_000 }
  for (const width of [340, 900]) {
    const groups = dimGroups(dashboard(r, width).source)
    expect(groups.length).toBe(types.length)
    for (const g of groups) expect(hues(g)).toEqual([])
  }
  // the strip draws them dim too, its sparkline areas a translucent wash rather than a solid block
  const band = strip({ ...r, strip: ['stat', 'gauge', 'ring', 'meter', 'checklist', 'trend'] }, 1400).source
  expect(dimGroups(band).length).toBeGreaterThanOrEqual(4)
  for (const g of dimGroups(band)) expect(hues(g)).toEqual([])
  const trend = dimGroups(strip({ ...r, strip: ['trend'] }, 1400).source)
  expect(trend.length).toBe(1)
  expect(trend[0]).toMatch(/fill="var\(--dim\)" fill-opacity="\.12"/)
  expect(trend[0]).not.toContain('url(')
  // fresh, the same run keeps its hues
  expect(hues(dashboard({ ...r, ticks: 0 }, 900).source).length).toBeGreaterThan(0)
})

test("a tone named as a colour is drawn in its hue, `accent` the run's own; a hex as written", async () => {
  const r = apply(null, { start: 'T', accent: 'warn', widget: { id: 'b', type: 'bars', items: [{ label: 'a', value: 1, color: 'good' }, { label: 'b', value: 2, color: 'accent' }, { label: 'c', value: 3, color: '#123456' }] } }, 0)
  const { source } = dashboard(r, 600)
  expect([...source.matchAll(/<path d="M[^"]*" fill="([^"]+)"\/>/g)].map(m => m[1])).toEqual(['#788C5D', '#C7963E', '#123456']) // good; accent, the run's (warn); the hex
  for (const svg of [source, strip(r, 800).source]) expect(svg).not.toMatch(/="(good|accent|warn)"/)
})

// A cut inside an emoji would leave half of it, which draws as a box and makes the text no valid UTF-16 at all
test('a cut never leaves half an emoji', async () => {
  for (const t of ['🚀 Deploy the release', '🚀🚀🚀🚀🚀🚀🚀🚀 ship it', 'ship 🚀 the 🚀 release 🚀 today']) {
    for (let px = 10; px <= 120; px++) {
      const cut = fit(t, px, 13)
      expect(cut, `${t} @ ${px}`).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/)
      expect(() => encodeURIComponent(cut), `${t} @ ${px}`).not.toThrow()
    }
  }
})
