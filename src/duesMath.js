// Shared "what does this member owe" calculation, so the reimbursement review
// can default its dues credit to the member's real outstanding balance —
// matching the Dues grid's owedNet formula.

import { buildMatcher } from './matching.js'

// data: { dues, roster, settings, zeffyPayments, checkins, finePayments, reimbursements }
// Returns outstanding cents (dues + attendance fines + late fines − credits),
// excluding one reimbursement (the one being decided) to avoid circularity.
export function memberOwedCents(memberId, data, excludeReimbId = null) {
  const { dues, roster, settings, zeffyPayments = [], checkins = [], finePayments = [], reimbursements = [] } = data
  if (!memberId) return 0
  const member = roster.find((m) => m.id === memberId)
  const matcher = buildMatcher(roster, dues.contactLinks || {})
  const excluded = dues.excludedCampaigns || {}
  const defaults = settings?.dueFineDefaults ?? { lateCents: 500, veryLateCents: 1000, veryLateAfterDays: 7 }

  const succeeded = zeffyPayments.filter(
    (p) => p.status === 'succeeded' && p.refund_status !== 'full' && !excluded[p.campaign_id ?? 'none'],
  )

  // Rates this member paid, and the earliest date each was paid.
  const paidRates = new Set()
  const paidDate = {}
  for (const p of succeeded) {
    if (matcher(p) !== memberId) continue
    const d = p.created?.slice(0, 10)
    for (const it of p.items ?? []) {
      if (!it.rate_id) continue
      paidRates.add(it.rate_id)
      if (!paidDate[it.rate_id] || d < paidDate[it.rate_id]) paidDate[it.rate_id] = d
    }
  }

  const categories = dues.categories || []
  const catKey = (c) => c.id ?? c.rateId
  const isUnpaid = (c) => {
    const ov = dues.overrides?.[memberId]?.[catKey(c)]
    if (ov === 'paid' || ov === 'exempt') return false
    return !(c.rateId && paidRates.has(c.rateId))
  }
  const gross = categories.reduce((s, c) => (isUnpaid(c) ? s + c.amountCents : s), 0)

  // Attendance fines (approved only) minus fine payments.
  const fined = checkins.reduce((n, c) => n + (c.fine_pending ? 0 : Math.round(Number(c.fine) * 100)), 0)
  const finePaid = finePayments.reduce((n, p) => n + Math.round(Number(p.amount) * 100), 0)
  const attendanceFines = Math.max(0, fined - finePaid)

  // Late-payment fines.
  const lateFine = (c) => {
    if (!c.rateId || !c.dueDate || c.lateFinesActive === false || member?.paymentPlan) return 0
    if (dues.lateFineWaivers?.[memberId]?.[catKey(c)]) return 0
    const paid = paidDate[c.rateId]
    if (!paid || paid <= c.dueDate) return 0
    const daysLate = Math.round((new Date(paid) - new Date(c.dueDate)) / 86400000)
    return daysLate >= (c.veryLateAfterDays ?? defaults.veryLateAfterDays)
      ? (c.veryLateCents ?? defaults.veryLateCents)
      : (c.lateCents ?? defaults.lateCents)
  }
  const lateFines = categories.reduce((s, c) => s + lateFine(c), 0)

  // Credits: ticked donations + other approved/paid reimbursement dues-offsets.
  const donationCredits = dues.donationCredits || {}
  let donationCredit = 0
  for (const p of succeeded) {
    if (matcher(p) !== memberId || !donationCredits[p.id]) continue
    donationCredit += (p.items ?? [])
      .filter((i) => i.type === 'donation' || i.type === 'additional_donation')
      .reduce((s, i) => s + (i.amount ?? 0), 0)
  }
  const reimbCredit = reimbursements
    .filter((r) => r.member_id === memberId && ['approved', 'paid'].includes(r.status) && r.id !== excludeReimbId)
    .reduce((s, r) => s + (r.dues_credit_cents || 0), 0)

  return gross + attendanceFines + lateFines - donationCredit - reimbCredit
}
