import { useEffect, useState } from 'react'
import { Button } from '../components/ui.jsx'
import { currentDemoTab, goToDemoTab, onDemoTab } from './demoNav.js'

// Floating guide shown only in demo mode. It frames the project for a first-
// time viewer (think: a recruiter with 60 seconds), offers a short guided tour
// of the strongest features, and — when free-roaming — explains whatever tab
// they're on with a one-line "why this was interesting to build" hook.

// The curated highlight reel. Order is the pitch: what it is → hardest
// algorithm → security thinking → system integration → architecture + access.
const TOUR = [
  {
    tab: 'set-design',
    title: 'Talaash HQ',
    body: 'A production app I built for a ~40-person collegiate dance team — set design, scheduling, attendance and dues in one place. Real people run practices on it; this is a safe sandbox seeded with fake data.',
    tags: ['React 19', 'Supabase', 'Postgres'],
  },
  {
    tab: 'calendar',
    title: 'Conflict-aware scheduler',
    body: "The piece I'm proudest of. Members log the times they can't make; a rank-choice optimizer brute-forces every practice ordering to minimize who misses their own segment. Unavoidable conflicts flag red right on the calendar.",
    tags: ['Custom optimizer', 'Algorithms'],
  },
  {
    tab: 'attendance',
    title: 'Fraud-resistant attendance',
    body: "Check-in uses a rotating per-practice password, and fines are computed on the Postgres server clock — not the phone — so they can't be spoofed. Attendance is assumed: members only act to flag a problem.",
    tags: ['Server-clock RPC', 'Timezone-correct'],
  },
  {
    tab: 'dues',
    title: 'One balance from many sources',
    body: 'This grid folds payment-provider data, manual overrides, attendance fines, and reimbursement credits into a single "what each person owes." Click any cell to override it.',
    tags: ['Derived state', 'Zeffy + Venmo'],
  },
  {
    tab: 'roster',
    title: 'Access control + this demo',
    body: 'Roles are enforced in the database with row-level security, and only the owner can grant admin — guarded by a Postgres trigger, not just the UI. Even this demo is engineering: the whole app runs against an in-memory mock of Supabase.',
    tags: ['RLS', 'DB triggers', 'Swappable backend'],
  },
]

// Short "why it was interesting" line per tab, for free-roam browsing.
const BLURBS = {
  'set-design': "Casting and stage traffic per segment. Entry/exit sides drive automatic quick-change warnings when a dancer has back-to-back numbers.",
  calendar: 'Members log after-7 availability; an optimizer finds the practice order with the fewest cast conflicts, and conflicts flag red on scheduled blocks.',
  benching: 'A weekly rehearsal-duty rotation with reserves and per-week overrides; covered hours roll up toward each member\'s requirement.',
  attendance: "Rotating per-practice password with fines computed on the server clock so they can't be faked. Members only act to flag a problem.",
  dues: 'One grid merging payment-provider data, manual overrides, attendance fines, and reimbursement credits into a single balance per member.',
  reimbursements: 'Members submit expenses; approvals offset their dues first, then pay out the rest — the money threads back into the dues grid.',
  roster: 'Roles are enforced in the database via row-level security, and only the owner can grant admin — checked by a Postgres trigger, not just the UI.',
}

function Tags({ tags }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {tags.map((t) => (
        <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent-soft text-accent">
          {t}
        </span>
      ))}
    </div>
  )
}

export default function DemoNarrator() {
  const [tab, setTab] = useState(currentDemoTab())
  const [open, setOpen] = useState(true)
  const [step, setStep] = useState(null) // number = touring, null = free-roam

  useEffect(() => onDemoTab(setTab), [])

  const startTour = () => { setStep(0); goToDemoTab(TOUR[0].tab); setOpen(true) }
  const endTour = () => setStep(null)
  const go = (i) => {
    if (i < 0 || i >= TOUR.length) return endTour()
    setStep(i)
    goToDemoTab(TOUR[i].tab)
  }

  // Minimized: a small pill that reopens the guide.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3.5 py-2 rounded-full bg-accent text-accent-ink text-sm font-semibold shadow-lg cursor-pointer"
      >
        <span className="w-2 h-2 rounded-full bg-current opacity-80 animate-pulse" />
        Demo guide
      </button>
    )
  }

  const touring = step !== null
  const s = touring ? TOUR[step] : null

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-subtle">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-good animate-pulse" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Live demo</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-faint hover:text-ink cursor-pointer text-lg leading-none"
          title="Minimize"
        >
          –
        </button>
      </div>

      <div className="px-4 py-3.5">
        {touring ? (
          <>
            <h3 className="text-sm font-bold text-ink">{s.title}</h3>
            <p className="text-[13px] text-muted leading-relaxed mt-1.5">{s.body}</p>
            <Tags tags={s.tags} />

            <div className="flex items-center gap-1 mt-4 mb-3">
              {TOUR.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${i === step ? 'bg-accent' : i < step ? 'bg-accent/40' : 'bg-line'}`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button onClick={endTour} className="text-[11px] text-faint hover:text-muted cursor-pointer">
                Skip
              </button>
              <div className="flex items-center gap-2">
                {step > 0 && <Button size="sm" variant="ghost" onClick={() => go(step - 1)}>Back</Button>}
                <Button size="sm" variant="primary" onClick={() => go(step + 1)}>
                  {step === TOUR.length - 1 ? 'Done' : 'Next'}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-sm font-bold text-ink mb-1.5">
              {TOUR.find((t) => t.tab === tab)?.title ?? 'Talaash HQ'}
            </h3>
            <p className="text-[13px] text-muted leading-relaxed">
              {BLURBS[tab] ?? BLURBS['set-design']}
            </p>
            <div className="mt-4">
              <Button size="sm" variant="primary" onClick={startTour} className="w-full">
                Take the 60-second tour →
              </Button>
              <p className="text-[11px] text-faint text-center mt-2">
                Sandbox with synthetic data · edits reset on refresh
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
