// The trial: the real band and pane, drawn outside the app. Copies the mod into a temp folder with
// dev/trial-scenes.tsx as its only extra test, runs it with `claude plugin test`, and renders each tree it prints
// into dev/out/trial.html, light and dark, approximating the desktop app's boxes, text, buttons and SVG, and the terminal's
// cells (text in monospace, a column 8px wide).
// What only the app decides (clipping, hover, the dock, its exact fonts) is still checked there.
//
//   node dev/trial.mjs            then open dev/out/trial.html (any static server, or the file)
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'hud-trial-'))
cpSync(join(root, '.claude-plugin', 'plugin.json'), join(tmp, '.claude-plugin', 'plugin.json'), { recursive: true })
cpSync(join(root, 'types'), join(tmp, 'types'), { recursive: true })
cpSync(join(root, 'hooks'), join(tmp, 'hooks'), { recursive: true, filter: f => !/\.test\./.test(f) })
cpSync(join(root, 'dev', 'trial-scenes.tsx'), join(tmp, 'hooks', 'trial.test.tsx'))
const run = spawnSync(`claude plugin test "${tmp}"`, { encoding: 'utf8', shell: true, maxBuffer: 64 << 20 })
rmSync(tmp, { recursive: true, force: true })
const out = `${run.stdout}\n${run.stderr}`
const records = out.split(/\r?\n/).filter(l => l.startsWith('TRIAL ')).map(l => JSON.parse(l.slice(6)))
// a scene that threw draws no more views: say so, with the start of why
const at = out.indexOf('(fail)')
if (at >= 0) console.error(out.slice(at).split(/\r?\n/).slice(0, 12).join('\n'))
if (!records.length) {
  console.error(out)
  process.exit(1)
}

// The app's text colours by theme key, measured off captures where they could be (approximate elsewhere).
const COLORS = {
  dark: { text: '#F5F4EF', dim: '#A3A198', claude: '#D97757', success: '#8E9E77', warning: '#D9A441', error: '#D3847D', suggestion: '#6D9DCD', inactive: '#7D7C78', band: '#262624', page: '#1F1E1D', chip: '#3A3A37', line: '#3E3E3A' },
  light: { text: '#141413', dim: '#6F6E69', claude: '#C6613F', success: '#66774F', warning: '#8D6A2C', error: '#BD4C42', suggestion: '#507499', inactive: '#8E8D86', band: '#FFFFFF', page: '#FAF9F5', chip: '#ECEAE2', line: '#E8E6DC' },
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const CELL = 8, ROW = 20 // a column and a row of the app's cells, in px

const render = (n, theme) => {
  if (n === null || n === undefined || n === false) return ''
  if (typeof n === 'string' || typeof n === 'number') return esc(n)
  if (Array.isArray(n)) return n.map(c => render(c, theme)).join('')
  const p = n.props ?? {}, kids = (n.children ?? []).map(c => render(c, theme)).join('')
  const c = COLORS[theme]
  if (n.type === 'Text') {
    const style = [
      p.bold ? 'font-weight:600' : '', p.italic ? 'font-style:italic' : '',
      p.color ? `color:${c[p.color] ?? p.color}` : p.dimColor ? `color:${c.dim}` : '',
      p.wrap === 'truncate-end' ? 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;min-width:0' : '',
    ].filter(Boolean).join(';')
    return `<span style="${style}">${kids}</span>`
  }
  if (n.type === 'Button') {
    if (p.role === 'dismiss') return `<span class="btn dismiss" title="${esc(p.label)}">✕</span>`
    return `<span class="btn${p.plain ? ' plain' : ''}">${esc(p.label ?? '')}</span>`
  }
  if (n.type === 'Svg') {
    const src = String(p.source).replace('@media (prefers-color-scheme: dark)', theme === 'dark' ? '@media all' : '@media not all')
    // an image, as the app draws it: its <style> stays its own (inline, every SVG's rules would share the page)
    return `<img class="svg" width="${p.width}" height="${p.height}" alt="${esc(p.alt)}" title="${esc(p.alt)}" src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}">`
  }
  // a Box, as Ink lays it out: a row unless it says column
  const style = [
    'display:' + (p.display === 'none' ? 'none' : 'flex'),
    'flex-direction:' + (p.flexDirection ?? 'row'),
    p.alignItems ? `align-items:${p.alignItems}` : '',
    p.justifyContent ? `justify-content:${p.justifyContent}` : '',
    p.flexGrow !== undefined ? `flex-grow:${p.flexGrow}` : '',
    p.flexShrink !== undefined ? `flex-shrink:${p.flexShrink}` : '',
    p.minWidth !== undefined ? `min-width:${p.minWidth}` : '',
    p.width !== undefined ? `width:${typeof p.width === 'number' ? p.width * CELL + 'px' : p.width}` : '',
    p.flexWrap ? `flex-wrap:${p.flexWrap}` : '',
    p.paddingX ? `padding-left:${p.paddingX * CELL}px;padding-right:${p.paddingX * CELL}px` : '',
    p.marginTop ? `margin-top:${p.marginTop * ROW}px` : '',
    p.marginRight ? `margin-right:${p.marginRight * CELL}px` : '',
    p.borderStyle ? `border:1px solid ${c.line};border-radius:8px` : '',
    p.position === 'absolute' ? `position:absolute;top:${(p.top ?? 0) * ROW}px;left:${(p.left ?? 0) * CELL}px` : '',
  ].filter(Boolean).join(';')
  return `<div style="${style}">${kids}</div>`
}

const css = theme => {
  const c = COLORS[theme]
  return `.${theme}{background:${c.page};color:${c.text};padding:16px}
  .${theme} .band{background:${c.band};border-radius:10px;padding:8px 12px;margin:6px 0 18px}
  .${theme} .pane{background:${c.band};border:1px solid ${c.line};border-radius:10px;padding:10px 12px;margin:6px 0 18px}
  .${theme} .btn{background:${c.chip};border-radius:6px;padding:0 7px;margin-left:6px;white-space:nowrap;font-size:12.5px;line-height:22px}
  .${theme} .btn.plain,.${theme} .btn.dismiss{background:none;color:${c.dim}}
  .${theme} .terminal{font:13px/20px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .${theme} .terminal .btn{border-radius:3px;font-size:13px;line-height:20px}
  .${theme} .terminal div{min-width:0} .${theme} .terminal span{white-space:pre!important}`  /* cells: spaces kept (a truncate-end text's too: its own nowrap collapses them), and a box shrinks as Yoga's does (its minimum width is 0) */
}

const views = [...new Set(records.map(r => r.scene))]
const section = theme => views.map(scene => {
  const rs = records.filter(r => r.scene === scene)
  return `<h2>${esc(scene)}</h2><div class="row">` + rs.map(r => {
    const w = r.view === 'band' ? r.cols * CELL : r.cols * CELL + 24
    const surface = r.surface ?? 'desktop'
    return `<figure><figcaption>${surface} ${r.view} · ${r.cols} cols${r.open ? ' · dashboard open' : ''} · ${w}px</figcaption>
      <div class="${r.view} ${surface}" style="width:${w}px">${render(r.tree, theme)}</div></figure>`
  }).join('') + '</div>'
}).join('')

const html = `<!doctype html><meta charset="utf-8"><title>HUD trial</title>
<style>body{margin:0;font:13px/20px ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
h1,h2{font-size:14px;margin:16px 0 4px} .row{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
figure{margin:0} figcaption{font:11px ui-monospace,monospace;opacity:.6}
.svg{display:block} .svg svg{display:block}
${css('dark')}${css('light')}</style>
<div class="dark"><h1>Dark</h1>${section('dark')}</div><div class="light"><h1>Light</h1>${section('light')}</div>`
mkdirSync(join(root, 'dev', 'out'), { recursive: true })
writeFileSync(join(root, 'dev', 'out', 'trial.html'), html)
writeFileSync(join(root, 'dev', 'out', 'trial.json'), JSON.stringify(records)) // for dev/cells.mjs
console.log(`dev/out/trial.html: ${records.length} views of ${views.length} scenes`)
