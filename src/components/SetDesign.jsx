import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { putFile, getFile, deleteFile } from '../fileStore.js'
import { uid, segColor, MIX_STATUSES, SIDES, sideLabel } from '../lib.js'
import { Button, Card, CardHeader, Badge, Select, TextInput, EmptyState, Modal } from './ui.jsx'

// Loads a stored blob and exposes an object URL for it.
function useFileURL(fileId) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    let objectUrl = null
    setUrl(null)
    if (fileId) {
      getFile(fileId).then((blob) => {
        if (alive && blob) {
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        }
      })
    }
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId])
  return url
}

function UploadButton({ accept, label, onFile }) {
  const ref = useRef(null)
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <Button size="sm" onClick={() => ref.current?.click()}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 11V2M4.5 5.5L8 2l3.5 3.5M2.5 13.5h11" />
        </svg>
        {label}
      </Button>
    </>
  )
}

const mixStatusInfo = (v) => MIX_STATUSES.find((s) => s.value === v) ?? MIX_STATUSES[0]

export default function SetDesign() {
  const { state, addSegment } = useStore()
  const [selectedId, setSelectedId] = useState(state.segments[0]?.id ?? null)
  const selected = state.segments.find((s) => s.id === selectedId) ?? state.segments[0] ?? null

  const addNew = () => {
    const seg = addSegment(`Segment ${state.segments.length + 1}`)
    setSelectedId(seg.id)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 mb-1">Set Design</h1>
          <p className="text-sm text-zinc-500">
            Show lineup, forms, mixes, casting and stage traffic.
          </p>
        </div>
        <Button variant="primary" onClick={addNew}>+ New segment</Button>
      </div>

      {state.segments.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="text-lg">🎭</span>}
            title="No segments yet"
            hint="Create your first segment to upload forms, attach a mix and cast members."
            action={<Button variant="primary" onClick={addNew}>Create a segment</Button>}
          />
        </Card>
      ) : (
        <div className="flex gap-5 items-start">
          <Lineup selectedId={selected?.id} onSelect={setSelectedId} />
          {selected && <SegmentDetail key={selected.id} segment={selected} />}
        </div>
      )}
    </div>
  )
}

function Lineup({ selectedId, onSelect }) {
  const { state, moveSegment } = useStore()

  return (
    <Card className="w-64 shrink-0 sticky top-6">
      <CardHeader title="Show order" subtitle="Top runs first" />
      <ul className="px-3 pb-3 space-y-1">
        {state.segments.map((seg, i) => {
          const st = mixStatusInfo(seg.mixStatus)
          return (
            <li key={seg.id}>
              <div
                onClick={() => onSelect(seg.id)}
                className={`group flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${
                  seg.id === selectedId ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-100'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: segColor(i) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{seg.name}</div>
                  <div className={`text-[11px] ${seg.id === selectedId ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {i + 1} of {state.segments.length} · {seg.members.length} dancers · {st.label}
                  </div>
                </div>
                <div className={`flex flex-col ${seg.id === selectedId ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                  <button
                    className="text-[10px] leading-none px-1 py-0.5 hover:scale-125 transition-transform cursor-pointer disabled:opacity-20"
                    disabled={i === 0}
                    onClick={(e) => { e.stopPropagation(); moveSegment(seg.id, -1) }}
                    title="Move up"
                  >▲</button>
                  <button
                    className="text-[10px] leading-none px-1 py-0.5 hover:scale-125 transition-transform cursor-pointer disabled:opacity-20"
                    disabled={i === state.segments.length - 1}
                    onClick={(e) => { e.stopPropagation(); moveSegment(seg.id, 1) }}
                    title="Move down"
                  >▼</button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function SegmentDetail({ segment }) {
  const { state, updateSegment, removeSegment } = useStore()
  const idx = state.segments.findIndex((s) => s.id === segment.id)
  const [renaming, setRenaming] = useState(false)
  const [showCast, setShowCast] = useState(false)

  const deleteSegment = async () => {
    if (!confirm(`Delete "${segment.name}"? Its forms PDF, mix and practice history go with it.`)) return
    await deleteFile(segment.pdf?.fileId)
    await deleteFile(segment.audio?.fileId)
    removeSegment(segment.id)
  }

  return (
    <div className="flex-1 min-w-0 space-y-5">
      {/* Header card */}
      <Card>
        <div className="px-5 py-4 flex items-center gap-3">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: segColor(idx) }} />
          {renaming ? (
            <TextInput
              autoFocus
              defaultValue={segment.name}
              onBlur={(e) => {
                if (e.target.value.trim()) updateSegment(segment.id, { name: e.target.value.trim() })
                setRenaming(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
            />
          ) : (
            <h2 className="text-lg font-bold text-zinc-900 flex-1 truncate">{segment.name}</h2>
          )}
          <Badge className="bg-zinc-100 text-zinc-600">#{idx + 1} in show</Badge>
          <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>Rename</Button>
          <Button size="sm" variant="danger" onClick={deleteSegment}>Delete</Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <MixCard segment={segment} />
        <NotesCard segment={segment} />
      </div>

      <CastCard segment={segment} idx={idx} onOpenPicker={() => setShowCast(true)} />
      <FormsCard segment={segment} />

      {showCast && <CastPicker segment={segment} onClose={() => setShowCast(false)} />}
    </div>
  )
}

// ---- Forms PDF ----

function FormsCard({ segment }) {
  const { updateSegment } = useStore()
  const url = useFileURL(segment.pdf?.fileId)

  const upload = async (file) => {
    const id = uid()
    await putFile(id, file)
    await deleteFile(segment.pdf?.fileId)
    updateSegment(segment.id, { pdf: { fileId: id, name: file.name } })
  }

  const remove = async () => {
    if (!confirm('Remove the forms PDF?')) return
    await deleteFile(segment.pdf?.fileId)
    updateSegment(segment.id, { pdf: null })
  }

  return (
    <Card>
      <CardHeader
        title="Forms (ArrangeUs PDF)"
        subtitle={segment.pdf ? segment.pdf.name : 'Export your forms from ArrangeUs as a PDF and upload it here.'}
        actions={
          <div className="flex gap-2">
            <UploadButton accept="application/pdf" label={segment.pdf ? 'Replace PDF' : 'Upload PDF'} onFile={upload} />
            {segment.pdf && <Button size="sm" variant="ghost" className="text-red-500" onClick={remove}>Remove</Button>}
          </div>
        }
      />
      {segment.pdf ? (
        url ? (
          <div className="px-5 pb-5">
            <iframe
              title="Forms PDF"
              src={url}
              className="w-full h-[36rem] rounded-xl border border-zinc-200 bg-zinc-50"
            />
          </div>
        ) : (
          <div className="px-5 pb-5 text-sm text-zinc-400">Loading PDF…</div>
        )
      ) : (
        <EmptyState
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
              <path d="M14 3v5h5" />
            </svg>
          }
          title="No forms uploaded"
          hint="Upload the segment's formation PDF to scroll through it right here."
        />
      )}
    </Card>
  )
}

// ---- Audio mix ----

function MixCard({ segment }) {
  const { updateSegment } = useStore()
  const url = useFileURL(segment.audio?.fileId)
  const status = mixStatusInfo(segment.mixStatus)

  const upload = async (file) => {
    const id = uid()
    await putFile(id, file)
    await deleteFile(segment.audio?.fileId)
    updateSegment(segment.id, { audio: { fileId: id, name: file.name } })
  }

  const remove = async () => {
    if (!confirm('Remove the audio mix?')) return
    await deleteFile(segment.audio?.fileId)
    updateSegment(segment.id, { audio: null })
  }

  return (
    <Card>
      <CardHeader
        title="Audio mix"
        subtitle={segment.audio ? segment.audio.name : 'Upload the current cut of this segment’s mix.'}
        actions={
          <Badge className={status.cls}>{status.label}</Badge>
        }
      />
      <div className="px-5 pb-5 space-y-3">
        {segment.audio && (
          url
            ? <audio controls src={url} className="w-full" />
            : <div className="text-sm text-zinc-400">Loading audio…</div>
        )}
        <div className="flex items-center gap-2">
          <UploadButton accept="audio/*" label={segment.audio ? 'Replace mix' : 'Upload mix'} onFile={upload} />
          <Select
            value={segment.mixStatus}
            onChange={(e) => updateSegment(segment.id, { mixStatus: e.target.value })}
            className="!w-auto"
          >
            {MIX_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
          {segment.audio && (
            <Button size="sm" variant="ghost" className="text-red-500" onClick={remove}>Remove</Button>
          )}
        </div>
      </div>
    </Card>
  )
}

// ---- Notes ----

function NotesCard({ segment }) {
  const { updateSegment } = useStore()
  return (
    <Card>
      <CardHeader title="Notes" subtitle="Production details, people, ideas." />
      <div className="px-5 pb-5">
        <textarea
          className="w-full h-32 px-3 py-2 text-sm bg-white border border-zinc-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-400/40 resize-y placeholder:text-zinc-400"
          placeholder="e.g. Props enter with back row · lighting cue on the beat drop · Riya leads the front block…"
          value={segment.notes}
          onChange={(e) => updateSegment(segment.id, { notes: e.target.value })}
        />
      </div>
    </Card>
  )
}

// ---- Cast (members in segment) ----

function CastCard({ segment, idx, onOpenPicker }) {
  const { state, setMemberSide, toggleSegmentMember } = useStore()
  const prevSeg = state.segments[idx - 1] ?? null
  const nextSeg = state.segments[idx + 1] ?? null

  const totalCounts = useMemo(() => {
    const counts = {}
    for (const seg of state.segments)
      for (const m of seg.members) counts[m.memberId] = (counts[m.memberId] || 0) + 1
    return counts
  }, [state.segments])

  const rows = segment.members
    .map((entry) => {
      const member = state.roster.find((r) => r.id === entry.memberId)
      if (!member) return null
      const prevEntry = prevSeg?.members.find((m) => m.memberId === entry.memberId) ?? null
      const nextEntry = nextSeg?.members.find((m) => m.memberId === entry.memberId) ?? null
      const warnings = []
      if (prevEntry && prevEntry.exitSide && entry.enterSide && prevEntry.exitSide !== entry.enterSide)
        warnings.push(`Exits “${prevSeg.name}” ${sideLabel(prevEntry.exitSide)} but enters this segment ${sideLabel(entry.enterSide)}`)
      if (nextEntry && entry.exitSide && nextEntry.enterSide && entry.exitSide !== nextEntry.enterSide)
        warnings.push(`Exits this segment ${sideLabel(entry.exitSide)} but enters “${nextSeg.name}” ${sideLabel(nextEntry.enterSide)}`)
      return { entry, member, prevEntry, nextEntry, warnings, total: totalCounts[entry.memberId] || 0 }
    })
    .filter(Boolean)
    .sort((a, b) => a.member.name.localeCompare(b.member.name))

  const warningCount = rows.reduce((n, r) => n + r.warnings.length, 0)

  return (
    <Card>
      <CardHeader
        title={`Cast (${rows.length})`}
        subtitle="Entry/exit sides power the quick-change warnings between back-to-back segments."
        actions={
          <div className="flex items-center gap-2">
            {warningCount > 0 && (
              <Badge className="bg-red-100 text-red-700">⚠ {warningCount} quick-change risk{warningCount > 1 ? 's' : ''}</Badge>
            )}
            <Button size="sm" onClick={onOpenPicker}>Edit cast</Button>
          </div>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<span className="text-lg">🕺</span>}
          title="Nobody cast yet"
          hint="Pick who dances this segment from the roster."
          action={<Button variant="primary" onClick={onOpenPicker}>Select dancers</Button>}
        />
      ) : (
        <div className="px-5 pb-5 overflow-x-auto thin-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="pb-2 pr-3 font-medium">Dancer</th>
                <th className="pb-2 pr-3 font-medium">Adjacent segments</th>
                <th className="pb-2 pr-3 font-medium">Total</th>
                <th className="pb-2 pr-3 font-medium">Enters from</th>
                <th className="pb-2 pr-3 font-medium">Exits to</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(({ entry, member, prevEntry, nextEntry, warnings, total }) => (
                <tr key={member.id} className="align-top">
                  <td className="py-2.5 pr-3 font-medium text-zinc-800 whitespace-nowrap">{member.name}</td>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {prevEntry && <Badge className="bg-violet-100 text-violet-700">← in previous</Badge>}
                      {nextEntry && <Badge className="bg-sky-100 text-sky-700">in next →</Badge>}
                      {!prevEntry && !nextEntry && <span className="text-xs text-zinc-400">rests around this one</span>}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge className={total >= 5 ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-600'}>
                      {total} seg{total !== 1 ? 's' : ''}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-3">
                    <SideSelect value={entry.enterSide} onChange={(v) => setMemberSide(segment.id, member.id, 'enterSide', v)} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <SideSelect value={entry.exitSide} onChange={(v) => setMemberSide(segment.id, member.id, 'exitSide', v)} />
                  </td>
                  <td className="py-2.5">
                    {warnings.length > 0 && (
                      <span className="text-red-600 text-xs" title={warnings.join('\n')}>⚠ {warnings.length}</span>
                    )}
                    <button
                      className="ml-2 text-zinc-300 hover:text-red-500 cursor-pointer text-xs"
                      title="Remove from segment"
                      onClick={() => toggleSegmentMember(segment.id, member.id)}
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {warningCount > 0 && (
            <div className="mt-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3 space-y-1">
              {rows.flatMap(({ member, warnings }) =>
                warnings.map((w, i) => (
                  <p key={member.id + i} className="text-xs text-red-700">
                    <span className="font-semibold">{member.name}:</span> {w}
                  </p>
                )),
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function SideSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1 text-xs bg-white border border-zinc-300 rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-zinc-400/40"
    >
      {SIDES.map((s) => (
        <option key={s.value} value={s.value}>{s.value === '' ? '—' : s.label}</option>
      ))}
    </select>
  )
}

function CastPicker({ segment, onClose }) {
  const { state, toggleSegmentMember } = useStore()
  const [query, setQuery] = useState('')
  const inSeg = new Set(segment.members.map((m) => m.memberId))
  const visible = state.roster
    .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Modal title={`Cast — ${segment.name}`} onClose={onClose}>
      {state.roster.length === 0 ? (
        <p className="text-sm text-zinc-500">
          The roster is empty — add members in the Roster tab first.
        </p>
      ) : (
        <>
          <TextInput placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="mt-3 grid grid-cols-2 gap-1.5 max-h-80 overflow-y-auto thin-scroll">
            {visible.map((m) => {
              const active = inSeg.has(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => toggleSegmentMember(segment.id, m.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-colors cursor-pointer border ${
                    active
                      ? 'bg-zinc-900 text-white border-zinc-900'
                      : 'bg-white border-zinc-200 hover:border-zinc-400'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-md flex items-center justify-center text-[10px] ${active ? 'bg-white text-zinc-900' : 'border border-zinc-300'}`}>
                    {active ? '✓' : ''}
                  </span>
                  <span className="truncate">{m.name}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}
