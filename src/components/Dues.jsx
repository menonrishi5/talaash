import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase.js'
import { uid } from '../lib.js'
import { buildMatcher, buyerKey, buyerName, isActive } from '../matching.js'
import { Button, Card, CardHeader, Modal, Badge, Select, EmptyState, inputCls } from './ui.jsx'
import VenmoTab from './Venmo.jsx'

// Dues tracker driven by the Zeffy payment mirror — the app version of the
// "Roster Actually Paid" sheet. Checkmarks come from payment line items
// (matched by Zeffy rate id, never by dollar amount); buyers are matched to
// members by full name, then unique last name (parents paying), then manual
// links. Donations can optionally be credited against a member's dues.

const cents = (c) => `$${(c / 100) % 1 ? (c / 100).toFixed(2) : c / 100}`
const catId = (c) => c.id ?? c.rateId
const isFineCandidate = (p) => JSON.stringify(p.raw ?? '').toLowerCase().includes('fine')

export default function Dues() {
  const { canEdit } = useAuth()
  // Viewers get a private "my dues" view — the database only lets them read
  // their own payment rows and their own slice of the dues doc.
  if (!canEdit) return <MyDues />
  return <DuesAdmin />
}

function DuesAdmin() {
  const { state, setDues } = useStore()
  const { canEdit } = useAuth()
  const { dues, roster } = state
  const [payments, setPayments] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [campaignsOpen, setCampaignsOpen] = useState(false)
  const [tab, setTab] = useState('grid') // grid | payments | donations

  const [reimbs, setReimbs] = useState([])
  const [finesDue, setFinesDue] = useState({}) // memberId -> outstanding fine cents

  const loadPayments = async () => {
    const [{ data, error }, { data: rb }, { data: fines }, { data: finePays }] = await Promise.all([
      supabase.from('zeffy_payments').select('*').order('created', { ascending: false }),
      supabase.from('reimbursements').select('member_id,status,dues_credit_cents').in('status', ['approved', 'paid']),
      supabase.from('checkins').select('member_id,fine'),
      supabase.from('payments').select('member_id,amount'),
    ])
    if (!error) setPayments(data)
    if (rb) setReimbs(rb)
    // Outstanding attendance fines fold into what each member owes.
    const due = {}
    for (const c of fines ?? []) due[c.member_id] = (due[c.member_id] || 0) + Math.round(Number(c.fine) * 100)
    for (const p of finePays ?? []) {
      if (p.member_id) due[p.member_id] = (due[p.member_id] || 0) - Math.round(Number(p.amount) * 100)
    }
    for (const k of Object.keys(due)) if (due[k] <= 0) delete due[k]
    setFinesDue(due)
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

  const allSucceeded = useMemo(
    () => (payments ?? []).filter((p) => p.status === 'succeeded' && p.refund_status !== 'full'),
    [payments],
  )

  // Distinct campaigns across all synced payments; excluded ones (e.g. an
  // archived "Talaash 6.0 Dues") drop out of the grid, donations, and
  // category discovery entirely.
  const campaigns = useMemo(() => {
    const map = new Map()
    for (const p of allSucceeded) {
      const id = p.campaign_id ?? 'none'
      const e = map.get(id) ?? { id, title: p.description || 'No campaign', count: 0 }
      e.count += 1
      map.set(id, e)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [allSucceeded])

  const excluded = dues.excludedCampaigns || {}
  const succeeded = useMemo(
    () => allSucceeded.filter((p) => !excluded[p.campaign_id ?? 'none']),
    [allSucceeded, excluded],
  )

  const matcher = useMemo(
    () => buildMatcher(roster, dues.contactLinks),
    [roster, dues.contactLinks],
  )

  // memberId -> set of Zeffy rate_ids they've paid for
  const paidRates = useMemo(() => {
    const map = {}
    for (const p of succeeded) {
      const memberId = matcher(p)
      if (!memberId) continue
      for (const item of p.items ?? []) {
        if (!item.rate_id) continue
        ;(map[memberId] = map[memberId] || new Set()).add(item.rate_id)
      }
    }
    return map
  }, [succeeded, matcher])

  // Donations: donation-type line items on non-fine payments.
  const donations = useMemo(() => {
    const list = []
    for (const p of succeeded) {
      if (isFineCandidate(p)) continue
      const donationCents = (p.items ?? [])
        .filter((i) => i.type === 'donation' || i.type === 'additional_donation')
        .reduce((n, i) => n + (i.amount ?? 0), 0)
      if (donationCents > 0) list.push({ payment: p, donationCents, memberId: matcher(p) })
    }
    return list
  }, [succeeded, matcher])

  // Credits = ticked donation credits + approved reimbursement dues-offsets.
  const creditsByMember = useMemo(() => {
    const map = {}
    for (const d of donations) {
      if (d.memberId && dues.donationCredits?.[d.payment.id]) {
        map[d.memberId] = (map[d.memberId] || 0) + d.donationCents
      }
    }
    for (const r of reimbs) {
      if (r.member_id && r.dues_credit_cents > 0) {
        map[r.member_id] = (map[r.member_id] || 0) + r.dues_credit_cents
      }
    }
    return map
  }, [donations, dues.donationCredits, reimbs])

  const unmatched = useMemo(() => {
    const seen = new Map()
    for (const p of succeeded) {
      if (matcher(p)) continue
      const key = buyerKey(p)
      if (!key) continue
      const entry = seen.get(key) ?? { key, name: buyerName(p), email: p.buyer_email, count: 0, total: 0 }
      entry.count += 1
      entry.total += p.amount_cents
      seen.set(key, entry)
    }
    return [...seen.values()]
  }, [succeeded, matcher])

  const categories = [...dues.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const cellState = (memberId, cat) => {
    const ov = dues.overrides[memberId]?.[catId(cat)]
    if (ov) return ov // 'paid' | 'exempt'
    if (cat.rateId && paidRates[memberId]?.has(cat.rateId)) return 'auto-paid'
    return 'unpaid'
  }

  const cycleCell = (memberId, cat) => {
    if (!canEdit) return
    const key = catId(cat)
    const cur = dues.overrides[memberId]?.[key] ?? null
    const next = cur === null ? 'paid' : cur === 'paid' ? 'exempt' : null
    const memberOv = { ...(dues.overrides[memberId] || {}) }
    if (next === null) delete memberOv[key]
    else memberOv[key] = next
    setDues({ overrides: { ...dues.overrides, [memberId]: memberOv } })
  }

  const owedGross = (memberId) =>
    categories.reduce((sum, c) => (cellState(memberId, c) === 'unpaid' ? sum + c.amountCents : sum), 0)
  // Unclamped: a negative net is a credit balance that carries forward
  // instead of silently evaporating.
  const owedNet = (memberId) =>
    owedGross(memberId) + (finesDue[memberId] || 0) - (creditsByMember[memberId] || 0)
  const totalOwed = roster.reduce((n, m) => n + Math.max(0, owedNet(m.id)), 0)

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
          <Button size="sm" onClick={() => setCampaignsOpen(true)}>
            Campaigns ({campaigns.length - campaigns.filter((c) => excluded[c.id]).length}/{campaigns.length})
          </Button>
          {canEdit && <Button size="sm" onClick={() => setSetupOpen(true)}>Fee categories</Button>}
          <Button size="sm" variant="primary" disabled={syncing} onClick={sync}>
            {syncing ? 'Syncing…' : '↻ Sync Zeffy'}
          </Button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1.5 mb-5">
        {[
          ['grid', "Who's paid"],
          ['payments', `Zeffy payments (${succeeded.length})`],
          ['donations', `Donations (${donations.length})`],
          ['venmo', 'Venmo (out)'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer ${
              tab === id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-400'
            }`}
          >
            {label}
          </button>
        ))}
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

      {tab === 'venmo' && <VenmoTab />}

      {tab === 'payments' && <PaymentsTable payments={succeeded} matcher={matcher} roster={roster} />}

      {tab === 'donations' && (
        donations.length > 0 ? (
          <DonationsCard donations={donations} />
        ) : (
          <Card>
            <EmptyState
              icon={<span className="text-lg">💝</span>}
              title="No donations found"
              hint="Donation line items from non-archived campaigns will show up here after a sync."
            />
          </Card>
        )
      )}

      {tab === 'grid' && canEdit && unmatched.length > 0 && <UnmatchedCard unmatched={unmatched} />}

      {tab !== 'grid' ? null : categories.length === 0 ? (
        <Card className="mb-5">
          <EmptyState
            icon={<span className="text-lg">💸</span>}
            title="No fee categories yet"
            hint={canEdit
              ? 'Sync Zeffy, then define the fee categories (Fall Dues, NN Hotels, …) from the rates found in your payments — plus any cash-collected fees.'
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
        <Card className="mb-5">
          <CardHeader
            title="Who's paid what"
            subtitle={canEdit
              ? `Click a cell to override: auto → paid (manual) → exempt. Team outstanding (dues + fines): ${cents(totalOwed)}.`
              : `Team outstanding (dues + fines): ${cents(totalOwed)}.`}
          />
          <div className="px-5 pb-5 overflow-x-auto thin-scroll">
            <table className="text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white text-left text-[11px] uppercase tracking-wide text-zinc-400 font-medium pb-2 pr-4">Member</th>
                  {categories.map((c) => (
                    <th key={catId(c)} className="text-center text-[11px] uppercase tracking-wide text-zinc-400 font-medium pb-2 px-2 whitespace-nowrap">
                      {c.name}{!c.rateId && <span title="Manual category (not from Zeffy)"> ✍</span>}
                      <div className="text-zinc-300 normal-case">{cents(c.amountCents)}</div>
                    </th>
                  ))}
                  <th className="text-center text-[11px] uppercase tracking-wide text-zinc-400 font-medium pb-2 px-2">Fines</th>
                  <th className="text-right text-[11px] uppercase tracking-wide text-zinc-400 font-medium pb-2 pl-4">Owed</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((m) => {
                  const gross = owedGross(m.id)
                  const credit = creditsByMember[m.id] || 0
                  const net = owedNet(m.id)
                  return (
                    <tr key={m.id}>
                      <td className={`sticky left-0 bg-white py-1.5 pr-4 font-medium whitespace-nowrap border-t border-zinc-100 ${isActive(m) ? 'text-zinc-800' : 'text-zinc-400'}`}>
                        {m.name}
                        {!isActive(m) && <Badge className="bg-amber-50 text-amber-700 ml-1.5">inactive</Badge>}
                      </td>
                      {categories.map((c) => {
                        const st = cellState(m.id, c)
                        const label = {
                          'auto-paid': ['✓', 'bg-emerald-100 text-emerald-700', 'Paid (from Zeffy)'],
                          paid: ['✓', 'bg-violet-100 text-violet-700', 'Paid (manual override)'],
                          exempt: ['—', 'bg-zinc-100 text-zinc-400', 'Exempt'],
                          unpaid: ['✗', 'bg-red-50 text-red-400', 'Not paid'],
                        }[st]
                        return (
                          <td key={catId(c)} className="text-center px-2 py-1.5 border-t border-zinc-100">
                            <button
                              disabled={!canEdit}
                              title={label[2]}
                              onClick={() => cycleCell(m.id, c)}
                              className={`w-7 h-7 rounded-lg text-xs font-bold ${label[1]} ${canEdit ? 'cursor-pointer hover:ring-2 hover:ring-zinc-300' : ''}`}
                            >
                              {label[0]}
                            </button>
                          </td>
                        )
                      })}
                      <td className="text-center px-2 py-1.5 border-t border-zinc-100 whitespace-nowrap">
                        {finesDue[m.id]
                          ? <span className="text-xs font-semibold text-amber-700" title="Outstanding attendance fines (fined minus payments)">{cents(finesDue[m.id])}</span>
                          : <span className="text-zinc-200 text-xs">—</span>}
                      </td>
                      <td
                        className={`text-right pl-4 py-1.5 font-semibold border-t border-zinc-100 whitespace-nowrap ${net > 0 ? 'text-red-600' : 'text-emerald-600'}`}
                        title={`${cents(gross)} dues${finesDue[m.id] ? ` + ${cents(finesDue[m.id])} fines` : ''}${credit ? ` − ${cents(credit)} credits` : ''}${net < 0 ? ' — credit carries forward' : ''}`}
                      >
                        {net > 0 ? cents(net) : net < 0 ? `+${cents(-net)} credit` : '✓'}
                        {credit > 0 && net >= 0 && (
                          <span className="block text-[10px] font-normal text-sky-600">
                            −{cents(credit)} credit
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {setupOpen && <CategoriesModal payments={succeeded} onClose={() => setSetupOpen(false)} />}
      {campaignsOpen && <CampaignsModal campaigns={campaigns} onClose={() => setCampaignsOpen(false)} />}
    </div>
  )
}

// Include/exclude whole Zeffy campaigns (e.g. archive last year's dues).
function CampaignsModal({ campaigns, onClose }) {
  const { state, setDues } = useStore()
  const { canEdit } = useAuth()
  const excluded = state.dues.excludedCampaigns || {}

  const toggle = (id) => {
    if (!canEdit) return
    const next = { ...excluded }
    if (next[id]) delete next[id]
    else next[id] = true
    setDues({ excludedCampaigns: next })
  }

  return (
    <Modal title="Zeffy campaigns" onClose={onClose}>
      <p className="text-xs text-zinc-500 mb-3">
        Unchecked campaigns are ignored everywhere — the paid grid, donations, and category
        discovery. Uncheck old seasons (e.g. Talaash 6.0 Dues) to isolate the current membership.
      </p>
      <ul className="divide-y divide-zinc-100">
        {campaigns.map((c) => (
          <li key={c.id} className="py-2 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={!excluded[c.id]}
              onChange={() => toggle(c.id)}
            />
            <span className="flex-1 text-zinc-800">{c.title}</span>
            <Badge className="bg-zinc-100 text-zinc-600">{c.count} payments</Badge>
          </li>
        ))}
        {campaigns.length === 0 && (
          <li className="py-2 text-sm text-zinc-400 italic">Nothing synced yet.</li>
        )}
      </ul>
    </Modal>
  )
}

// Raw mirrored payments, like Zeffy's own Payments page but roster-aware.
// Editors can fix any buyer's match inline — the correction is a saved link,
// so it applies to every payment from that buyer.
function PaymentsTable({ payments, matcher, roster }) {
  const { state, setDues } = useStore()
  const { canEdit } = useAuth()
  const [query, setQuery] = useState('')
  const [relink, setRelink] = useState(null) // {key, buyer, memberId}
  const memberName = (id) => roster.find((m) => m.id === id)?.name

  const saveLink = () => {
    const next = { ...state.dues.contactLinks }
    if (relink.memberId) next[relink.key] = relink.memberId
    else delete next[relink.key] // back to automatic matching
    setDues({ contactLinks: next })
    setRelink(null)
    // Keep the server-side match (viewers' own-payments filter) in step.
    setTimeout(() => supabase.functions.invoke('zeffy-sync').catch(() => {}), 2000)
  }

  const clearAllLinks = () => {
    const n = Object.keys(state.dues.contactLinks || {}).length
    if (!n) return
    if (confirm(`Remove all ${n} manual buyer links and go back to pure automatic matching?`))
      setDues({ contactLinks: {} })
  }

  const q = query.toLowerCase()
  const visible = payments.filter((p) =>
    !q ||
    buyerName(p).toLowerCase().includes(q) ||
    (p.buyer_email ?? '').toLowerCase().includes(q) ||
    (p.description ?? '').toLowerCase().includes(q) ||
    (memberName(matcher(p)) ?? '').toLowerCase().includes(q),
  )

  return (
    <Card>
      <CardHeader
        title={`Payments (${visible.length})`}
        subtitle={canEdit
          ? 'Mirror of Zeffy. Wrong match? Click the member badge to correct it — the fix sticks for all of that buyer’s payments.'
          : 'Read-only mirror of Zeffy, filtered to the included campaigns.'}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && Object.keys(state.dues.contactLinks || {}).length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearAllLinks}>Clear manual links</Button>
            )}
            <input
              className={`${inputCls} !w-56 !py-1.5`}
              placeholder="Search buyer, member, campaign…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
      />
      <div className="px-5 pb-5 overflow-x-auto thin-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="pb-2 pr-3 font-medium">Date</th>
              <th className="pb-2 pr-3 font-medium">Buyer</th>
              <th className="pb-2 pr-3 font-medium">Matched member</th>
              <th className="pb-2 pr-3 font-medium">Campaign</th>
              <th className="pb-2 pr-3 font-medium">Items</th>
              <th className="pb-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visible.map((p) => {
              const memberId = matcher(p)
              const key = buyerKey(p)
              const isLinked = !!state.dues.contactLinks?.[key]
              return (
                <tr key={p.id}>
                  <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap">{new Date(p.created).toLocaleDateString()}</td>
                  <td className="py-2 pr-3 font-medium text-zinc-800 whitespace-nowrap">
                    {buyerName(p)}
                    {p.buyer_email && <span className="block text-[11px] font-normal text-zinc-400">{p.buyer_email}</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setRelink({
                        key,
                        buyer: buyerName(p),
                        memberId: state.dues.contactLinks?.[key] ?? '',
                      })}
                      title={canEdit ? (isLinked ? 'Manually linked — click to change' : 'Click to correct this match') : undefined}
                      className={canEdit ? 'cursor-pointer' : ''}
                    >
                      {memberId
                        ? <Badge className={isLinked ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}>
                            {memberName(memberId)}{isLinked ? ' ✎' : ''}
                          </Badge>
                        : <Badge className="bg-amber-100 text-amber-800">unmatched</Badge>}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-zinc-600">{p.description || '—'}</td>
                  <td className="py-2 pr-3 text-zinc-500">{(p.items ?? []).length}</td>
                  <td className="py-2 text-right font-semibold text-zinc-800 whitespace-nowrap">
                    {cents(p.amount_cents)}
                    {p.refund_status === 'partial' && (
                      <span className="block text-[10px] font-medium text-amber-700" title="Part of this payment was refunded in Zeffy — double-check this member's paid grid">
                        partial refund
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan="6" className="py-6 text-center text-sm text-zinc-400 italic">No payments match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {relink && (
        <Modal title={`Match payments from ${relink.buyer}`} onClose={() => setRelink(null)}>
          <p className="text-xs text-zinc-500 mb-3">
            Applies to every payment from this buyer. "Automatic" uses full name → unique last
            name → unique first name.
          </p>
          <Select
            value={relink.memberId}
            onChange={(e) => setRelink({ ...relink, memberId: e.target.value })}
          >
            <option value="">— automatic —</option>
            {roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <div className="flex justify-end gap-2 mt-4">
            <Button onClick={() => setRelink(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveLink}>Save</Button>
          </div>
        </Modal>
      )}
    </Card>
  )
}

// Buyers whose payments couldn't be auto-matched (unknown name, or a
// first/last name shared by multiple members — e.g. the two Shreyas).
function UnmatchedCard({ unmatched }) {
  const { state, setDues } = useStore()
  const [picks, setPicks] = useState({}) // buyer key -> memberId (staged, not saved)

  // Deliberate two-step: choose, then click Link. (The old instant-linking
  // dropdown could silently bind the wrong pair.)
  const link = (key) => {
    const memberId = picks[key]
    if (!memberId) return
    setDues({ contactLinks: { ...state.dues.contactLinks, [key]: memberId } })
    // Re-sync so the server-side member match (which gates what viewers can
    // see of their own payments) picks up the new link.
    setTimeout(() => supabase.functions.invoke('zeffy-sync').catch(() => {}), 1500)
  }

  return (
    <Card className="mb-5">
      <CardHeader
        title={`Needs a match (${unmatched.length})`}
        subtitle="Buyers that couldn't be auto-matched (unknown name, or a name several members share). Link once; it sticks for all their payments and can be changed later in the Zeffy payments tab."
      />
      <ul className="px-5 pb-5 divide-y divide-zinc-100">
        {unmatched.map((u) => (
          <li key={u.key} className="py-2 flex items-center gap-3 text-sm flex-wrap">
            <span className="font-medium text-zinc-800">{u.name}</span>
            {u.email && <span className="text-xs text-zinc-400">{u.email}</span>}
            <Badge className="bg-zinc-100 text-zinc-600">{u.count} payment{u.count > 1 ? 's' : ''} · {cents(u.total)}</Badge>
            <div className="ml-auto flex items-center gap-2">
              <Select
                className="!w-52 !py-1.5"
                value={picks[u.key] ?? ''}
                onChange={(e) => setPicks({ ...picks, [u.key]: e.target.value })}
              >
                <option value="">Link to member…</option>
                {state.roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <Button size="sm" variant="primary" disabled={!picks[u.key]} onClick={() => link(u.key)}>
                Link
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// Donations (non-fine). Editors can credit one against the donor's dues.
function DonationsCard({ donations }) {
  const { state, setDues } = useStore()
  const { canEdit } = useAuth()
  const credits = state.dues.donationCredits || {}
  const memberName = (id) => state.roster.find((m) => m.id === id)?.name

  const toggleCredit = (paymentId) => {
    const next = { ...credits }
    if (next[paymentId]) delete next[paymentId]
    else next[paymentId] = true
    setDues({ donationCredits: next })
  }

  const total = donations.reduce((n, d) => n + d.donationCents, 0)

  return (
    <Card>
      <CardHeader
        title={`Donations (${donations.length} · ${cents(total)})`}
        subtitle="Zeffy donations that aren't fines. By default they're just donations — optionally credit one against the donor's dues."
      />
      <ul className="px-5 pb-5 divide-y divide-zinc-100">
        {donations.map(({ payment: p, donationCents, memberId }) => (
          <li key={p.id} className="py-2 flex items-center gap-3 text-sm flex-wrap">
            <span className="font-medium text-zinc-800">{buyerName(p)}</span>
            <Badge className="bg-sky-100 text-sky-700">{cents(donationCents)}</Badge>
            <span className="text-xs text-zinc-400">
              {new Date(p.created).toLocaleDateString()} · {p.description || 'no campaign'}
              {memberId ? ` · matched to ${memberName(memberId)}` : ' · unmatched'}
            </span>
            {canEdit && (
              <label className={`ml-auto flex items-center gap-1.5 text-xs ${memberId ? 'text-zinc-600 cursor-pointer' : 'text-zinc-300'}`}>
                <input
                  type="checkbox"
                  disabled={!memberId}
                  checked={!!credits[p.id]}
                  onChange={() => toggleCredit(p.id)}
                />
                credit toward dues
              </label>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

// Define fee categories: Zeffy rates discovered from payments + manual ones.
function CategoriesModal({ payments, onClose }) {
  const { state, setDues } = useStore()

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

  const existing = Object.fromEntries(state.dues.categories.map((c) => [catId(c), c]))
  const [rows, setRows] = useState(() => [
    ...discovered.map((d, i) => ({
      id: d.rateId,
      rateId: d.rateId,
      include: !!existing[d.rateId],
      name: existing[d.rateId]?.name ?? '',
      amountCents: existing[d.rateId]?.amountCents ?? d.typicalAmount,
      count: d.count,
      typicalAmount: d.typicalAmount,
      campaigns: d.campaigns,
      order: existing[d.rateId]?.order ?? i,
    })),
    // manual categories saved earlier
    ...state.dues.categories
      .filter((c) => !c.rateId)
      .map((c) => ({ ...c, id: catId(c), include: true, count: null, campaigns: '', typicalAmount: null })),
  ])

  const addManual = () => {
    setRows([...rows, {
      id: 'manual-' + uid(), rateId: null, include: true, name: '',
      amountCents: 0, count: null, typicalAmount: null, campaigns: '', order: rows.length,
    }])
  }

  // Include every discovered rate with a placeholder name to rename —
  // Zeffy's API doesn't expose rate names, so amounts + campaign is the
  // best automatic label available.
  const autoFill = () => {
    setRows(rows.map((r) =>
      r.rateId
        ? {
            ...r,
            include: true,
            name: r.name || `${cents(r.typicalAmount)} — ${(r.campaigns || 'fee').split(',')[0].trim()}`,
          }
        : r,
    ))
  }

  const save = () => {
    const categories = rows
      .filter((r) => r.include && r.name.trim())
      .map((r, i) => ({ id: r.id, rateId: r.rateId, name: r.name.trim(), amountCents: r.amountCents, order: i }))
    setDues({ categories })
    onClose()
  }

  const update = (i, patch) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <Modal title="Fee categories" onClose={onClose} wide>
      <p className="text-xs text-zinc-500 mb-3">
        Zeffy rates found in your payments are listed first — tick the required fees, name them
        like your sheet columns, confirm the amount. Add manual categories (✍) for cash/Venmo
        fees; those are checked off by hand in the grid. New fees created in Zeffy appear here
        after the next sync — Zeffy's API is read-only, so fees can't be created from this side.
      </p>
      <div className="space-y-1.5 max-h-96 overflow-y-auto thin-scroll">
        {rows.map((r, i) => (
          <div key={r.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${r.include ? 'border-zinc-300 bg-white' : 'border-zinc-200 bg-zinc-50 opacity-70'}`}>
            <input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} />
            <input
              className={`${inputCls} !w-40 !py-1.5`}
              placeholder={r.rateId ? 'Name (e.g. NN Hotels)' : 'Manual fee name'}
              value={r.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <span className="text-xs text-zinc-400">$</span>
            <input
              type="number" step="0.01" min="0"
              className={`${inputCls} !w-24 !py-1.5`}
              value={r.amountCents / 100}
              onChange={(e) => update(i, { amountCents: Math.round(Number(e.target.value) * 100) })}
            />
            <span className="text-[11px] text-zinc-400 ml-auto text-right">
              {r.rateId
                ? <>
                    {r.count} paid · typ. {cents(r.typicalAmount)}
                    {r.campaigns && <span className="block truncate max-w-48" title={r.campaigns}>{r.campaigns}</span>}
                  </>
                : <Badge className="bg-zinc-100 text-zinc-500">manual ✍</Badge>}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between items-center mt-4">
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={addManual}>+ Manual category</Button>
          {rows.some((r) => r.rateId && !r.include) && (
            <Button size="sm" variant="ghost" onClick={autoFill}>✨ Auto-fill all rates</Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save categories</Button>
        </div>
      </div>
    </Modal>
  )
}

// ---- viewer view: just my dues ----
// Data arrives pre-filtered: the RPC returns only this member's slice of the
// dues doc, and RLS returns only their own payment rows.
function MyDues() {
  const [info, setInfo] = useState(null) // get_my_dues result
  const [rows, setRows] = useState([])   // my zeffy payments
  const [reimbs, setReimbs] = useState([])
  const [finesDue, setFinesDue] = useState(0) // my outstanding fines, cents

  useEffect(() => {
    ;(async () => {
      const [{ data: d }, { data: pays }, { data: rb }, { data: fines }, { data: finePays }] = await Promise.all([
        supabase.rpc('get_my_dues'),
        supabase.from('zeffy_payments').select('*').order('created', { ascending: false }),
        supabase.from('reimbursements').select('*').in('status', ['approved', 'paid']),
        supabase.from('checkins').select('fine'),   // RLS: own rows only
        supabase.from('payments').select('amount'), // RLS: own rows only
      ])
      setInfo(d ?? { linked: false })
      setRows(pays ?? [])
      setReimbs(rb ?? [])
      const fined = (fines ?? []).reduce((n, c) => n + Math.round(Number(c.fine) * 100), 0)
      const paid = (finePays ?? []).reduce((n, p) => n + Math.round(Number(p.amount) * 100), 0)
      setFinesDue(Math.max(0, fined - paid))
    })()
  }, [])

  if (!info) {
    return <Card><div className="p-8 text-sm text-zinc-400">Loading your dues…</div></Card>
  }

  if (!info.linked) {
    return (
      <div>
        <h1 className="text-xl font-bold text-zinc-900 mb-1">My Dues</h1>
        <Card className="mt-4">
          <EmptyState
            icon={<span className="text-lg">🔗</span>}
            title="Your account isn't linked to a roster member yet"
            hint="Ask a board member to link it (Roster → App access) — then your payments and what you owe show up here."
          />
        </Card>
      </div>
    )
  }

  const excluded = info.excluded_campaigns || {}
  const mine = rows.filter(
    (p) => p.status === 'succeeded' && p.refund_status !== 'full' && !excluded[p.campaign_id ?? 'none'],
  )
  const paidRateIds = new Set(
    mine.flatMap((p) => (p.items ?? []).filter((i) => i.rate_id).map((i) => i.rate_id)),
  )
  const overrides = info.overrides || {}
  const cats = [...(info.categories ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const stateOf = (c) => {
    const ov = overrides[c.id ?? c.rateId]
    if (ov) return ov
    return c.rateId && paidRateIds.has(c.rateId) ? 'auto-paid' : 'unpaid'
  }

  const donationCreditIds = new Set(info.donation_credit_ids ?? [])
  const donationCredit = mine
    .filter((p) => donationCreditIds.has(p.id))
    .reduce((n, p) => n + (p.items ?? [])
      .filter((i) => i.type === 'donation' || i.type === 'additional_donation')
      .reduce((s, i) => s + (i.amount ?? 0), 0), 0)
  const reimbCredit = reimbs.reduce((n, r) => n + (r.dues_credit_cents ?? 0), 0)

  const gross = cats.reduce((n, c) => (stateOf(c) === 'unpaid' ? n + c.amountCents : n), 0)
  const credit = donationCredit + reimbCredit
  const net = gross + finesDue - credit // negative = credit carried forward

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-zinc-900 mb-1">My Dues</h1>
        <p className="text-sm text-zinc-500">Only you (and the board) can see this.</p>
      </div>

      <Card className="mb-5">
        <div className="px-5 py-5 flex items-center gap-6 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-zinc-400 font-medium">
              {net < 0 ? 'Your credit balance' : 'You currently owe'}
            </div>
            <div className={`text-3xl font-black ${net > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {net > 0 ? cents(net) : net < 0 ? `+${cents(-net)}` : '$0 🎉'}
            </div>
            {net < 0 && (
              <div className="text-[11px] text-zinc-400">carries forward against future fees</div>
            )}
          </div>
          {(credit > 0 || finesDue > 0) && (
            <div className="text-xs text-zinc-500">
              {cents(gross)} in unpaid fees
              {finesDue > 0 && <span className="block text-amber-700">+ {cents(finesDue)} attendance fines</span>}
              {donationCredit > 0 && <span className="block">− {cents(donationCredit)} donation credit</span>}
              {reimbCredit > 0 && <span className="block">− {cents(reimbCredit)} reimbursement credit</span>}
            </div>
          )}
        </div>
      </Card>

      {cats.length > 0 && (
        <Card className="mb-5">
          <CardHeader title="Fee checklist" />
          <ul className="px-5 pb-5 divide-y divide-zinc-100">
            {cats.map((c) => {
              const st = stateOf(c)
              return (
                <li key={c.id ?? c.rateId} className="py-2 flex items-center gap-3 text-sm">
                  <span className="flex-1 text-zinc-800">{c.name}</span>
                  <span className="text-zinc-400 text-xs">{cents(c.amountCents)}</span>
                  {st === 'unpaid'
                    ? <Badge className="bg-red-50 text-red-500">not paid</Badge>
                    : st === 'exempt'
                      ? <Badge className="bg-zinc-100 text-zinc-500">exempt</Badge>
                      : <Badge className="bg-emerald-100 text-emerald-700">paid ✓</Badge>}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title={`My payments (${mine.length})`} subtitle="Everything Zeffy has from you." />
        {mine.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-zinc-400 italic">No payments found for you yet.</p>
        ) : (
          <ul className="px-5 pb-5 divide-y divide-zinc-100">
            {mine.map((p) => (
              <li key={p.id} className="py-2 flex items-center gap-3 text-sm">
                <span className="text-zinc-500 text-xs w-20">{new Date(p.created).toLocaleDateString()}</span>
                <span className="flex-1 text-zinc-700">{p.description || 'Payment'}</span>
                <span className="font-semibold text-zinc-800">{cents(p.amount_cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
