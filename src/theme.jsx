import { createContext, useContext, useEffect, useState } from 'react'

// Theme: 'light' | 'dark' | 'system'. We always resolve to a concrete
// light/dark and stamp it on <html data-theme> so CSS tokens flip.

const ThemeCtx = createContext(null)
const KEY = 'talaash-theme'

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

function apply(pref) {
  const resolved = pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref
  document.documentElement.setAttribute('data-theme', resolved)
  return resolved
}

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(() => localStorage.getItem(KEY) || 'system')
  const [resolved, setResolved] = useState(() => apply(localStorage.getItem(KEY) || 'system'))

  useEffect(() => {
    localStorage.setItem(KEY, pref)
    setResolved(apply(pref))
    if (pref !== 'system') return
    // Follow the OS while in system mode.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(apply('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  return (
    <ThemeCtx.Provider value={{ pref, setPref, resolved }}>{children}</ThemeCtx.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error('useTheme outside provider')
  return ctx
}
