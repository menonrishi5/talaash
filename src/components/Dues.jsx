import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase.js'
import { Button, Card, CardHeader, Modal, Badge, TextInput, Select, EmptyState, inputCls } from './ui.jsx'

// Dues tracker driven by the Zeffy payment mirror. Replaces the
// "Roster Actually Paid" sheet: fee categories are Zeffy rates you label
// once; the grid auto-checks from real payment line items.

const cents = (c) => `$${(c / 100) % 1 ? (c / 100).toFixed(2) : c / 100}`
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const buyerKey = (p) => norm(p.buyer_email) || norm(`${p.buyer_first ?? ''} ${p.buyer_last ?? ''}`)
const buyerName = (p) =>
  `${p.buyer_first ?? ''} ${p.buyer_last ?? ''}`.trim() || p.buyer_email || 'Unknown buyer'

export default function Dues() {
  const { state, setDues } = useStore()
  const { canEdit } = useAuth()
  const { dues, roster } = { dues: state.dues, roster: state.roster }
  const [payments, setPayments] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const [setupOpen, setSetupOpen] = useState(false)

  const loadPayments = async () => {
    const { data, error } = await supabase
      .from('zeffy_payments')
      .select('*')
      .order('created', { ascending: false })
    if (!error) setPayments(data)
    return error
  }

  useEffect(() => {
    loadPayments()
  }, [])

  const sync = async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('zeffy-sync')
      if (error) throw error
      if (!data.ok) throw new Error(data.error)
      await loadPayments()
      setSyncMsg(`Synced ${data.synced} payments from Zeffy.`)
    } catch (e) {
      console.error(e)
      setSyncMsg(`Sync failed: ${e.message ?? e}. Is the zeffy-sync function deployed?`)
    } finally {
      setSyncing(false)
    }
  }

  const succeeded = useMemo(
    () => (payments ?? []).filter((p) => p.status === 'succeeded' && p.refund_status !== 'full'),
    [payments],
  )

  // buyer -> member resolution: manual link first, then exact full-name match
  const memberByName = useMemo(() => {
    const map = {}
    for (const m of roster) map[norm(m.name)] = m.id
    return map
  }, [roster])

  const memberForPayment = (p) =>
    dues.contactLinks[buyerKey(p)] ??
    memberByName[norm(`${p.buyer_first ?? ''} ${p.buyer_last ?? ''}`)] ??
    null

  // memberId -> set of rate_ids they've paid for
  const paidRates = useMemo(() => {
    const map = {}
    for (const p of succeeded) {
      const memberId = memberForPayment(p)
      if (!memberId) continue
      for (const item of p.items ?? []) {
        if (!item.rate_id) continue
        ;(map[memberId] = map[memberId] || new Set()).add(item.rate_id)
      }
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [succeeded, dues.contactLinks, memberByName])

  const unmatched = useMemo(() => {
    const seen = new Map()
    for (const p of succeeded) {
      if (memberForPayment(p)) continue
      const key = buyerKey(p)
      if (!key) continue
      const entry = seen.get(key) ?? { key, name: buyerName(p), email: p.buyer_email, count: 0, total: 0 }
      entry.count += 1
      entry.total += p.amount_cents
      seen.set(key, entry)
    }
    return [...seen.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [succeeded, dues.contactLinks, memberByName])

  const categories = [...dues.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const cellState = (memberId, rateId) => {
    const ov = dues.overrides[memberId]?.[rateId]
    if (ov) return ov // 'paid' | 'exempt'
    return paidRates[memberId]?.has(rateId) ? 'auto-paid' : 'unpaid'
  }

  const cycleCell = (memberId, rateId) => {
    if (!canEdit) return
    const cur = dues.overrides[memberId]?.[rateId] ?? null
    const next = cur === null ? 'paid' : cur === 'paid' ? 'exempt' : null
    const memberOv = { ...(dues.overrides[memberId] || {}) }
    if (next === null) delete memberOv[rateId]
    else memberOv[rateId] = next
    setDues({ overrides: { ...dues.overrides, [memberId]: memberOv } })
  }

  const owed = (memberId) =>
    categories.reduce((sum, c) => {
      const st = cellState(memberId, c.rateId)
      return st === 'unpaid' ? sum + c.amountCents : sum
    }, 0)

  const totalOwed = roster.reduce((n, m) => n + owed(m.id), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 mb-1">Dues & Payments</h1>
          <p className="text-sm text-zinc-500">
            Live from Zeffy — {succeeded.length} payments mirrored{payments?.[0] ? `, newest ${new Date(payments[0].created).toLocaleDateString()}` : ''}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && <Button size="sm" onClick={() => setSetupOpen(true)}>Fee categories</Button>}
          <Button size="sm" variant="primary" disabled={syncing} onClick={sync}>
            {syncing ? 'Syncing…' : '↻ Sync Zeffy'}
          </Button>
        </div>
      </div>

      {syncMsg && (
        <div className={`mb-4 rounded-2xl border px-5 py-3 text-sm ${
          syncMsg.startsWith('Sync failed')
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
        }`}>
          {syncMsg}
        </div>
      )}

      {canEdit && unmatched.length > 0 && (
        <UnmatchedCard unmatched={unmatched} />
      )}

      {categories.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="text-lg">💸</span>}
            title="No fee categories yet"
            hint={canEdit
              ? 'Sync Zeffy, then define the fee categories (Fall Dues, NN Hotels, …) from the rates found in your payments.'
              : 'An editor sets up the fee categories here.'}
            action={canEdit ? (
              <div className="flex gap-2">
                <Button variant="primary" disabled={syncing} onClick={sync}>Sync Zeffy first</Button>
                <Button onClick={() => setSetupOpen(true)}>Set up categories</Button>
              </div>
            ) : null}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Who's paid what"
            subtitle={canEdit
              ? `Click a cell to override: auto → paid (manual) → exempt. Team outstanding: ${cents(totalOwed)}.`
              : `Team outstanding: ${cents(totalOwed)}.`}
          />
          <div className="px-5 pb-5 overflow-x-auto thin-scroll">
            <table className="text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white text-left text-[11px] uppercase tracking-wide text-zinc-400 font-medium pb-2 pr-4">Member</th>
                  {categories.map((c) => (
                    <th key={c.rateId} className="text-center text-[11px] uppercase tracking-wide text-zinc-400 font-medium pb-2 px-2 whitespace-nowrap">
                      {c.name}
                      <div className="text-zinc-300 normal-case">{cents(c.amountCents)}</div>
                    </th>
                  ))}
                  <th className="text-right text-[11px] uppercase tracking-wide text-zinc-400 font-medium pb-2 pl-4">Owed</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((m) => {
                  const due = owed(m.id)
                  return (
                    <tr key={m.id} className="border-t border-zinc-100">
                      <td className="sticky left-0 bg-white py-1.5 pr-4 font-medium text-zinc-800 whitespace-nowrap border-t border-zinc-100">{m.name}</td>
                      {categories.map((c) => {
                        const st = cellState(m.id, c.rateId)
                        const label = {
                          'auto-paid': ['✓', 'bg-emerald-100 text-emerald-700', 'Paid (from Zeffy)'],
                          paid: ['✓', 'bg-violet-100 text-violet-700', 'Paid (manual override)'],
                          exempt: ['—', 'bg-zinc-100 text-zinc-400', 'Exempt'],
                          unpaid: ['✗', 'bg-red-50 text-red-400', 'Not paid'],
                        }[st]
                        return (
                          <td key={c.rateId} className="text-center px-2 py-1.5 border-t border-zinc-100">
                            <button
                              disabled={!canEdit}
                              title={label[2]}
                              onClick={() => cycleCell(m.id, c.rateId)}
                              className={`w-7 h-7 rounded-lg text-xs font-bold ${label[1]} ${canEdit ? 'cursor-pointer hover:ring-2 hover:ring-zinc-300' : ''}`}
                            >
                              {label[0]}
                            </button>
                          </td>
                        )
                      })}
                      <td className={`text-right pl-4 py-1.5 font-semibold border-t border-zinc-100 ${due > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {due > 0 ? cents(due) : '✓'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {setupOpen && (
        <CategoriesModal payments={succeeded} onClose={() => setSetupOpen(false)} />
      )}
    </div>
  )
}

// Buyers whose payments couldn't be matched to a roster member.
function UnmatchedCard({ unmatched }) {
  const { state, setDues } = useStore()

  const link = (key, memberId) => {
    if (!memberId) return
    setDues({ contactLinks: { ...state.dues.contactLinks, [key]: memberId } })
  }

  return (
    <Card className="mb-5">
      <CardHeader
        title={`Unmatched Zeffy buyers (${unmatched.length})`}
        subtitle="These payments don't match a roster name — link each buyer to a member (e.g. a parent paying for their dancer)."
      />
      <ul className="px-5 pb-5 divide-y divide-zinc-100">
        {unmatched.map((u) => (
          <li key={u.key} className="py-2 flex items-center gap-3 text-sm flex-wrap">
            <span className="font-medium text-zinc-800">{u.name}</span>
            {u.email && <span className="text-xs text-zinc-400">{u.email}</span>}
            <Badge className="bg-zinc-100 text-zinc-600">{u.count} payment{u.count > 1 ? 's' : ''} · {cents(u.total)}</Badge>
            <div className="ml-auto">
              <Select className="!w-52 !py-1.5" defaultValue="" onChange={(e) => link(u.key, e.target.value)}>
                <option value="">Link to member…</option>
                {state.roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// Define fee categories from the rates discovered in synced payments.
function CategoriesModal({ payments, onClose }) {
  const { state, setDues } = useStore()

  // Discover distinct rate_ids with occurrence counts and typical amount.
  const discovered = useMemo(() => {
    const map = new Map()
    for (const p of payments) {
      for (const item of p.items ?? []) {
        if (!item.rate_id) continue
        const e = map.get(item.rate_id) ?? { rateId: item.rate_id, count: 0, amounts: {}, campaigns: new Set() }
        e.count += 1
        e.amounts[item.amount] = (e.amounts[item.amount] || 0) + 1
        if (p.description) e.campaigns.add(p.description)
        map.set(item.rate_id, e)
      }
    }
    return [...map.values()]
      .map((e) => ({
        ...e,
        typicalAmount: Number(Object.entries(e.amounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0),
        campaigns: [...e.campaigns].join(', '),
      }))
      .sort((a, b) => b.count - a.count)
  }, [payments])

  const existing = Object.fromEntries(state.dues.categories.map((c) => [c.rateId, c]))
  const [rows, setRows] = useState(() =>
    discovered.map((d, i) => ({
      rateId: d.rateId,
      include: !!existing[d.rateId],
      name: existing[d.rateId]?.name ?? '',
      amountCents: existing[d.rateId]?.amountCents ?? d.typicalAmount,
      count: d.count,
      typicalAmount: d.typicalAmount,
      campaigns: d.campaigns,
      order: existing[d.rateId]?.order ?? i,
    })),
  )

  const save = () => {
    const categories = rows
      .filter((r) => r.include && r.name.trim())
      .map((r, i) => ({ rateId: r.rateId, name: r.name.trim(), amountCents: r.amountCents, order: i }))
    setDues({ categories })
    onClose()
  }

  return (
    <Modal title="Fee categories" onClose={onClose} wide>
      {discovered.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No rates found yet — hit "Sync Zeffy" first, then come back here.
        </p>
      ) : (
        <>
          <p className="text-xs text-zinc-500 mb-3">
            These are the ticket rates found in your Zeffy payments. Tick the ones that are
            required fees, name them like your sheet columns (Fall Dues, NN Hotels…), and
            confirm the amount owed. The paid grid fills itself from there.
          </p>
          <div className="space-y-1.5 max-h-96 overflow-y-auto thin-scroll">
            {rows.map((r, i) => (
              <div key={r.rateId} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${r.include ? 'border-zinc-300 bg-white' : 'border-zinc-150 bg-zinc-50 opacity-70'}`}>
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                />
                <input
                  className={`${inputCls} !w-40 !py-1.5`}
                  placeholder="Name (e.g. NN Hotels)"
                  value={r.name}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <span className="text-xs text-zinc-400">$</span>
                <input
                  type="number" step="0.01" min="0"
                  className={`${inputCls} !w-24 !py-1.5`}
                  value={r.amountCents / 100}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amountCents: Math.round(Number(e.target.value) * 100) } : x)))}
                />
                <span className="text-[11px] text-zinc-400 ml-auto text-right">
                  {r.count} paid · typ. {cents(r.typicalAmount)}
                  {r.campaigns && <span className="block truncate max-w-48" title={r.campaigns}>{r.campaigns}</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save categories</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
