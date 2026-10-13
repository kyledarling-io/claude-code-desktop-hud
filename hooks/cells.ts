// The terminal's drawing as the cells it takes: an approximate Yoga/Ink layout of a tree the kit draws (a Text is its
// characters, a Box a row or a column, a shrinking Text truncates where its width ends), so a test or `dev/cells.mjs` can
// read the band or the pane at any width and see what fits, where a line is cut, and what overflows. No `$`, no DOM;
// erasable types only, so `dev/cells.mjs` can import it as it is.
//
// The band's Text is strict (`wrapText` false): a Text that is too wide and does not truncate overflows, which is how a
// test sees a part that needed a width it was not given. The pane's Text wraps as Ink wraps it (`wrapText` true): at
// spaces, a word wider than the line broken hard, so a long line is several lines and none of it is cut.

export type Tree = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

// A character's columns: an East Asian wide or fullwidth character, and every pictograph (⏱, ⚠, ✔, ❤, ➡ and the emoji),
// is counted as 2 columns, the width some terminals give them; counting wide only cuts a column sooner. A mark that
// joins its letter and a variation selector take none. The HUD's own drawing counts by these too (render.ts's len(),
// text.ts's measure()).
// simplification: the main blocks of Unicode's East Asian wide ranges, not its whole table; a rarer wide character counts one
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f200, 0x1f251], [0x20000, 0x3fffd],
]
const ZERO: [number, number][] = [[0x300, 0x36f], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f]]
const PICTOGRAPH = /\p{Extended_Pictographic}/u
const within = (cp: number, ranges: [number, number][]) => ranges.some(([a, b]) => cp >= a && cp <= b)
/** The columns one character (a code point) takes: 0, 1 or 2. */
export const width = (ch: string) => {
  const cp = ch.codePointAt(0) ?? 0
  return cp < 0xa9 ? 1 : within(cp, ZERO) ? 0 : PICTOGRAPH.test(ch) || within(cp, WIDE) ? 2 : 1 // (© at 0xa9 is the first pictograph)
}
/** A text's width in terminal columns. */
export const len = (s: string) => {
  let n = 0
  for (const ch of s) n += width(ch)
  return n
}
/** The longest start of `s` that takes `w` columns or fewer. */
export const take = (s: string, w: number) => {
  let out = '', n = 0
  for (const ch of s) {
    if (n + width(ch) > w) break
    out += ch
    n += width(ch)
  }
  return out
}
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - len(s)))
type Part = unknown

/** The text of a tree: its strings joined, a Button as `[label]`. */
export const flat = (n: Part): string =>
  n === null || n === undefined || n === false ? ''
    : typeof n === 'string' || typeof n === 'number' ? String(n)
      : Array.isArray(n) ? n.map(flat).join('')
        : (n as Tree).type === 'Button' ? `[${String((n as Tree).props?.label ?? '')}]`
          : ((n as Tree).children ?? []).map(flat).join('')

const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const kids = (n: Tree): Part[] => (n.children ?? []).filter(c => c !== null && c !== false && c !== undefined && c !== '')
// a Box's own width beyond its content: its border and its padding, and the margin beside it
const chrome = (t: Tree) => (t.props?.borderStyle ? 2 : 0) + 2 * num(t.props?.paddingX)
const margin = (t: Tree) => num(t.props?.marginRight) + num(t.props?.marginLeft)

const intrinsic = (n: Part): number => {
  if (typeof n === 'string' || typeof n === 'number') return len(String(n))
  const t = n as Tree
  if (t.type === 'Text' || t.type === 'Button') return len(flat(t))
  const ks = kids(t)
  const inner = (t.props?.flexDirection ?? 'row') === 'column' ? Math.max(0, ...ks.map(intrinsic)) : ks.reduce((a: number, k) => a + intrinsic(k), 0)
  return inner + chrome(t) + margin(t)
}
const shrinkOf = (n: Part, wrapText: boolean): number => {
  if (typeof n === 'string') return 0
  const t = n as Tree
  if (typeof t.props?.flexShrink === 'number') return t.props.flexShrink
  if (t.type === 'Text') return t.props?.wrap === 'truncate-end' || wrapText ? 1 : 0
  if (t.type === 'Button') return 0
  return 1
}

/** `s` wrapped to `w` columns as Ink wraps: at spaces, a word wider than the line broken hard. */
const wrapped = (s: string, w: number): string[] => {
  if (w <= 0 || len(s) <= w) return [s] // as it is: Ink keeps a line's own spaces, leading ones too
  const out: string[] = []
  let line = ''
  for (const word of s.split(' ')) {
    let rest = word
    const room = () => w - len(line) - (line ? 1 : 0)
    if (len(word) <= room()) { line = line ? `${line} ${word}` : word; continue }
    if (line) (out.push(line), (line = ''))
    while (len(rest) > w) {
      const head = take(rest, w) || [...rest][0]! // (a wide character in one column: it goes alone)
      out.push(head)
      rest = rest.slice(head.length)
    }
    line = rest
  }
  if (line || !out.length) out.push(line)
  return out
}

/** The lines of `tree` in `cols` columns, and what overflowed: a Text that doesn't fit and neither truncates nor (with `wrapText`) wraps, or a row wider than its width. */
export function lay(tree: Part, cols: number, wrapText = false): { lines: string[]; overflow: string[] } {
  const overflow: string[] = []
  const cut = (s: string, w: number, trunc: boolean) => {
    if (len(s) <= w) return pad(s, w)
    if (trunc) return pad(take(s, Math.max(0, w - 1)) + '…', w)
    overflow.push(`${len(s)} > ${w}: ${s}`)
    return s
  }
  const text = (s: string, w: number, trunc: boolean): string[] =>
    trunc ? [cut(s, w, true)] : wrapText ? wrapped(s, w).map(l => pad(l, w)) : [cut(s, w, false)]
  const go = (n: Part, w: number): string[] => {
    if (typeof n === 'string' || typeof n === 'number') return text(String(n), w, false)
    const t = n as Tree
    if (t.type === 'Text') return text(flat(t), w, t.props?.wrap === 'truncate-end')
    if (t.type === 'Button') return [cut(flat(t), w, false)]
    // a Box inside its border and padding
    const inner = w - chrome(t), pad = (line: string) => `${t.props?.borderStyle ? '│' : ''}${' '.repeat(num(t.props?.paddingX))}${line}${' '.repeat(num(t.props?.paddingX))}${t.props?.borderStyle ? '│' : ''}`
    const wrap = (lines: string[]) => (chrome(t) ? lines.map(pad) : lines)
    const ks = kids(t)
    if ((t.props?.flexDirection ?? 'row') === 'column') return wrap(ks.flatMap(k => go(k, inner)))
    if (t.props?.flexWrap === 'wrap') {
      // children in rows of what fits, as a wrapping row lays them out
      const rows: Part[][] = [[]]
      let used = 0
      for (const k of ks) {
        const w1 = intrinsic(k)
        if (used + w1 > inner && rows.at(-1)!.length) (rows.push([]), (used = 0))
        rows.at(-1)!.push(k)
        used += w1
      }
      return wrap(rows.flatMap(row => go({ type: 'Box', props: { flexDirection: 'row' }, children: row }, inner)))
    }
    const basis = ks.map(intrinsic), total = basis.reduce((a, b) => a + b, 0)
    let widths = basis.slice()
    if (total > inner) {
      const over = total - inner
      const weights = ks.map((k, i) => shrinkOf(k, wrapText) * (basis[i] ?? 0)), sum = weights.reduce((a, b) => a + b, 0)
      if (sum > 0) widths = basis.map((b, i) => Math.max(0, b - Math.ceil((over * (weights[i] ?? 0)) / sum)))
      const after = widths.reduce((a, b) => a + b, 0)
      if (after > inner) overflow.push(`row ${after} > ${inner}: ${flat(t)}`)
    } else {
      const grow = ks.map(k => (typeof k === 'object' && k !== null ? num((k as Tree).props?.flexGrow) : 0)), g = grow.reduce((a, b) => a + b, 0)
      if (g > 0) widths = basis.map((b, i) => b + Math.floor(((inner - total) * (grow[i] ?? 0)) / g))
    }
    // a child's margin is room beside it, not part of the box it draws in
    const columns = ks.map((k, i) => go(k, Math.max(0, (widths[i] ?? 0) - (typeof k === 'object' && k !== null ? margin(k as Tree) : 0))))
    const h = Math.max(1, ...columns.map(c => c.length))
    return wrap(Array.from({ length: h }, (_, r) => columns.map((c, i) => (c[r] ?? ' '.repeat(Math.max(0, (widths[i] ?? 0) - (typeof ks[i] === 'object' && ks[i] !== null ? margin(ks[i] as Tree) : 0)))) + ' '.repeat(typeof ks[i] === 'object' && ks[i] !== null ? margin(ks[i] as Tree) : 0)).join('')))
  }
  return { lines: go(tree, cols), overflow }
}
