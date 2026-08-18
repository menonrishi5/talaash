// Demo mode: when on, the whole app runs against an in-memory mock backend
// seeded with synthetic data (no login, no real Supabase). It's on automatically
// on the dedicated demo deployment (talaash-demo*, and the demo-branch preview
// URLs), so a plain link needs no query string. Elsewhere (the team's real app,
// local dev) it's opt-in with `?demo`, remembered for the tab; `?demo=0` exits.
// Nothing here is real — a refresh resets the data.

const FLAG = 'talaash-demo'

// True on the hostnames that exist only to serve the demo.
function isDemoHost() {
  const h = window.location.hostname
  return h.startsWith('talaash-demo') || h.includes('git-demo')
}

export function isDemo() {
  if (typeof window === 'undefined') return false
  try {
    if (isDemoHost()) return true
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === '0') {
      sessionStorage.removeItem(FLAG)
      return false
    }
    if (params.has('demo')) {
      sessionStorage.setItem(FLAG, '1')
      return true
    }
    return sessionStorage.getItem(FLAG) === '1'
  } catch {
    return false
  }
}

export function exitDemo() {
  try {
    sessionStorage.removeItem(FLAG)
  } catch {
    /* ignore */
  }
}
