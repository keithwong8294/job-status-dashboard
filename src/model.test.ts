import { describe, expect, it } from 'vitest'
import { inGroup, isExpired, weekly, type Application, type Lead, type Status } from './model'
import type { Category, EmailRecord } from './types'

const day = 864e5
const start = new Date(2026, 4, 4) // a Monday
const email = (category: Category, date: number) => ({ id: String(date), category, date }) as EmailRecord
const app = (status: Status, emails: EmailRecord[]): Application => ({
  key: status + emails.length,
  company: 'Acme',
  status,
  emailStatus: status,
  edited: false,
  scamSigns: [],
  appliedOn: emails[0]?.date,
  lastUpdate: emails.at(-1)?.date ?? 0,
  emails,
})

describe('counting applications', () => {
  const t = start.getTime()
  const apps = [
    app('applied', [email('application', t)]),
    // Heard back, then rejected: counts as a rejection only, like the list shows.
    app('rejected', [email('application', t), email('response', t + 8 * day), email('rejection', t + 15 * day)]),
    app('interviewing', [email('application', t + day), email('response', t + 9 * day)]),
    app('scam', [email('application', t), email('response', t + day)]),
  ]

  it('puts each application in one status group', () => {
    expect(apps.filter((a) => inGroup(a, 'all'))).toHaveLength(3)
    expect(apps.filter((a) => inGroup(a, 'responses'))).toHaveLength(1)
    expect(apps.filter((a) => inGroup(a, 'rejected'))).toHaveLength(1)
  })

  it('charts the same counts as the tiles', () => {
    const weeks = weekly(apps, start, t + 20 * day)
    const sum = (k: 'application' | 'response' | 'rejection') => weeks.reduce((n, w) => n + w[k], 0)
    expect([sum('application'), sum('response'), sum('rejection')]).toEqual([3, 1, 1])
    expect(weeks[2].rejection).toBe(1)
  })
})

describe('expired leads', () => {
  it('expires a lead no alert has listed in 30 days', () => {
    const now = Date.now()
    expect(isExpired({ date: now - 31 * day } as Lead, now)).toBe(true)
    expect(isExpired({ date: now - 5 * day } as Lead, now)).toBe(false)
  })
})
