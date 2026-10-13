import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { measure } from './svg'

// The app's one dock, standing in beneath the plugin: ui.open shows a pane, ui.close hides it, and another
// mod's pane can take the dock with no ui.close for ours (take()).
const dock = (on: On, opened: string[] = []) => {
  const shown = new Set<string>()
  on('ui.open', ($, e) => (opened.push(e.id), shown.add(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($, e) => (shown.delete(e.id), { value: undefined }))
  on('ui.panes', () => ({ value: [...shown].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  return { take: () => shown.clear() }
}

type Handle = {
  drawn: () => Promise<unknown>
  press: (t: { key: string }) => Promise<unknown>
  find: (q: { key: string }) => Promise<{ text?: string } | undefined>
  unmount: () => Promise<void>
}

const props = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }

test('strip shows the run and Expand opens the pane', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  dock(on, opened)
  // the engine's own band, standing in beneath the plugin: an empty Box
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  const hud = (input: object) => ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'mcp__hud__hud', ...input })
  for (const surface of ['terminal', 'desktop'] as const) {
    await hud({ start: 'Deploy', progress: '3/4', log: 'built' })
    // simplification: loose call; mount's generic over every component is too deep for tsc
    const ui = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component: 'AbovePrompt', props })
    expect(JSON.stringify(await ui.drawn())).toContain('Deploy')
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'toggle' }))?.text).toContain('Collapse')
    expect(opened.at(-1)).toBe('hud')
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'toggle' }))?.text).toContain('Expand')
    await ui.press({ key: 'hide' })
    expect(JSON.stringify(await ui.drawn())).not.toContain('Deploy')
    await hud({ start: 'Again' })
    expect(JSON.stringify(await ui.drawn())).toContain('Again') // a new run brings the strip back
    await ui.unmount()
  }
})

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (n: unknown): Node[] => (typeof n === 'object' && n !== null ? [n as Node, ...((n as Node).children ?? []).flatMap(nodes)] : [])
const text = (n: unknown): string => (typeof n === 'string' ? n : nodes(n)[0]?.children?.map(text).join('') ?? '')

test('desktop band: the title wraps to two lines and the goal has its own, no repeats of the strip, no markdown, header only while the dashboard is open', async ($, on) => {
  mock.clock(on)
  dock(on)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  const hud = (input: object) => ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'mcp__hud__hud', ...input })
  await hud({ start: 'Fix HUD description + done phase', goal: 'Trim the hud tool description under 2048 chars and make done/fail close the current phase, then open a PR', progress: '3/4' })
  await hud({ phase: { name: 'Test', state: 'done' } })
  await hud({ phase: { name: 'PR', state: 'now' }, log: 'CI `test` check **pending**' })
  const ui = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface: 'desktop', component: 'AbovePrompt', props: { ...props, bodyColumns: 96 } })
  const all = nodes(await ui.drawn())
  const row = all.find(n => n.type === 'Box' && n.props?.flexDirection === 'row')!
  const [status, , facts] = (row.children as Node[]).map(text)
  const lines = ((row.children as Node[])[1]!.children as Node[]).map(text)
  // the status keeps together (no space it could break at) and sits beside the title
  expect(status).toMatch(/^● Running/)
  // the title whole on its line, the goal on a line of its own cut to the room; the strip below draws progress
  // and phases, so the header doesn't
  expect(lines[0]).toBe('Fix HUD description + done phase')
  expect(lines.at(-1)!.startsWith('→ Trim the hud tool description')).toBe(true)
  expect(lines.at(-1)!.endsWith('…')).toBe(true)
  expect(facts).toContain('0:00')
  expect(facts).not.toContain('3/4')
  expect(facts).not.toContain('PR')
  // the app's own close control, and a quiet Expand
  expect(all.find(n => n.props?.key === 'hide')?.props?.role).toBe('dismiss')
  expect(all.find(n => n.props?.key === 'hide')?.props?.label).toBe('✕') // a desktop that draws the label shows a mark, not words
  expect(all.find(n => n.props?.key === 'toggle')?.props?.variant).toBeUndefined()
  expect(all.map(text).join(' ')).toContain('CI test check pending')
  expect(all.map(text).join(' ')).not.toMatch(/[`*]/)
  expect(all.some(n => n.type === 'Svg')).toBe(true)
  // the image's alt says in words what it draws, as a reader of it can't see the graphic the header leaves it to
  expect(String(all.find(n => n.type === 'Svg')?.props?.alt)).toBe('Progress 3 of 4, 75%. Phases: Test done, PR in progress (step 2 of 2). Tool calls 0. Last: CI test check pending.')
  // the dashboard open beside the conversation: the band goes minimal, one line of status, title and its buttons;
  // the pane right there has the rest
  await ui.press({ key: 'toggle' })
  const open = nodes(await ui.drawn())
  expect(open.some(n => n.type === 'Svg')).toBe(false)
  const openRow = open.find(n => n.type === 'Box' && n.props?.flexDirection === 'row')!
  expect((openRow.children as Node[]).map(n => n.type)).toEqual(['Box', 'Box', 'Button', 'Button'])
  expect(((openRow.children as Node[])[1]!.children as Node[]).map(text)).toEqual(['Fix HUD description + done phase'])
  expect(open.map(text).join(' ')).not.toContain('CI test check pending')
  await ui.unmount()
})

test('the header names the step in hand and errors in words when the strip leaves them out, and drops them with the dashboard open', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ isError: true, result: 'boom' })) // every tool beneath the plugin fails, which counts as an error
  on('session.surfaces', () => ({ value: [] })) // (a failed call asks who watches; a denied one never did)
  dock(on)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  const hud = (input: object) => ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'mcp__hud__hud', ...input })
  // a strip Claude set to the call count alone: the plan's step and the errors are the header's to say
  await hud({ start: 'Video', strip: ['calls'], widget: { id: 'plan', type: 'checklist', items: [{ label: 'Probe', state: 'done' }, { label: 'Spawn', state: 'now' }] } })
  await ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'Bash', command: 'false' })
  const ui = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface: 'desktop', component: 'AbovePrompt', props: { ...props, bodyColumns: 120 } })
  const facts = text((nodes(await ui.drawn()).find(n => n.type === 'Box' && n.props?.flexDirection === 'row')!.children as Node[])[2])
  expect(facts).toContain('▸ Spawn')
  expect(facts).toMatch(/· {2}1 error\s*$/)
  await ui.press({ key: 'toggle' })
  expect(nodes(await ui.drawn()).map(text).join(' ')).not.toContain('Spawn')
  await ui.unmount()
})

test('desktop pane: the summary in text colour beside its mark, and a narrow pane drawn at its own width', async ($, on) => {
  mock.clock(on)
  const hud = (input: object) => ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'mcp__hud__hud', ...input })
  await hud({ start: 'Ship **it**', goal: 'open the `PR`', done: 'PR open; CI `test` pending' })
  const pane = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface: 'desktop', component: 'Pane', requestId: 'hud', props: { title: 'HUD', isFocused: false, bodyColumns: 36, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  const all = nodes(await pane.drawn())
  const summary = all.find(n => n.type === 'Text' && text(n).includes('PR open'))!
  expect(text(summary)).toBe('✓ PR open; CI test pending')
  expect(summary.props?.color).toBeUndefined() // only the ✓ is coloured
  expect(all.map(text).join(' ')).not.toMatch(/[`*]/)
  // 36 columns is a 288px dock: drawn at that, not at a floor the surface would shrink, labels and all
  expect(all.find(n => n.type === 'Svg')?.props?.width).toBe(288)
  await pane.unmount()
})

test("another mod's pane taking the dock brings the band back from its header-only form", async ($, on) => {
  mock.clock(on)
  const { take } = dock(on)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  await ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'mcp__hud__hud', start: 'Deploy', progress: '3/4' })
  const ui = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface: 'desktop', component: 'AbovePrompt', props })
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'toggle' }))?.text).toContain('Collapse')
  expect(nodes(await ui.drawn()).some(n => n.type === 'Svg')).toBe(false)
  // another mod's pane takes the dock and the HUD hears no close (as in the app): the band trusts the dock, not its flag
  take()
  await ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'mcp__hud__hud', log: 'still going' }) // any redraw (the app's is the 1s clock)
  expect((await ui.find({ key: 'toggle' }))?.text).toContain('Expand')
  expect(nodes(await ui.drawn()).some(n => n.type === 'Svg')).toBe(true)
  await ui.unmount()
})

test('a long title wraps to two lines and the goal keeps a line of its own, and /hud says it all in full', async ($, on) => {
  mock.clock(on)
  dock(on)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  const title = 'Migrate the billing and invoicing subsystem to the event-sourced ledger', goal = 'Move every invoice into the append-only ledger and verify balances per customer account'
  const hud = (input: object) => ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'mcp__hud__hud', ...input })
  await hud({ start: title, goal, progress: '7/12' })
  // seen in the app: the title filled the row and was cut, and the goal vanished without a trace
  for (const bodyColumns of [105, 80, 60]) {
    const ui = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface: 'desktop', component: 'AbovePrompt', props: { ...props, bodyColumns } })
    const row = nodes(await ui.drawn()).find(n => n.type === 'Box' && n.props?.flexDirection === 'row')!
    const lines = ((row.children as Node[])[1]!.children as Node[]).map(text)
    // the title on one line or two, then the goal on its own
    expect(lines.length).toBeLessThanOrEqual(3)
    if (bodyColumns >= 80) expect(lines.slice(0, -1).join(' ')).toBe(title) // the whole title, wrapped if need be
    expect(lines.at(-1)!.startsWith('→ Move every invoice')).toBe(true)
    // no hover cards in the band: it doesn't reveal them (proved in the app)
    expect(nodes(await ui.drawn()).some(n => n.props?.display === 'none')).toBe(false)
    await ui.unmount()
  }
  // the way to the whole text: /hud
  const out = await ($.command.run as unknown as (i: object) => Promise<{ text: string }>)({ command: 'hud' })
  expect(out.text).toContain(title)
  expect(out.text).toContain(`Goal: ${goal}`)
})

test('desktop header: a long step never pushes out the title or the buttons, and the last line never repeats the goal', async ($, on) => {
  mock.clock(on)
  dock(on)
  on('tool.call', () => ({ isError: true, result: 'boom' })) // three failed calls, for the errors fact
  on('session.surfaces', () => ({ value: [] })) // (a failed call asks who watches; a denied one never did)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  const hud = (input: object) => ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'mcp__hud__hud', ...input })
  // the live case: a checklist plan whose step in hand is a long line, and errors, both left to the header (the
  // strip is set to the call count alone)
  await hud({ start: 'API Phase 1 — schema 1.x → 1.3.0', strip: ['calls'], widget: { id: 'steps', type: 'checklist', items: [{ label: 'Map the data', state: 'done' }, { label: 'Migrate routes: UserGroup unfold, UserList, Edit row, OrderHistory, AdminMessage', state: 'now' }] } })
  for (let n = 0; n < 3; n++) await ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'Bash', command: 'false' })
  await hud({ log: 'Schema check passes on staging' })
  await hud({ goal: 'Move every endpoint to the new schema with its tests green before Phase 1 ends' })
  for (const bodyColumns of [60, 105, 150]) {
    const ui = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface: 'desktop', component: 'AbovePrompt', props: { ...props, bodyColumns } })
    // the band's last line is the last entry the header doesn't already show
    expect(nodes(await ui.drawn()).map(text).join(' ')).toContain('Schema check passes on staging')
    const row = nodes(await ui.drawn()).find(n => n.type === 'Box' && n.props?.flexDirection === 'row')!
    const [status, , facts] = (row.children as Node[]).map(text)
    // the title box's lines: the title (one or two) and the goal; the widest is what the row's room holds
    const boxLines = ((row.children as Node[])[1]!.children as Node[]).map(text)
    expect(boxLines[0]!.startsWith('API')).toBe(true) // the title keeps its floor
    // the title's lines are bold, the goal's (the last) regular
    const titleW = Math.max(...boxLines.slice(0, -1).map(l => measure(l, 13, { bold: true })), measure(boxLines.at(-1)!, 13))
    expect(facts).toContain('0:00') // the clock and the errors stay
    expect(facts).toContain('3 errors')
    // what the row holds fits it, in the row's own units, so the buttons after it are never cut
    const used = measure(status!, 13, { bold: true }) + titleW + measure(facts!, 13) + measure('Collapse', 13)
    expect(used).toBeLessThanOrEqual((bodyColumns * 7 - 64) / 0.85)
    await ui.unmount()
  }
})

test("the band's last line: on desktop a long log line gives up a path's folders before any of its words", async ($, on) => {
  mock.clock(on)
  dock(on)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  const hud = (input: object) => ($.tool.call as unknown as (i: object) => Promise<unknown>)({ tool: 'mcp__hud__hud', ...input })
  const raw = 'Wrote ~/work/acme/billing-service/packages/api/v2.0/hooks/sources/contract.ts; 31 tests pass, tsc clean, validate passed. Next: the trial at three widths'
  await hud({ start: 'Fit', log: raw })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', surface, component: 'AbovePrompt', props: { ...props, bodyColumns: 80 } })
    const last = nodes(await ui.drawn()).filter(n => n.type === 'Text').map(text).filter(t => t.includes('Wrote')).at(-1) ?? ''
    // the terminal fits its own line to its 80 columns, in the module (a path gives up its folders, a cut falls at a word)
    if (surface === 'terminal') expect(last).toBe('  Wrote …/contract.ts; 31 tests pass, tsc clean, validate passed…')
    else {
      expect(last).toBe('0:00  Wrote …/contract.ts; 31 tests pass, tsc clean, validate passed. Next: the trial at three widths')
      expect(measure(last, 13)).toBeLessThanOrEqual((80 * 7 - 16) / 0.85)
    }
    await ui.unmount()
  }
})
