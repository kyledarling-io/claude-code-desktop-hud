import type { EngineInterface, Register } from 'claude-code'

// simplification: a throwaway probe for the HUD's platform questions (steps: dev/probes/README.md).
// Each hook logs what it saw and passes the event on untouched. `/probe-platform` prints the log; the `budget` tool
// returns it to Claude. The log is module memory: a reload empties it.
const lines: string[] = []

async function log($: EngineInterface, ev: string, data: unknown) {
  try {
    lines.push(`${new Date(await $.clock.now()).toISOString()} ${ev} ${JSON.stringify(data).slice(0, 600)}`)
  } catch (err) {
    lines.push(`log failed: ${String(err)}`)
  }
}

// A description of 4,352 characters with a marker every 256: the last marker Claude reads is the budget.
const MARKS = Array.from({ length: 17 }, (_, i) => {
  const tag = `[M${(i + 1) * 256}]`
  return tag.padStart(256, i === 0 ? 'Probe tool: returns the probe log. Budget markers follow. ' + '.'.repeat(200) : '.')
}).join('')

async function start($: EngineInterface) {
  const v = await $.session.version()
  const names = (await $.tool.list()).map(t => t.name)
  await log($, 'session.start', { version: v, surfaces: await $.session.surfaces(), taskTools: names.filter(n => /^(TodoWrite|Task)/.test(n)), tools: names.length })
  await $.tool.register({ name: 'budget', description: MARKS, inputSchema: { type: 'object', properties: {} }, isDeferred: false })
  await $.command.register({ name: 'probe-platform', description: 'Show the probe log tail' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await start($)
    return r
  }).catch(($, e, next) => next(e))
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    await log($, 'session.attach', { surface: e.surface })
    return r
  }).catch(($, e, next) => next(e))
  on('turn.start', async ($, e, next) => {
    await log($, 'turn.start', { text: e.text.slice(0, 40), turnId: e.turnId })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => {
    await log($, 'turn.complete', { agentId: e.agentId, reason: e.reason, isAborted: e.isAborted, durationMs: e.durationMs, answer: e.answer.slice(0, 60) })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    await log($, 'agent.spawn', { description: e.description, subagentType: e.subagentType, background: e.background, parentAgentId: e.parentAgentId, got: r })
    return r
  }).catch(($, e, next) => next(e))
  on('session.compact', async ($, e, next) => {
    await log($, 'session.compact', { trigger: e.trigger, agentId: e.agentId })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    await log($, 'tool.check', { tool: e.tool, agentId: e.agentId, real: e.tool_use_id !== undefined, decision: r.decision, reason: r.reason })
    return r
  }).catch(($, e, next) => next(e))
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) === 'mcp__probe-platform__budget') return { result: lines.slice(-40).join('\n') || 'empty' }
    await log($, 'tool.call>', { tool: String(e.tool), agentId: e.agentId })
    const r = await next(e)
    const res = (r as { result?: unknown }).result
    await log($, 'tool.call<', { tool: String(e.tool), agentId: e.agentId, isError: (r as { isError?: boolean }).isError, deny: (r as { deny?: string }).deny, bg: (res as { backgroundTaskId?: string } | undefined)?.backgroundTaskId })
    return r
  }).catch(($, e, next) => next(e))
  on('prompt.submit', async ($, e, next) => {
    await log($, 'prompt.submit', { kind: e.origin.kind, text: e.text.slice(0, 40), turnId: e.turnId })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('prompt.compose', async ($, e, next) => {
    await log($, 'prompt.compose', { tools: e.tools.length, hud: e.tools.includes('mcp__hud__hud'), taskTools: e.tools.filter(t => /^(TodoWrite|Task)/.test(t)), traits: e.traits })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PermissionRequest', async ($, e, next) => {
    await log($, 'classic.PermissionRequest', { tool: e.tool_name, agent: (e as { agent_id?: string }).agent_id, mode: (e as { permission_mode?: string }).permission_mode })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PermissionDenied', async ($, e, next) => {
    await log($, 'classic.PermissionDenied', { tool: e.tool_name, reason: e.reason })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.Notification', async ($, e, next) => {
    await log($, 'classic.Notification', { type: e.notification_type, message: e.message.slice(0, 80) })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.SubagentStart', async ($, e, next) => {
    await log($, 'classic.SubagentStart', { agent_id: e.agent_id, agent_type: e.agent_type })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.SubagentStop', async ($, e, next) => {
    await log($, 'classic.SubagentStop', { agent_id: e.agent_id, agent_type: e.agent_type })
    return next(e)
  }).catch(($, e, next) => next(e))
  on('command.run', { command: 'probe-platform' }, async () => ({ text: lines.slice(-60).join('\n') || 'empty' }))
}
