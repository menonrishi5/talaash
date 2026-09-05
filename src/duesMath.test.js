import { describe, it, expect } from 'vitest'
import { memberOwedCents } from './duesMath.js'

const roster = [{ id: 'm1', name: 'Asha Rao' }]

const zeffyPaidRate = (overrides = {}) => ([{
  id: 'p1',
  status: 'succeeded',
  campaign_id: 'camp1',
  buyer_first: 'Asha',
  buyer_last: 'Rao',
  created: '2026-01-05',
  items: [{ rate_id: 'r1', amount: 5000 }],
  ...overrides,
}])

const baseData = (over = {}) => ({
  dues: { categories: [], overrides: {}, contactLinks: {} },
  roster,
  settings: {},
  zeffyPayments: [],
  checkins: [],
  finePayments: [],
  reimbursements: [],
  ...over,
})

describe('memberOwedCents', () => {
  it('returns 0 with no member id', () => {
    expect(memberOwedCents(null, baseData())).toBe(0)
  })

  it('counts an unpaid manual category (no rateId) as owed', () => {
    const data = baseData({ dues: { categories: [{ id: 'c1', amountCents: 5000 }], overrides: {}, contactLinks: {} } })
    expect(memberOwedCents('m1', data)).toBe(5000)
  })

  it('a manual "paid" override clears it', () => {
    const data = baseData({
      dues: { categories: [{ id: 'c1', amountCents: 5000 }], overrides: { m1: { c1: 'paid' } }, contactLinks: {} },
    })
    expect(memberOwedCents('m1', data)).toBe(0)
  })

  it('a manual "exempt" override clears it', () => {
    const data = baseData({
      dues: { categories: [{ id: 'c1', amountCents: 5000 }], overrides: { m1: { c1: 'exempt' } }, contactLinks: {} },
    })
    expect(memberOwedCents('m1', data)).toBe(0)
  })

  it('a category matched by zeffy rate_id is not owed', () => {
    const data = baseData({
      dues: { categories: [{ id: 'c1', rateId: 'r1', amountCents: 5000 }], overrides: {}, contactLinks: {} },
      zeffyPayments: zeffyPaidRate(),
    })
    expect(memberOwedCents('m1', data)).toBe(0)
  })

  it('an excluded campaign is treated as if the payment never happened', () => {
    const data = baseData({
      dues: {
        categories: [{ id: 'c1', rateId: 'r1', amountCents: 5000 }],
        overrides: {}, contactLinks: {},
        excludedCampaigns: { camp1: true },
      },
      zeffyPayments: zeffyPaidRate(),
    })
    expect(memberOwedCents('m1', data)).toBe(5000)
  })

  it('pending attendance fines do not count yet, approved ones do', () => {
    const data = baseData({
      checkins: [
        { fine: '5.00', fine_pending: false },
        { fine: '3.00', fine_pending: true },
      ],
    })
    expect(memberOwedCents('m1', data)).toBe(500)
  })

  it('fine payments offset attendance fines but never go negative', () => {
    const data = baseData({
      checkins: [{ fine: '5.00', fine_pending: false }],
      finePayments: [{ amount: '20.00' }],
    })
    expect(memberOwedCents('m1', data)).toBe(0)
  })

  it('a late-payment fee applies when paid after the due date', () => {
    const data = baseData({
      dues: { categories: [{ id: 'c1', rateId: 'r1', amountCents: 5000, dueDate: '2026-01-01' }], overrides: {}, contactLinks: {} },
      zeffyPayments: zeffyPaidRate({ created: '2026-01-03' }), // 2 days late
    })
    expect(memberOwedCents('m1', data)).toBe(500) // default lateCents
  })

  it('no late fee when paid on or before the due date', () => {
    const data = baseData({
      dues: { categories: [{ id: 'c1', rateId: 'r1', amountCents: 5000, dueDate: '2026-01-05' }], overrides: {}, contactLinks: {} },
      zeffyPayments: zeffyPaidRate({ created: '2026-01-05' }),
    })
    expect(memberOwedCents('m1', data)).toBe(0)
  })

  it('a member on a payment plan is exempt from late fees', () => {
    const data = baseData({
      roster: [{ id: 'm1', name: 'Asha Rao', paymentPlan: true }],
      dues: { categories: [{ id: 'c1', rateId: 'r1', amountCents: 5000, dueDate: '2026-01-01' }], overrides: {}, contactLinks: {} },
      zeffyPayments: zeffyPaidRate({ created: '2026-01-03' }),
    })
    expect(memberOwedCents('m1', data)).toBe(0)
  })

  it('a per-member late-fine waiver zeroes it out', () => {
    const data = baseData({
      dues: {
        categories: [{ id: 'c1', rateId: 'r1', amountCents: 5000, dueDate: '2026-01-01' }],
        overrides: {}, contactLinks: {},
        lateFineWaivers: { m1: { c1: true } },
      },
      zeffyPayments: zeffyPaidRate({ created: '2026-01-03' }),
    })
    expect(memberOwedCents('m1', data)).toBe(0)
  })

  it('crosses into the very-late fee tier after the threshold', () => {
    const data = baseData({
      dues: { categories: [{ id: 'c1', rateId: 'r1', amountCents: 5000, dueDate: '2026-01-01' }], overrides: {}, contactLinks: {} },
      zeffyPayments: zeffyPaidRate({ created: '2026-01-11' }), // 10 days late
    })
    expect(memberOwedCents('m1', data)).toBe(1000) // default veryLateCents
  })

  it('a ticked donation credits against what is owed', () => {
    const data = baseData({
      dues: { categories: [], overrides: {}, contactLinks: {}, donationCredits: { p1: true } },
      zeffyPayments: [{
        id: 'p1', status: 'succeeded', campaign_id: 'camp1',
        buyer_first: 'Asha', buyer_last: 'Rao', created: '2026-01-05',
        items: [{ type: 'donation', amount: 1000 }],
      }],
    })
    expect(memberOwedCents('m1', data)).toBe(-1000) // credit carries forward
  })

  it('approved/paid reimbursements credit against what is owed', () => {
    const data = baseData({
      reimbursements: [
        { id: 'r1', member_id: 'm1', status: 'approved', dues_credit_cents: 2000 },
        { id: 'r2', member_id: 'm1', status: 'approved', dues_credit_cents: 500 },
        { id: 'r3', member_id: 'm1', status: 'denied', dues_credit_cents: 9999 },
        { id: 'r4', member_id: 'm2', status: 'approved', dues_credit_cents: 9999 },
      ],
    })
    expect(memberOwedCents('m1', data)).toBe(-2500)
  })

  it('excludes the reimbursement currently being decided, to avoid circularity', () => {
    const data = baseData({
      reimbursements: [
        { id: 'r1', member_id: 'm1', status: 'approved', dues_credit_cents: 2000 },
        { id: 'r2', member_id: 'm1', status: 'approved', dues_credit_cents: 500 },
      ],
    })
    expect(memberOwedCents('m1', data, 'r1')).toBe(-500)
  })
})
