import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase.js'
import { nextPractice, minToLabel, fmtDate, DAY_NAMES, DAY_SHORT, fromISODate } from '../lib.js'
import { isActive } from '../matching.js'
import { Button, Card, CardHeader, Select, Badge } from './ui.jsx'

// Availability window: after 7 PM, in 30-min blocks up to 11 PM.
const AVAIL_START = 19 * 60
const N_BLOCKS = 8 // 7:00 → 11:00
const blockLabel = (i) => minToLabel(AVAIL_START + i * 30)
const weekdayOf = (iso) => (fromISODate(iso).getDay() + 6) % 7 // Mon=0

// Resolve a member's busy blocks for a date: date override wins, then their
// weekly default for that weekday, else fully free.
function resolveBusy(byKey, memberId, dateISO) {
  return (
    byKey[`${memberId}|d:${dateISO}`] ??
    byKey[`${memberId}|w:${weekdayOf(dateISO)}`] ??
    []
  )
}

// A row of 8 tappable 30-min chips. Tapping marks that block busy.
function BlockStrip({ busy, onToggle, disabled }) {
  const set = new Set(busy)
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from({ length: N_BLOCKS }, (_, i) => {
        const isBusy = set.has(i)
        return (
          <button
            key={i}
            disabled={disabled}
            onClick={() => onToggle(i)}
            className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${disabled ? '' : 'cursor-pointer'} ${
              isBusy
                ? 'bg-bad-soft text-bad border-bad/30'
                : 'bg-good-soft text-good border-good/20 hover:border-good/40'
            }`}
            title={isBusy ? 'Busy — tap to mark free' : 'Free — tap to mark busy'}
          >
            {blockLabel(i)}
          </button>
        )
      })}
    </div>
  )
}

// ---- member: set my after-7 availability ----
export function MyAvailability() {
  const { state } = useStore()
  const { memberId } = useAuth()
  const sched = state.settings?.practiceSchedule ?? []
  const next = useMemo(() => nextPractice(sched), [sched])
  const practiceDays = useMemo(
    () => [...new Set(sched.map((p) => p.day))].sort((a, b) => a - b),
    [sched],
  )
  const [byKey, setByKey] = useState(null)
  const [showWeekly, setShowWeekly] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)

  const load = async () => {
    const { data } = await supabase.from('member_availability').select('*').eq('member_id', memberId)
    const map = {}
    for (const r of data ?? []) map[`${memberId}|${r.key}`] = r.busy
    setByKey(map)
  }
  useEffect(() => {
    if (memberId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId])

  if (!memberId || !byKey) return null

  const save = async (key, busy) => {
    setByKey((m) => ({ ...m, [`${memberId}|${key}`]: busy }))
    const { error } = await supabase.from('member_availability').upsert({
      member_id: memberId, key, busy, updated_at: new Date().toISOString(),
    })
    if (error) { alert('Could not save availability: ' + error.message); return }
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 1500)
  }

  const toggle = (key, existing, i) => {
    const set = new Set(existing)
    set.has(i) ? set.delete(i) : set.add(i)
    save(key, [...set].sort((a, b) => a - b))
  }

  if (practiceDays.length === 0) return null

  return (
    <Card className="mb-5">
      <CardHeader
        title="My availability"
        subtitle="Tap the times after 7 PM you CAN'T make. Helps the board schedule around conflicts — nothing else uses this."
      />
      <div className="px-5 pb-5 space-y-4">
        {next && (
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">
              This practice — {DAY_NAMES[next.day]} {fmtDate(next.dateISO)}
            </p>
            <BlockStrip
              busy={resolveBusy(byKey, memberId, next.dateISO)}
              onToggle={(i) => toggle(`d:${next.dateISO}`, resolveBusy(byKey, memberId, next.dateISO), i)}
            />
            <p className="text-[11px] text-faint mt-1">Overrides your usual for this date only.</p>
          </div>
        )}

        <button
          className="text-xs font-medium text-accent hover:underline cursor-pointer"
          onClick={() => setShowWeekly((v) => !v)}
        >
          {showWeekly ? 'Hide' : 'Set'} my usual weekly times
        </button>
        {showWeekly && (
          <div className="space-y-2.5 pt-1">
            {practiceDays.map((d) => {
              const key = `w:${d}`
              const busy = byKey[`${memberId}|${key}`] ?? []
              return (
                <div key={d}>
                  <p className="text-[11px] font-medium text-muted mb-1">{DAY_NAMES[d]} (every week)</p>
                  <BlockStrip busy={busy} onToggle={(i) => toggle(key, busy, i)} />
                </div>
              )
            })}
          </div>
        )}
        {savedMsg && <p className="text-xs text-good">✓ Saved</p>}
      </div>
    </Card>
  )
}

// ---- editor: who in a segment has a conflict, and the best window ----
export function ConflictCheck() {
  const { state } = useStore()
  const [segmentId, setSegmentId] = useState(state.segments[0]?.id ?? '')
  const next = useMemo(() => nextPractice(state.settings?.practiceSchedule ?? []), [state.settings])
  const [dateISO, setDateISO] = useState(next?.dateISO ?? '')
  const [byKey, setByKey] = useState({})

  useEffect(() => {
    supabase.from('member_availability').select('*').then(({ data }) => {
      const map = {}
      for (const r of data ?? []) map[`${r.member_id}|${r.key}`] = r.busy
      setByKey(map)
    })
  }, [])

  const segment = state.segments.find((s) => s.id === segmentId)
  const cast = (segment?.members ?? [])
    .map((mm) => state.roster.find((r) => r.id === mm.memberId))
    .filter((m) => m && isActive(m))

  if (state.segments.length === 0) {
    return (
      <Card className="mb-5">
        <CardHeader title="Conflict check" subtitle="Create segments in Set Design to check who's free for each." />
      </Card>
    )
  }

  // free count per block across the cast
  const freeByBlock = Array.from({ length: N_BLOCKS }, (_, i) =>
    cast.filter((m) => !resolveBusy(byKey, m.id, dateISO).includes(i)).length,
  )
  const bestCount = Math.max(0, ...freeByBlock)

  return (
    <Card className="mb-5">
      <CardHeader
        title="Conflict check"
        subtitle="Pick a segment and date — see who's free after 7 PM and the best window for its cast."
        actions={
          <div className="flex items-center gap-2">
            <Select className="!w-44 !py-1.5" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
              {state.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <input
              type="date"
              className="px-2 py-1.5 text-sm bg-surface border border-line-strong rounded-lg"
              value={dateISO}
              onChange={(e) => setDateISO(e.target.value)}
            />
          </div>
        }
      />
      <div className="px-5 pb-5 overflow-x-auto thin-scroll">
        {cast.length === 0 ? (
          <p className="text-sm text-faint italic">No active cast in this segment.</p>
        ) : (
          <table className="text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface text-left text-[11px] uppercase tracking-wide text-faint font-medium pb-2 pr-3">Dancer</th>
                {Array.from({ length: N_BLOCKS }, (_, i) => (
                  <th key={i} className="text-center text-[10px] text-faint font-medium pb-2 px-1 whitespace-nowrap">{blockLabel(i)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cast.map((m) => {
                const busy = resolveBusy(byKey, m.id, dateISO)
                const hasData = byKey[`${m.id}|d:${dateISO}`] || byKey[`${m.id}|w:${weekdayOf(dateISO)}`]
                return (
                  <tr key={m.id}>
                    <td className="sticky left-0 bg-surface py-1 pr-3 font-medium text-ink whitespace-nowrap border-t border-line">
                      {m.name}
                      {!hasData && <span className="text-[10px] text-faint ml-1" title="Hasn't set availability — assumed free">(no data)</span>}
                    </td>
                    {Array.from({ length: N_BLOCKS }, (_, i) => (
                      <td key={i} className="text-center px-1 py-1 border-t border-line">
                        <span className={`inline-block w-4 h-4 rounded ${busy.includes(i) ? 'bg-bad' : 'bg-good/70'}`} />
                      </td>
                    ))}
                  </tr>
                )
              })}
              <tr>
                <td className="sticky left-0 bg-surface py-1.5 pr-3 text-[11px] font-semibold text-muted border-t-2 border-line">Free / {cast.length}</td>
                {freeByBlock.map((n, i) => (
                  <td key={i} className={`text-center px-1 py-1.5 text-xs font-bold border-t-2 border-line ${n === bestCount && n === cast.length ? 'text-good' : n === bestCount ? 'text-warn' : 'text-faint'}`}>
                    {n}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
        {cast.length > 0 && (
          <p className="text-[11px] text-faint mt-2">
            🟩 free · 🟥 busy. Best coverage: {bestCount}/{cast.length} of the cast, at{' '}
            {freeByBlock.map((n, i) => (n === bestCount ? blockLabel(i) : null)).filter(Boolean).join(', ')}.
          </p>
        )}
      </div>
    </Card>
  )
}
