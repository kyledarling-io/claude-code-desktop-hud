import type { Register } from 'claude-code'

// A source for the HUD (SOURCES.md): it says once what it is, then sends one slot every 5 seconds. Change the
// declaration, the slot and what arms the clock to send what your plugin knows.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Every $.hud call is caught. A refusal is an answer ({ ok: false, why }), and a fault must not reach this hook.
    let declared = false
    try {
      declared = (await $.hud.declare({
        v: 1,
        name: 'Source template',
        access: 'Counts in its own memory. Reads nothing.', // shown to the person as written: say what your plugin reads
        slots: [{ id: 'ticks', pattern: 'stat', title: 'Ticks' }],
      })).ok
    } catch { /* the HUD isn't answering: send nothing */ }

    // Only a declared source can push, so a refused declaration leaves nothing to send.
    if (declared) {
      let n = 0 // a reload starts the count again; what must outlive one belongs in $.state
      $.clock.every(5000, async () => {
        n += 1
        try {
          await $.hud.push({ v: 1, id: 'ticks', pattern: 'stat', title: 'Ticks', value: n, note: 'one every 5 seconds' })
        } catch { /* the next tick sends the count again */ }
      })
    }
    return next(e)
  })
}
