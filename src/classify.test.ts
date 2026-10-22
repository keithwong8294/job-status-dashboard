import { describe, expect, it } from 'vitest'
import { classify, extractLeads, parsePay, toRecord } from './classify'
import { demoEmails } from './demo'
import { buildApplications, buildLeads } from './model'
import type { RawEmail } from './types'

const mail = (over: Partial<RawEmail>): RawEmail => ({
  id: 'x',
  threadId: 'x',
  date: Date.UTC(2026, 5, 1),
  from: 'jobs@acme.com',
  fromName: 'Acme Careers',
  fromDomain: 'acme.com',
  subject: '',
  snippet: '',
  body: '',
  ...over,
})

describe('classify', () => {
  it('spots application confirmations', () => {
    expect(classify(mail({ subject: 'Thank you for applying to Acme' }))).toBe('application')
    expect(classify(mail({ subject: 'Application received - Data Analyst' }))).toBe('application')
  })

  it('prefers rejection even when the email thanks you for applying', () => {
    const m = mail({
      subject: 'Your application to Acme',
      body: 'Thank you for applying. Unfortunately, we have decided to move forward with other candidates.',
    })
    expect(classify(m)).toBe('rejection')
  })

  it('spots interview requests', () => {
    expect(classify(mail({ subject: 'Interview for Software Engineer' }))).toBe('response')
    expect(classify(mail({ subject: 'Next steps', snippet: "We'd love to chat about the role" }))).toBe('response')
  })

  it('treats job board alerts as leads and ignores social notifications', () => {
    const board = { from: 'jobalerts-noreply@linkedin.com', fromDomain: 'linkedin.com', fromName: 'LinkedIn' }
    expect(classify(mail({ ...board, subject: 'Data Analyst: new jobs for you' }))).toBe('lead')
    expect(classify(mail({ ...board, subject: 'You appeared in 9 searches this week' }))).toBe('other')
    expect(classify(mail({ ...board, subject: 'Keith, your application was sent to Acme' }))).toBe('application')
  })

  it('ignores unrelated mail', () => {
    expect(classify(mail({ subject: 'Your order has shipped', fromDomain: 'shop.com' }))).toBe('other')
  })
})

describe('parsePay', () => {
  it('normalizes ranges to annual', () => {
    expect(parsePay('$120K - $150K a year')).toMatchObject({ minAnnual: 120000, maxAnnual: 150000 })
    expect(parsePay('$25 - $30 an hour')).toMatchObject({ minAnnual: 52000, maxAnnual: 62400 })
    expect(parsePay('Salary: $95,000/yr')).toMatchObject({ minAnnual: 95000, maxAnnual: 95000 })
    expect(parsePay('$5,000 per month')).toMatchObject({ minAnnual: 60000 })
    expect(parsePay('no pay listed')).toBeUndefined()
  })
})

describe('extractLeads', () => {
  it('reads each listing in a LinkedIn alert', () => {
    const leads = extractLeads(
      mail({
        fromDomain: 'linkedin.com',
        body: `Jobs you may be interested in
Data Analyst
Contoso · Seattle, WA (Hybrid)
$80K - $95K a year
View job: https://www.linkedin.com/comm/jobs/view/123
Junior Data Scientist
Fabrikam
Remote
Be an early applicant
https://www.linkedin.com/comm/jobs/view/456
Unsubscribe https://www.linkedin.com/unsub`,
      }),
    )
    expect(leads).toHaveLength(2)
    expect(leads[0]).toMatchObject({ title: 'Data Analyst', company: 'Contoso', location: 'Seattle, WA (Hybrid)' })
    expect(leads[0].pay?.maxAnnual).toBe(95000)
    expect(leads[1]).toMatchObject({ title: 'Junior Data Scientist', company: 'Fabrikam', location: 'Remote' })
  })

  it('reads Glassdoor listings, which put the company first', () => {
    const leads = extractLeads(
      mail({
        fromDomain: 'glassdoor.com',
        body: 'Litware\nQA Engineer\nAustin, TX\n$28 - $34 an hour\nhttps://www.glassdoor.com/partner/jobListing.htm?jobListingId=9\n',
      }),
    )
    expect(leads[0]).toMatchObject({ company: 'Litware', title: 'QA Engineer', location: 'Austin, TX' })
  })
})

describe('job details', () => {
  it('pulls company and title from the subject', () => {
    const r = toRecord(mail({ subject: 'Your application for Data Analyst at Contoso' }))
    expect(r.job).toMatchObject({ title: 'Data Analyst', company: 'Contoso' })
  })

  it('falls back to the sender name for the company', () => {
    const r = toRecord(mail({ subject: 'Application received', fromName: 'Northwind Labs Recruiting', body: 'Thanks for applying for the Software Engineer position.' }))
    expect(r.job).toMatchObject({ company: 'Northwind Labs', title: 'Software Engineer' })
  })

  it('respects a manual relabel', () => {
    const r = toRecord(mail({ subject: 'Thank you for applying' }), 'other')
    expect(r).toMatchObject({ category: 'other', overridden: true })
  })
})

describe('sample data', () => {
  it('classifies every made-up email the way it was written', () => {
    const records = demoEmails(Date.UTC(2026, 9, 22)).map((e) => toRecord(e))
    expect(records.filter((r) => r.category === 'other')).toHaveLength(1)
    expect(records.filter((r) => r.category === 'lead').every((r) => r.leads.length >= 2)).toBe(true)
    const apps = buildApplications(records)
    expect(apps.length).toBeGreaterThan(5)
    expect(apps.every((a) => a.title)).toBe(true)
  })
})

describe('buildApplications', () => {
  const rec = (subject: string, body: string, day: number) =>
    toRecord(mail({ id: subject + day, subject, body, date: Date.UTC(2026, 5, day) }))

  it('keeps two roles at one company apart and matches the reply to the newest', () => {
    const apps = buildApplications([
      rec('Your application for Data Analyst at Acme', '', 1),
      rec('Your application for QA Engineer at Acme', '', 2),
      rec('Update from Acme', 'Unfortunately we will not be moving forward.', 9),
    ])
    expect(apps).toHaveLength(2)
    expect(apps.find((a) => a.title === 'QA Engineer')?.status).toBe('rejected')
    expect(apps.find((a) => a.title === 'Data Analyst')?.status).toBe('applied')
  })

  it('reads a short city name, not the whole sentence', () => {
    const r = rec('Thank you for applying to Acme', 'Thanks for applying for the Data Analyst position at Acme in Chicago, IL.', 1)
    expect(r.job.location).toBe('Chicago, IL')
  })
})

describe('buildLeads', () => {
  it('merges the same job from several alerts into one row', () => {
    const alert = (day: number, pay: string) =>
      toRecord(
        mail({
          id: `a${day}`,
          date: Date.UTC(2026, 5, day),
          fromDomain: 'linkedin.com',
          subject: 'Data Analyst: new jobs for you',
          body: `Data Analyst\nContoso\nSeattle, WA\n${pay}\nhttps://www.linkedin.com/comm/jobs/view/${day}\n`,
        }),
      )
    const leads = buildLeads([alert(1, '$80K - $95K a year'), alert(5, '')])
    expect(leads).toHaveLength(1)
    expect(leads[0]).toMatchObject({ seen: 2, date: Date.UTC(2026, 5, 5), url: 'https://www.linkedin.com/comm/jobs/view/5' })
    expect(leads[0].pay?.maxAnnual).toBe(95000)
  })
})
