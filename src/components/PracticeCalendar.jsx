import { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import WeekGrid, { START_HOUR, END_HOUR } from './WeekGrid.jsx'
import {
  weekStartISO, addDaysISO, dayIndexOfISO, fmtWeekRange, fmtDate, relativeDays,
  segColor, minToLabel, durationLabel, DAY_NAMES, toISODate,
} from '../lib.js'
import { Button, Card, CardHeader, Modal, Field, Select, Badge, EmptyState } from './ui.jsx'

function timeOptions(step = 15) {
  const opts = []
  for (let m = START_HOUR * 60; m <= END_HOUR * 60; m += step) opts.push(m)
  return opts
}
const TIME_OPTS = timeOptions()

export default function PracticeCalendar() {
  const { state, addPracticeBlock, updatePracticeBlock, removePracticeBlock } = useStore()
  const [weekISO, setWeekISO] = useState(weekStartISO())
  const [draft, setDraft] = useState(null) // {id?, day, startMin, endMin, segmentId}

  const segIndex = useMemo(
    () => Object.fromEntries(state.segments.map((s, i) => [s.id, i])),
    [state.segments],
  )

  const weekBlocks = state.practiceBlocks.filter((b) => {
    const d = dayIndexOfISO(b.date)
    return addDaysISO(b.date, -d) === weekISO
  })

  const events = weekBlocks.map((b) => {
    const seg = state.segments.find((s) => s.id === b.segmentId)
    return {
      id: b.id,
      day: dayIndexOfISO(b.date),
      startMin: b.startMin,
      endMin: b.endMin,
      color: seg ? segColor(segIndex[seg.id]) : '#a1a1aa',
      title: seg?.name ?? 'Deleted segment',
      onClick: () => setDraft({ id: b.id, day: dayIndexOfISO(b.date), startMin: b.startMin, endMin: b.endMin, segmentId: b.segmentId }),
    }
  })

  const save = () => {
    const { id, day, startMin, endMin, segmentId } = draft
    if (!segmentId || endMin <= startMin) return
    const date = addDaysISO(weekISO, day)
    if (id) updatePracticeBlock(id, { date, startMin, endMin, segmentId })
    else addPracticeBlock({ date, startMin, endMin, segmentId })
    setDraft(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 mb-1">Practice Calendar</h1>
          <p className="text-sm text-zinc-500">Drag on the grid to schedule a segment run.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setWeekISO(addDaysISO(weekISO, -7))}>‹</Button>
          <Button size="sm" onClick={() => setWeekISO(weekStartISO())}>Today</Button>
          <Button size="sm" onClick={() => setWeekISO(addDaysISO(weekISO, 7))}>›</Button>
          <span className="text-sm font-semibold text-zinc-700 ml-2 w-36 text-right">{fmtWeekRange(weekISO)}</span>
        </div>
      </div>

      <Card className="mb-5">
        {state.segments.length === 0 ? (
          <EmptyState
            icon={<span className="text-lg">📅</span>}
            title="No segments to schedule"
            hint="Create segments in Set Design first, then drag time blocks here."
          />
        ) : (
          <div className="p-3">
            <WeekGrid
              weekISO={weekISO}
              events={events}
              onDragCreate={(day, startMin, endMin) =>
                setDraft({ day, startMin, endMin, segmentId: state.segments[0]?.id ?? '' })
              }
            />
          </div>
        )}
      </Card>

      <Tracker segIndex={segIndex} />

      {draft && (
        <Modal
          title={draft.id ? 'Edit practice block' : 'Schedule practice'}
          onClose={() => setDraft(null)}
        >
          <Field label="Segment">
            <Select value={draft.segmentId} onChange={(e) => setDraft({ ...draft, segmentId: e.target.value })}>
              {state.segments.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Day">
            <Select value={draft.day} onChange={(e) => setDraft({ ...draft, day: Number(e.target.value) })}>
              {DAY_NAMES.map((d, i) => (
                <option key={d} value={i}>{d} · {fmtDate(addDaysISO(weekISO, i))}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <Select value={draft.startMin} onChange={(e) => setDraft({ ...draft, startMin: Number(e.target.value) })}>
                {TIME_OPTS.map((m) => <option key={m} value={m}>{minToLabel(m)}</option>)}
              </Select>
            </Field>
            <Field label="End">
              <Select value={draft.endMin} onChange={(e) => setDraft({ ...draft, endMin: Number(e.target.value) })}>
                {TIME_OPTS.filter((m) => m > draft.startMin).map((m) => <option key={m} value={m}>{minToLabel(m)}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex justify-between mt-2">
            {draft.id ? (
              <Button variant="danger" onClick={() => { removePracticeBlock(draft.id); setDraft(null) }}>
                Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button onClick={() => setDraft(null)}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={!draft.segmentId || draft.endMin <= draft.startMin}>
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Per-segment practice metrics. "Practiced" = the scheduled block's end time
// has passed (per your choice: scheduled = practiced).
function Tracker({ segIndex }) {
  const { state } = useStore()
  const now = new Date()
  const todayISO = toISODate(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const thisWeek = weekStartISO()

  const rows = state.segments.map((seg) => {
    const blocks = state.practiceBlocks.filter((b) => b.segmentId === seg.id)
    const past = blocks.filter(
      (b) => b.date < todayISO || (b.date === todayISO && b.endMin <= nowMin),
    )
    const totalMin = past.reduce((n, b) => n + (b.endMin - b.startMin), 0)
    const weekMin = blocks
      .filter((b) => addDaysISO(b.date, -dayIndexOfISO(b.date)) === thisWeek)
      .reduce((n, b) => n + (b.endMin - b.startMin), 0)
    const lastDate = past.map((b) => b.date).sort().at(-1) ?? null
    const upcoming = blocks.filter(
      (b) => b.date > todayISO || (b.date === todayISO && b.endMin > nowMin),
    ).length
    const staleDays = lastDate
      ? Math.round((now - new Date(lastDate)) / 86400000)
      : Infinity
    return { seg, totalMin, weekMin, lastDate, sessions: past.length, upcoming, staleDays }
  })

  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="Practice tracker"
        subtitle="Hours count once a scheduled block's time has passed."
      />
      <div className="px-5 pb-5 overflow-x-auto thin-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="pb-2 pr-3 font-medium">Segment</th>
              <th className="pb-2 pr-3 font-medium">Last practiced</th>
              <th className="pb-2 pr-3 font-medium">Total hours</th>
              <th className="pb-2 pr-3 font-medium">Sessions</th>
              <th className="pb-2 pr-3 font-medium">This week</th>
              <th className="pb-2 font-medium">Upcoming</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map(({ seg, totalMin, weekMin, lastDate, sessions, upcoming, staleDays }) => (
              <tr key={seg.id}>
                <td className="py-2.5 pr-3">
                  <span className="inline-flex items-center gap-2 font-medium text-zinc-800">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: segColor(segIndex[seg.id]) }} />
                    {seg.name}
                  </span>
                </td>
                <td className="py-2.5 pr-3">
                  {lastDate ? (
                    <span className="text-zinc-600">
                      {fmtDate(lastDate)} <span className="text-zinc-400">({relativeDays(lastDate)})</span>
                    </span>
                  ) : (
                    <Badge className="bg-red-100 text-red-700">never</Badge>
                  )}
                  {staleDays !== Infinity && staleDays > 7 && (
                    <Badge className="bg-amber-100 text-amber-800 ml-1.5">stale</Badge>
                  )}
                </td>
                <td className="py-2.5 pr-3 font-semibold text-zinc-800">{durationLabel(totalMin)}</td>
                <td className="py-2.5 pr-3 text-zinc-600">{sessions}</td>
                <td className="py-2.5 pr-3 text-zinc-600">{weekMin ? durationLabel(weekMin) : '—'}</td>
                <td className="py-2.5 text-zinc-600">{upcoming ? `${upcoming} block${upcoming > 1 ? 's' : ''}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
