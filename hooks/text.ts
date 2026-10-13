// Text as the HUD draws it, with no DOM to measure: plain(), measure(), tidy() and fit(). Moved whole from svg.ts,
// which re-exports them. It imports only cells.ts's widths (which imports nothing), so lifecycle.ts (which titles a run
// from the prompt) reads it, and svg.ts reads both, without a cycle.
import { len, width } from './cells'

// Claude writes markdown out of habit, and the HUD draws plain text: paired inline marks go
// (`code`, **bold**, [text](url)), so no backtick or asterisk shows. Lone marks stay (a ** b, `x).
export const plain = (s: string) =>
  s.replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1').replace(/`([^`\n]+)`/g, '$1').replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, '$1')

// SVG text never wraps, and the module has no DOM to measure with: estimate widths per glyph class
// (system-ui / Segoe UI proportions), then fit or wrap to pixels. simplification: a table, not font metrics; ±5% in practice.
// A character counted as two columns (East Asian wide, a pictograph: cells.ts) is an em, and monospace counts columns.
const NARROW = new Set("ijl.,:;|!'`·"), SEMI = new Set('frtI()[]{} -/"*'), WIDE = new Set('mwMW@%&')
export const measure = (s: string, size: number, opts: { mono?: boolean; bold?: boolean } = {}) => {
  if (opts.mono) return len(s) * size * 0.6
  let em = 0
  for (const ch of s) {
    em += NARROW.has(ch) ? 0.26 : SEMI.has(ch) ? 0.36 : WIDE.has(ch) ? 0.84
      : ch >= 'A' && ch <= 'Z' ? 0.64 : ch >= '0' && ch <= '9' ? 0.56 : width(ch) === 2 ? 1 : ch.charCodeAt(0) > 0x2000 ? 0.9 : 0.53
  }
  return em * size * (opts.bold ? 1.07 : 1) * 1.06 // simplification: +6% so real glyphs never outgrow the estimate
}
// Raw output carries terminal colour codes, control characters and runs of spaces: none of them draw.
export const tidy = (s: string) => plain(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()

// What a token says least of goes first when a line is long: a hash keeps its first 7, a URL its host and its last
// part, a path its last two parts and then its file name.
const UUID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi
const HEX = /\b(?=[0-9]*[a-f])[0-9a-f]{12,}\b/gi
const shortUrl = (u: string) => {
  try {
    const { host, pathname } = new URL(u)
    const parts = pathname.split('/').filter(Boolean)
    return parts.length ? `${host}/${parts.length > 1 ? '…/' : ''}${parts.at(-1)}` : host
  } catch { return u }
}
// A path is a token with two separators or more and a letter (so 2026/10/11 is a date, not a path). One that starts
// with a host is a URL already shortened, which keeps its host.
const HOST = /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}$/i
const shortPaths = (s: string, keep: number) => s.replace(/\S+/g, tok => {
  const [, lead = '', core = '', tail = ''] = /^([('"`]*)(.*?)([)'"`,.;:]*)$/.exec(tok) ?? []
  const parts = core.split(/[\\/]/)
  if (parts.length < 3 || !/[A-Za-z]/.test(core) || /^https?:/.test(core) || HOST.test(parts[0] ?? '')) return tok
  const short = `…/${parts.filter(Boolean).slice(-keep).join('/')}`
  return short.length < core.length ? lead + short + tail : tok
})
const SHORTER: ((s: string) => string)[] = [
  s => s.replace(UUID, m => m.slice(0, 8)).replace(HEX, m => m.slice(0, 7)),
  s => s.replace(/https?:\/\/[^\s'"()<>]+/g, shortUrl),
  s => shortPaths(s, 2),
  s => shortPaths(s, 1),
]

/**
 * One line of `px`. Text that doesn't fit first loses what says least (hashes, the middles of URLs and paths), then
 * is cut where a reader can tell it was cut: at a clause's end, else a word's, with "…". A cut lands mid-word only
 * when one word is wider than the room. The whole text stays in the dashboard and /hud.
 */
export const fit = (raw: string, px: number, size: number, opts: { mono?: boolean; bold?: boolean } = {}) => {
  // No glyph is narrower than 0.26em (a joining mark aside, which only cuts a run of them sooner), so no more code points
  // than `most` can fit: a text longer than that is not measured whole, and the cut below never tries one longer (2,000
  // characters cost what 200 do, on every redraw)
  const most = Math.ceil(px / (0.26 * size)) + 1
  const fits = (t: string) => t.length <= 2 * most && measure(t, size, opts) <= px
  let s = tidy(raw) // measured as drawn
  for (const shorter of SHORTER) {
    if (fits(s)) return s
    s = shorter(s)
  }
  if (fits(s)) return s
  if (s.length > most) s = [...s].slice(0, most).join('')
  // the longest cut that fits, as a scan down from the whole would find it (widths only add up)
  let n = 1
  for (let hi = s.length; n < hi;) {
    const mid = Math.ceil((n + hi) / 2)
    if (measure(s.slice(0, mid) + '…', size, opts) <= px) n = mid
    else hi = mid - 1
  }
  const hard = s.slice(0, n).replace(/[\ud800-\udbff]$/, '') // never half an emoji: the cut counts UTF-16 units
  // simplification: each softer cut must keep 60% of the one before, so a narrow label never shrinks to a word or two
  const keeps = (t: string | undefined, of: string) => (t && t.length >= of.length * 0.6 ? t : undefined)
  const atWord = keeps(s[n] === ' ' ? hard : hard.replace(/\s+\S*$/, ''), hard) ?? hard
  // A sentence's end, else a comma outside brackets. Never just after a colon: it promises what the cut hides.
  const comma = /^(.*,)\s/.exec(atWord + ' ')?.[1]
  const best = keeps(/^(.*[.;!?—])\s/.exec(atWord + ' ')?.[1], atWord)
    ?? keeps(comma && (comma.match(/\(/g) ?? []).length <= (comma.match(/\)/g) ?? []).length ? comma : undefined, atWord)
    ?? atWord
  // and not on a little word ("tested on a…")
  const ends = best.replace(/[\s,;:.—+&-]+$/, '').replace(/(\s+(a|an|the|of|to|and|or|on|in|at|by|for|with|from|as|is))+$/i, '')
  // and never right after a number: "v2…" reads as 2 and "18,2…" as 18, so the number that ends it goes whole, the word with it
  return (ends || best).replace(/\S*\d$/, '').replace(/[\s,;:.—+&-]+$/, '') + '…'
}
