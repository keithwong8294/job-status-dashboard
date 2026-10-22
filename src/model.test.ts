import { describe, expect, it } from 'vitest'
import { buildApplications, inGroup, isExpired, weekly, withEditedStatus, type Application, type Lead, type Status } from './model'
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
    app('interview_rejected', [email('application', t), email('response', t + 8 * day), email('rejection', t + 15 * day)]),
    app('action', [email('application', t + day), email('response', t + 9 * day)]),
    app('scam', [email('application', t), email('response', t + day)]),
  ]

  it('puts each application in one status group', () => {
    expect(apps.filter((a) => inGroup(a, 'all'))).toHaveLength(3)
    expect(apps.filter((a) => inGroup(a, 'action'))).toHaveLength(1)
    expect(apps.filter((a) => inGroup(a, 'interviews'))).toHaveLength(1)
    expect(apps.filter((a) => inGroup(a, 'rejected'))).toHaveLength(1)
  })

  it('charts the same counts as the tiles', () => {
    const weeks = weekly(apps, start, t + 20 * day)
    const sum = (k: 'application' | 'response' | 'rejection') => weeks.reduce((n, w) => n + w[k], 0)
    expect([sum('application'), sum('response'), sum('rejection')]).toEqual([3, 2, 1])
    expect(weeks[2].rejection).toBe(1)
  })
})

describe('status from emails', () => {
  const at = (category: Category, day: number, subject: string) =>
    ({ id: subject, threadId: 't', from: 'hr@acme.com', fromName: 'Acme', fromDomain: 'acme.com', category, date: start.getTime() + day * 864e5, subject, snippet: '', body: '', job: { company: 'Acme' }, scamSigns: [], leads: [] }) as unknown as EmailRecord
  const status = (...emails: EmailRecord[]) => buildApplications(emails)[0].status

  it('reads the five statuses', () => {
    expect(status(at('application', 0, 'Thanks for applying'))).toBe('applied')
    expect(status(at('application', 0, 'Thanks for applying'), at('response', 2, 'Please complete this assessment'))).toBe('action')
    expect(status(at('application', 0, 'Thanks for applying'), at('rejection', 2, 'Update on your application'))).toBe('rejected')
    expect(
      status(at('application', 0, 'Thanks for applying'), at('response', 2, 'Schedule your interview'), at('rejection', 9, 'Update on your application')),
    ).toBe('interview_rejected')
    expect(
      status(at('application', 0, 'Thanks for applying'), at('response', 2, 'Schedule your interview'), at('response', 9, 'We are pleased to offer you the role')),
    ).toBe('interview_offer')
  })

  it('maps statuses saved before the change', () => {
    const [a] = withEditedStatus([app('applied', [])], new Map([['applied0', 'withdrawn' as Status]]))
    expect(a.status).toBe('removed')
  })
})

describe('expired leads', () => {
  it('expires a lead no alert has listed in 30 days', () => {
    const now = Date.now()
    expect(isExpired({ date: now - 31 * day } as Lead, now)).toBe(true)
    expect(isExpired({ date: now - 5 * day } as Lead, now)).toBe(false)
  })
})
