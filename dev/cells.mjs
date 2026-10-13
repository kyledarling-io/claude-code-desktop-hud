// The trial's terminal views as text lines at their widths, to read the band and the pane where the HTML cannot say what
// fits: an approximate Yoga/Ink layout (hooks/cells.ts: a Text is its characters, a Box a row or a column, a shrinking Text
// truncates where its width ends). Node 22.18 or later runs the TypeScript module as it is (and warns once that it has no
// module type; harmless).
//
//   node dev/trial.mjs                                  writes dev/out/trial.html and dev/out/trial.json
//   node dev/cells.mjs dev/out/trial.json band [scene]  the terminal bands at 60, 105 and 150 (and open); `pane` for the pane
//
// A line that overflows its width is flagged with `!!`; a cut is where a truncating Text meets its width.
import { readFileSync } from 'node:fs'
import { lay, len } from '../hooks/cells.ts'

const records = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const want = process.argv[3] ?? 'band' // band | pane
const only = process.argv[4] // scene filter substring
for (const r of records) {
  if (r.surface !== 'terminal' || r.view !== want) continue
  if (only && !r.scene.includes(only)) continue
  const { lines, overflow } = lay(r.tree, r.cols, want === 'pane') // the pane's text wraps, as Ink wraps it; the band's is strict
  console.log(`=== ${r.scene} · ${r.view} ${r.cols}${r.open ? ' open' : ''}`)
  for (const l of lines) console.log('|' + l.replace(/\s+$/, '') + (len(l) > r.cols ? `   <<< ${len(l)} cols` : ''))
  for (const f of overflow) console.log('  !! OVERFLOW(' + f + ')')
}
