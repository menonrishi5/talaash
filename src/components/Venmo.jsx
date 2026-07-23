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
  const [reimbs, setReimbs] = useState([])
  const [importMsg, setImportMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [dirFilter, setDirFilter] = useState('out') // out | in | all
  const [picks, setPicks] = useState({}) // txn id -> reimbursement id (suggestions)
  const fileRef = useRef(null)

  const load = async () => {
    const [{ data }, { data: rb }] = await Promise.all([
      supabase.from('venmo_transactions').select('*').order('datetime', { ascending: false }),
      supabase.from('reimbursements').select('*').in('status', ['approved', 'paid']),
    ])
    if (data) setTxns(data)
    if (rb) setReimbs(rb)
  }
  useEffect(() => {
    load()
  }, [])

  // What the team actually owes them: approved amount minus the dues credit.
  const payoutCents = (r) => (r.approved_amount_cents ?? r.amount_cents) - (r.dues_credit_cents ?? 0)

  // Settle a reimbursement with a specific Venmo payment: marks it paid for
  // the transaction amount and links the two so neither matches again.
  const applyMatch = async (txn, r) => {
    const { error: e1 } = await supabase
      .from('reimbursements')
      .update({
        status: 'paid',
        paid_amount_cents: -txn.amount_cents,
        paid_at: txn.datetime ?? new Date().toISOString(),
      })
      .eq('id', r.id)
    if (e1) return alert('Could not mark the reimbursement paid: ' + e1.message)
    const { error: e2 } = await supabase
      .from('venmo_transactions')
      .update({ reimbursement_id: r.id, category: 'Reimbursement', member_id: r.member_id })
      .eq('id', txn.id)
    if (e2) alert('Reimbursement marked paid, but linking the transaction failed: ' + e2.message)
    load()
  }

  // Auto-reconcile: an outbound payment to a member whose ONE awaiting-payout
  // reimbursement equals the amount exactly is settled automatically.
  const autoReconcile = async (candidateTxns, matchFn) => {
    const { data: rb } = await supabase
      .from('reimbursements').select('*').eq('status', 'approved')
    const open = (rb ?? []).filter((r) => r.member_id && payoutCents(r) > 0)
    const usedReimb = new Set()
    let applied = 0
    for (const txn of candidateTxns) {
      if (txn.amount_cents >= 0 || txn.reimbursement_id) continue
      const memberId = txn.member_id ?? matchFn(txn.to_name)
      if (!memberId) continue
      const exact = open.filter(
        (r) => r.member_id === memberId && payoutCents(r) === -txn.amount_cents && !usedReimb.has(r.id),
      )
      if (exact.length !== 1) continue // ambiguous or none -> leave for suggestions
      usedReimb.add(exact[0].id)
      await applyMatch(txn, exact[0])
      applied++
    }
    return applied
  }

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
      // Settle any reimbursements this statement clearly paid out.
      const settled = prepared.length > 0 ? await autoReconcile(prepared, matchName) : 0
      await load()
      setImportMsg({
        kind: 'ok',
        text: `Imported ${prepared.length} new transaction${prepared.length === 1 ? '' : 's'}` +
          `${rows.length - fresh.length ? `, ${rows.length - fresh.length} already known` : ''}` +
          `${settled ? ` · ${settled} reimbursement${settled > 1 ? 's' : ''} auto-marked paid` : ''}` +
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
          <p className={`px-5 pb-4 text-sm ${importMsg.kind === 'error' ? 'text-bad' : 'text-good'}`}>
            {importMsg.text}
          </p>
        )}
      </Card>

      {(() => {
        // Outbound payments that look like reimbursement payouts but weren't
        // auto-settled (off amounts, several open requests, etc.).
        const openReimbs = reimbs.filter((r) => r.status === 'approved' && r.member_id && payoutCents(r) > 0)
        const suggestions = (txns ?? [])
          .filter((t) => t.amount_cents < 0 && !t.reimbursement_id)
          .map((t) => ({ txn: t, memberId: t.member_id ?? matchName(t.to_name) }))
          .filter((s) => s.memberId && openReimbs.some((r) => r.member_id === s.memberId))
        if (suggestions.length === 0) return null
        return (
          <Card className="mb-5">
            <CardHeader
              title={`Possible reimbursement payouts (${suggestions.length})`}
              subtitle="These outbound payments went to members with an approved reimbursement awaiting payout. Link them to mark the reimbursement paid."
            />
            <ul className="px-5 pb-5 divide-y divide-line">
              {suggestions.map(({ txn, memberId }) => {
                const options = openReimbs.filter((r) => r.member_id === memberId)
                const exact = options.find((r) => payoutCents(r) === -txn.amount_cents)
                const picked = picks[txn.id] ?? exact?.id ?? ''
                const chosen = options.find((r) => r.id === picked)
                return (
                  <li key={txn.id} className="py-2 flex items-center gap-3 flex-wrap text-sm">
                    <span className="font-medium text-ink">{txn.to_name}</span>
                    <Badge className="bg-red-50 text-bad">−{cents(txn.amount_cents)}</Badge>
                    <span className="text-xs text-faint">
                      {txn.datetime ? new Date(txn.datetime).toLocaleDateString() : '—'}{txn.note ? ` · ${txn.note}` : ''}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <Select
                        className="!w-64 !py-1.5"
                        value={picked}
                        onChange={(e) => setPicks({ ...picks, [txn.id]: e.target.value })}
                      >
                        <option value="">Link to reimbursement…</option>
                        {options.map((r) => (
                          <option key={r.id} value={r.id}>
                            {cents(payoutCents(r))} owed — {r.description?.slice(0, 40)}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="success" disabled={!chosen} onClick={() => applyMatch(txn, chosen)}>
                        Mark paid
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })()}

      {Object.keys(outTotals.map).length > 0 && (
        <Card className="mb-5">
          <CardHeader title={`Money out: ${cents(outTotals.total)}`} subtitle="By category — classify transactions below to refine this." />
          <div className="px-5 pb-5 flex flex-wrap gap-2">
            {Object.entries(outTotals.map).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <Badge key={cat} className={cat === 'Uncategorized' ? 'bg-warn-soft text-warn' : 'bg-subtle text-ink'}>
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
          <p className="px-5 pb-5 text-sm text-faint">Loading…</p>
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
                <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Counterparty</th>
                  <th className="pb-2 pr-3 font-medium">Note</th>
                  <th className="pb-2 pr-3 font-medium">Category</th>
                  <th className="pb-2 pr-3 font-medium">Member</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-3 text-muted whitespace-nowrap">
                      {t.datetime ? new Date(t.datetime).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2 pr-3 font-medium text-ink whitespace-nowrap">
                      {t.amount_cents < 0 ? t.to_name : t.from_name}
                      {t.status && t.status !== 'Complete' && (
                        <Badge className="bg-warn-soft text-warn ml-1.5">{t.status}</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted max-w-56 truncate" title={t.note ?? ''}>
                      {t.note || '—'}
                      {t.reimbursement_id && (
                        <Badge className="bg-good-soft text-good ml-1.5" title="Linked to a reimbursement — marked paid">↔ reimb.</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="px-2 py-1 text-xs bg-surface border border-line-strong rounded-lg cursor-pointer"
                        value={t.category ?? ''}
                        onChange={(e) => update(t.id, { category: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="px-2 py-1 text-xs bg-surface border border-line-strong rounded-lg cursor-pointer"
                        value={t.member_id ?? ''}
                        onChange={(e) => update(t.id, { member_id: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {state.roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </td>
                    <td className={`py-2 text-right font-semibold whitespace-nowrap ${t.amount_cents < 0 ? 'text-bad' : 'text-good'}`}>
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
