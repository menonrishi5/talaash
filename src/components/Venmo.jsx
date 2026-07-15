import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { supabase } from '../supabase.js'
import { buildMatcher } from '../matching.js'
import { Button, Card, CardHeader, Badge, Select, EmptyState, inputCls } from './ui.jsx'
import { parseVenmoCSV } from '../venmoImport.js'

// Venmo ledger (editors only — treasury data). Venmo has no API, so this is
// fed by importing monthly statement CSVs from venmo.com; the transaction ID
// is the primary key, so re-importing overlapping statements never duplicates.

const cents = (c) => {
  const abs = Math.abs(c)
  return `$${(abs / 100) % 1 ? (abs / 100).toFixed(2) : abs / 100}`
}

const CATEGORIES = [
  'Reimbursement', 'Props', 'Costumes', 'Food', 'Travel',
  'Production', 'Competition', 'Venue', 'Income', 'Other',
]

export default function VenmoTab() {
  const { state } = useStore()
  const [txns, setTxns] = useState(null)
  const [importMsg, setImportMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [dirFilter, setDirFilter] = useState('out') // out | in | all
  const fileRef = useRef(null)

  const load = async () => {
    const { data } = await supabase
      .from('venmo_transactions')
      .select('*')
      .order('datetime', { ascending: false })
    if (data) setTxns(data)
  }
  useEffect(() => {
    load()
  }, [])

  const matcher = useMemo(
    () => buildMatcher(state.roster, state.dues.contactLinks),
    [state.roster, state.dues.contactLinks],
  )
  const matchName = (name) => {
    if (!name) return null
    const words = name.trim().split(/\s+/)
    return matcher({
      buyer_first: words[0],
      buyer_last: words.slice(1).join(' ') || null,
      buyer_email: null,
    })
  }

  const importFile = async (file) => {
    setBusy(true)
    setImportMsg(null)
    try {
      const text = await file.text()
      const { rows, errors, skipped } = parseVenmoCSV(text)
      if (rows.length === 0) {
        setImportMsg({ kind: 'error', text: errors[0] ?? 'No transactions found in that file.' })
        return
      }
      const existing = new Set((txns ?? []).map((t) => t.id))
      const fresh = rows.filter((r) => !existing.has(r.id))
      // Prefill: outbound recipient matched to roster; notes mentioning
      // reimbursement get categorized. Everything stays editable.
      const prepared = fresh.map((r) => ({
        ...r,
        member_id: matchName(r.amount_cents < 0 ? r.to_name : r.from_name),
        category: /reimburs/i.test(r.note ?? '') ? 'Reimbursement' : null,
      }))
      if (prepared.length > 0) {
        const { error } = await supabase.from('venmo_transactions').upsert(prepared)
        if (error) throw error
      }
      await load()
      setImportMsg({
        kind: 'ok',
        text: `Imported ${prepared.length} new transaction${prepared.length === 1 ? '' : 's'}` +
          `${rows.length - fresh.length ? `, ${rows.length - fresh.length} already known` : ''}` +
          `${errors.length ? ` — ${errors.length} row(s) unreadable` : ''}.`,
      })
    } catch (e) {
      console.error(e)
      setImportMsg({ kind: 'error', text: 'Import failed: ' + (e.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  const update = async (id, patch) => {
    const { error } = await supabase.from('venmo_transactions').update(patch).eq('id', id)
    if (error) alert('Could not save: ' + error.message)
    load()
  }

  const memberName = (id) => state.roster.find((m) => m.id === id)?.name

  const visible = (txns ?? [])
    .filter((t) => (dirFilter === 'all' ? true : dirFilter === 'out' ? t.amount_cents < 0 : t.amount_cents > 0))
    .filter((t) => {
      const q = query.toLowerCase()
      return !q ||
        (t.note ?? '').toLowerCase().includes(q) ||
        (t.to_name ?? '').toLowerCase().includes(q) ||
        (t.from_name ?? '').toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q) ||
        (memberName(t.member_id) ?? '').toLowerCase().includes(q)
    })

  // Category totals over OUTBOUND money (the reporting Rishi asked for).
  const outTotals = useMemo(() => {
    const map = {}
    let total = 0
    for (const t of txns ?? []) {
      if (t.amount_cents >= 0) continue
      const cat = t.category ?? 'Uncategorized'
      map[cat] = (map[cat] || 0) + -t.amount_cents
      total += -t.amount_cents
    }
    return { map, total }
  }, [txns])

  return (
    <>
      <Card className="mb-5">
        <CardHeader
          title="Import a Venmo statement"
          subtitle="venmo.com → Settings → Statements → Download CSV (one per month). Re-importing overlapping months is safe — known transactions are skipped."
          actions={
            <>
              <input
                ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) importFile(f)
                  e.target.value = ''
                }}
              />
              <Button variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? 'Importing…' : '⇪ Import CSV'}
              </Button>
            </>
          }
        />
        {importMsg && (
          <p className={`px-5 pb-4 text-sm ${importMsg.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
            {importMsg.text}
          </p>
        )}
      </Card>

      {Object.keys(outTotals.map).length > 0 && (
        <Card className="mb-5">
          <CardHeader title={`Money out: ${cents(outTotals.total)}`} subtitle="By category — classify transactions below to refine this." />
          <div className="px-5 pb-5 flex flex-wrap gap-2">
            {Object.entries(outTotals.map).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <Badge key={cat} className={cat === 'Uncategorized' ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-700'}>
                {cat}: {cents(amt)}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`Transactions (${visible.length})`}
          actions={
            <div className="flex items-center gap-2">
              <Select className="!w-32 !py-1.5" value={dirFilter} onChange={(e) => setDirFilter(e.target.value)}>
                <option value="out">Money out</option>
                <option value="in">Money in</option>
                <option value="all">All</option>
              </Select>
              <input
                className={`${inputCls} !w-52 !py-1.5`}
                placeholder="Search note, name, category…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          }
        />
        {txns === null ? (
          <p className="px-5 pb-5 text-sm text-zinc-400">Loading…</p>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<span className="text-lg">💸</span>}
            title="No transactions yet"
            hint="Import a Venmo statement CSV above to start the outbound ledger."
          />
        ) : (
          <div className="px-5 pb-5 overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Counterparty</th>
                  <th className="pb-2 pr-3 font-medium">Note</th>
                  <th className="pb-2 pr-3 font-medium">Category</th>
                  <th className="pb-2 pr-3 font-medium">Member</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visible.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap">
                      {t.datetime ? new Date(t.datetime).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2 pr-3 font-medium text-zinc-800 whitespace-nowrap">
                      {t.amount_cents < 0 ? t.to_name : t.from_name}
                      {t.status && t.status !== 'Complete' && (
                        <Badge className="bg-amber-50 text-amber-700 ml-1.5">{t.status}</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-zinc-600 max-w-56 truncate" title={t.note ?? ''}>{t.note || '—'}</td>
                    <td className="py-2 pr-3">
                      <select
                        className="px-2 py-1 text-xs bg-white border border-zinc-300 rounded-lg cursor-pointer"
                        value={t.category ?? ''}
                        onChange={(e) => update(t.id, { category: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="px-2 py-1 text-xs bg-white border border-zinc-300 rounded-lg cursor-pointer"
                        value={t.member_id ?? ''}
                        onChange={(e) => update(t.id, { member_id: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {state.roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </td>
                    <td className={`py-2 text-right font-semibold whitespace-nowrap ${t.amount_cents < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {t.amount_cents < 0 ? '−' : '+'}{cents(t.amount_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
