import { describe, it, expect } from 'vitest'
import { isActive, buyerKey, buyerName, buildMatcher } from './matching.js'

describe('isActive', () => {
  it('is active unless explicitly flagged false (legacy rows have no flag)', () => {
    expect(isActive({})).toBe(true)
    expect(isActive({ active: true })).toBe(true)
    expect(isActive({ active: false })).toBe(false)
  })
})

describe('buyerKey / buyerName', () => {
  it('keys by normalized email when present', () => {
    expect(buyerKey({ buyer_email: '  Asha@Example.com ' })).toBe('asha@example.com')
  })

  it('falls back to normalized full name when there is no email', () => {
    expect(buyerKey({ buyer_first: 'Asha', buyer_last: 'Rao' })).toBe('asha rao')
  })

  it('names the buyer from first/last, or email, or "Unknown buyer"', () => {
    expect(buyerName({ buyer_first: 'Asha', buyer_last: 'Rao' })).toBe('Asha Rao')
    expect(buyerName({ buyer_email: 'a@b.com' })).toBe('a@b.com')
    expect(buyerName({})).toBe('Unknown buyer')
  })
})

describe('buildMatcher', () => {
  const roster = [
    { id: 'm1', name: 'Asha Rao' },
    { id: 'm2', name: 'Dev Kumar' },
    { id: 'm3', name: 'Priya Kumar' },   // shares a last name with m2
    { id: 'm4', name: 'Shreyas Patel' }, // shares a first name with m5
    { id: 'm5', name: 'Shreyas Mehta' },
  ]

  it('a manual link takes precedence over everything else', () => {
    const matcher = buildMatcher(roster, { 'random@buyer.com': 'm2' })
    expect(matcher({ buyer_email: 'random@buyer.com', buyer_first: 'Asha', buyer_last: 'Rao' })).toBe('m2')
  })

  it('ignores a manual link pointing at a removed member', () => {
    const matcher = buildMatcher(roster, { 'random@buyer.com': 'no-longer-on-roster' })
    expect(matcher({ buyer_email: 'random@buyer.com' })).toBeNull()
  })

  it('matches an exact full name', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Asha', buyer_last: 'Rao' })).toBe('m1')
  })

  it('matches a unique last name (a parent paying)', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Vikram', buyer_last: 'Rao' })).toBe('m1')
  })

  it('sends an ambiguous last name to the manual queue', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Someone', buyer_last: 'Kumar' })).toBeNull()
  })

  it('falls back to a unique first name when there is no useful last name', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Dev', buyer_last: '' })).toBe('m2')
  })

  it('sends an ambiguous first name to the manual queue', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Shreyas', buyer_last: '' })).toBeNull()
  })

  it('returns null for a total stranger', () => {
    const matcher = buildMatcher(roster)
    expect(matcher({ buyer_first: 'Nobody', buyer_last: 'Here' })).toBeNull()
  })
})
