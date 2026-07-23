import { useState } from 'react'
import SetDesign from './components/SetDesign.jsx'
import PracticeCalendar from './components/PracticeCalendar.jsx'
import Benching from './components/Benching.jsx'
import Attendance from './components/Attendance.jsx'
import Dues from './components/Dues.jsx'
import Reimbursements from './components/Reimbursements.jsx'
import Roster from './components/Roster.jsx'
import { useStore } from './store.jsx'
import { useAuth } from './auth.jsx'
import { useTheme } from './theme.jsx'

const NAV = [
  {
    id: 'set-design', label: 'Set Design',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <circle cx="8" cy="9" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="16" cy="9" r="1.3" fill="currentColor" stroke="none" />
        <path d="M7 21h10" />
      </svg>
    ),
  },
  {
    id: 'calendar', label: 'Practice Calendar',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    id: 'benching', label: 'Benching',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12h16M4 12v6M20 12v6M6 12V8a2 2 0 012-2h8a2 2 0 012 2v4" />
      </svg>
    ),
  },
  {
    id: 'attendance', label: 'Attendance',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V2.5h6V4M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'dues', label: 'Dues & Payments',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6.5v11M15 8.8c-.6-.9-1.7-1.4-3-1.4-1.8 0-3 .9-3 2.3 0 2.9 6 1.6 6 4.5 0 1.4-1.3 2.3-3 2.3-1.3 0-2.4-.5-3-1.4" />
      </svg>
    ),
  },
  {
    id: 'reimbursements', label: 'Reimbursements',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </svg>
    ),
  },
  {
    id: 'roster', label: 'Roster',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5M16 4.6a3.5 3.5 0 010 6.8M18.5 15.4c1.6.8 2.7 2.4 3 4.6" />
      </svg>
    ),
  },
]

const SYNC_LABEL = {
  connecting: { dot: 'bg-faint animate-pulse', text: 'Connecting…' },
  synced: { dot: 'bg-good', text: 'Synced' },
  saving: { dot: 'bg-warn animate-pulse', text: 'Saving…' },
  offline: { dot: 'bg-bad', text: 'Offline — saved locally' },
}

const THEME_ICONS = {
  light: <path d="M12 3v1.5M12 19.5V21M4.2 4.2l1 1M18.8 18.8l1 1M3 12h1.5M19.5 12H21M4.2 19.8l1-1M18.8 5.2l1-1" />,
  system: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  dark: <path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" />,
}

function ThemeToggle() {
  const { pref, setPref } = useTheme()
  return (
    <div
      className="flex p-0.5 rounded-lg"
      style={{ background: 'var(--sidebar-hover)' }}
    >
      {['light', 'system', 'dark'].map((mode) => (
        <button
          key={mode}
          onClick={() => setPref(mode)}
          title={mode[0].toUpperCase() + mode.slice(1)}
          className="flex-1 flex items-center justify-center py-1.5 rounded-md cursor-pointer transition-colors"
          style={pref === mode
            ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
            : { color: 'var(--sidebar-muted)' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            {THEME_ICONS[mode]}
          </svg>
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState('set-design')
  const { syncStatus } = useStore()
  const { session, role, signOut } = useAuth()
  const sync = SYNC_LABEL[syncStatus] ?? SYNC_LABEL.connecting

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside
        className="w-56 shrink-0 flex flex-col themed"
        style={{ background: 'var(--sidebar)', color: 'var(--sidebar-muted)' }}
      >
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-sm"
              style={{
                background: 'linear-gradient(145deg, var(--accent), var(--accent-strong))',
                color: 'var(--accent-ink)',
                boxShadow: '0 4px 12px color-mix(in srgb, var(--accent) 45%, transparent)',
              }}
            >
              T
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight" style={{ color: 'var(--sidebar-ink)' }}>Talaash HQ</div>
              <div className="text-[11px]" style={{ color: 'var(--sidebar-muted)' }}>DDN team manager</div>
            </div>
          </div>
        </div>
        <nav className="px-3 space-y-0.5">
          {NAV.map((n) => {
            const active = tab === n.id
            return (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-colors"
                style={active
                  ? { background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: '0 2px 10px color-mix(in srgb, var(--accent) 40%, transparent)' }
                  : { color: 'var(--sidebar-muted)' }}
                onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = 'var(--sidebar-hover)'; e.currentTarget.style.color = 'var(--sidebar-ink)' } }}
                onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--sidebar-muted)' } }}
              >
                {n.icon}
                {n.label}
              </button>
            )
          })}
        </nav>
        <div className="mt-auto px-4 py-4 space-y-3">
          <ThemeToggle />
          <div className="flex items-center gap-2 text-[11px] px-1" style={{ color: 'var(--sidebar-muted)' }}>
            <span className={`w-2 h-2 rounded-full ${sync.dot}`} />
            {sync.text}
          </div>
          <div className="pt-3 px-1" style={{ borderTop: '1px solid var(--sidebar-hover)' }}>
            <div className="text-[11px] truncate" style={{ color: 'var(--sidebar-muted)' }} title={session?.user?.email}>
              {session?.user?.email}
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span
                className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={role === 'editor'
                  ? { background: 'color-mix(in srgb, var(--accent) 25%, transparent)', color: 'var(--accent-strong)' }
                  : { background: 'var(--sidebar-hover)', color: 'var(--sidebar-muted)' }}
              >
                {role}
              </span>
              <button
                onClick={signOut}
                className="text-[11px] cursor-pointer transition-colors hover:opacity-100"
                style={{ color: 'var(--sidebar-muted)' }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-y-auto thin-scroll">
        <div className="max-w-6xl mx-auto px-6 py-6">
          {tab === 'set-design' && <SetDesign />}
          {tab === 'calendar' && <PracticeCalendar />}
          {tab === 'benching' && <Benching />}
          {tab === 'attendance' && <Attendance />}
          {tab === 'dues' && <Dues />}
          {tab === 'reimbursements' && <Reimbursements />}
          {tab === 'roster' && <Roster />}
        </div>
      </main>
    </div>
  )
}
