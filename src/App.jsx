import { useState } from 'react'
import SetDesign from './components/SetDesign.jsx'
import PracticeCalendar from './components/PracticeCalendar.jsx'
import Benching from './components/Benching.jsx'
import Attendance from './components/Attendance.jsx'
import Roster from './components/Roster.jsx'
import { useStore } from './store.jsx'

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
  connecting: { dot: 'bg-zinc-500 animate-pulse', text: 'Connecting…' },
  synced: { dot: 'bg-emerald-500', text: 'Synced' },
  saving: { dot: 'bg-amber-400 animate-pulse', text: 'Saving…' },
  offline: { dot: 'bg-red-500', text: 'Offline — saved locally' },
}

export default function App() {
  const [tab, setTab] = useState('set-design')
  const { syncStatus } = useStore()
  const sync = SYNC_LABEL[syncStatus] ?? SYNC_LABEL.connecting

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-zinc-900 text-zinc-300 flex flex-col">
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-600 to-zinc-800 border border-zinc-600 flex items-center justify-center font-bold text-white text-sm">
              T
            </div>
            <div>
              <div className="text-sm font-semibold text-white leading-tight">Talaash HQ</div>
              <div className="text-[11px] text-zinc-500">DDN team manager</div>
            </div>
          </div>
        </div>
        <nav className="px-3 space-y-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                tab === n.id
                  ? 'bg-zinc-700/70 text-white'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className={`w-2 h-2 rounded-full ${sync.dot}`} />
            {sync.text}
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
          {tab === 'roster' && <Roster />}
        </div>
      </main>
    </div>
  )
}
