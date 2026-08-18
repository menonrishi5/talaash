// Demo mode: when on, the whole app runs against an in-memory mock backend
// seeded with synthetic data (no login, no real Supabase). Turned on with
// `?demo` in the URL and remembered for the tab so in-app navigation keeps it.
// `?demo=0` turns it back off. Nothing here is real — a refresh resets the data.

const FLAG = 'talaash-demo'

export function isDemo() {
  if (typeof window === 'undefined') return false
  try {
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
