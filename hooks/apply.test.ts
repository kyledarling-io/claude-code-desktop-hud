import { test, expect } from 'claude-code/testing'
import { apply } from './run'
import { answer, DESCRIPTION } from './tool'

test('the hud tool description fits in what reaches the model', async () => {
  expect(DESCRIPTION.length).toBeLessThanOrEqual(2048)
})

// plain() is quadratic on a long run of "[": the answer measures what the strip could ever show of a text, and says its length
test("the tool's answer to a text far over its budget comes at once, and names its whole length", async () => {
  const t = performance.now(), said = answer({ log: '['.repeat(60_000), title: '['.repeat(60_000) })
  expect(performance.now() - t).toBeLessThan(100)
  expect(said).toContain('log at 70 characters (yours is 60000)')
  expect(said).toContain('title at 60 characters (yours is 60000)')
  expect(answer({ title: '**Deploy** the `billing` service to the twelve production hosts, then verify' })).toContain('(yours is 70)') // markdown not counted
})

test('hud reducer', async () => {
  let r = apply(null, { start: 'Deploy', set: { attempts: 1 } }, 0)
  r = apply(r, { phase: { name: 'build', state: 'now' }, progress: '3/4', count: 'timeout' }, 1000)
  r = apply(r, { phase: { name: 'ship', state: 'now' }, count: 'timeout', point: 2 }, 2000)
  expect(r.phases).toEqual([{ name: 'build', state: 'done' }, { name: 'ship', state: 'now' }])
  expect(r.progress).toEqual({ n: 3, total: 4, label: undefined })
  expect(r.counts.timeout).toBe(2)
  r = apply(r, { done: 'shipped' }, 3000)
  expect(r.status).toBe('done')
  // finishing closes the running step: done with the run, or failed with it
  expect(r.phases).toEqual([{ name: 'build', state: 'done' }, { name: 'ship', state: 'done' }])
  expect(apply(apply(null, { start: 'F', phase: { name: 'test', state: 'now' } }, 0), { fail: 'red' }, 1).phases).toEqual([{ name: 'test', state: 'failed' }])
  // done and fail in one call: the run failed, so its running step failed too
  const both = apply(apply(null, { start: 'B', phase: { name: 'test', state: 'now' } }, 0), { done: 'ok', fail: 'red' }, 1)
  expect([both.status, both.summary, both.phases]).toEqual(['failed', 'red', [{ name: 'test', state: 'failed' }]])
  expect(r.endedAt).toBe(3000)
  expect(apply(r, { start: 'again' }, 5000).endedAt).toBeUndefined()
  expect(r.log.at(-1)?.text).toBe('shipped')
  expect(apply(r, { start: 'Next' }, 4000).tiles).toEqual({})
  // widgets sent as a JSON string, or without ids, never make blank cards
  const s = apply(null, { start: 'S', widgets: '[{"id":"a","type":"ring","value":3}]' as never, widget: { type: 'stat' } as never }, 0)
  expect(s.widgets.map(w => w.id)).toEqual(['a'])
})

test('every object or array field may arrive as a JSON string', async () => {
  const r = apply(null, { start: 'x', set: '{"a":1}', fun: '["one"]', remove: '["w"]', phase: '{"name":"Build","state":"now"}', cell: '{"name":"h1","state":"hit"}' } as never, 0)
  expect(r.tiles).toEqual({ a: 1 })
  expect(r.fun).toEqual(['one'])
  expect(r.phases).toEqual([{ name: 'Build', state: 'now' }])
  expect(r.cells).toEqual([{ name: 'h1', state: 'hit' }])
  // remove needs something to remove
  const w = apply(null, { start: 'x', widgets: [{ id: 'w', type: 'ring' }, { id: 'k', type: 'ring' }] }, 0)
  expect(apply(w, { remove: '["w"]' } as never, 1).widgets.map(x => x.id)).toEqual(['k'])
})

// The model's input is any JSON (the schema is a suggestion), and what the run keeps is drawn on every redraw: a field of
// another type would throw there, on both surfaces, until the run was gone.
test('off-schema widget fields are coerced to their types or dropped, so what the run keeps is what the HUD can draw', async () => {
  const said: string[] = []
  const r = apply(null, { start: 'x', widgets: [
    { id: 'a', type: 'stat', title: 7, value: { x: 1 }, unit: 3, delta: 'up', tone: 'red', span: 'wide', better: 'sideways', by: 'observer', at: 99, n: 5, bound: { hits: 9, misses: 0, seen: 9 }, extra: 'x' },
    { id: 'b', type: 'list', title: 'Hosts', items: 'web-01' },
    { id: 'c', type: 'bars', items: [{ label: 7, value: '3' }, 'junk', { value: 2 }, { label: 'ok', state: 'bogus', note: 5, value: 'many' }] },
    { id: 'd', type: 'bogus', points: [1, 'x', null, 2], rows: [[1, 'a'], 'x'], text: 12, min: '0', max: 'ten', push: 'x' },
  ] } as never, 0, -Infinity, said)
  const [a, b, c, d] = r.widgets
  expect([a!.title, a!.value, a!.unit, a!.delta, a!.tone, a!.span, a!.better, a!.by, a!.at, a!.n, a!.bound, 'extra' in a!]).toEqual(['7', undefined, '3', undefined, undefined, undefined, undefined, 'claude', 0, undefined, undefined, false])
  expect([b!.title, b!.items]).toEqual(['Hosts', undefined])
  expect(c!.items).toEqual([{ label: '7', value: 3 }, { label: 'ok', note: '5' }])
  expect([d!.type, d!.points, d!.rows, d!.text, d!.min, d!.max]).toEqual(['stat', [1, 2], [[1]], '12', 0, undefined])
  expect(said).toEqual([])
  // a later update with junk keeps what the widget held
  const kept = apply(r, { widget: { id: 'c', items: 'nope', title: { a: 1 } } } as never, 1)
  expect([kept.widgets[2]!.items, kept.widgets[2]!.title]).toEqual([c!.items, undefined])
  // the run's own fields too: a number where text goes is written out, junk is dropped, and nothing throws
  const run = apply(null, { start: 7, goal: 8, log: 9, level: 'loud', status: { s: 1 }, point: 'x', count: 'retries', count_by: 'two', next: 'soon', done: 10 } as never, 0)
  expect([run.title, run.goal, run.log.map(l => [l.text, l.level]), run.status, run.points, run.counts, run.nextAt, run.summary])
    .toEqual(['7', '8', [['Goal: 8', 'info'], ['9', 'info'], ['10', 'ok']], 'done', [], { retries: 1 }, undefined, '10'])
})

test("each of Claude's text fields is kept to 2,000 characters", async () => {
  const long = (c: string) => c.repeat(5000)
  const r = apply(null, {
    start: long('s'), goal: long('g'), log: long('l'), progress: '1/2', progress_label: long('p'), status: long('t'), fun: [long('f')], set: { [long('k')]: long('v') },
    phase: { name: long('n'), state: 'now' }, widget: { id: 'w', type: 'checklist', title: long('w'), unit: long('u'), text: long('x'), items: [{ label: long('i'), note: long('o') }] },
  } as never, 0)
  const w = r.widgets[0]!, texts = [r.title, r.goal, ...r.log.map(l => l.text), r.progress!.label, r.status, ...r.fun, ...Object.keys(r.tiles), ...Object.values(r.tiles), r.phases[0]!.name, w.title, w.unit, w.text, w.items![0]!.label, w.items![0]!.note]
  for (const t of texts) expect(String(t).length).toBeLessThanOrEqual(2000)
  expect(apply(r, { title: long('n') }, 1).title.length).toBe(2000)
  expect(apply(r, { done: long('d') }, 1).summary!.length).toBe(2000)
})

test('accent and item colours take a hex or a tone name, and progress 0 ≤ n ≤ total; anything else is refused in a line', async () => {
  const said: string[] = []
  const r = apply(null, { start: 'x', accent: 'red" onload="x', widget: { id: 'e', type: 'bars', items: [{ label: 'a', value: 1, color: '#d97757' }, { label: 'b', value: 2, color: 'good' }, { label: 'c', value: 3, color: '"/><x' }, { label: 'd', value: 4, color: '#abc' }] } } as never, 0, -Infinity, said)
  expect(r.accent).toBeUndefined()
  expect(r.widgets[0]!.items!.map(i => i.color)).toEqual(['#d97757', 'good', undefined, '#abc'])
  expect(said).toEqual([
    'accent: "red\\" onload=\\"x" is no colour; send a hex like #d97757, or good, bad, warn, info or accent',
    'color on e: "\\"/><x" is no colour; send a hex like #d97757, or good, bad, warn, info or accent',
  ])
  expect(apply(null, { start: 'x', accent: '#D97757' }, 0).accent).toBe('#D97757')
  expect(apply(null, { start: 'x', accent: 'warn' }, 0).accent).toBe('warn')
  for (const [progress, kept] of [['-3/10', undefined], ['12/10', undefined], ['3/0', undefined], ['abc', undefined], [7, undefined], ['0/5', { n: 0, total: 5 }], ['10/10', { n: 10, total: 10 }], ['2.5/4', { n: 2.5, total: 4 }]] as const) {
    const lines: string[] = []
    const p = apply(null, { start: 'x', progress } as never, 0, -Infinity, lines).progress
    expect(p && { n: p.n, total: p.total }, String(progress)).toEqual(kept)
    expect(lines, String(progress)).toEqual(kept ? [] : [`progress: "${progress}" is not n/total with 0 ≤ n ≤ total`])
  }
  // a refused progress leaves the one the run had
  const had = apply(null, { start: 'x', progress: '3/8' }, 0)
  expect(apply(had, { progress: '-1/8' }, 1).progress).toEqual({ n: 3, total: 8, label: undefined })
})

test('junk in those fields is ignored', async () => {
  const before = apply(null, { start: 'x', set: { a: 1 }, fun: ['keep'], phase: { name: 'P', state: 'now' }, cell: { name: 'c', state: 'hit' }, widget: { id: 'w', type: 'ring' } }, 0)
  const shape = (r: typeof before) => [r.tiles, r.fun, r.phases, r.cells, r.widgets.map(x => x.id)]
  const same = (input: object) => expect(shape(apply(before, input as never, 1))).toEqual(shape(before))
  same({ set: 'nope', phase: '[1]', fun: '{"a":1}', remove: 7 })
  same({ set: '[1]', phase: '"P"', cell: '5', fun: '[1,2]', remove: '{"w":1}' })
  same({ phase: { name: 7, state: 'now' }, cell: { name: 'c', state: 'bogus' } })
  same({ phase: '{"name":"","state":"now"}', cell: '{"state":"hit"}', remove: [7, null] })
  same({ fun: 'nope' })
  // a good field with junk inside: the usable part applies
  const part = apply(before, { set: '{"b":2,"c":{"d":1},"e":true,"f":"x"}', fun: ['one', 7, 'two'], remove: [7, 'w'] } as never, 1)
  expect(part.tiles).toEqual({ a: 1, b: 2, f: 'x' })
  expect(part.fun).toEqual(['one', 'two'])
  expect(part.widgets).toEqual([])
  // an empty list still clears the fun strip
  expect(apply(before, { fun: [] }, 1).fun).toEqual([])
  // whatever arrives, nothing throws
  for (const junk of [null, 7, true, 'nope', '', '[1]', '"s"', '{"a":1}', [1], {}]) {
    for (const field of ['set', 'phase', 'cell', 'fun', 'remove']) expect(() => apply(before, { [field]: junk } as never, 1)).not.toThrow()
  }
})
