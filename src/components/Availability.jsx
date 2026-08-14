import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase.js'
import { nextPractice, minToLabel, fmtDate, DAY_NAMES, DAY_SHORT, fromISODate } from '../lib.js'
import { isActive } from '../matching.js'
import { Button, Card, CardHeader, Select, Badge } from './ui.jsx'

// Availability window: after 7 PM, in 30-min blocks up to 11 PM.
export const AVAIL_START = 19 * 60
export const N_BLOCKS = 8 // 7:00 → 11:00
export const blockLabel = (i) => minToLabel(AVAIL_START + i * 30)
export const weekdayOf = (iso) => (fromISODate(iso).getDay() + 6) % 7 // Mon=0

// Resolve a member's busy blocks for a date: date override wins, then their
// weekly default for that weekday, else fully free.
export function resolveBusy(byKey, memberId, dateISO) {
  return (
    byKey[`${memberId}|d:${dateISO}`] ??
    byKey[`${memberId}|w:${weekdayOf(dateISO)}`] ??
    []
  )
}

// True if the member has entered any availability that applies to this date.
export function hasAvailability(byKey, memberId, dateISO) {
  return !!(byKey[`${memberId}|d:${dateISO}`] || byKey[`${memberId}|w:${weekdayOf(dateISO)}`])
}

// The 30-min availability block indices a scheduled time range overlaps,
// clamped to the after-7 window.
export function blocksForRange(startMin, endMin) {
  const out = []
  for (let i = 0; i < N_BLOCKS; i++) {
    const bStart = AVAIL_START + i * 30
    if (bStart + 30 > startMin && bStart < endMin) out.push(i)
  }
  return out
}

// Cast members who are busy during a scheduled block on a given date.
export function conflictsForBlock(byKey, cast, dateISO, startMin, endMin) {
  const idx = blocksForRange(startMin, endMin)
  if (idx.length === 0) return []
  return cast.filter((m) => {
    const busy = resolveBusy(byKey, m.id, dateISO)
    return idx.some((i) => busy.includes(i))
  })
}

// All orderings of a small array.
function permutations(arr) {
  if (arr.length <= 1) return [arr]
  const out = []
  arr.forEach((v, i) => {
    for (const p of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([v, ...p])
  })
  return out
}

// Rank-choice practice optimizer. Given segments in priority order (index 0 =
// most important), each with a cast and a duration in 30-min blocks, try every
// ordering placed back-to-back somewhere in the 7–11 PM window and return the
// arrangement with the fewest cast conflicts — weighting higher-ranked segments
// so they win the cleanest slots. Contiguous by design (no idle gaps mid-run).
export function optimizeOrder(segs, byKey, dateISO) {
  if (segs.length === 0) return { error: 'Add at least one segment.' }
  const total = segs.reduce((n, s) => n + s.durBlocks, 0)
  if (total > N_BLOCKS)
    return { error: `That's ${total * 30} min, but only ${N_BLOCKS * 30} min (7–11 PM) is available. Trim a segment.` }

  const n = segs.length
  const weightOf = (rankIdx) => n - rankIdx // top priority = heaviest
  const conflictsAt = (seg, startBlock) => {
    const blocks = []
    for (let b = startBlock; b < startBlock + seg.durBlocks; b++) blocks.push(b)
    return seg.cast.filter((m) => {
      const busy = resolveBusy(byKey, m.id, dateISO)
      return blocks.some((b) => busy.includes(b))
    })
  }

  const slack = N_BLOCKS - total
  let best = null
  for (const perm of permutations(segs.map((_, i) => i))) {
    for (let offset = 0; offset <= slack; offset++) {
      let cursor = offset
      let weighted = 0, raw = 0, posPenalty = 0
      const slots = []
      for (const si of perm) {
        const seg = segs[si]
        const conflicts = conflictsAt(seg, cursor)
        weighted += conflicts.length * weightOf(si)
        raw += conflicts.length
        posPenalty += si * cursor // nudges important segments earlier on ties
        slots.push({ seg, rank: si, startBlock: cursor, conflicts })
        cursor += seg.durBlocks
      }
      const cand = { slots, weighted, raw, posPenalty }
      const better =
        !best ||
        cand.weighted < best.weighted ||
        (cand.weighted === best.weighted && cand.raw < best.raw) ||
        (cand.weighted === best.weighted && cand.raw === best.raw && cand.posPenalty < best.posPenalty)
      if (better) best = cand
    }
  }

  best.slots = best.slots
    .map((s) => ({
      ...s,
      startMin: AVAIL_START + s.startBlock * 30,
      endMin: AVAIL_START + (s.startBlock + s.seg.durBlocks) * 30,
    }))
    .sort((a, b) => a.startMin - b.startMin)
  best.totalConflicts = best.raw
  return best
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

// ---- editor: rank-choice auto-optimizer ----
const durLabel = (blocks) => {
  const min = blocks * 30
  const h = Math.floor(min / 60), m = min % 60
  return (h ? `${h} hr` : '') + (h && m ? ' ' : '') + (m ? `${m} min` : '')
}
const DUR_OPTS = Array.from({ length: N_BLOCKS }, (_, i) => i + 1)

export function AutoSchedule() {
  const { state, addPracticeBlock, removePracticeBlock } = useStore()
  const next = useMemo(() => nextPractice(state.settings?.practiceSchedule ?? []), [state.settings])
  const [dateISO, setDateISO] = useState(next?.dateISO ?? '')
  const [byKey, setByKey] = useState({})
  const [picks, setPicks] = useState([]) // ordered [{ segmentId, durBlocks }] — order = rank
  const [plan, setPlan] = useState(null)

  useEffect(() => {
    supabase.from('member_availability').select('*').then(({ data }) => {
      const map = {}
      for (const r of data ?? []) map[`${r.member_id}|${r.key}`] = r.busy
      setByKey(map)
    })
  }, [])

  if (state.segments.length === 0) return null

  const castOf = (segId) =>
    (state.segments.find((s) => s.id === segId)?.members ?? [])
      .map((mm) => state.roster.find((r) => r.id === mm.memberId))
      .filter((m) => m && isActive(m))

  const remaining = state.segments.filter((s) => !picks.some((p) => p.segmentId === s.id))
  const totalBlocks = picks.reduce((n, p) => n + p.durBlocks, 0)

  const add = (segmentId) => {
    if (!segmentId) return
    setPicks((ps) => [...ps, { segmentId, durBlocks: 2 }])
    setPlan(null)
  }
  const remove = (i) => { setPicks((ps) => ps.filter((_, j) => j !== i)); setPlan(null) }
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= picks.length) return
    setPicks((ps) => { const c = [...ps]; [c[i], c[j]] = [c[j], c[i]]; return c })
    setPlan(null)
  }
  const setDur = (i, durBlocks) => {
    setPicks((ps) => ps.map((p, j) => (j === i ? { ...p, durBlocks } : p)))
    setPlan(null)
  }

  const run = () => {
    const segs = picks.map((p) => ({
      id: p.segmentId,
      name: state.segments.find((s) => s.id === p.segmentId)?.name ?? '—',
      cast: castOf(p.segmentId),
      durBlocks: p.durBlocks,
    }))
    setPlan(optimizeOrder(segs, byKey, dateISO))
  }

  const apply = () => {
    if (!plan || plan.error) return
    const existing = state.practiceBlocks.filter((b) => b.date === dateISO)
    const msg = existing.length
      ? `Replace the ${existing.length} block(s) already on ${fmtDate(dateISO)} with this optimized schedule?`
      : `Add ${plan.slots.length} block(s) to ${fmtDate(dateISO)}?`
    if (!window.confirm(msg)) return
    existing.forEach((b) => removePracticeBlock(b.id))
    plan.slots.forEach((s) =>
      addPracticeBlock({ segmentId: s.seg.id, date: dateISO, startMin: s.startMin, endMin: s.endMin }))
    setPlan(null)
    alert('Scheduled! See it on the calendar below.')
  }

  return (
    <Card className="mb-5">
      <CardHeader
        title="Auto-schedule (beta)"
        subtitle="Pick the segments to run this practice, in priority order, and let it find the running order with the fewest conflicts after 7 PM."
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="px-2 py-1.5 text-sm bg-surface border border-line-strong rounded-lg"
              value={dateISO}
              onChange={(e) => { setDateISO(e.target.value); setPlan(null) }}
            />
          </div>
        }
      />
      <div className="px-5 pb-5 space-y-3">
        {picks.length === 0 && (
          <p className="text-sm text-faint italic">No segments added yet.</p>
        )}

        {picks.map((p, i) => {
          const seg = state.segments.find((s) => s.id === p.segmentId)
          return (
            <div key={p.segmentId} className="flex items-center gap-2 flex-wrap">
              <span className="w-6 h-6 shrink-0 rounded-full bg-accent-soft text-accent text-xs font-bold inline-flex items-center justify-center">{i + 1}</span>
              <span className="flex-1 min-w-0 font-medium text-ink truncate">{seg?.name ?? '—'}</span>
              <span className="text-[11px] text-faint shrink-0">{castOf(p.segmentId).length} cast</span>
              <Select className="!w-32 !py-1.5 shrink-0" value={p.durBlocks} onChange={(e) => setDur(i, Number(e.target.value))}>
                {DUR_OPTS.map((b) => <option key={b} value={b}>{durLabel(b)}</option>)}
              </Select>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" onClick={() => move(i, -1)} disabled={i === 0} title="Higher priority">↑</Button>
                <Button size="sm" onClick={() => move(i, 1)} disabled={i === picks.length - 1} title="Lower priority">↓</Button>
                <Button size="sm" variant="danger" onClick={() => remove(i)}>✕</Button>
              </div>
            </div>
          )
        })}

        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
          <div className="flex items-center gap-2">
            {remaining.length > 0 && (
              <Select className="!w-48 !py-1.5" value="" onChange={(e) => add(e.target.value)}>
                <option value="">+ Add segment…</option>
                {remaining.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
            <span className={`text-[11px] ${totalBlocks > N_BLOCKS ? 'text-bad font-semibold' : 'text-faint'}`}>
              {durLabel(totalBlocks || 0) || '0 min'} / {durLabel(N_BLOCKS)}
            </span>
          </div>
          <Button variant="primary" size="sm" onClick={run} disabled={picks.length === 0}>
            Optimize order
          </Button>
        </div>

        {plan?.error && <p className="text-sm text-bad">{plan.error}</p>}

        {plan && !plan.error && (
          <div className="pt-2 border-t border-line space-y-2">
            <p className="text-xs font-medium text-muted">
              Best running order for {fmtDate(dateISO)} —{' '}
              {plan.totalConflicts === 0
                ? <span className="text-good font-semibold">no conflicts 🎉</span>
                : <span className="text-warn font-semibold">{plan.totalConflicts} total conflict{plan.totalConflicts > 1 ? 's' : ''}</span>}
            </p>
            {plan.slots.map((s) => (
              <div key={s.seg.id} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 w-28 tabular-nums text-muted">{minToLabel(s.startMin)}–{minToLabel(s.endMin)}</span>
                <span className="shrink-0 font-medium text-ink w-32 truncate">{s.seg.name}</span>
                {s.conflicts.length === 0 ? (
                  <span className="text-good text-xs">✓ all clear</span>
                ) : (
                  <span className="text-xs text-warn">
                    ⚠ {s.conflicts.length} out: <span className="text-muted">{s.conflicts.map((m) => m.name).join(', ')}</span>
                  </span>
                )}
              </div>
            ))}
            <div className="flex justify-end pt-1">
              <Button variant="primary" size="sm" onClick={apply}>Apply to calendar</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
