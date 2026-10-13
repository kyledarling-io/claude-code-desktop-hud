import type { On, Register } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

// Another plugin sending a slot when its tool is called, and what it says it can access.
const deploys: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'deploys') return next(e)
    await $.hud.declare({ v: 1, name: 'Deploys', access: 'Reads deploy states from the hosting API with your token.', slots: [{ id: 'prod', pattern: 'stat', title: 'Production' }] })
    await $.hud.push({ v: 1, id: 'prod', pattern: 'stat', title: 'Production', value: 'failed', tone: 'bad', note: 'build 1432 failed 2m ago' })
    return { result: 'ok' }
  })
}
const plugins = [{ name: 'deploys', register: deploys }]

// The store beneath the plugin, recording what the HUD writes.
const store = (on: On, kept: Record<string, unknown> = {}) => {
  on('store.get', ($, e) => ({ value: kept[e.key] }))
  on('store.set', ($, e) => (kept[e.key] = e.value, { value: undefined }))
  return kept
}
type Handle = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
const pane = { title: 'HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
const band = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const mount = ($: Engine, t: object) => ($.ui.mount as unknown as (t: object) => Promise<Handle>)({ plugin: 'hud', ...t })
const hud = ($: Engine, args: string) => ($.command.run as unknown as (i: object) => Promise<{ text: string }>)({ command: 'hud', args }).then(o => o.text)
// the engine beneath, registered before the test's first call on $
const beneath = (on: On) => {
  mock.clock(on)
  on('ui.panes', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: [] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
}
// a run, the plugin's slot, and the turn's end (the boundary where the strip takes a new slot)
const setup = async ($: Engine) => {
  const call = $.tool.call as unknown as (i: object) => Promise<unknown>
  await call({ tool: 'mcp__hud__hud', start: 'Ship it' })
  await call({ tool: 'deploys' })
  await ($.turn.complete as unknown as (i: object) => Promise<unknown>)({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
}

test("the pane lists every source with what it can access and its slots; a muted source's slots leave the drawing until unmuted", { plugins }, async ($, on) => {
  const kept = store(on)
  beneath(on)
  await setup($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const p = await mount($, { surface, component: 'Pane', requestId: 'hud', props: pane })
    const seen = async () => JSON.stringify(await p.drawn())
    // the HUD's own three and the plugin, each with its access line as written and its slots
    for (const words of ['Sources', 'Test results', 'Tool signals', 'Context and cost', 'Agents', 'Deploys', 'from deploys',
      'Reads deploy states from the hosting API with your token.', 'Context, Cost, Usage limit', 'build 1432 failed 2m ago']) expect(await seen()).toContain(words)
    expect(await seen()).toContain('/hud mute <name>') // how to mute: by command (a pane button never fired in the app)
    expect(await seen()).not.toContain('"Button"')
    await hud($, 'mute deploys')
    expect(await seen()).not.toContain('build 1432 failed 2m ago') // its slot is gone from the drawing
    expect(await seen()).toContain('" · muted"') // the source stays listed, so it can come back
    expect(kept.muted).toEqual(['deploys']) // kept across sessions
    await hud($, 'unmute deploys')
    expect(await seen()).toContain('build 1432 failed 2m ago')
    expect(kept.muted).toEqual([])
    await p.unmount()
  }
})

test('/hud sources says who sends what and what each can access; /hud mute and /hud unmute take a source by its name', { plugins }, async ($, on) => {
  const kept = store(on)
  beneath(on)
  await setup($)
  const sources = await hud($, 'sources')
  expect(sources).toContain('Deploys · from deploys\n  Reads deploy states from the hosting API with your token.\n  Production')
  expect(sources).toContain('Test results · HUD')
  const strip = async () => {
    const b = await mount($, { surface: 'desktop', component: 'AbovePrompt', props: band })
    const s = JSON.stringify(await b.drawn())
    await b.unmount()
    return s
  }
  expect(await strip()).toContain('Production (from deploys)')
  expect(await hud($, 'mute deploys')).toBe('Deploys is muted: its figures are hidden until /hud unmute deploys.')
  expect(await strip()).not.toContain('Production')
  expect(await hud($, 'sources')).toContain('Deploys · from deploys · muted')
  expect(await hud($, 'unmute Deploys')).toBe('Deploys is back.')
  expect(await strip()).toContain('Production (from deploys)')
  // the HUD's own by name, as many words as it has
  expect(await hud($, 'mute context and cost')).toContain('Context and cost is muted')
  expect(kept.muted).toEqual(['hud:context-and-cost'])
  expect(await hud($, 'mute nothing-here')).toBe('No source "nothing-here". Name one of: test-results, tool-signals, context-and-cost, agents, deploys.')
})

test("mutes kept from an earlier session apply from the start", { plugins }, async ($, on) => {
  store(on, { muted: ['deploys'] })
  beneath(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  await ($.session.start as unknown as (i: object) => Promise<unknown>)({ cwd: '/', surface: null, isInteractive: false })
  await setup($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const p = await mount($, { surface, component: 'Pane', requestId: 'hud', props: pane })
    const seen = JSON.stringify(await p.drawn())
    expect(seen).toContain('" · muted"')
    expect(seen).not.toContain('build 1432 failed 2m ago')
    await p.unmount()
  }
})
