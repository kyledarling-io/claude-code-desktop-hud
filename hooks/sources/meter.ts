import type { SessionMeasureInput } from 'claude-code'

import type { Declaration, Pushes, Slot } from './contract'

// A source of the session's own figures: how full the context window is, what the session has cost, and the
// account's rate-limit windows. All of it is what session.measure hands every hook after a turn: the app already
// has these numbers, and this source reads nothing else. It keeps no state.

export const declaration: Declaration = {
  v: 1,
  name: 'Context and cost',
  access: "Reads the figures the app reports after each turn: the context window's fill, the session's cost and the rate-limit windows. Nothing else.",
  slots: [
    { id: 'context', pattern: 'ring', title: 'Context' },
    { id: 'cost', pattern: 'stat', title: 'Cost' },
    { id: 'limits', pattern: 'meter', title: 'Usage limit' },
  ],
}

// claude-hud's levels: a context window reads as filling at 70% and as nearly full at 85%
const WARN = 70, FULL = 85
// a rate-limit window says nothing until it is half used
const LIMIT_SHOWN = 50
const LIMIT_NAME: Record<string, string> = { five_hour: '5-hour limit', seven_day: 'Weekly limit', spend_limit: 'Spend limit' }

const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
const until = (iso: string | undefined, now: number) => {
  const ms = iso ? Date.parse(iso) - now : NaN
  if (!(ms > 0)) return ''
  const m = Math.round(ms / 60_000)
  return `; resets in ${m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`}`
}

export type Measure = Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost' | 'changed'>

export function observe(e: Measure, now: number): Pushes {
  const push: Slot[] = [], clear: string[] = []
  const { percent, tokens, window } = e.context
  if (e.changed.includes('context') && percent !== undefined) {
    push.push({
      v: 1, id: 'context', pattern: 'ring', title: 'Context', value: percent, max: 100, unit: '%',
      tone: percent >= FULL ? 'bad' : percent >= WARN ? 'warn' : undefined,
      note: `${tokens === undefined ? '' : `${k(tokens)} of `}${k(window)} tokens${percent >= FULL ? '; compaction is near' : ''}`,
    })
  }
  if (e.changed.includes('cost') && e.cost) {
    push.push({ v: 1, id: 'cost', pattern: 'stat', title: 'Cost', value: Math.round(e.cost.usd * 100) / 100, unit: 'USD', note: 'this session, as /cost counts it' })
  }
  if (e.changed.includes('rateLimits')) {
    const top = [...e.rateLimits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
    if (top && top.percentUsed >= LIMIT_SHOWN) {
      push.push({
        v: 1, id: 'limits', pattern: 'meter', title: LIMIT_NAME[top.kind] ?? 'Usage limit', value: top.percentUsed, max: 100, unit: '%',
        tone: top.percentUsed >= FULL ? 'bad' : top.percentUsed >= WARN ? 'warn' : undefined,
        note: `${top.percentUsed}% used${until(top.resetsAt, now)}`,
      })
    } else clear.push('limits')
  }
  return { push, clear }
}
