import { describe, expect, it } from 'vitest'
import { toRecord } from './classify'
import { DEMO_PROFILE, demoEmails } from './demo'
import { buildApplications, buildLeads, isExpired, type Status } from './model'
import { isRecommended, scoreLead } from './recommend'
import { fieldOf, DEFAULT_HIDDEN_FIELDS } from './fields'
import { locate } from './distance'

const now = new Date(2026, 10, 24).getTime()
const records = demoEmails(now).map((r) => toRecord(r))
const apps = buildApplications(records)
const leads = buildLeads(records)

describe('sample data', () => {
  it('is the same every time', () => {
    expect(demoEmails(now)).toEqual(demoEmails(now))
  })

  it('never mentions a real inbox or person', () => {
    const text = JSON.stringify(demoEmails(now)).toLowerCase()
    expect(text).not.toMatch(/keith|wong|gmail\.com|@(?!linkedin|indeed|glassdoor|mail\.joinhandshake)[a-z0-9.-]+\.(?:com|net|org)\b/)
  })

  it('shows every application status', () => {
    const counts = new Map<Status, number>()
    for (const a of apps) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
    for (const s of ['applied', 'action', 'rejected', 'interview_rejected', 'interview_offer', 'scam'] as Status[]) {
      expect(counts.get(s) ?? 0, s).toBeGreaterThan(0)
    }
    expect(apps.length).toBeGreaterThan(30)
    expect(apps.every((a) => a.title && a.company)).toBe(true)
  })

  it('has leads from every board, with pay, places and descriptions', () => {
    const sources = new Set(leads.map((l) => l.source))
    expect([...sources].sort()).toEqual(['glassdoor', 'handshake', 'indeed', 'linkedin'])
    expect(leads.length).toBeGreaterThan(40)
    expect(leads.every((l) => l.title && l.company && l.location)).toBe(true)
    expect(leads.filter((l) => l.pay).length).toBeGreaterThan(30)
    expect(leads.some((l) => l.description)).toBe(true)
  })

  it('gives the lead views something to show', () => {
    const fresh = leads.filter((l) => !isExpired(l, now))
    expect(fresh.filter((l) => isRecommended(scoreLead(l, DEMO_PROFILE))).length).toBeGreaterThan(8)
    expect(leads.some((l) => isExpired(l, now))).toBe(true)
    expect(leads.some((l) => DEFAULT_HIDDEN_FIELDS.includes(fieldOf(l.title)))).toBe(true)
    expect(locate(DEMO_PROFILE.home)).toBeDefined()
  })

  it('leaves inbox noise out', () => {
    expect(records.filter((r) => r.category === 'other')).toHaveLength(2)
  })
})
