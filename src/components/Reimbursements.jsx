import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase.js'
import { uid } from '../lib.js'
import { putReceipt, receiptURL } from '../fileStore.js'
import { Button, Card, CardHeader, Modal, Field, Select, TextInput, Badge, inputCls } from './ui.jsx'

const cents = (c) => `$${(c / 100) % 1 ? (c / 100).toFixed(2) : c / 100}`

// Receipts are private; fetch a short-lived signed URL only when opened.
function ReceiptLink({ id, className }) {
  const open = async (e) => {
    e.preventDefault()
    const url = await receiptURL(id)
    if (url) window.open(url, '_blank', 'noopener')
    else alert('Could not open the receipt.')
  }
  return (
    <a href="#" onClick={open} className={className ?? 'text-xs text-muted underline'}>receipt</a>
  )
}
const CATEGORIES = ['Props', 'Costumes', 'Food', 'Travel', 'Production', 'Competition', 'Other']

const STATUS_BADGE = {
  pending: 'bg-warn-soft text-warn',
  approved: 'bg-info-soft text-info',
  denied: 'bg-subtle text-muted',
  paid: 'bg-good-soft text-good',
}

export default function Reimbursements() {
  const { canEdit, memberId, session } = useAuth()
  const { state } = useStore()
  const [rows, setRows] = useState(null)
  const [decide, setDecide] = useState(null) // row being approved/denied
  const [edit, setEdit] = useState(null) // row being edited (editor)

  const load = async () => {
    // RLS: viewers get their own rows, editors get everything.
    const { data } = await supabase
      .from('reimbursements')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setRows(data)
  }
  useEffect(() => {
    load()
  }, [])

  const memberName = (id) => state.roster.find((m) => m.id === id)?.name

  const markPaid = async (r) => {
    const remainder = (r.approved_amount_cents ?? r.amount_cents) - (r.dues_credit_cents ?? 0)
    const input = prompt(
      `Amount actually paid back to ${memberName(r.member_id) ?? 'them'} (cash/Venmo):`,
      (remainder / 100).toFixed(2),
    )
    if (input === null) return
    const paid = Math.round(Number(input) * 100)
    if (Number.isNaN(paid) || paid < 0) return alert('Enter a valid amount.')
    const { error } = await supabase
      .from('reimbursements')
      .update({ status: 'paid', paid_amount_cents: paid, paid_at: new Date().toISOString() })
      .eq('id', r.id)
    if (error) alert('Could not update: ' + error.message)
    load()
  }

  const remove = async (r) => {
    if (!confirm('Delete this request?')) return
    const { error } = await supabase.from('reimbursements').delete().eq('id', r.id)
    if (error) alert('Could not delete: ' + error.message)
    load()
  }

  const pending = (rows ?? []).filter((r) => r.status === 'pending')
  const decided = (rows ?? []).filter((r) => r.status !== 'pending')

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink mb-1">Reimbursements</h1>
        <p className="text-sm text-muted">
          Spent your own money on the team? Submit it here. Approved amounts offset your dues
          first; anything left is paid back to you.
        </p>
      </div>

      <SubmitCard onSubmitted={load} />

      {rows === null ? (
        <Card><div className="p-8 text-sm text-faint">Loading…</div></Card>
      ) : (
        <>
          {pending.length > 0 && (
            <Card className="mb-5">
              <CardHeader title={canEdit ? `Awaiting review (${pending.length})` : 'Your pending requests'} />
              <ul className="px-5 pb-5 divide-y divide-line">
                {pending.map((r) => (
                  <Row key={r.id} r={r} memberName={memberName}>
                    {canEdit ? (
                      <>
                        <Button size="sm" variant="primary" onClick={() => setDecide(r)}>Review</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="text-bad" onClick={() => remove(r)}>Delete</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-bad" onClick={() => remove(r)}>Withdraw</Button>
                    )}
                  </Row>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="History" />
            {decided.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-faint italic">Nothing decided yet.</p>
            ) : (
              <ul className="px-5 pb-5 divide-y divide-line">
                {decided.map((r) => (
                  <Row key={r.id} r={r} memberName={memberName}>
                    {canEdit && r.status === 'approved' &&
                      (r.approved_amount_cents ?? 0) - (r.dues_credit_cents ?? 0) > 0 && (
                        <Button size="sm" variant="success" onClick={() => markPaid(r)}>Mark paid back</Button>
                      )}
                    {canEdit && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setDecide(r)}>Re-review</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="text-bad" onClick={() => remove(r)}>Delete</Button>
                      </>
                    )}
                  </Row>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {decide && <DecideModal r={decide} memberName={memberName} onClose={() => { setDecide(null); load() }} />}
      {edit && <EditModal r={edit} memberName={memberName} onClose={() => { setEdit(null); load() }} />}
    </div>
  )
}

// Editor edit of a request's core fields (amount, description, category, date,
// and — for members whose account isn't linked — which member it's for).
function EditModal({ r, memberName, onClose }) {
  const { state } = useStore()
  const [form, setForm] = useState({
    amount: (r.amount_cents / 100).toFixed(2),
    description: r.description ?? '',
    category: r.category ?? '',
    purchase_date: r.purchase_date ?? '',
    member_id: r.member_id ?? '',
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const amount = Math.round(Number(form.amount) * 100)
    if (!amount || amount <= 0 || !form.description.trim()) return
    setBusy(true)
    const patch = {
      description: form.description.trim(),
      category: form.category || null,
      purchase_date: form.purchase_date || null,
      member_id: form.member_id || null,
    }
    if (r.status === 'pending') patch.amount_cents = amount // locked after a decision
    const { error } = await supabase
      .from('reimbursements')
      .update(patch)
      .eq('id', r.id)
    setBusy(false)
    if (error) return alert('Could not save: ' + error.message)
    onClose()
  }

  return (
    <Modal title="Edit reimbursement" onClose={onClose}>
      <Field label="Member">
        <Select value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })}>
          <option value="">— unlinked —</option>
          {state.roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={r.status === 'pending' ? 'Amount ($)' : 'Amount ($) — locked'}>
          <input type="number" min="0" step="0.01" disabled={r.status !== 'pending'}
            className={`${inputCls} disabled:bg-subtle disabled:text-faint`} value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Date of purchase">
          <input type="date" className={inputCls} value={form.purchase_date}
            onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
        </Field>
      </div>
      <Field label="Category">
        <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          <option value="">— none —</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Description">
        <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      {r.status !== 'pending' && (
        <p className="text-[11px] text-warn mb-3">
          This request is already {r.status} — the amount is locked so it can't drift from the
          approved/credited figures. Use Re-review to change the money side.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={save}>Save changes</Button>
      </div>
    </Modal>
  )
}

function Row({ r, memberName, children }) {
  return (
    <li className="py-2.5 flex items-center gap-3 flex-wrap text-sm">
      <div className="flex-1 min-w-48">
        <span className="font-medium text-ink">
          {memberName(r.member_id) ?? 'Unlinked account'} · {cents(r.amount_cents)}
        </span>
        <span className="block text-xs text-muted">
          {r.description}
          {r.category ? ` · ${r.category}` : ''}
          {r.purchase_date ? ` · bought ${r.purchase_date}` : ''}
        </span>
        {r.status !== 'pending' && (
          <span className="block text-[11px] text-faint">
            {r.status === 'denied' && (r.decision_note ? `denied — ${r.decision_note}` : 'denied')}
            {r.status !== 'denied' && (
              <>
                approved {cents(r.approved_amount_cents ?? r.amount_cents)}
                {r.dues_credit_cents > 0 && <> · <span className="text-info font-medium">{cents(r.dues_credit_cents)} credited to dues</span></>}
                {r.status === 'paid'
                  ? <> · paid back {cents(r.paid_amount_cents ?? 0)}</>
                  : (r.approved_amount_cents ?? 0) - (r.dues_credit_cents ?? 0) > 0 &&
                    <> · <span className="text-warn font-medium">{cents((r.approved_amount_cents ?? 0) - (r.dues_credit_cents ?? 0))} to pay back</span></>}
              </>
            )}
          </span>
        )}
      </div>
      {r.receipt_file_id && <ReceiptLink id={r.receipt_file_id} />}
      <Badge className={STATUS_BADGE[r.status]}>{r.status}</Badge>
      {children}
    </li>
  )
}

function SubmitCard({ onSubmitted }) {
  const { memberId, session } = useAuth()
  const [form, setForm] = useState({ amount: '', description: '', purchase_date: '', category: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    const amount = Math.round(Number(form.amount) * 100)
    if (!amount || amount <= 0 || !form.description.trim()) return
    setBusy(true)
    try {
      let receiptId = null
      if (file) {
        receiptId = `receipt-${uid()}`
        await putReceipt(receiptId, file)
      }
      const { error } = await supabase.from('reimbursements').insert({
        profile_id: session.user.id,
        member_id: memberId,
        amount_cents: amount,
        description: form.description.trim(),
        purchase_date: form.purchase_date || null,
        category: form.category || null,
        receipt_file_id: receiptId,
      })
      if (error) throw error
      setForm({ amount: '', description: '', purchase_date: '', category: '' })
      setFile(null)
      setDone(true)
      setTimeout(() => setDone(false), 4000)
      onSubmitted()
    } catch (e) {
      alert('Could not submit: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-5">
      <CardHeader
        title="Submit a reimbursement"
        subtitle={memberId ? null : 'Heads up: your account isn’t linked to a roster member yet — a board member can link it in Roster → App access.'}
      />
      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Amount ($)">
            <input type="number" min="0" step="0.01" className={inputCls} value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Date of purchase">
            <input type="date" className={inputCls} value={form.purchase_date}
              onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">— select —</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Receipt (photo/PDF)">
            <input
              type="file" accept="image/*,application/pdf"
              className="w-full text-xs text-muted file:mr-2 file:px-3 file:py-2 file:rounded-xl file:border file:border-line-strong file:bg-surface file:text-ink file:text-xs file:cursor-pointer"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
        <Field label="What was it for?">
          <TextInput
            placeholder="e.g. LED props from Amazon for Segment 3"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="flex items-center justify-between">
          {done ? <span className="text-sm text-good font-medium">✓ Submitted — the board will review it.</span> : <span />}
          <Button variant="primary" disabled={busy || !Number(form.amount) || !form.description.trim()} onClick={submit}>
            {busy ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

// Editor approval: split the approved amount into dues credit + cash payout.
function DecideModal({ r, memberName, onClose }) {
  // Re-review pre-fills from the prior decision; first review from the request.
  const [approved, setApproved] = useState(((r.approved_amount_cents ?? r.amount_cents) / 100).toFixed(2))
  const [credit, setCredit] = useState(((r.dues_credit_cents ?? 0) / 100).toFixed(2))
  const [note, setNote] = useState(r.decision_note ?? '')
  const [busy, setBusy] = useState(false)

  const approvedC = Math.round(Number(approved) * 100) || 0
  const creditC = Math.min(Math.round(Number(credit) * 100) || 0, approvedC)
  const payout = approvedC - creditC

  const decide = async (status) => {
    setBusy(true)
    const patch = status === 'approved'
      ? { status, approved_amount_cents: approvedC, dues_credit_cents: creditC, decision_note: note || null, decided_at: new Date().toISOString() }
      : { status: 'denied', decision_note: note || null, decided_at: new Date().toISOString() }
    const { error } = await supabase.from('reimbursements').update(patch).eq('id', r.id)
    setBusy(false)
    if (error) return alert('Could not save: ' + error.message)
    onClose()
  }

  return (
    <Modal title={`Review — ${memberName(r.member_id) ?? 'unlinked'} · ${cents(r.amount_cents)}`} onClose={onClose}>
      <p className="text-sm text-muted mb-1">{r.description}</p>
      <p className="text-xs text-faint mb-4">
        {r.category ?? 'no category'}{r.purchase_date ? ` · bought ${r.purchase_date}` : ''}
        {r.receipt_file_id && <> · <ReceiptLink id={r.receipt_file_id} className="underline" /></>}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Approve amount ($)">
          <input type="number" min="0" step="0.01" className={inputCls} value={approved} onChange={(e) => setApproved(e.target.value)} />
        </Field>
        <Field label="Of that, credit toward their dues ($)">
          <input type="number" min="0" step="0.01" className={inputCls} value={credit} onChange={(e) => setCredit(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted mb-3">
        {creditC > 0 && <>{cents(creditC)} comes off what they owe. </>}
        {payout > 0 ? <>{cents(payout)} to pay back in cash/Venmo (mark it paid later).</> : 'Nothing to pay out.'}
        {' '}Check their outstanding on the Dues grid to pick the split.
      </p>
      <Field label="Note (optional)">
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="visible to the member" />
      </Field>
      <div className="flex justify-between mt-2">
        <Button variant="danger" disabled={busy} onClick={() => decide('denied')}>Deny</Button>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || approvedC <= 0} onClick={() => decide('approved')}>
            Approve {cents(approvedC)}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
