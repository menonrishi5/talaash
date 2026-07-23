import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { putFile, deleteFile, fileURL } from '../fileStore.js'
import { uid, segColor, MIX_STATUSES, SIDES, sideLabel } from '../lib.js'
import { isActive } from '../matching.js'
import { readFormPages, detectMemberSides, pageToStage } from '../formReader.js'
import { Button, Card, CardHeader, Badge, Select, TextInput, EmptyState, Modal } from './ui.jsx'

function UploadButton({ accept, label, onFile }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const handle = async (f) => {
    setBusy(true)
    try {
      await onFile(f)
    } catch (e) {
      console.error(e)
      alert('Upload failed — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handle(f)
          e.target.value = ''
        }}
      />
      <Button size="sm" disabled={busy} onClick={() => ref.current?.click()}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 11V2M4.5 5.5L8 2l3.5 3.5M2.5 13.5h11" />
        </svg>
        {busy ? 'Uploading…' : label}
      </Button>
    </>
  )
}

const mixStatusInfo = (v) => MIX_STATUSES.find((s) => s.value === v) ?? MIX_STATUSES[0]

export default function SetDesign() {
  const { state, addSegment } = useStore()
  const { canEdit } = useAuth()
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
          <h1 className="text-xl font-bold text-ink mb-1">Set Design</h1>
          <p className="text-sm text-muted">
            Show lineup, forms, mixes, casting and stage traffic.
          </p>
        </div>
        {canEdit && <Button variant="primary" onClick={addNew}>+ New segment</Button>}
      </div>

      {state.segments.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="text-lg">🎭</span>}
            title="No segments yet"
            hint={canEdit
              ? 'Create your first segment to upload forms, attach a mix and cast members.'
              : 'An editor can build the show lineup here.'}
            action={canEdit ? <Button variant="primary" onClick={addNew}>Create a segment</Button> : null}
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
  const { canEdit } = useAuth()

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
                  seg.id === selectedId ? 'bg-accent text-accent-ink' : 'hover:bg-subtle'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: segColor(i) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{seg.name}</div>
                  <div className={`text-[11px] ${seg.id === selectedId ? 'text-faint' : 'text-muted'}`}>
                    {i + 1} of {state.segments.length} · {seg.members.length} dancers · {st.label}
                  </div>
                </div>
                <div className={`${canEdit ? 'flex' : 'hidden'} flex-col ${seg.id === selectedId ? '' : 'opacity-0 group-hover:opacity-100'}`}>
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
  const { canEdit } = useAuth()
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
            <h2 className="text-lg font-bold text-ink flex-1 truncate">{segment.name}</h2>
          )}
          <Badge className="bg-subtle text-muted">#{idx + 1} in show</Badge>
          {canEdit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>Rename</Button>
              <Button size="sm" variant="danger" onClick={deleteSegment}>Delete</Button>
            </>
          )}
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
  const { canEdit } = useAuth()
  const url = fileURL(segment.pdf?.fileId)

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
          canEdit ? (
            <div className="flex gap-2">
              <UploadButton accept="application/pdf" label={segment.pdf ? 'Replace PDF' : 'Upload PDF'} onFile={upload} />
              {segment.pdf && <Button size="sm" variant="ghost" className="text-bad" onClick={remove}>Remove</Button>}
            </div>
          ) : null
        }
      />
      {segment.pdf ? (
        url ? (
          <div className="px-5 pb-5">
            <iframe
              title="Forms PDF"
              src={url}
              className="w-full h-[36rem] rounded-xl border border-line bg-subtle"
            />
          </div>
        ) : (
          <div className="px-5 pb-5 text-sm text-faint">Loading PDF…</div>
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
  const { canEdit } = useAuth()
  const url = fileURL(segment.audio?.fileId)
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
            : <div className="text-sm text-faint">Loading audio…</div>
        )}
        {canEdit && (
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
              <Button size="sm" variant="ghost" className="text-bad" onClick={remove}>Remove</Button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// ---- Notes ----

function NotesCard({ segment }) {
  const { updateSegment } = useStore()
  const { canEdit } = useAuth()
  return (
    <Card>
      <CardHeader title="Notes" subtitle="Production details, people, ideas." />
      <div className="px-5 pb-5">
        <textarea
          className="w-full h-32 px-3 py-2 text-sm bg-surface border border-line-strong rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/30 resize-y placeholder:text-faint read-only:bg-subtle read-only:text-muted"
          placeholder={canEdit ? 'e.g. Props enter with back row · lighting cue on the beat drop · Riya leads the front block…' : 'No notes yet.'}
          value={segment.notes}
          readOnly={!canEdit}
          onChange={(e) => updateSegment(segment.id, { notes: e.target.value })}
        />
      </div>
    </Card>
  )
}

// ---- Cast (members in segment) ----

function CastCard({ segment, idx, onOpenPicker }) {
  const { state, setMemberSide, toggleSegmentMember } = useStore()
  const { canEdit } = useAuth()
  const [detectOpen, setDetectOpen] = useState(false)
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
              <Badge className="bg-bad-soft text-bad">⚠ {warningCount} quick-change risk{warningCount > 1 ? 's' : ''}</Badge>
            )}
            {canEdit && segment.pdf && rows.length > 0 && (
              <Button size="sm" onClick={() => setDetectOpen(true)}>✨ Auto-detect sides</Button>
            )}
            {canEdit && <Button size="sm" onClick={onOpenPicker}>Edit cast</Button>}
          </div>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<span className="text-lg">🕺</span>}
          title="Nobody cast yet"
          hint={canEdit ? 'Pick who dances this segment from the roster.' : 'An editor can cast this segment.'}
          action={canEdit ? <Button variant="primary" onClick={onOpenPicker}>Select dancers</Button> : null}
        />
      ) : (
        <div className="px-5 pb-5 overflow-x-auto thin-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="pb-2 pr-3 font-medium">Dancer</th>
                <th className="pb-2 pr-3 font-medium">Adjacent segments</th>
                <th className="pb-2 pr-3 font-medium">Total</th>
                <th className="pb-2 pr-3 font-medium">Enters from</th>
                <th className="pb-2 pr-3 font-medium">Exits to</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ entry, member, prevEntry, nextEntry, warnings, total }) => (
                <tr key={member.id} className="align-top">
                  <td className="py-2.5 pr-3 font-medium text-ink whitespace-nowrap">
                    {member.name}
                    {!isActive(member) && (
                      <Badge className="bg-warn-soft text-warn ml-1.5" title="This member is inactive — consider recasting">inactive</Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {prevEntry && <Badge className="bg-special-soft text-special">← in previous</Badge>}
                      {nextEntry && <Badge className="bg-info-soft text-info">in next →</Badge>}
                      {!prevEntry && !nextEntry && <span className="text-xs text-faint">rests around this one</span>}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge className={total >= 5 ? 'bg-warn-soft text-warn' : 'bg-subtle text-muted'}>
                      {total} seg{total !== 1 ? 's' : ''}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-3">
                    <SideSelect disabled={!canEdit} value={entry.enterSide} onChange={(v) => setMemberSide(segment.id, member.id, 'enterSide', v)} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <SideSelect disabled={!canEdit} value={entry.exitSide} onChange={(v) => setMemberSide(segment.id, member.id, 'exitSide', v)} />
                  </td>
                  <td className="py-2.5">
                    {warnings.length > 0 && (
                      <span className="text-bad text-xs" title={warnings.join('\n')}>⚠ {warnings.length}</span>
                    )}
                    {canEdit && (
                      <button
                        className="ml-2 text-faint hover:text-bad cursor-pointer text-xs"
                        title="Remove from segment"
                        onClick={() => toggleSegmentMember(segment.id, member.id)}
                      >✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {warningCount > 0 && (
            <div className="mt-3 rounded-xl bg-bad-soft border border-bad/20 px-4 py-3 space-y-1">
              {rows.flatMap(({ member, warnings }) =>
                warnings.map((w, i) => (
                  <p key={member.id + i} className="text-xs text-bad">
                    <span className="font-semibold">{member.name}:</span> {w}
                  </p>
                )),
              )}
            </div>
          )}
        </div>
      )}
      {detectOpen && <SideDetectModal segment={segment} onClose={() => setDetectOpen(false)} />}
    </Card>
  )
}

// Reads the forms PDF and proposes enter/exit sides from each dancer's
// position on the first and last page. Suggestions only — nothing is applied
// until confirmed, and every value stays editable afterward.
function SideDetectModal({ segment, onClose }) {
  const { state, setMemberSide, setSettings } = useStore()
  const [status, setStatus] = useState('reading') // reading | ready | empty | error
  const [detected, setDetected] = useState([])
  const [numPages, setNumPages] = useState(0)
  const leftIsStageLeft = state.settings.pdfLeftIsStageLeft !== false

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const pages = await readFormPages(fileURL(segment.pdf.fileId))
        if (!alive) return
        setNumPages(pages.numPages)
        if (pages.first.length === 0 && pages.last.length === 0) {
          setStatus('empty')
          return
        }
        const cast = segment.members
          .map((mm) => state.roster.find((r) => r.id === mm.memberId))
          .filter(Boolean)
        setDetected(detectMemberSides(pages, cast))
        setStatus('ready')
      } catch (e) {
        console.error(e)
        if (alive) setStatus('error')
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment.pdf?.fileId])

  const matched = detected.filter((d) => d.enterPage || d.exitPage)
  const unmatched = detected.filter((d) => !d.enterPage && !d.exitPage)

  const apply = () => {
    for (const d of matched) {
      if (d.enterPage) setMemberSide(segment.id, d.memberId, 'enterSide', pageToStage(d.enterPage, leftIsStageLeft))
      if (d.exitPage) setMemberSide(segment.id, d.memberId, 'exitSide', pageToStage(d.exitPage, leftIsStageLeft))
    }
    onClose()
  }

  return (
    <Modal title={`Auto-detect sides — ${segment.name}`} onClose={onClose} wide>
      {status === 'reading' && <p className="text-sm text-faint">Reading the forms PDF…</p>}
      {status === 'error' && (
        <p className="text-sm text-bad">Couldn't read that PDF — try re-uploading it, or set sides manually.</p>
      )}
      {status === 'empty' && (
        <p className="text-sm text-muted">
          This PDF has no readable text — it's exported as images, so names can't be located
          automatically. Sides stay manual for this one. (If ArrangeUs offers a text-based PDF
          export option, that one would work.)
        </p>
      )}
      {status === 'ready' && (
        <>
          <p className="text-xs text-muted mb-2">
            Positions read from page 1 (enter) and page {numPages} (exit), split into stage thirds.
            Review, adjust the orientation if sides look mirrored, then apply. Everything stays
            editable in the cast table afterward.
          </p>
          <label className="flex items-center gap-2 text-xs text-muted mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={leftIsStageLeft}
              onChange={(e) => setSettings({ pdfLeftIsStageLeft: e.target.checked })}
            />
            Left side of the PDF page is the dancers' Stage Left (uncheck if your charts are drawn
            from the audience's view)
          </label>
          {matched.length === 0 ? (
            <p className="text-sm text-muted">
              The PDF has text, but none of it matches this segment's cast names — are the names on
              the forms different from the roster names?
            </p>
          ) : (
            <table className="w-full text-sm mb-3">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="pb-1.5 pr-3 font-medium">Dancer</th>
                  <th className="pb-1.5 pr-3 font-medium">Enters from</th>
                  <th className="pb-1.5 font-medium">Exits to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {matched.map((d) => (
                  <tr key={d.memberId}>
                    <td className="py-1.5 pr-3 font-medium text-ink">{d.name}</td>
                    <td className="py-1.5 pr-3 text-muted">
                      {d.enterPage ? sideLabel(pageToStage(d.enterPage, leftIsStageLeft)) : <span className="text-faint">not found on page 1</span>}
                    </td>
                    <td className="py-1.5 text-muted">
                      {d.exitPage ? sideLabel(pageToStage(d.exitPage, leftIsStageLeft)) : <span className="text-faint">not found on last page</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {unmatched.length > 0 && (
            <p className="text-[11px] text-faint mb-3">
              Not found in the PDF: {unmatched.map((d) => d.name).join(', ')} — set theirs manually.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={matched.length === 0} onClick={apply}>
              Apply {matched.length ? `to ${matched.length} dancer${matched.length > 1 ? 's' : ''}` : ''}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function SideSelect({ value, onChange, disabled }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1 text-xs bg-surface border border-line-strong rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:bg-subtle disabled:cursor-default"
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
  // Inactive members can't be newly cast, but stay listed if already in the
  // segment so they can be removed.
  const visible = state.roster
    .filter((m) => isActive(m) || inSeg.has(m.id))
    .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Modal title={`Cast — ${segment.name}`} onClose={onClose}>
      {state.roster.length === 0 ? (
        <p className="text-sm text-muted">
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
                      ? 'bg-accent text-accent-ink border-accent'
                      : 'bg-surface border-line hover:border-line-strong'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-md flex items-center justify-center text-[10px] ${active ? 'bg-surface text-ink' : 'border border-line-strong'}`}>
                    {active ? '✓' : ''}
                  </span>
                  <span className="truncate">{m.name}{!isActive(m) ? ' (inactive)' : ''}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}
