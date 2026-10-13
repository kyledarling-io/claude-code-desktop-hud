import type { HudHeld, HudItem, HudRun, HudState, HudTone, HudWidget } from '../types'
import { isMirror, leadList, life, span } from './lifecycle'
import { PINNED, widgetKey, type Placed } from './rank'
import { TONES } from './sources/contract'
import { fit, measure, plain, tidy } from './text'

// Text measuring and fitting lives in text.ts (lifecycle.ts reads it too); here as ever for everyone else.
export { fit, measure, plain, tidy }

// One SVG dashboard for the surfaces that draw Svg (desktop, vscode, mobile).
// simplification: no play-once (fill="freeze") animations; the surface reloads the image on every redraw (each scroll step), which replays them. Loops only.
// Cards sit on a grid of up to 4 units; each card is a pure (w, h, ctx) -> markup.
// Gradients and filters are shared: a card asks ctx for one and the dashboard emits them once in <defs>.

const PAD = 14
const GAP = 12
const HEAD = 34 // card title band

// Anthropic's clay: the default accent, as the strip
export const ACCENT = '#D97757'
const TONE: Record<HudTone, string> = {
  good: '#788C5D', bad: '#BF4D43', warn: '#C7963E', info: '#6A9BCC', accent: '#D97757',
}

// A colour Claude named (the run's accent, an item's colour): a tone is its hue (`accent`, the run's own), else the hex it
// is; apply() lets nothing else in, and a run from before keeps what it had.
const hue = (col: string | undefined, accent: string) =>
  col === undefined ? undefined : col === 'accent' ? accent : TONES.includes(col as HudTone) ? TONE[col as HudTone] : col

// Status hues are for marks. Text in a status colour takes its -t token, ≥ 4.5:1 on both backgrounds of its
// theme (#FAF9F5/#FFF, #262624/#30302E); a to-do mark takes --todo, ≥ 3:1. Tracks stay quiet on purpose:
// every one has its count in words beside it. A block that hasn't changed in a while draws every text in --dim-t
// (≥ 4.5:1) and every mark in --dim (≥ 3:1), whatever hue it had: its states still read by shape.
const TOKENS = {
  light: '--good-t:#66774F;--bad-t:#BD4C42;--warn-t:#8D6A2C;--info-t:#507499;--todo:#8E8D86;--dim-t:#72716C;--dim:#8E8D86',
  dark: '--good-t:#8E9E77;--bad-t:#D3847D;--warn-t:#C7963E;--info-t:#6D9DCD;--todo:#7D7C78;--dim-t:#9A9992;--dim:#7D7C78',
}
// A dim block's text takes --dim-t from the style; its marks are repainted in --dim on the way out (dimmed()), so no
// drawer learns to dim and no colour slips past a selector. Quiet tokens (tracks, the card, to-do rings, hairlines,
// muted ink) and the white of a tick stay; a gradient wash stays a wash.
const DIM = '.dim text,.dim tspan{fill:var(--dim-t)}'
const QUIET = /^(none|#fff|var\(--(track|card|bg|todo|line|line2|muted)\))$/
const dimmed = (svg: string) => svg.replace(/ (fill|stroke)="([^"]*)"/g, (all, attr: string, v: string) =>
  QUIET.test(v) ? all : v.startsWith('url(') ? ` ${attr}="var(--dim)" ${attr}-opacity=".12"` : ` ${attr}="var(--dim)"`)
const toneText = (good: boolean) => (good ? 'var(--good-t)' : 'var(--bad-t)')

// Labels read as the app's do: sentence case, never shouted.
export const sentence = (t: string) => {
  const first = t.split(/\s/)[0] ?? ''
  return !t || first.length <= 3 || /\d/.test(first) ? t : t[0]!.toUpperCase() + t.slice(1)
}

// What an SVG text node holds: plain, then escaped.
export const esc = (s: unknown) =>
  plain(String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// A share as a whole percent that never claims done or empty before it is: 99.6% reads 99, not 100.
export const pct = (f: number) => (f >= 1 ? 100 : f <= 0 ? 0 : Math.min(99, Math.max(1, Math.round(f * 100))))

export const fmt = (v: number | string | undefined): string => {
  if (typeof v !== 'number') return v ?? '–'
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (a >= 1e4) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(a < 10 ? 2 : 1)
}

// Word-wraps to at most `max` lines of `px`; the last line ends in … when text is left over.
export const wrapPx = (text: string, px: number, size: number, max = 2, opts: { mono?: boolean; bold?: boolean } = {}) => {
  const out: string[] = []
  const words = plain(text).split(/\s+/).filter(Boolean)
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? line + ' ' + words[i] : words[i]!
    if (measure(next, size, opts) <= px || !line) { line = next; continue }
    out.push(line)
    line = words[i]!
    if (out.length === max - 1) { line = words.slice(i).join(' '); break }
  }
  if (line) out.push(line)
  return out.slice(0, max).map(l => fit(l, px, size, opts))
}
const f1 = (n: number) => n.toFixed(1)

// #RRGGBB mixed toward white (amt > 0) or black (amt < 0); anything else passes through.
const shade = (hex: string, amt: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  const ch = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)).toString(16).padStart(2, '0')
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

type Ctx = {
  id: string
  accent: string
  tone: (t?: HudTone) => string
  // a shared gradient of `color`: 'h' lighter→color left to right, 'v' lighter at the top, 'a' an area fade
  grad: (color: string, dir: 'h' | 'v' | 'a') => string
}

const stateColor = (s: HudState | undefined, c: Ctx) =>
  s === 'done' || s === 'hit' ? TONE.good
    : s === 'failed' || s === 'miss' ? TONE.bad
      : s === 'now' ? c.accent : 'var(--muted)'

const pulse = (cx: number, cy: number, r: number, color: string) => `
  <circle cx="${f1(cx)}" cy="${f1(cy)}" r="${r}" fill="none" stroke="${color}" stroke-width="2">
    <animate attributeName="r" values="${r};${r + 6}" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines=".2 .6 .4 1"/>
    <animate attributeName="opacity" values=".35;0" dur="2.4s" repeatCount="indefinite"/>
  </circle>`

const icon = (s: HudState | undefined, cx: number, cy: number, r: number, c: Ctx) => {
  const col = stateColor(s, c)
  if (s === 'done' || s === 'hit')
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.grad(col, 'v')}"/><path d="M${cx - r * 0.45} ${cy}l${r * 0.32} ${r * 0.34} ${r * 0.6}-${r * 0.68}" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  if (s === 'failed' || s === 'miss')
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.grad(col, 'v')}"/><path d="M${cx - r * 0.38} ${cy - r * 0.38}l${r * 0.76} ${r * 0.76}M${cx + r * 0.38} ${cy - r * 0.38}l-${r * 0.76} ${r * 0.76}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`
  if (s === 'now')
    return `${pulse(cx, cy, r, col)}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.grad(col, 'v')}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.38}" fill="#fff"/>`
  return `<circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="var(--card)" stroke="var(--todo)" stroke-width="2"/>`
}

// A state the size of a dot, told by shape as well as colour (green and red differ little in lightness):
// a filled dot done, a cross failed, a bar in hand, a ring to do.
const dot = (s: HudState | undefined, cx: number, cy: number, c: Ctx) =>
  s === 'done' || s === 'hit' ? `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="3.5" fill="${TONE.good}"/>`
    : s === 'failed' || s === 'miss' ? `<path d="M${f1(cx - 3)} ${f1(cy - 3)}l6 6M${f1(cx + 3)} ${f1(cy - 3)}l-6 6" stroke="${TONE.bad}" stroke-width="2.2" stroke-linecap="round"/>`
      : s === 'now' ? `<rect x="${f1(cx - 5)}" y="${f1(cy - 2.5)}" width="10" height="5" rx="2.5" fill="${c.accent}"/>`
        : `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="3" fill="none" stroke="var(--todo)" stroke-width="1.6"/>`

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
}
const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
  const [x1, y1] = polar(cx, cy, r, from)
  const [x2, y2] = polar(cx, cy, r, to)
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

// Catmull-Rom through the points as cubic Béziers, control points held inside [top, bottom] so the curve never overshoots the box.
export const smooth = (p: (readonly [number, number])[], top: number, bottom: number) => {
  if (p.length < 3) return p.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join('')
  const cy = (v: number) => Math.min(bottom, Math.max(top, v))
  let d = `M${f1(p[0]![0])} ${f1(p[0]![1])}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!, p1 = p[i]!, p2 = p[i + 1]!, p3 = p[i + 2] ?? p2
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(cy(p1[1] + (p2[1] - p0[1]) / 6))} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(cy(p2[1] - (p3[1] - p1[1]) / 6))} ${f1(p2[0])} ${f1(p2[1])}`
  }
  return d
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const frac = (w: HudWidget) => {
  const lo = w.min ?? 0, hi = w.max ?? 100
  return Math.min(1, Math.max(0, (num(w.value) - lo) / (hi - lo || 1)))
}

// A source's slot drawn as a widget of its pattern, keyed by sender and id (`deploys/prod`), never as Claude's own.
const asWidget = (s: HudHeld): HudWidget => ({
  id: `${s.from}/${s.id}`, type: s.pattern, title: s.title, value: s.value, unit: s.unit, min: s.min, max: s.max,
  delta: s.delta, better: s.better, tone: s.tone, items: s.items, points: s.points, rows: s.rows, text: s.text,
})
const fromWho = (s: HudHeld) => (s.from === 'hud' ? undefined : `from ${s.from}`)

// The full dashboard, flat as the strip: no cards, no fills behind content. Blocks sit on a grid of up to
// 4 units; hairlines divide them, vertical inside a row and full width between rows. A block is a
// sentence-case label row (a muted aside on its right) over a body drawn from (0, 0) of its own box.
// Marks: 2px lines, ≤24px bars with a rounded data end, one colour per series,
// text in text colours (the mark beside it carries the colour), labels on the extremes only.

const GX = 24 // between blocks in a row; the hairline sits in its middle
const GY = 26 // between rows; likewise
const LABEL = 22 // the label row
const CAP = { bold: true }
// categorical slots, stepped per theme in the <style>; passes validate_palette.js on both surfaces. clay, blue, ochre, teal, violet, rose
const CAT = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)']

type Block = {
  span: number
  flex?: true // takes a share of the width its row leaves over
  dim?: true // it hasn't changed in a while
  label?: string
  aside?: string
  dot?: string // a status dot before the label
  why?: string // why it's on the board (hooks/rank.ts), under the label
  height: (w: number) => number // the body, under the label row
  draw: (w: number, h: number) => string
}

// A block whose widget or tile hasn't changed in a while is dim, and its aside says when it did: as of the run's last
// main-loop call, never now, so the image changes only when a call does (ticking text stays out of the SVG).
const aged = (b: Block, clock: { tick?: number; at?: number } | undefined, r: HudRun): Block => {
  if (!clock || life(clock, r) === 'fresh') return b
  const ago = r.tickAt !== undefined && clock.at !== undefined ? `${span(r.tickAt - clock.at)} ago` : undefined
  return { ...b, dim: true, aside: [b.aside, ago].filter(Boolean).join(' · ') || undefined }
}

const T = (x: number, y: number, s: string, size: number, cls = 't', attrs = '') =>
  `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}"${cls ? ` class="${cls}"` : ''}${attrs}>${esc(s)}</text>`
const END = ' text-anchor="end"', MID = ' text-anchor="middle"', W600 = ' font-weight="600"'
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const arrow = (d: number) => (d >= 0 ? '▲' : '▼')
const withUnit = (v: string, u?: string) => (!u ? v : u === '%' ? v + u : `${v} ${u}`)
// A gauge, ring or meter on a 0 to 100 % scale reads as its value ("62%"), never "62 of 100%", and never its share rounded
const of100 = (w: HudWidget) => w.unit === '%' && (w.max ?? 100) === 100 && (w.min ?? 0) === 0
const change = (pts: number[]) => {
  const a = pts.at(-1), b = pts.at(-2)
  const ch = a !== undefined && b !== undefined && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : NaN
  return Number.isFinite(ch) ? ch : undefined
}

// bars with a rounded data end and a square base: hbar grows right from x, vbar grows up to y
const hbar = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h / 2)
  return `M${f1(x)} ${f1(y)}h${f1(w - r)}a${r} ${r} 0 0 1 ${r} ${r}v${f1(h - 2 * r)}a${r} ${r} 0 0 1 -${r} ${r}h-${f1(w - r)}z`
}
const vbar = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h)
  return `M${f1(x)} ${f1(y + h)}v-${f1(h - r)}a${r} ${r} 0 0 1 ${r} -${r}h${f1(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${f1(h - r)}z`
}
const endDot = (x: number, y: number, col: string) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="4" fill="${col}" stroke="var(--bg)" stroke-width="2"/>`
const nothing = () => T(0, 13, 'Nothing yet', 12.5, 'm')

// a stat's trend: quiet ink, the latest point in the accent
const sparkline = (pts: number[], x: number, y: number, w: number, h: number, col: string) => {
  const lo = Math.min(...pts), hi = Math.max(...pts)
  const xy = pts.map((v, i) => [x + (i / (pts.length - 1)) * w, hi === lo ? y + h / 2 : y + h - ((v - lo) / (hi - lo)) * h] as const)
  const [lx, ly] = xy[xy.length - 1]!
  return `<path d="${smooth(xy, y, y + h)}" fill="none" stroke="var(--muted)" stroke-opacity=".6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>${endDot(lx, ly, col)}`
}

// a line chart: three hairlines, a 10% wash, the range on the right
const plot = (pts: number[], w: number, h: number, col: string) => {
  if (pts.length < 2) return T(0, h / 2, 'Waiting for data…', 12.5, 'm')
  const lo = Math.min(...pts), hi = Math.max(...pts), pw = w - 44, top = 6, bot = h - 6
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * pw, hi === lo ? (top + bot) / 2 : bot - ((v - lo) / (hi - lo)) * (bot - top)] as const)
  const d = smooth(xy, top, bot), [lx, ly] = xy[xy.length - 1]!
  return [top, (top + bot) / 2, bot].map(y => `<line x1="0" x2="${f1(pw)}" y1="${f1(y)}" y2="${f1(y)}" class="hair"/>`).join('') +
    `<path d="${d}L${f1(pw)} ${bot}L0 ${bot}Z" fill="${col}" fill-opacity=".1"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${pulse(lx, ly, 4, col)}${endDot(lx, ly, col)}` +
    T(w, top + 4, fmt(hi), 11, 'm num', END) + T(w, bot + 4, fmt(lo), 11, 'm num', END)
}

const lineBlock = (pts: number[], unit: string | undefined, col: string, label: string): Block => {
  const ch = change(pts)
  return {
    span: 2, flex: true, label,
    aside: pts.length ? `${withUnit(fmt(pts.at(-1)), unit)}${ch !== undefined ? ` · ${arrow(ch)} ${Math.abs(ch).toFixed(1)}%` : ''}` : undefined,
    height: () => 96,
    draw: (w, h) => plot(pts.slice(-120), w, h, col),
  }
}

type Stat = { label: string; value: string; unit?: string; delta?: number; better?: 'up' | 'down'; points?: number[]; dot?: string; note?: { text: string; dot: string } }
// The colours of a change: good, bad, or neutral when nobody said which way is good (latency down is good).
const changeOf = (d: number, better: 'up' | 'down' | undefined) =>
  better === undefined || d === 0 ? { mark: 'var(--muted)', text: 'var(--muted)' } : (d >= 0) === (better === 'up') ? { mark: TONE.good, text: toneText(true) } : { mark: TONE.bad, text: toneText(false) }
// A unit after its figure: "81%" joined, "212 ms" spaced.
const unitSpace = (u: string) => (u === '%' ? '' : ' ')
const statBlock = (s: Stat, accent: string): Block => {
  const spark = (s.points?.length ?? 0) > 1
  return {
    span: 1, flex: true, label: s.label, dot: s.dot,
    height: () => 28 + (s.delta !== undefined ? 18 : 0) + (s.note ? 18 : 0) + (spark ? 32 : 0),
    draw: w => {
      const unitW = s.unit ? measure(' ' + s.unit, 13) : 0
      const size = Math.max(16, Math.min(26, (26 * (w - unitW)) / Math.max(1, measure(s.value, 26))))
      let y = 30
      let out = `<text x="0" y="${y}" font-size="${size.toFixed(1)}" class="t disp">${esc(s.value)}${s.unit ? `<tspan font-size="13" class="m sans">${unitSpace(s.unit)}${esc(s.unit)}</tspan>` : ''}</text>`
      if (s.delta !== undefined) {
        y += 20
        out += T(0, y, `${arrow(s.delta)} ${fmt(Math.abs(s.delta))}`, 12, '', `${W600} fill="${changeOf(s.delta, s.better).text}"`)
      }
      if (s.note) {
        y += 20
        out += `<circle cx="3" cy="${y - 4}" r="3" fill="${s.note.dot}"/>` + T(11, y, s.note.text, 12, 't', W600)
      }
      return out + (spark ? sparkline(s.points!.slice(-40), 4, y + 12, Math.min(w, 200) - 8, 24, accent) : '')
    },
  }
}

// a ring's figure and its %, at 18px unless it needs less to sit inside the ring
const ringText = (v: string, cx: number, cy: number) => {
  const size = Math.min(18, 40 / (measure(v, 1) + measure('%', 2 / 3)))
  return `<text x="${cx}" y="${cy + 6}" font-size="${size.toFixed(1)}" class="t disp"${MID}>${esc(v)}<tspan font-size="${(size * 2 / 3).toFixed(1)}" class="m sans">%</tspan></text>`
}

const itemsOf = (w: HudWidget) => w.items ?? []
const maxOf = (items: HudItem[]) => Math.max(1e-9, ...items.map(i => num(i.value)))
const sum = (items: HudItem[]) => items.reduce((s, i) => s + num(i.value), 0)

// horizontal bars: label, bar, the value at its tip
const barsBlock = (items: HudItem[], label: string, col: (it: HudItem) => string, unit?: string): Block => ({
  span: 2, flex: true, label, aside: items.length > 1 && !unit ? `${fmt(sum(items))} total` : undefined,
  height: () => Math.max(16, items.length * 26 - 10),
  draw: w => {
    if (!items.length) return nothing()
    const top = maxOf(items), lw = Math.min(150, w * 0.34), room = w - lw - 52
    return items.map((it, i) => {
      const y = i * 26, bw = Math.max(2, (room * num(it.value)) / top)
      return T(0, y + 11, fit(it.label, lw - 12, 12.5), 12.5) + `<path d="${hbar(lw, y + 2, bw, 10)}" fill="${col(it)}"/>` +
        T(lw + bw + 8, y + 11, fmt(it.value), 12, 't num', W600)
    }).join('')
  },
})

const WIDGET: Record<HudWidget['type'], (w: HudWidget, c: Ctx) => Block> = {
  stat: (w, c) => statBlock({ label: w.title ?? w.id, value: fmt(w.value), unit: w.unit, delta: w.delta, better: w.better, points: w.points, dot: w.tone ? c.tone(w.tone) : undefined }, c.accent),
  gauge: (w, c) => {
    const rad = (cw: number) => Math.max(24, Math.min(44, (cw - 8) / 2))
    return {
      span: 1, height: cw => rad(cw) + 26,
      draw: cw => {
        const r = rad(cw), cx = r + 4, cy = r + 4, f = frac(w)
        return `<path d="${arc(cx, cy, r, -90, 90)}" stroke="var(--track)" stroke-width="8" fill="none" stroke-linecap="round"/>
          ${f > 0 ? `<path d="${arc(cx, cy, r, -90, -90 + 180 * f)}" stroke="${c.tone(w.tone)}" stroke-width="8" fill="none" stroke-linecap="round"/>` : ''}
          <text x="${f1(cx)}" y="${f1(cy - 4)}" font-size="24" class="t disp"${MID}>${esc(fmt(w.value))}${w.unit ? `<tspan font-size="12" class="m sans">${unitSpace(w.unit)}${esc(w.unit)}</tspan>` : ''}</text>` +
          T(cx - r, cy + 20, fmt(w.min ?? 0), 11, 'm num', MID) + T(cx + r, cy + 20, fmt(w.max ?? 100), 11, 'm num', MID)
      },
    }
  },
  ring: (w, c) => ({
    span: 1, height: () => 60,
    draw: cw => {
      const r = 25, cx = 29, cy = 30, C = 2 * Math.PI * r, f = frac(w)
      return `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="var(--track)" stroke-width="7" fill="none"/>
        ${f > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${c.tone(w.tone)}" stroke-width="7" fill="none" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})" stroke-dasharray="${f1(C * f)} ${f1(C)}"/>` : ''}
        ${ringText(of100(w) ? fmt(w.value) : String(pct(f)), cx, cy)}` +
        (cw >= 140 && !(w.unit === '%' && (w.max ?? 100) === 100) ? T(80, cy - 2, withUnit(fmt(w.value), w.unit), 14, 't', W600) + T(80, cy + 16, `of ${withUnit(fmt(w.max ?? 100), w.unit)}`, 12, 'm') : '')
    },
  }),
  meter: (w, c) => ({
    span: 2, flex: true, aside: `${pct(frac(w))}%`, height: () => 32,
    draw: cw => `<rect x="0" y="2" width="${f1(cw)}" height="6" rx="3" fill="var(--track)"/>
      <rect x="0" y="2" width="${f1(Math.max(6, cw * frac(w)))}" height="6" rx="3" fill="${c.tone(w.tone)}"/>` +
      T(0, 30, of100(w) ? withUnit(fmt(w.value), '%') : `${fmt(w.value)} of ${withUnit(fmt(w.max ?? 100), w.unit)}`, 12.5, 'm'),
  }),
  line: (w, c) => lineBlock(w.points ?? [], w.unit, c.tone(w.tone), w.title ?? w.id),
  bars: (w, c) => barsBlock(itemsOf(w).slice(0, 10), w.title ?? w.id, it => it.color ?? (it.state ? stateColor(it.state, c) : c.tone(w.tone)), w.unit),
  columns: (w, c) => {
    const items = itemsOf(w).slice(-24)
    return {
      span: 2, flex: true, height: () => 128,
      draw: (cw, h) => {
        if (!items.length) return nothing()
        const top = maxOf(items), n = items.length, slot = cw / n, bw = Math.min(24, slot * 0.6), base = h - 20, room = base - 18
        const peak = items.findIndex(i => num(i.value) === top), every = Math.ceil(30 / slot)
        return `<line x1="0" x2="${f1(cw)}" y1="${base}" y2="${base}" class="hair2"/>` + items.map((it, i) => {
          const bh = (room * num(it.value)) / top, x = i * slot + (slot - bw) / 2, mid = x + bw / 2
          const col = it.color ?? (it.state ? stateColor(it.state, c) : c.tone(w.tone))
          return (bh > 0 ? `<path d="${vbar(x, base - bh, bw, bh)}" fill="${col}"/>` : '') +
            (i === peak || i === n - 1 ? T(mid, base - bh - 6, fmt(it.value), 11, 't num', MID + W600) : '') +
            (i % every === 0 || i === n - 1 ? T(mid, base + 15, fit(it.label, slot * every - 4, 11), 11, 'm', MID) : '')
        }).join('')
      },
    }
  },
  donut: (w, c) => {
    // simplification: past 6 slices the tail folds into Other, as the categorical slots stop at 6
    const all = itemsOf(w)
    const items = all.length > 6 ? [...all.slice(0, 5), { label: 'Other', value: sum(all.slice(5)), color: 'var(--line2)' }] : all
    const total = sum(items) || 1
    return {
      span: 2, flex: true, height: () => Math.max(96, items.length * 24 - 6),
      draw: (cw, h) => {
        const r = 40, cx = 46, cy = h / 2, C = 2 * Math.PI * r, gap = items.length > 1 ? 2 : 0, x0 = cx + r + 32
        const ly = (i: number) => cy - (items.length * 24 - 6) / 2 + i * 24 + 9
        const colOf = (it: HudItem, i: number) => it.color ?? (it.state ? stateColor(it.state, c) : CAT[i]!)
        let off = 0
        return items.map((it, i) => {
          const len = (C * num(it.value)) / total
          const seg = len > gap ? `<circle cx="${cx}" cy="${f1(cy)}" r="${r}" fill="none" stroke="${colOf(it, i)}" stroke-width="10" stroke-dasharray="${f1(len - gap)} ${f1(C)}" stroke-dashoffset="${f1(-off)}" transform="rotate(-90 ${cx} ${f1(cy)})"/>` : ''
          off += len
          return seg + `<rect x="${x0}" y="${f1(ly(i) - 9)}" width="9" height="9" rx="2" fill="${colOf(it, i)}"/>` +
            T(x0 + 17, ly(i), fit(it.label, cw - x0 - 17 - 44, 12.5), 12.5) + T(cw, ly(i), `${pct(num(it.value) / total)}%`, 12, 'm num', END)
        }).join('') + T(cx, cy + 4, fmt(w.value ?? sum(items)), 18, 't disp', MID) + T(cx, cy + 18, 'total', 12, 'm', MID)
      },
    }
  },
  heatmap: (w, c) => {
    const rows = w.rows ?? [], nc = Math.max(1, ...rows.map(r => r.length)), cell = (cw: number) => Math.min(28, cw / nc)
    return {
      span: 2, flex: true, height: cw => rows.length * cell(cw) + 24,
      draw: cw => {
        const all = rows.flat()
        if (!all.length) return nothing()
        const s = cell(cw), lo = Math.min(...all), hi = Math.max(...all), col = c.tone(w.tone)
        const op = (t: number) => (0.08 + 0.92 * t).toFixed(2), t = (v: number) => (v - lo) / (hi - lo || 1)
        const ky = rows.length * s + 16, kx = measure(fmt(lo), 11) + 6
        return rows.map((row, i) => row.map((v, j) => `<rect x="${f1(j * s)}" y="${f1(i * s)}" width="${f1(s - 2)}" height="${f1(s - 2)}" rx="2" fill="${col}" fill-opacity="${op(t(v))}"/>`).join('')).join('') +
          T(0, ky, fmt(lo), 11, 'm num') +
          Array.from({ length: 5 }, (_, i) => `<rect x="${f1(kx + i * 12)}" y="${ky - 9}" width="10" height="10" rx="2" fill="${col}" fill-opacity="${op(i / 4)}"/>`).join('') +
          T(kx + 66, ky, fmt(hi), 11, 'm num')
      },
    }
  },
  list: (w, c) => {
    const items = itemsOf(w).slice(0, 10)
    return {
      span: 2, flex: true, height: () => Math.max(16, items.length * 34 - 8),
      draw: cw => {
        if (!items.length) return nothing()
        const top = maxOf(items)
        return items.map((it, i) => {
          const y = i * 34, val = it.value !== undefined ? fmt(it.value) : '', vw = val ? measure(val, 13, CAP) + 12 : 0
          const name = fit(it.label, cw - 24 - vw, 13, { bold: i === 0 }), room = cw - 24 - vw - measure(name, 13, { bold: i === 0 }) - 8
          // simplification: the leader is the one emphasised; the rest stay gray, so color is not spent on rank
          return T(0, y + 13, String(i + 1), 12, 'm num') +
            `<text x="24" y="${y + 13}" font-size="13" class="t"${i === 0 ? W600 : ''}>${esc(name)}${it.note && room > 30 ? `<tspan class="m" font-size="12" font-weight="400"> ${esc(fit(it.note, room, 12))}</tspan>` : ''}</text>` +
            (val ? T(cw, y + 13, val, 13, 't num', END + W600) : '') +
            (it.value !== undefined ? `<rect x="24" y="${y + 20}" width="${f1(Math.max(2, ((cw - 24) * num(it.value)) / top))}" height="3" rx="1.5" fill="${it.color ?? (i === 0 ? c.tone(w.tone) : 'var(--line2)')}"/>` : '')
        }).join('')
      },
    }
  },
  checklist: (w, c) => {
    const LINE = 17, items = itemsOf(w).slice(0, 14)
    const rows = (cw: number) => {
      let y = 0
      return items.map(it => {
        const noteW = it.note ? measure(it.note, 12) + 12 : 0
        const at = { it, y, lines: wrapPx(it.label, cw - 24 - noteW, 13, 2, { bold: it.state === 'now' }), h: 0 }
        at.h = 26 + (at.lines.length - 1) * LINE
        y += at.h
        return at
      })
    }
    const done = items.filter(i => i.state === 'done' || i.state === 'hit').length
    return {
      span: 2, flex: true, aside: items.length ? `${done} of ${items.length} done` : undefined,
      height: cw => { const l = rows(cw).at(-1); return l ? l.y + l.h - 8 : 16 },
      draw: cw => {
        const all = rows(cw)
        if (!all.length) return nothing()
        return all.map(({ it, y, lines, h }, i) => {
          const isDone = it.state === 'done' || it.state === 'hit'
          return (i < all.length - 1 ? `<line x1="8" x2="8" y1="${y + 17}" y2="${y + h + 1}" stroke="${isDone ? TONE.good : 'var(--line2)'}" stroke-width="1.5"/>` : '') +
            icon(it.state ?? 'todo', 8, y + 9, 7, c) +
            lines.map((l, j) => T(24, y + 13 + j * LINE, l, 13, isDone ? 'm' : 't', it.state === 'now' ? W600 : '')).join('') +
            (it.note ? T(cw, y + 13, it.note, 12, 'm num', END) : '')
        }).join('')
      },
    }
  },
  table: (w, c) => {
    const LINE = 16, items = itemsOf(w).slice(0, 14)
    const rows = (cw: number) => {
      let y = 0
      return items.map(it => {
        const val = it.note ?? fmt(it.value), mark = it.state || it.color ? 14 : 0
        const valLines = wrapPx(val, cw * 0.58 - mark, 13, 2, CAP)
        const valW = Math.max(...valLines.map(l => measure(l, 13, CAP)))
        const labelLines = wrapPx(it.label, cw - valW - mark - 16, 12.5, 2)
        const at = { it, y, valLines, valW, labelLines, mark, h: 28 + (Math.max(valLines.length, labelLines.length) - 1) * LINE }
        y += at.h
        return at
      })
    }
    return {
      span: 2, flex: true,
      height: cw => { const l = rows(cw).at(-1); return l ? l.y + l.h - 8 : 16 },
      draw: cw => {
        const all = rows(cw)
        if (!all.length) return nothing()
        return all.map(({ it, y, valLines, valW, labelLines, mark, h }, i) =>
          (i < all.length - 1 ? `<line x1="0" x2="${f1(cw)}" y1="${f1(y + h - 3.5)}" y2="${f1(y + h - 3.5)}" class="hair"/>` : '') +
          labelLines.map((l, j) => T(0, y + 14 + j * LINE, l, 12.5, 'm')).join('') +
          (mark ? (it.state ? dot(it.state, cw - valW - 9, y + 9.5, c) : `<circle cx="${f1(cw - valW - 9)}" cy="${y + 9.5}" r="3.5" fill="${it.color}"/>`) : '') +
          valLines.map((l, j) => T(cw, y + 14 + j * LINE, l, 13, 't num', END + W600)).join('')).join('')
      },
    }
  },
  text: (w, c) => {
    const lines = (cw: number) => (w.text ?? String(w.value ?? '')).split('\n').flatMap(p => wrapPx(p, cw - 14, 13, 12)).slice(0, 20)
    return {
      span: 2, flex: true, height: cw => Math.max(16, lines(cw).length * 19 - 2),
      draw: (cw, h) => `<rect x="0" y="0" width="2" height="${f1(h)}" rx="1" fill="${c.tone(w.tone)}"/>` +
        lines(cw).map((l, i) => T(14, 13 + i * 19, l, 13)).join(''),
    }
  },
}

// The mirrored plan draws only as the lead (leadList(), in lifecycle.ts): where Claude has progress, phases or a
// checklist of its own, it is kept and not drawn.
export const hiddenMirror = (r: HudRun, w: HudWidget) => isMirror(w) && w !== leadList(r)

// The lead checklist's label: its title, unless the run's title already says it ("Phase 0" in "Billing 2.0 — Phase 0
// audit" reads as an echo), then what it is to the run: the plan.
const planLabel = (r: HudRun, w: HudWidget) =>
  w.title && !r.title.toLowerCase().includes(w.title.toLowerCase()) ? w.title : 'Plan'

// The step in hand and the strip key that draws it: the phase marked now, else the lead checklist's item.
// A finished run has none: done/fail close its phase, and a checklist Claude left on 'now' counts as closed too.
export const stepNow = (r: HudRun): { name: string; key: string } | undefined => {
  const phase = r.phases.find(p => p.state === 'now')
  if (phase) return { name: phase.name, key: 'phases' }
  if (r.status === 'done' || r.status === 'failed') return undefined
  const plan = leadList(r), item = plan?.items?.find(i => i.state === 'now')
  return plan && item ? { name: item.label, key: own(plan.id) } : undefined
}

// A source's slot as a block of its pattern, with what the value means now (its note) under the title, and who sent it
// beside the title; the HUD's own go unsigned.
const slotBlock = (s: HudHeld, c: Ctx, why?: string): Block => {
  const b = WIDGET[s.pattern](asWidget(s), c)
  const note = (w: number) => (s.note ? wrapPx(s.note, w, 12.5, 2) : [])
  const noteH = (w: number) => (s.note ? note(w).length * 17 + 6 : 0)
  return {
    ...b, label: s.title, why, aside: [b.aside, fromWho(s)].filter(Boolean).join(' · ') || undefined,
    height: w => noteH(w) + b.height(w),
    draw: (w, h) => note(w).map((l, j) => T(0, 13 + j * 17, l, 12.5, 'm')).join('') +
      `<g transform="translate(0 ${noteH(w)})">${b.draw(w, h - noteH(w))}</g>`,
  }
}

// The run in rows: its progress and phases (or the checklist that leads), its figures, then the model's
// widgets in order, what was noticed, the log. Ranked (`placed`, hooks/rank.ts), Claude's widgets and the sources'
// slots are one board after the run's own items, in rank order, each with why it's there under its title.
const rowsOf = (r: HudRun, W: number, cols: number, c: Ctx, slots: HudHeld[], placed?: Placed[]): Block[][] => {
  const rows: Block[][] = []
  const why = new Map(placed?.map(p => [p.key, p.why]))

  let hero: Block | undefined
  if (r.progress) {
    // simplification: clamped here as apply() refuses one out of range, for a run from before that holds one
    const { total, label } = r.progress, n = Math.min(total, Math.max(0, r.progress.n)), f = n / total
    const col = r.status === 'failed' ? TONE.bad : r.status === 'done' ? TONE.good : c.accent
    hero = {
      span: 4, flex: true, height: () => 52,
      draw: w => {
        const sw = (w - (total - 1) * 2) / total, track = total <= 48 && sw >= 4
          ? Array.from({ length: total }, (_, i) => `<rect x="${f1(i * (sw + 2))}" y="44" width="${f1(sw)}" height="6" rx="${Math.min(3, sw / 2).toFixed(1)}" fill="${i < n ? col : 'var(--track)'}"/>`).join('')
          : `<rect x="0" y="44" width="${f1(w)}" height="6" rx="3" fill="var(--track)"/><rect x="0" y="44" width="${f1(Math.max(6, w * f))}" height="6" rx="3" fill="${col}"/>`
        return `<text x="0" y="32" font-size="34" class="t disp">${pct(f)}<tspan font-size="16" class="m">%</tspan></text>` +
          T(w, 15, `${fmt(n)} of ${fmt(total)}${label ? ' ' + label : ''}`, 13, 't', END + W600) +
          T(w, 33, total - n > 0 ? `${fmt(total - n)} left` : 'Complete', 12.5, 'm', END) + track
      },
    }
  }

  // A chain names every step only while every name fits whole beside its dot. Past that it never clips
  // ("R…"): it becomes a segmented track like the progress figure's, with the step that matters named.
  let phases: Block | undefined
  if (r.phases.length) {
    const ph = r.phases, n = ph.length, at = ph.findIndex(p => p.state === 'now')
    const names = (w: number) => ph.every(p => measure(p.name, 12, { bold: p.state === 'now' }) <= w / n - 8)
    const cur = ph[at] ?? ph.find(p => p.state === 'failed') ?? [...ph].reverse().find(p => p.state === 'done') ?? ph[0]!
    const ci = ph.indexOf(cur), done = ph.filter(p => p.state === 'done').length
    phases = {
      span: 4, flex: true, label: 'Phases',
      aside: at >= 0 ? `${at + 1} of ${n}` : `${done} of ${n} done`,
      height: w => (names(w) ? 42 : 64),
      draw: w => {
        if (names(w)) {
          const gap = w / n, cx = (i: number) => gap * (i + 0.5), y = 9
          return `<line x1="${f1(cx(0))}" x2="${f1(cx(n - 1))}" y1="${y}" y2="${y}" stroke="var(--track)" stroke-width="2"/>` +
            ph.map((p, i) => (i < n - 1 && p.state === 'done' ? `<line x1="${f1(cx(i))}" x2="${f1(cx(i + 1))}" y1="${y}" y2="${y}" stroke="${TONE.good}" stroke-width="2"/>` : '')).join('') + // simplification: solid; a gradient on a flat line has a zero-height box and paints nothing
            ph.map((p, i) => icon(p.state, cx(i), y, 8, c) +
              T(cx(i), y + 30, p.name, 12, p.state === 'todo' ? 'm' : 't', MID + (p.state === 'now' ? W600 : ''))).join('')
        }
        const sw = (w - (n - 1) * 2) / n, fill = (s: HudState) => (s === 'todo' ? 'var(--track)' : stateColor(s, c))
        const track = sw >= 3
          ? ph.map((p, i) => `<rect x="${f1(i * (sw + 2))}" y="0" width="${f1(sw)}" height="6" rx="${Math.min(3, sw / 2).toFixed(1)}" fill="${fill(p.state)}"/>`).join('')
          : `<rect x="0" y="0" width="${f1(w)}" height="6" rx="3" fill="var(--track)"/><rect x="0" y="0" width="${f1(Math.max(6, (w * done) / n))}" height="6" rx="3" fill="${TONE.good}"/>`
        // the named step under its own segment: a caret ties the two together
        const mx = Math.min(w - 4, Math.max(4, ci * (sw + 2) + sw / 2))
        const prev = ph[ci - 1], next = ph.slice(ci + 1).find(p => p.state !== 'done')
        const context = [prev && `after ${prev.name}`, next ? `next ${next.name}` : cur.state === 'done' ? 'all phases done' : ''].filter(Boolean).join(' · ')
        return track + `<path d="M${f1(mx - 4)} 13l4-4 4 4z" fill="${fill(cur.state)}"/>` +
          icon(cur.state, 8, 30, 8, c) +
          T(24, 35, fit(cur.name, w - 24, 15, { bold: true }), 15, 't', W600) +
          T(24, 56, fit(context, w - 24, 12.5), 12.5, 'm')
      },
    }
  }
  if (hero && phases && cols === 4) rows.push([{ ...hero, span: 2 }, { ...phases, span: 2 }])
  else for (const b of [hero, phases]) if (b) rows.push([b])
  // With no progress or phases, a checklist is the run's plan: it leads, above the figures.
  const plan = leadList(r)
  if (plan) rows.push([aged({ ...WIDGET.checklist(plan, c), span: 4, label: planLabel(r, plan), why: why.get(widgetKey(plan)) }, plan, r)])

  // figures in balanced rows of ~150px or more each: 7 at three across is 3 + 2 + 2, not 3 + 3 + 1.
  // Failed calls sit under the call count, so a few read against the total, not as a headline of their own.
  const stats = [
    ...Object.entries(r.tiles).map(([k, v]) => aged(statBlock({ label: k, value: fmt(v) }, c.accent), r.tileClock?.[k], r)),
    ...(placed ? [] : r.widgets.filter(w => w.type === 'stat').map(w => aged(WIDGET.stat(w, c), w, r))),
    statBlock({ label: 'Tool calls', value: fmt(r.calls), note: r.errors ? { text: `${fmt(r.errors)} failed`, dot: TONE.bad } : undefined }, c.accent),
  ]
  const across = Math.min(6, Math.max(2, Math.floor((W + GX) / (150 + GX)))), lines = Math.ceil(stats.length / across)
  for (let i = 0, l = 0; l < lines; l++) {
    const n = Math.floor(stats.length / lines) + (l < stats.length % lines ? 1 : 0)
    rows.push(stats.slice(i, i + n))
    i += n
  }

  if (r.cells.length) {
    const cells = r.cells, colW = Math.max(...cells.map(x => measure(x.name, 12.5, CAP))) + 36
    const per = (w: number) => Math.max(1, Math.floor(w / colW))
    const count = (s: HudState) => cells.filter(x => x.state === s).length
    const left = count('todo') + count('now')
    rows.push([{
      span: 4, flex: true, label: 'Grid',
      aside: [count('hit') && `${count('hit')} hit`, count('miss') && `${count('miss')} miss`, left && `${left} to go`].filter(Boolean).join(' · '),
      height: w => Math.ceil(cells.length / per(w)) * 24 - 6,
      draw: w => {
        const k = per(w), cw = w / k
        return cells.map((cell, i) => {
          const x = (i % k) * cw, y = Math.floor(i / k) * 24 + 13
          return icon(cell.state, x + 6, y - 4, 6, c) +
            T(x + 17, y, fit(cell.name, cw - 22, 12.5, CAP), 12.5, cell.state === 'todo' ? 'm' : 't', cell.state === 'now' ? W600 : '')
        }).join('')
      },
    }])
  }

  const rest: Block[] = []
  if (r.points.length > 1) rest.push(lineBlock(r.points, undefined, c.accent, 'Trend'))
  const counts = Object.entries(r.counts).sort((a, b) => b[1] - a[1])
  if (counts.length) rest.push(barsBlock(counts.slice(0, 10).map(([label, value]) => ({ label, value })), 'Counts', () => c.accent))
  const widgetBlock = (w: HudWidget, why?: string) => {
    const b = WIDGET[w.type]?.(w.items?.some(it => it.color) ? { ...w, items: w.items.map(it => ({ ...it, color: hue(it.color, c.accent) })) } : w, c)
    if (b) rest.push(aged({ ...b, span: w.span ?? b.span, label: b.label ?? w.title ?? w.id, why }, w, r))
  }
  if (placed) {
    for (const p of placed) {
      const w = r.widgets.find(x => widgetKey(x) === p.key)
      if (!w) rest.push(slotBlock(p.slot, c, p.why))
      else if (w !== plan) widgetBlock(w, p.why)
    }
  } else {
    for (const w of r.widgets) if (w.type !== 'stat' && w !== plan && !isMirror(w)) widgetBlock(w)
    // then the sources' slots
    for (const s of slots) rest.push(slotBlock(s, c))
  }
  let row: Block[] = [], used = 0
  for (const b of rest) {
    const s = Math.min(cols, Math.max(1, Math.round(b.span)))
    if (used + s > cols) { rows.push(row); row = []; used = 0 }
    row.push(b)
    used += s
  }
  if (row.length) rows.push(row)

  if (r.fun.length) {
    const paras = (w: number) => r.fun.map(f => wrapPx(f, w, 14, 3))
    rows.push([{
      span: 4, flex: true, label: 'Noticed',
      height: w => paras(w).reduce((n, p) => n + p.length * 20 + 8, -9),
      draw: w => {
        let y = 14, out = ''
        for (const p of paras(w)) {
          for (const l of p) { out += T(2, y, l, 14, 't serif', ' font-style="italic"'); y += 20 }
          y += 8
        }
        return out
      },
    }])
  }

  if (r.log.length) {
    const lines = (w: number) => {
      let y = 0
      return r.log.slice(-12).map(l => {
        const at = { l, y, text: wrapPx(l.text, w - 58, 12.5, 2), h: 0 }
        at.h = 22 + (at.text.length - 1) * 16
        y += at.h
        return at
      })
    }
    const n = r.log.length
    rows.push([{
      span: 4, flex: true, label: 'Log', aside: n > 12 ? `Last 12 of ${n}` : `${n} ${n === 1 ? 'entry' : 'entries'}`,
      height: w => { const l = lines(w).at(-1)!; return l.y + l.h - 6 },
      draw: w => lines(w).map(({ l, y, text }) => {
        const mark = l.level === 'ok' ? icon('done', 46, y + 9, 5.5, c) : l.level === 'err' ? icon('failed', 46, y + 9, 5.5, c)
          : l.level === 'warn' ? `<path d="M46 ${y + 3}l5.5 10h-11z" fill="${TONE.warn}"/><path d="M46 ${y + 6.5}v3.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="46" cy="${y + 11.4}" r=".9" fill="#fff"/>`
            : `<circle cx="46" cy="${y + 9}" r="2.5" fill="var(--muted)"/>`
        return T(0, y + 13, mmss(l.at - r.startedAt), 12, 'm num') + mark +
          // the observer's lines in the muted text token (≥ 4.5:1 on both themes); a line with no by is Claude's
          text.map((t, j) => T(58, y + 13 + j * 16, t, 12.5, l.by === 'observer' ? 'm' : 't')).join('')
      }).join(''),
    }])
  }
  return rows
}

// What the strip and dashboard draw, in words, for their alt: a screen reader hears the run as the graphic shows it.
// The header's native text already says the title, goal, status and clock.
const STATE_WORD: Record<HudState, string> = { todo: 'to do', now: 'in progress', done: 'done', failed: 'failed', hit: 'hit', miss: 'missed' }
const widgetWords = (w: HudWidget): string => {
  const items = w.items ?? [], unit = w.unit ? (w.unit === '%' ? '%' : ` ${w.unit}`) : ''
  switch (w.type) {
    case 'stat': return `${fmt(w.value)}${unit}${w.delta !== undefined ? `, ${w.delta >= 0 ? 'up' : 'down'} ${fmt(Math.abs(w.delta))}` : ''}`
    case 'gauge': case 'ring': case 'meter': return of100(w) ? `${fmt(w.value)}%` : `${fmt(w.value)}${unit} of ${fmt(w.max ?? 100)}`
    case 'line': {
      const p = w.points ?? []
      return p.length ? `last ${fmt(p.at(-1))}, from ${fmt(Math.min(...p))} to ${fmt(Math.max(...p))}` : 'no points yet'
    }
    case 'heatmap': {
      const all = (w.rows ?? []).flat()
      return `${w.rows?.length ?? 0} by ${Math.max(0, ...(w.rows ?? []).map(r => r.length))}${all.length ? `, from ${fmt(Math.min(...all))} to ${fmt(Math.max(...all))}` : ''}`
    }
    case 'checklist': {
      const done = items.filter(i => i.state === 'done' || i.state === 'hit').length, now = items.find(i => i.state === 'now')
      return `${done} of ${items.length} done${now ? `, now ${plain(now.label)}` : ''}${items.some(i => i.state === 'failed') ? `, failed ${items.filter(i => i.state === 'failed').map(i => plain(i.label)).join(', ')}` : ''}`
    }
    case 'text': return plain(w.text ?? '')
    default: return items.slice(0, 8).map(i => `${plain(i.label)}${i.value !== undefined ? ' ' + fmt(i.value) : ''}${i.state ? ' ' + STATE_WORD[i.state] : ''}${i.note ? ' (' + plain(i.note) + ')' : ''}`).join(', ')
  }
}
const slotWords = (s: HudHeld) => `${plain(s.title)}${fromWho(s) ? ` (${fromWho(s)})` : ''}: ${widgetWords(asWidget(s))}${s.note ? `, ${plain(s.note)}` : ''}`
const ownWords = (w: HudWidget) => `${plain(w.title ?? w.id)}: ${widgetWords(w)}`
/** Ranked (`placed`), Claude's widgets and the slots are said in rank order, each with why it's there ("… — why"). */
export function describe(r: HudRun, slots: HudHeld[] = [], placed?: Placed[]): string {
  const board = placed
    ? placed.map(p => { const w = r.widgets.find(x => widgetKey(x) === p.key); return `${w ? ownWords(w) : slotWords(p.slot)}${p.why ? ` — ${p.why}` : ''}` })
    : [...r.widgets.filter(w => !hiddenMirror(r, w)).map(ownWords), ...slots.map(slotWords)]
  const at = r.phases.findIndex(p => p.state === 'now'), count = (s: HudState) => r.cells.filter(c => c.state === s).length
  const parts = [
    r.progress && `Progress ${fmt(r.progress.n)} of ${fmt(r.progress.total)}${r.progress.label ? ' ' + plain(r.progress.label) : ''}, ${pct(r.progress.n / r.progress.total)}%`,
    r.phases.length > 0 && `Phases: ${r.phases.map(p => `${plain(p.name)} ${STATE_WORD[p.state]}`).join(', ')}${at >= 0 ? ` (step ${at + 1} of ${r.phases.length})` : ''}`,
    ...Object.entries(r.tiles).map(([k, v]) => `${plain(k)} ${fmt(v)}`),
    `Tool calls ${fmt(r.calls)}${r.errors ? `, ${fmt(r.errors)} failed` : ''}`,
    r.cells.length > 0 && `Grid of ${r.cells.length}: ${[count('hit') && `${count('hit')} hit`, count('miss') && `${count('miss')} missed`, count('now') && `${count('now')} in progress`, count('todo') && `${count('todo')} to do`].filter(Boolean).join(', ')}`,
    r.points.length > 1 && `Trend: last ${fmt(r.points.at(-1))}, from ${fmt(Math.min(...r.points))} to ${fmt(Math.max(...r.points))}`,
    Object.keys(r.counts).length > 0 && `Counts: ${Object.entries(r.counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${plain(k)} ${n}`).join(', ')}`,
    ...board,
    r.fun.length > 0 && `Noticed: ${r.fun.map(plain).join(' ')}`,
    r.log.length > 0 && `Last: ${plain(r.log.at(-1)!.text)}`,
  ]
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join('. ') + '.'
}

// A block's label row: the label wraps to two lines where it doesn't fit, and the aside sits on its right, or on
// its own line under the label when the two don't share one (never cut to "4 t…"). Why it's on the board goes on a
// line of its own under them, muted and fitted.
const headOf = (b: Block, w: number): { h: number; svg: string } => {
  if (!b.label) return { h: 0, svg: '' }
  const dotW = b.dot ? 12 : 0, label = sentence(b.label), asideW = b.aside ? measure(b.aside, 12) : 0
  const inline = !b.aside || measure(label, 12, CAP) + 12 + asideW <= w - dotW
  const lines = wrapPx(label, w - dotW - (b.aside && inline ? asideW + 12 : 0), 12, 2, CAP)
  const below = b.aside && !inline ? fit(b.aside, w - dotW, 12) : ''
  const under = lines.length + (below ? 1 : 0)
  const svg = (b.dot ? `<circle cx="3" cy="9" r="3" fill="${b.dot}"/>` : '') +
    lines.map((l, j) => T(dotW, 13 + j * 16, l, 12, 'm', ' font-weight="500"')).join('') +
    (b.why ? T(dotW, 13 + under * 16, fit(b.why, w - dotW, 12), 12, 'm', ' font-style="italic"') : '') +
    (b.aside && inline ? T(w, 13, b.aside, 12, 'm num', END) : '') +
    (below ? T(dotW, 13 + lines.length * 16, below, 12, 'm num') : '')
  return { h: LABEL + (under - 1 + (b.why ? 1 : 0)) * 16, svg }
}

/** `placed` (hooks/rank.ts): the board ranked, which draws Claude's widgets and the slots in rank order with their why. */
export function dashboard(r: HudRun, width: number, slots: HudHeld[] = [], placed?: Placed[]): { source: string; height: number } {
  const W = Math.round(width)
  const cols = W >= 760 ? 4 : W >= 400 ? 2 : 1
  const unit = (W - GX * (cols - 1)) / cols
  const accent = hue(r.accent, ACCENT) ?? ACCENT
  const c: Ctx = { id: 'd', accent, grad: col => col, tone: t => (t ? (t === 'accent' ? accent : TONE[t]) : accent) }

  const out: string[] = []
  let y = 4
  rowsOf(r, W, cols, c, slots, placed).forEach((row, ri) => {
    // natural widths by span; overfull rows shrink to fit, and flexible blocks share what is left over
    const nat = row.map(b => { const s = Math.min(cols, Math.max(1, Math.round(b.span))); return s * unit + (s - 1) * GX })
    const room = W - GX * (row.length - 1), total = nat.reduce((a, b) => a + b, 0), k = Math.min(1, room / total)
    const left = room - total * k, flexW = row.reduce((n, b, i) => n + (b.flex ? nat[i]! * k : 0), 0)
    const ws = nat.map((n, i) => n * k + (flexW && row[i]!.flex ? (left * n * k) / flexW : 0))
    const heads = row.map((b, i) => headOf(b, ws[i]! - 2))
    const h = Math.max(...row.map((b, i) => heads[i]!.h + b.height(ws[i]! - 2)))
    if (ri) out.push(`<line x1="0" x2="${W}" y1="${f1(y - GY / 2)}" y2="${f1(y - GY / 2)}" class="hair"/>`)
    let x = 0
    row.forEach((b, i) => {
      const w = ws[i]!
      if (i) out.push(`<line x1="${f1(x - GX / 2)}" x2="${f1(x - GX / 2)}" y1="${f1(y)}" y2="${f1(y + h)}" class="hair"/>`)
      const head = heads[i]!, bw = w - 2
      const block = `${head.svg}<g transform="translate(0 ${head.h})">${b.draw(bw, b.height(bw))}</g>`
      out.push(b.dim ? `<g class="dim" transform="translate(${f1(x)} ${f1(y)})">${dimmed(block)}</g>` : `<g transform="translate(${f1(x)} ${f1(y)})">${block}</g>`)
      x += w + GX
    })
    y += h + GY
  })

  const H = Math.max(60, Math.ceil(y - GY + 8))
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif">
  <style>
    svg{--fg:#141413;--muted:#6F6E69;--bg:#FAF9F5;--card:var(--bg);--line:#E8E6DC;--line2:#D1CFC5;--track:#ECEAE2;--c1:#C6613F;--c2:#2F6FC6;--c3:#B8860B;--c4:#0F8F7E;--c5:#8A4FC8;--c6:#C2457A;${TOKENS.light}}
    @media (prefers-color-scheme: dark){svg{--fg:#F5F4EF;--muted:#A3A198;--bg:#262624;--line:#3A3A37;--line2:#5A5954;--track:#3A3A37;--c1:#D9734E;--c2:#4F8AD9;--c3:#B98A14;--c4:#1FA08D;--c5:#9C6BDB;--c6:#D45C8E;${TOKENS.dark}}}
    .t{fill:var(--fg)} .m{fill:var(--muted)} .hair{stroke:var(--line)} .hair2{stroke:var(--line2)} .num{font-variant-numeric:lining-nums tabular-nums}
    .disp,.serif{font-family:'Copernicus','Tiempos Headline','Tiempos Text',ui-serif,Georgia,'Times New Roman',serif}
    .disp{font-weight:500;letter-spacing:-.01em;font-variant-numeric:lining-nums tabular-nums} .sans{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:0}
    ${DIM}
  </style>${out.join('')}</svg>`
  return { source, height: H }
}


// The strip under the band's header row, laid out like size-classed widgets.
// Every item offers variants from small to large, each sized from its own content. The fit pass starts
// everything at its smallest, drops the least important item while even that overflows, then grows
// one item a size at a time, the one with the best priority-to-size score whose next size still fits.
// So the strip reshapes with the room and the data instead of stretching one layout.
// Text that ticks (the clock) stays native above it.

// w: the width the content needs · h: how tall it draws from Y0 · flex: it can use more width than w
type StripVariant = { w: number; h: number; flex?: true; draw: (x: number, w: number) => string }
// slot: the slot key it stands for (claude/<id>, hud/tests, deploys/prod), which an arrangement names it by
type StripItem = { key: string; priority: number; tone: string; variants: StripVariant[]; dim?: boolean; slot?: string }

const Y0 = 6 // content top; each variant says how far down it draws
// The built-in items' keys, which `strip: [...]` names and `shown` reports. A tile or widget Claude gave one
// of these names is keyed own:<name>, so it never stands in for the built-in (a tile "errors" hiding the
// counted tool errors from the header, which leaves out what the strip drew).
const BUILTIN = new Set(['progress', 'phases', 'trend', 'errors', 'calls'])
const own = (k: string) => (BUILTIN.has(k) ? `own:${k}` : k)
const CAPS = 11 // a label's size

// The patterns a strip item can draw a slot in.
const STRIP: readonly string[] = ['stat', 'gauge', 'ring', 'meter', 'line', 'checklist']

/** Claude's `strip` as slot keys, which count as its focus (hooks/rank.ts): a widget by its key, a slot as named; the
 * run's own items (progress, a tile) are no slots. */
export const stripFocus = (r: HudRun | null): string[] => (r?.strip ?? []).flatMap(k => {
  if (k.includes('/')) return [k]
  const w = BUILTIN.has(k) ? undefined : r!.widgets.find(x => own(x.id) === k)
  return w ? [widgetKey(w)] : []
})

/** What the strip shows, decided at a boundary (hooks/rank.ts): its slot keys, why each is there, and the run's own
 * items it gave room to (`frame`, their keys). */
export type Arranged = { strip: string[]; why: Record<string, string>; frame?: string[] }

/**
 * The band's strip. With no arrangement, `slots` (in the order to draw them) fill what Claude's own items leave of
 * four, and drop first when the row is short. With one (`arranged`), the run's own items are drawn as they are and its
 * slots, Claude's widgets among them, take what is left in its order: a slot it doesn't name waits for the next
 * boundary. Claude can name items in `strip` by key. `urgent` takes the place in front of everything, never dropped:
 * the HUD's own rules raise it (hooks/urgency.ts), never a source. Its mark takes the slot's tone as it stands now, so
 * a held urgency whose cause has gone is not painted as the alarm it was.
 */
export function strip(r: HudRun, width: number, slots: HudHeld[] = [], urgent?: { slot: HudHeld; says: string }, arranged?: Arranged): { source: string; height: number; width: number; shown: string[] } {
  const { built, chosen } = pick(r, slots, urgent, arranged)
  return fitStrip(chosen, width, built.defs)
}

// What the strip chose, before it fits the row: its items in order, the urgency place first.
function pick(r: HudRun, slots: HudHeld[], urgent?: { slot: HudHeld; says: string }, arranged?: Arranged) {
  const built = stripItems(r, slots, urgent)
  let { chosen } = choose(r, built, arranged)
  const ahead = built.items.find(it => it.key === 'urgent')
  if (ahead) chosen = [ahead, ...chosen]
  return { built, chosen }
}

/** An item the strip chose: its key, the slot it stands for (none for the run's own), and for the run's own that a line
 * of text can say (a tile, the trend, the call count) what to say. */
export type Picked = { key: string; slot?: string; own?: { title: string; w: HudWidget; clock?: { at?: number; tick?: number } } }

/**
 * The items `strip()` chose, in its order, from the very function that chooses them (the run's own items, the slots the
 * arrangement named, the default pick with none), before the row's width drops any: what the terminal's band draws as
 * lines. Progress, phases and errors are among them, and the header already says those.
 */
export function stripPicked(r: HudRun, slots: HudHeld[] = [], urgent?: { slot: HudHeld; says: string }, arranged?: Arranged): Picked[] {
  const tiles = new Map(Object.entries(r.tiles).map(([k, v]) => [own(k), [k, v] as const]))
  return pick(r, slots, urgent, arranged).chosen.map(it => {
    if (it.slot) return { key: it.key, slot: it.slot }
    const tile = tiles.get(it.key)
    if (tile) return { key: it.key, own: { title: tile[0], w: { id: tile[0], type: 'stat' as const, value: tile[1] }, clock: r.tileClock?.[tile[0]] } }
    if (it.key === 'trend') return { key: it.key, own: { title: 'Trend', w: { id: 'trend', type: 'line' as const, points: r.points } } }
    if (it.key === 'calls') return { key: it.key, own: { title: 'Tool calls', w: { id: 'calls', type: 'stat' as const, value: r.calls } } }
    return { key: it.key }
  })
}

/** The strip at a boundary: its slot keys (the pinned, then the ranked rest in the room the run's own items leave of
 * four; with Claude's `strip`, the slots it names), and the run's own items it gave room to (`frame`), which keep it
 * until the next. `candidates` are the board, ranked, less what waits. */
export function stripSlots(r: HudRun, candidates: Placed[]): { slots: string[]; frame: string[] } {
  const widgets = new Set((r.widgets ?? []).map(widgetKey))
  const built = stripItems(r, candidates.filter(p => !widgets.has(p.key)).map(p => p.slot))
  const { chosen, ranked } = choose(r, built, { strip: candidates.map(p => p.key), why: Object.fromEntries(candidates.map(p => [p.key, p.why])) })
  return { slots: chosen.flatMap(it => (ranked.has(it) && it.slot ? [it.slot] : [])), frame: chosen.filter(it => !ranked.has(it)).map(it => it.key) }
}

type Built = ReturnType<typeof stripItems>
const isItem = (x: StripItem | undefined): x is StripItem => x !== undefined

// Every item the strip could draw for the run and the slots given; `defs` collects the gradients they ask for.
function stripItems(r: HudRun, slots: HudHeld[], urgent?: { slot: HudHeld; says: string }) {
  const accent = hue(r.accent, ACCENT) ?? ACCENT
  const defs = new Map<string, string>()
  const grad: Ctx['grad'] = (color, dir) => {
    if (!color.startsWith('#') || dir !== 'a') return color
    const id = `s${dir}${color.slice(1)}`
    if (!defs.has(id)) defs.set(id, dir === 'a'
      ? `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".12"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`
      : `<linearGradient id="${id}" x1="0" y1="0" x2="${dir === 'h' ? 1 : 0}" y2="${dir === 'v' ? 1 : 0}"><stop offset="0" stop-color="${shade(color, 0.3)}"/><stop offset="1" stop-color="${color}"/></linearGradient>`)
    return `url(#${id})`
  }
  const c: Ctx = { id: 'st', accent, grad, tone: t => (t ? (t === 'accent' ? accent : TONE[t]) : accent) }
  const caps = (x: number, y: number, text: string, w: number, anchor = 'start') =>
    `<text x="${f1(x)}" y="${y}" font-size="11" font-weight="500" text-anchor="${anchor}" class="m">${esc(fit(sentence(text), w, 11))}</text>`
  const big = (x: number, y: number, text: string, size: number, anchor = 'start') =>
    `<text x="${f1(x)}" y="${y}" font-size="${size}" font-weight="750" letter-spacing="-.02em" text-anchor="${anchor}" class="t num disp">${esc(text)}</text>`
  const ring = (cx: number, cy: number, rr: number, f: number, col: string, sw: number) => {
    const C = 2 * Math.PI * rr, dash = `${f1(C * f)} ${f1(C)}`
    return `<circle cx="${f1(cx)}" cy="${cy}" r="${rr}" stroke="var(--track)" stroke-width="${sw}" fill="none"/>
      <circle cx="${f1(cx)}" cy="${cy}" r="${rr}" stroke="${grad(col, 'v')}" stroke-width="${sw}" fill="none" stroke-linecap="round" transform="rotate(-90 ${f1(cx)} ${cy})" stroke-dasharray="${dash}"/>`
  }
  const spark = (pts: number[], x: number, y: number, w: number, h: number, col: string, area: boolean) => {
    const tail = pts.slice(-60), lo = Math.min(...tail), hi = Math.max(...tail)
    const xy = tail.map((v, i) => [x + (i / Math.max(1, tail.length - 1)) * w, y + h - (hi === lo ? h / 2 : ((v - lo) / (hi - lo)) * h)] as const)
    const d = smooth(xy, y, y + h), [lx, ly] = xy[xy.length - 1]!
    return `${area ? `<path d="${d}L${f1(lx)} ${y + h}L${f1(xy[0]![0])} ${y + h}Z" fill="${grad(col, 'a')}"/>` : ''}
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${f1(lx)}" cy="${f1(ly)}" r="5" fill="${col}" opacity=".2"/><circle cx="${f1(lx)}" cy="${f1(ly)}" r="2.6" fill="${col}"/>`
  }
  const pillW = (t: string) => measure(t, 11, CAP) + 14
  const pill = (x: number, y: number, t: string, col: string, text: string) =>
    `<rect x="${f1(x)}" y="${y}" width="${f1(pillW(t))}" height="17" rx="8.5" fill="${col}" opacity=".16"/><text x="${f1(x + pillW(t) / 2)}" y="${y + 12.5}" font-size="11" font-weight="650" text-anchor="middle" fill="${text}">${esc(t)}</text>`
  const P = 14 // card padding

  const items: StripItem[] = []
  // the sources' slots as widgets keyed <plugin>/<id>, each less important than any of Claude's items, in order
  const fromSlots = slots.filter(sl => STRIP.includes(sl.pattern) && sl !== urgent?.slot).map((sl, i) => ({ w: asWidget(sl), pri: 2 - i / 10 }))
  // a widget or tile that hasn't changed in a while is drawn dim, and the default pick takes it last
  const dim = (clock: { tick?: number } | undefined) => clock !== undefined && life(clock, r) !== 'fresh'
  const doneOf = (states: (HudState | undefined)[]) => states.filter(s => s === 'done' || s === 'hit').length

  // progress: ring alone → ring + headline → + segment track and what is left
  if (r.progress) {
    const { total, label = 'progress' } = r.progress, n = Math.min(total, Math.max(0, r.progress.n)), f = n / total // (clamped: a run from before)
    const col = r.status === 'failed' ? TONE.bad : r.status === 'done' ? TONE.good : accent
    const share = `${pct(f)}%`, sub = `${fmt(n)} of ${fmt(total)}`, left = total - n > 0 ? `${fmt(total - n)} left` : 'complete'
    const textW = Math.max(measure(share, 24, CAP), measure(sub, 11), measure(sentence(label), CAPS))
    const ringOnly = (x: number) => `${ring(x + 38, Y0 + 36, 22, f, col, 6)}${big(x + 38, Y0 + 41, share, 13, 'middle')}<text x="${f1(x + 38)}" y="${Y0 + 72}" font-size="11" text-anchor="middle" class="m num">${esc(`${fmt(n)}/${fmt(total)}`)}</text>`
    const headline = (x: number) => `${ring(x + P + 22, Y0 + 40, 22, f, col, 6)}
      ${caps(x + P + 56, Y0 + 22, label, textW + 4)}${big(x + P + 56, Y0 + 47, share, 24)}
      <text x="${f1(x + P + 56)}" y="${Y0 + 64}" font-size="11" class="m num">${esc(sub)}</text>`
    const mw = P + 56 + textW + P
    items.push({
      key: 'progress', priority: 10, tone: col, variants: [
        { w: 76, h: 74, draw: ringOnly },
        { w: mw, h: 66, draw: headline },
        {
          w: mw + 132, h: 66, draw: x => {
            const tx = x + mw - 4, tw = 118, segs = total <= 24 ? total : 0
            const track = segs
              ? Array.from({ length: segs }, (_, i) => { const sw = (tw - (segs - 1) * 2) / segs; return `<rect x="${f1(tx + i * (sw + 2))}" y="${Y0 + 38}" width="${f1(sw)}" height="8" rx="${Math.min(4, sw / 2).toFixed(1)}" fill="${i < n ? grad(col, 'h') : 'var(--track)'}"/>` }).join('')
              : `<rect x="${f1(tx)}" y="${Y0 + 38}" width="${tw}" height="8" rx="4" fill="var(--track)"/><rect x="${f1(tx)}" y="${Y0 + 38}" width="${f1(Math.max(8, tw * f))}" height="8" rx="4" fill="${grad(col, 'h')}"/>`
            return `${headline(x)}${track}<text x="${f1(tx + tw)}" y="${Y0 + 64}" font-size="11" font-weight="600" text-anchor="end" class="m num">${esc(left)}</text>`
          },
        },
      ],
    })
  }

  // phases: where we are → the chain with the current one named → every step named
  if (r.phases.length > 1) {
    const ph = r.phases, n = ph.length
    const cur = ph.find(p => p.state === 'now') ?? ph.find(p => p.state === 'failed') ?? ph[ph.length - 1]!
    const at = ph.indexOf(cur) // simplification: all done reads "4 / 4", a failed step reads its own number
    const done = doneOf(ph.map(p => p.state)), step = `${Math.min(n, at + 1)} / ${n}`
    const curW = measure(cur.name, 15, CAP), curMin = Math.min(curW, 150)
    const dots = (x: number, y: number, gap: number) => ph.map((p, i) => dot(p.state, x + i * gap + 3, y, c)).join('')
    const labelled = ph.map(p => Math.max(measure(p.name, 11, { bold: p.state === 'now' }) + 14, 44))
    items.push({
      key: 'phases', priority: 8, tone: cur.state === 'failed' ? TONE.bad : accent, variants: [
        {
          w: P * 2 + Math.max(curMin, n * 12 + 8, measure(`Phase ${step}`, CAPS)), h: 66, draw: (x, w) =>
            `${caps(x + P, Y0 + 22, `phase ${step}`, 200)}<text x="${f1(x + P)}" y="${Y0 + 46}" font-size="15" font-weight="700" class="t">${esc(fit(cur.name, w - P * 2, 15, CAP))}</text>${dots(x + P, Y0 + 62, 12)}`,
        },
        {
          w: P * 2 + Math.max(curMin + 70, n * 30), h: 66, flex: true, draw: (x, w) => {
            const gap = (w - P * 2 - 12) / Math.max(1, n - 1)
            return `${caps(x + P, Y0 + 22, `phase ${step}`, 120)}<text x="${f1(x + w - P)}" y="${Y0 + 22}" font-size="11" font-weight="600" text-anchor="end" class="m num">${done} done</text>
              <text x="${f1(x + P)}" y="${Y0 + 44}" font-size="15" font-weight="700" class="t">${esc(fit(cur.name, w - P * 2, 15, CAP))}</text>
              <line x1="${f1(x + P + 3)}" x2="${f1(x + P + 3 + (n - 1) * gap)}" y1="${Y0 + 62}" y2="${Y0 + 62}" stroke="var(--track)" stroke-width="2"/>${dots(x + P, Y0 + 62, gap)}`
          },
        },
        {
          w: P * 2 + labelled.reduce((a, b) => a + b, 0), h: 74, flex: true, draw: (x, w) => {
            const gap = (w - P * 2) / n, cx = (i: number) => x + P + gap * (i + 0.5)
            return `${caps(x + P, Y0 + 22, `phase ${step}`, 120)}<text x="${f1(x + w - P)}" y="${Y0 + 22}" font-size="11" font-weight="600" text-anchor="end" class="m num">${done} done</text>
              <line x1="${f1(cx(0))}" x2="${f1(cx(n - 1))}" y1="${Y0 + 44}" y2="${Y0 + 44}" stroke="var(--track)" stroke-width="3" stroke-linecap="round"/>
              ${ph.map((p, i) => (i < n - 1 && p.state === 'done' ? `<line x1="${f1(cx(i))}" x2="${f1(cx(i + 1))}" y1="${Y0 + 44}" y2="${Y0 + 44}" stroke="${TONE.good}" stroke-width="3" stroke-linecap="round"/>` : '')).join('')}
              ${ph.map((p, i) => `${icon(p.state, cx(i), Y0 + 44, 8, c)}<text x="${f1(cx(i))}" y="${Y0 + 68}" font-size="11" text-anchor="middle" font-weight="${p.state === 'now' ? 700 : 400}" class="${p.state === 'todo' ? 'm' : 't'}">${esc(fit(p.name, gap - 4, 11, { bold: p.state === 'now' }))}</text>`).join('')}`
          },
        },
      ],
    })
  }

  // stats: number → number with its change → + its own sparkline
  const stats = [
    ...r.widgets.filter(w => w.type === 'stat').map(w => ({ key: own(w.id), k: w.title ?? w.id, v: fmt(w.value), unit: w.unit, col: w.tone ? c.tone(w.tone) : accent, d: w.delta, better: w.better, pts: w.points, pri: 7, dim: dim(w), of: widgetKey(w) })),
    ...Object.entries(r.tiles).map(([k, v]) => ({ key: own(k), k, v: fmt(v), unit: undefined, col: accent, d: undefined, pts: undefined, pri: 6, dim: dim(r.tileClock?.[k]) })),
    ...(r.errors ? [{ key: 'errors', k: 'errors', v: fmt(r.errors), unit: undefined, col: TONE.bad, d: undefined, pts: undefined, pri: r.errors > r.calls * 0.05 ? 9 : 5, sub: `of ${fmt(r.calls)} calls` }] : []),
    { key: 'calls', k: 'tool calls', v: fmt(r.calls), unit: undefined, col: TONE.info, d: undefined, pts: undefined, pri: 3 },
    ...fromSlots.filter(x => x.w.type === 'stat').map(({ w, pri }) => ({ key: w.id, k: w.title ?? w.id, v: fmt(w.value), unit: w.unit, col: w.tone ? c.tone(w.tone) : accent, d: w.delta, better: w.better, pts: w.points, pri, slot: true, of: w.id })),
  ] as { key: string; k: string; v: string; unit?: string; col: string; d?: number; better?: 'up' | 'down'; pts?: number[]; pri: number; sub?: string; slot?: true; dim?: boolean; of?: string }[]
  for (const s of stats) {
    const delta = s.d !== undefined ? `${s.d >= 0 ? '▲' : '▼'} ${fmt(Math.abs(s.d))}` : undefined
    const ch = s.d === undefined ? undefined : changeOf(s.d, s.better), dCol = ch?.mark ?? s.col, dText = ch?.text ?? s.col
    const value = (x: number, size: number) => `<text x="${f1(x + P)}" y="${Y0 + 52}" font-size="${size}" font-weight="750" class="t num disp">${esc(s.v)}${s.unit ? `<tspan font-size="${size * 0.5}" font-weight="500" class="m" letter-spacing="0">${unitSpace(s.unit)}${esc(s.unit)}</tspan>` : ''}</text>`
    const valW = (size: number) => measure(s.v, size, CAP) + (s.unit ? measure(unitSpace(s.unit) + s.unit, size * 0.5) : 0)
    const head = (x: number, w: number) => `<circle cx="${f1(x + P + 3)}" cy="${Y0 + 19}" r="3" fill="${s.col}"/>${caps(x + P + 11, Y0 + 22, s.k, w - P * 2 - 11)}`
    const sw = Math.max(valW(22), measure(sentence(s.k), CAPS) + 11, s.sub ? measure(s.sub, 11) : 0) + P * 2 + 8 // +8: a label never ends flush on its edge
    // under the figure: its change, or what it is out of (failed calls of all calls)
    const under = (x: number) => delta ? `<text x="${f1(x + P)}" y="${Y0 + 68}" font-size="11" font-weight="650" fill="${dText}">${esc(delta)}</text>`
      : s.sub ? `<text x="${f1(x + P)}" y="${Y0 + 68}" font-size="11" class="m num">${esc(s.sub)}</text>` : ''
    const variants: StripVariant[] = [{ w: Math.max(72, sw), h: delta || s.sub ? 70 : 54, draw: (x, w) => head(x, w) + value(x, 22) + under(x) }]
    if (delta) variants.push({ w: Math.max(sw, valW(26) + pillW(delta) + 8 + P * 2), h: 56, draw: (x, w) => head(x, w) + value(x, 26) + pill(x + P + valW(26) + 8, Y0 + 37, delta, dCol, dText) })
    if ((s.pts?.length ?? 0) > 1) {
      const base = variants[variants.length - 1]!
      variants.push({ w: base.w + 104, h: Math.max(base.h, 64), draw: (x, w) => base.draw(x, w - 104) + spark(s.pts!, x + w - 104 - 4, Y0 + 28, 90, 34, s.col, true) })
    }
    items.push({ key: s.key, priority: s.pri, tone: s.col, variants, dim: s.dim, slot: s.of })
  }

  // gauge-like widgets: value with a small arc → a fuller gauge with its range
  const gaugeish = (w: HudWidget) => w.type === 'gauge' || w.type === 'ring' || w.type === 'meter'
  for (const { w: g, key, pri, of } of [...r.widgets.filter(gaugeish).map(w => ({ w, key: own(w.id), pri: 5, of: widgetKey(w) })), ...fromSlots.filter(x => gaugeish(x.w)).map(x => ({ ...x, key: x.w.id, of: x.w.id }))]) {
    const f = frac(g), col = c.tone(g.tone), name = g.title ?? g.id
    const vText = withUnit(fmt(g.value), g.unit)
    items.push({
      key, priority: pri, tone: col, dim: dim(g), slot: of, variants: [
        {
          w: Math.max(96, measure(vText, 14, CAP) + P * 2, measure(sentence(name), CAPS) + P * 2), h: 64, flex: true, draw: (x, w) =>
            `${caps(x + w / 2, Y0 + 22, name, w - P * 2, 'middle')}<path d="${arc(x + w / 2, Y0 + 62, 26, -90, 90)}" stroke="var(--track)" stroke-width="6" fill="none" stroke-linecap="round"/>
            <path d="${arc(x + w / 2, Y0 + 62, 26, -90, -90 + 180 * Math.max(f, 0.001))}" stroke="${grad(col, 'h')}" stroke-width="6" fill="none" stroke-linecap="round"/>${big(x + w / 2, Y0 + 60, vText, 14, 'middle')}`,
        },
        {
          w: Math.max(150, measure(vText, 22, CAP) + 110, measure(sentence(name), CAPS) + P * 2 + 88), h: 72, draw: (x, w) =>
            `<path d="${arc(x + P + 34, Y0 + 58, 30, -90, 90)}" stroke="var(--track)" stroke-width="7" fill="none" stroke-linecap="round"/>
            <path d="${arc(x + P + 34, Y0 + 58, 30, -90, -90 + 180 * Math.max(f, 0.001))}" stroke="${grad(col, 'h')}" stroke-width="7" fill="none" stroke-linecap="round"/>
            <text x="${f1(x + P + 34)}" y="${Y0 + 58}" font-size="11" font-weight="700" text-anchor="middle" class="t num">${pct(f)}%</text>
            ${caps(x + P + 80, Y0 + 26, name, w - P * 2 - 80)}${big(x + P + 80, Y0 + 52, of100(g) ? vText : fmt(g.value), 22)}
            ${of100(g) ? '' : `<text x="${f1(x + P + 80)}" y="${Y0 + 68}" font-size="11" class="m num">${esc(g.unit === '%' ? `of ${fmt(g.max ?? 100)}%` : `${g.unit ?? ''} of ${fmt(g.max ?? 100)}`.trim())}</text>`}`,
        },
      ],
    })
  }

  // checklists: count and the step in hand → + a tick row
  const listed = (w: HudWidget) => w.type === 'checklist' && (w.items?.length ?? 0) > 0 && !hiddenMirror(r, w)
  for (const { w: cl, key, pri, of } of [...r.widgets.filter(listed).map(w => ({ w, key: own(w.id), pri: 6, of: widgetKey(w) })), ...fromSlots.filter(x => listed(x.w)).map(x => ({ ...x, key: x.w.id, of: x.w.id }))]) {
    const its = cl.items!, done = doneOf(its.map(i => i.state)), cur = its.find(i => i.state === 'now') ?? its.find(i => i.state !== 'done') ?? its[its.length - 1]!
    const name = cl === leadList(r) ? planLabel(r, cl) : cl.title ?? cl.id, count = `${done} of ${its.length}`, curW = Math.min(240, measure(cur.label, 12.5, CAP))
    const headW = Math.max(curW, measure(`${sentence(name)}  ${count}`, CAPS)) + P * 2 + 18
    const body = (x: number, w: number) => `${caps(x + P, Y0 + 22, name, w - P * 2 - measure(count, 11, CAP) - 8)}<text x="${f1(x + w - P)}" y="${Y0 + 22}" font-size="11" font-weight="650" text-anchor="end" class="m num">${count}</text>
      ${icon(cur.state ?? 'todo', x + P + 6, Y0 + 41, 6, c)}<text x="${f1(x + P + 18)}" y="${Y0 + 45}" font-size="12.5" font-weight="600" class="t">${esc(fit(cur.label, w - P * 2 - 18, 12.5, CAP))}</text>`
    items.push({
      key, priority: pri, tone: TONE.good, dim: dim(cl), slot: of, variants: [
        { w: headW, h: 66, flex: true, draw: (x, w) => body(x, w) + `<rect x="${f1(x + P)}" y="${Y0 + 60}" width="${f1(w - P * 2)}" height="5" rx="2.5" fill="var(--track)"/><rect x="${f1(x + P)}" y="${Y0 + 60}" width="${f1(Math.max(5, (w - P * 2) * (done / its.length)))}" height="5" rx="2.5" fill="${grad(TONE.good, 'h')}"/>` },
        {
          // the ticks on a track, as the phase chain: green behind each one done
          w: Math.max(headW, its.length * 18 + P * 2), h: 70, flex: true, draw: (x, w) => {
            const gap = (w - P * 2) / its.length, cx = (i: number) => x + P + gap * (i + 0.5)
            const isDone = (it: HudItem) => it.state === 'done' || it.state === 'hit'
            return body(x, w) + `<line x1="${f1(cx(0))}" x2="${f1(cx(its.length - 1))}" y1="${Y0 + 64}" y2="${Y0 + 64}" stroke="var(--track)" stroke-width="2"/>` +
              its.map((it, i) => (i < its.length - 1 && isDone(it) ? `<line x1="${f1(cx(i))}" x2="${f1(cx(i + 1))}" y1="${Y0 + 64}" y2="${Y0 + 64}" stroke="${TONE.good}" stroke-width="2"/>` : '')).join('') +
              its.map((it, i) => icon(it.state ?? 'todo', cx(i), Y0 + 64, 5.5, c)).join('')
          },
        },
      ],
    })
  }

  // trend: last value with a whisker → a proper sparkline → + its range
  // the change reads good or bad by the line's better (a training loss falling is good), else neutral
  const trend = (key: string, name: string, pts: number[], col: string, better: 'up' | 'down' | undefined, priority: number, old = false, slot?: string) => {
    const chFill = (d: number) => changeOf(d, better).text
    const last = pts[pts.length - 1]!, prev = pts[pts.length - 2]!
    const ch = prev !== 0 ? ((last - prev) / Math.abs(prev)) * 100 : undefined
    const chText = ch !== undefined && Number.isFinite(ch) ? `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(1)}%` : ''
    const lo = Math.min(...pts.slice(-60)), hi = Math.max(...pts.slice(-60))
    const head = (x: number, w: number) => `${caps(x + P, Y0 + 22, name, w - P * 2 - 50)}${big(x + w - P, Y0 + 23, fmt(last), 13, 'end')}`
    items.push({
      key, priority, tone: col, dim: old, slot, variants: [
        { w: 128, h: 66, flex: true, draw: (x, w) => head(x, w) + spark(pts, x + P, Y0 + 34, w - P * 2, 30, col, false) },
        { w: 210, h: chText ? 78 : 68, flex: true, draw: (x, w) => head(x, w) + spark(pts, x + P, Y0 + 32, w - P * 2, 34, col, true) + (chText ? `<text x="${f1(x + P)}" y="${Y0 + 76}" font-size="11" font-weight="650" fill="${chFill(ch!)}">${chText}</text>` : '') },
        { w: 300, h: chText ? 78 : 68, flex: true, draw: (x, w) => head(x, w) + spark(pts, x + P, Y0 + 32, w - P * 2 - 44, 34, col, true) + `<text x="${f1(x + w - P)}" y="${Y0 + 40}" font-size="11" text-anchor="end" class="m num">${esc(fmt(hi))}</text><text x="${f1(x + w - P)}" y="${Y0 + 66}" font-size="11" text-anchor="end" class="m num">${esc(fmt(lo))}</text>` + (chText ? `<text x="${f1(x + P)}" y="${Y0 + 76}" font-size="11" font-weight="650" fill="${chFill(ch!)}">${chText}</text>` : '') },
      ],
    })
  }
  const lineW = r.widgets.find(w => w.type === 'line' && (w.points?.length ?? 0) > 1)
  if (r.points.length > 1) trend('trend', 'trend', r.points, accent, undefined, 6)
  else if (lineW) trend('trend', lineW.title ?? lineW.id, lineW.points!, lineW.tone ? c.tone(lineW.tone) : accent, lineW.better, 6, dim(lineW), widgetKey(lineW))
  for (const { w, pri } of fromSlots) if (w.type === 'line' && (w.points?.length ?? 0) > 1) trend(w.id, w.title ?? w.id, w.points!, c.tone(w.tone), w.better, pri, false, w.id)

  // the urgency place: one slot the HUD's own rules raised, said in a sentence, in front of everything
  if (urgent) {
    const col = c.tone(urgent.slot.tone), says = plain(urgent.says)
    const lines = (w: number) => wrapPx(says, w - P * 2, 12.5, 2, CAP)
    items.push({
      key: 'urgent', priority: 1000, tone: col, variants: [{
        w: Math.min(260, Math.max(160, measure(says, 12.5, CAP) + P * 2 + 4)), h: 66, draw: (x, w) =>
          `<path d="M${f1(x + P + 5)} ${Y0 + 12}l5.5 10h-11z" fill="${col}"/><path d="M${f1(x + P + 5)} ${Y0 + 15.5}v3.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="${f1(x + P + 5)}" cy="${Y0 + 20.4}" r=".9" fill="#fff"/>` +
          caps(x + P + 16, Y0 + 22, 'urgent', w - P * 2 - 16) +
          lines(w).map((l, j) => `<text x="${f1(x + P)}" y="${Y0 + 44 + j * 17}" font-size="12.5" font-weight="600" class="t">${esc(l)}</text>`).join(''),
      }],
    })
  }

  return { items, stats, fromSlots, defs }
}

// What the strip shows, before the fit: what the run named (earlier = more important), else the run's own items with
// the slots after them, four at most. `ranked`: the chosen that stand for the arrangement's slots, not the run's frame.
function choose(r: HudRun, { items, stats, fromSlots }: Built, arranged?: Arranged): { chosen: StripItem[]; ranked: Set<StripItem> } {
  const byKey = (k: string) => items.find(it => it.key === k)
  const ranked = new Set<StripItem>()
  // the run's own: progress, errors, the figures that fill what is left, and where the work is (phases, else the
  // checklist that stands in for them, else the trend), which always makes the four. Claude's widgets are figures here
  // only with no arrangement: with one, they are slots, and ranked.
  // (fresh before dim: one that hasn't changed in a while shows only when nothing fresh takes its place)
  const frame = (others: number) => {
    const plan = leadList(r), places = [plan && byKey(own(plan.id)), byKey('trend')].filter(isItem)
    const place = byKey('phases') ?? places.find(x => !x.dim) ?? places[0]
    const room = 4 - [r.progress, r.errors, place].filter(Boolean).length
    const statPick = stats.filter(s => s.key !== 'calls' && s.key !== 'errors' && !s.slot && !(arranged && s.of))
      .sort((a, b) => Number(!!a.dim) - Number(!!b.dim) || b.pri - a.pri).slice(0, Math.max(0, Math.min(2, room))).map(s => s.key)
    return [byKey('progress'), byKey('errors'), ...statPick.map(byKey), place,
      // the call count, beside a plan with no figures; the errors item already says "of N calls"
      ...(statPick.length || r.progress || r.phases.length || r.errors || others ? [] : [byKey('calls')])]
      .filter(isItem).slice(0, 4)
  }
  let chosen: StripItem[]
  if (arranged) {
    // what the person pinned leads; then what the run named, or its own items and the ranked rest, in order
    const bySlot = (k: string) => items.find(it => it.slot === k)
    const pinned = (k: string) => arranged.why[k] === PINNED
    const pins = arranged.strip.filter(pinned).map(bySlot).filter(isItem)
    pins.forEach((it, i) => (it.priority = 50 - i, ranked.add(it)))
    if (r.strip?.length) {
      const named = r.strip.map(byKey).filter(isItem).filter(it => !it.slot || arranged.strip.includes(it.slot))
      chosen = [...new Set([...pins, ...named])]
      chosen.forEach((it, i) => { it.priority = 100 - i; if (it.slot) ranked.add(it) })
    } else {
      const rest = arranged.strip.filter(k => !pinned(k)).map(bySlot).filter(isItem)
      // Between boundaries the run's own items keep the room the boundary gave them, their values as they are now; one
      // that came since (a first failed call, a new tile) takes only room still free, so no slot is pushed out. The next
      // boundary makes room for it.
      const given = arranged.frame, taken = pins.length + rest.length
      const kept = given?.map(byKey).filter(isItem).filter(it => !pins.includes(it) && !rest.includes(it)) ?? []
      const fresh = frame(taken).filter(it => !pins.includes(it) && !kept.includes(it))
      const mine = given ? [...kept, ...fresh.slice(0, Math.max(0, 4 - taken - kept.length))] : fresh
      const tail = rest.filter(it => !pins.includes(it) && !mine.includes(it))
      tail.forEach((it, i) => (it.priority = 2 - i / 10, ranked.add(it)))
      chosen = [...pins, ...mine, ...tail].slice(0, Math.max(4, pins.length))
      if (chosen.length === 1 && chosen[0]!.key === 'calls') chosen = []
    }
  } else if (r.strip?.length) {
    chosen = r.strip.map(byKey).filter(isItem)
    chosen.forEach((it, i) => (it.priority = 100 - i))
  } else {
    // the sources' slots fill what Claude's own leave of the four, in order
    chosen = [...frame(fromSlots.length), ...fromSlots.map(x => byKey(x.w.id)).filter(isItem)].slice(0, 4)
    if (chosen.length === 1 && chosen[0]!.key === 'calls') chosen = []
  }
  return { chosen, ranked }
}

function fitStrip(chosen: StripItem[], width: number, defs: Map<string, string>): { source: string; height: number; width: number; shown: string[] } {
  // fit: smallest sizes first; drop the least important while they overflow; then grow by priority per size
  const level = new Map<StripItem, number>(chosen.map(it => [it, 0]))
  const total = () => [...level].reduce((sum, [it, l]) => sum + it.variants[l]!.w, 0)
  while (level.size && total() > width) {
    const weakest = [...level.keys()].sort((a, b) => a.priority - b.priority)[0]!
    level.delete(weakest)
  }
  for (;;) {
    const growable = [...level].filter(([it, l]) => l < it.variants.length - 1)
      .map(([it, l]) => ({ it, l, grow: it.variants[l + 1]!.w - it.variants[l]!.w }))
      .filter(g => total() + g.grow <= width)
      .sort((a, b) => b.it.priority / (b.l + 1) - a.it.priority / (a.l + 1))
    if (!growable.length) break
    level.set(growable[0]!.it, growable[0]!.l + 1)
  }

  // fill: the room left goes to what can use it (charts, chains, lists) in proportion to their size, each to
  // twice its own at most, so ticks and steps never drift apart; items sit packed from the left
  const kept = chosen.filter(it => level.has(it))
  const shown = kept.map(it => it.variants[level.get(it)!]!)
  const flexW = shown.filter(v => v.flex).reduce((n, v) => n + v.w, 0)
  const allW = shown.reduce((n, v) => n + v.w, 0)
  const room = Math.max(0, width - allW)
  const share = (v: StripVariant) => (v.flex ? Math.min(v.w, (room * v.w) / flexW) : 0)

  // height: as tall as the tallest thing shown; every item from the top, so labels and figures line up
  const inner = Math.max(40, ...shown.map(v => v.h))
  const H = Y0 + inner + 6

  let x = 0
  const body = shown.map((v, i) => {
    const slot = v.w + share(v), dy = 0
    const drawn = v.draw(x, slot)
    const sep = i ? `<line x1="${f1(x)}" x2="${f1(x)}" y1="${Y0 + 6}" y2="${H - 8}" stroke="var(--line)"/>` : ''
    x += slot
    return kept[i]!.dim ? `${sep}<g class="dim" transform="translate(0 ${f1(dy)})">${dimmed(drawn)}</g>` : `${sep}<g transform="translate(0 ${f1(dy)})">${drawn}</g>`
  }).join('')
  const W = Math.round(width)

  return {
    height: H,
    width: W,
    shown: kept.map(it => it.key), // so the header row above it leaves these out
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif">
  <style>
    svg{--fg:#141413;--muted:#6F6E69;--card:#FFFFFF;--line:#E8E6DC;--line2:#D1CFC5;--track:#EEECE4;${TOKENS.light}}
    @media (prefers-color-scheme: dark){svg{--fg:#F5F4EF;--muted:#A3A198;--card:#30302E;--line:#3E3E3A;--line2:#5A5954;--track:#3B3B38;${TOKENS.dark}}}
    .t{fill:var(--fg)} .m{fill:var(--muted)} .num{font-variant-numeric:lining-nums tabular-nums}
    .disp{font-family:'Copernicus','Tiempos Headline','Tiempos Text',ui-serif,Georgia,'Times New Roman',serif;font-weight:500;letter-spacing:-.01em;font-variant-numeric:lining-nums tabular-nums}
    ${DIM}
  </style>
  <defs>
    ${[...defs.values()].join('')}
  </defs>
  ${body}</svg>`,
  }
}
