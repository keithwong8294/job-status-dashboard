// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { classify, toRecord } from './classify'
import { buildApplications } from './model'
import { chooseBody } from './gmail'
import type { RawEmail } from './types'

// Shapes copied from real job-search mail, with names and links changed.

const mail = (from: string, subject: string, snippet = '', body = ''): RawEmail => ({
  id: subject,
  threadId: subject,
  date: Date.UTC(2026, 9, 1),
  from,
  fromName: '',
  fromDomain: from.split('@')[1],
  subject,
  snippet,
  body,
})

describe('real-world subjects', () => {
  const cases: [string, string, string, string][] = [
    ['application', 'indeedapply@indeed.com', 'Indeed Application: Data Analyst', "We'll help you get started"],
    ['application', 'jobs-noreply@linkedin.com', 'Keith, your application was sent to Acme Labs', 'Your application was sent to Acme Labs'],
    ['application', 'shm@myworkday.com', 'Thank you for applying!', 'Dear KEITH, Thank you for your interest in the Office Supervisor position for which you applied.'],
    ['application', 'notify@dayforce.com', 'Thank you for your application to Helpful Org', 'We received your application for Help Desk Analyst.'],
    ['application', 'talent@bigco.com', 'You have successfully submitted your Bigco job application - Specialist Intern', ''],
    ['rejection', 'noreply@indeed.com', 'An update on your application from Widget Inc', 'Thank you for applying. Unfortunately, Widget Inc has moved to the next step and your application was not selected'],
    ['rejection', 'no-reply@ashbyhq.com', 'An update on your application at acme', "I want to be upfront with you: we've decided to move forward with another candidate"],
    ['rejection', 'noreply@hrrecruiting.com', 'Company Name - Field Technician Application', 'While your background and qualifications are impressive, we have decided'],
    ['response', 'talent@bigco.com', 'Action Required: Bigco Assessments for completion', 'Thank you for applying to the Specialist Intern position.'],
    ['response', 'talent@bigco.com', 'Your Bigco Application: Next Steps', ''],
    ['other', 'noreply@saashr.com', 'A New Account has been Created', 'Thank you for your interest in the ACME CORPORATION.'],
    ['other', 'jobs-noreply@linkedin.com', 'Problem with your IT Intern application', ''],
    ['other', 'noreply@glassdoor.com', 'Acme Inc.: What You Need to Know', 'See Salaries, Interviews, and Benefits'],
    ['other', 'messages-noreply@linkedin.com', 'Analyst insights: $90K/yr+ salary at 88 job openings', ''],
    ['other', 'linkedin@em.linkedin.com', 'Keith, thanks for being a valued member', 'Unlock a free trial of LinkedIn Premium'],
    ['lead', 'noreply@glassdoor.com', 'New jobs in Newark, NJ. Apply Now.', 'Acme is hiring'],
    ['lead', 'jobs-noreply@linkedin.com', 'Acme is hiring for HR', ''],
    ['lead', 'donotreply@match.indeed.com', 'Data Analyst @ Acme Infotech', '$60,000 - $80,000 a year.'],
    ['lead', 'jobalerts-noreply@linkedin.com', 'Systems Intern job at Acme - 29 company alumni', ''],
  ]
  it.each(cases)('%s: %s / %s', (expected, from, subject, snippet) => {
    expect(classify(mail(from, subject, snippet))).toBe(expected)
  })

  it('reads company and title from ATS confirmations', () => {
    const job = (from: string, subject: string, snippet: string) => toRecord(mail(from, subject, snippet)).job
    expect(job('do-not-reply@mail.paylocity.com', 'Thank you for applying!', 'Thank you for your interest in Aspire Partners, LLC. If you are interested')).toMatchObject({ company: 'Aspire Partners, LLC' })
    expect(job('leidos@myworkday.com', 'Leidos -Thank You For Applying to IT Desktop Intern', '')).toMatchObject({ company: 'Leidos', title: 'IT Desktop Intern' })
    expect(job('noreply@saashr.com', 'Thank You for your application', "We have received your application for the position 'IT Help Desk Intern' and are reviewing")).toMatchObject({ title: 'IT Help Desk Intern' })
    expect(job('noreply@hrrecruiting.com', 'Company Name - Field Technician Application', 'Thank you for your interest in the Field Technician position at Amada America, Inc. While your background')).toMatchObject({ company: 'Amada America, Inc' })
  })
})

describe('real-world bodies', () => {
  it('reads an Indeed match email (plain text part)', () => {
    const plain = `Hi KEITH, could be a good fit for this Office Assistant role.

Office Assistant
SIR SERVICES INC - Manalapan, NJ
$40,000 - $45,000 a year
Easily apply
Perform data entry tasks, including inputting and updating information into computer systems, and other office duties as needed by the team.

https://www.indeed.com/pagead/clk/dl?from=jobi2a&jrtk=1

Delivery Driver - $24.75/HR plus benefit
Logistics LLC - Middlesex, NJ
From $24.75 an hour
Responsive employer
Easily apply
Have a valid driver's license.

https://www.indeed.com/pagead/clk/dl?from=jobi2a&jrtk=2

© 2026 Indeed, Inc.
Indeed Tower 200 West 6th Street, Floor 36, Austin, TX 78701`
    const r = toRecord(mail('donotreply@match.indeed.com', 'Office Assistant at SIR SERVICES INC in Manalapan, NJ and 1 more new job', '', chooseBody(plain, '<p>html</p>')))
    expect(r.leads).toEqual([
      expect.objectContaining({ title: 'Office Assistant', company: 'SIR SERVICES INC', location: 'Manalapan, NJ', pay: expect.objectContaining({ maxAnnual: 45000 }) }),
      expect.objectContaining({ title: 'Delivery Driver - $24.75/HR plus benefit', company: 'Logistics LLC', pay: expect.objectContaining({ minAnnual: 51480 }) }),
    ])
  })

  it('reads a Glassdoor alert (HTML only, one link per card)', () => {
    const card = (company: string, title: string, loc: string, pay: string, id: number) =>
      `<table><tr><td><a href="https://www.glassdoor.com/partner/jobListing.htm?jobListingId=${id}"><table>
        <tr><td>${company}</td></tr><tr><td>${title}</td></tr><tr><td>${loc}</td></tr><tr><td>${pay}</td></tr>
        <tr><td>Easy Apply</td><td>1d</td></tr></table></a></td></tr></table>`
    const html = `<html><head><style>td{}</style></head><body>
      <p>Job alert: Analyst</p>
      ${card('Davis LLP', 'IT Support Analyst', 'New York, NY', '$55K - $65K (Employer est.)', 1)}
      ${card('WSP 3.7 ★', 'Junior Data Analyst', 'Newark, NJ', '$28 - $40 (Employer est.)', 2)}
      <p>investment associate <a href="https://www.glassdoor.com/job-listing/api/rjtRedirect?keywords=x">Create</a></p>
      <p>Glassdoor 200 West 6th Street, Floor 36, Austin, TX 78701 Copyright © 2008-2026</p>
    </body></html>`
    const r = toRecord(mail('noreply@glassdoor.com', 'IT Support Analyst at Davis LLP and 1 more job in New York, NY for you. Apply Now.', '', chooseBody(undefined, html)))
    expect(r.category).toBe('lead')
    expect(r.leads).toEqual([
      expect.objectContaining({ company: 'Davis LLP', title: 'IT Support Analyst', location: 'New York, NY', pay: expect.objectContaining({ minAnnual: 55000 }) }),
      expect.objectContaining({ company: 'WSP', title: 'Junior Data Analyst', location: 'Newark, NJ', pay: expect.objectContaining({ maxAnnual: 83200 }) }),
    ])
  })

  it('reads the employer from an Indeed Apply confirmation (HTML)', () => {
    const html = `<p>Application submitted</p><p>Help Desk Analyst</p>
      <p><a href="http://www.indeed.com/cmp/Helpful-Org">Helpful Org</a> - New York NY US</p>
      <p>The following items were sent to Helpful Org. Good luck!</p>
      <p>Austin Indeed Tower, 200 West 6th Street, Floor 36, Austin, TX 78701</p>`
    const plain = 'Your application has been submitted. Good luck!'
    const r = toRecord(mail('indeedapply@indeed.com', 'Indeed Application: Help Desk Analyst', "We'll help you get started", chooseBody(plain, html)))
    expect(r.category).toBe('application')
    expect(r.job).toMatchObject({ title: 'Help Desk Analyst', company: 'Helpful Org', location: 'New York NY US' })
  })
})

describe('noise, threads and scams', () => {
  const at = (from: string, subject: string, snippet: string, extra: Partial<RawEmail> = {}) => ({ ...mail(from, subject, snippet), ...extra })

  it('ignores bank and store marketing that sounds like hiring', () => {
    expect(classify(at('email@e.bank.com', 'Take the next step with an exclusive loan offer', "You're pre-screened to apply"))).toBe('other')
    expect(classify(at('deals@shop.com', 'Next steps for your order', '', { labels: ['CATEGORY_PROMOTIONS', 'INBOX'] }))).toBe('other')
    expect(classify(at('me@gmail.com', 'Re: Interview: Help Desk', 'Yes, I am interested', { labels: ['SENT'] }))).toBe('other')
  })

  it('counts a whole email thread as one application', () => {
    const t = (subject: string, snippet: string, day: number) =>
      toRecord({ ...at('hr@acme.com', subject, snippet), id: subject + day, threadId: 'thread-1', date: Date.UTC(2026, 8, day) })
    const apps = buildApplications([
      t('Thank you for applying to Acme', 'We received your application for the Analyst position.', 1),
      t('Re: Thank you for applying to Acme', 'Thank you for your interest. We have received your application.', 2),
      t('Re: Interview with Acme', "We'd like to schedule a phone screen.", 5),
    ])
    expect(apps).toHaveLength(1)
    expect(apps[0].status).toBe('responded')
  })

  it('merges back-to-back confirmations from one sender', () => {
    const t = (subject: string, snippet: string, minute: number) =>
      toRecord({ ...at('shm@myworkday.com', subject, snippet), id: subject, threadId: subject, date: Date.UTC(2026, 9, 19, 22, minute) })
    const apps = buildApplications([
      t('Action Needed! Thank you for applying with us.', 'Thank you for applying with us. Create a home account.', 50),
      t('Thank you for applying!', 'Thank you for your interest in the Office Supervisor position.', 51),
    ])
    expect(apps).toHaveLength(1)
  })

  it('flags a fake-check job scam', () => {
    const t = (subject: string, snippet: string, day: number) =>
      toRecord({
        ...at('ro.nichols@career-gymbrand.com', subject, snippet),
        id: subject + day,
        threadId: 't',
        date: Date.UTC(2026, 8, day),
      })
    const apps = buildApplications([
      t('Interview: IT Help Desk Associate', 'Dear Applicant. Your resume has been shortlisted. The interview is a written interview on Teams chat.', 8),
      t('Re: Interview: IT Help Desk Associate', 'We are delighted to extend to you the offer. We will mail you a company check to purchase your equipment from our approved vendor.', 22),
    ])
    expect(apps).toHaveLength(1)
    expect(apps[0].status).toBe('scam')
    expect(apps[0].scamSigns).toEqual(expect.arrayContaining(['lookalike sender domain (career-gymbrand.com)', 'offers to send you a check']))
  })

  it('does not flag an ordinary interview', () => {
    const r = toRecord(at('recruiting@acme.com', 'Interview for Data Analyst', "We'd like to schedule a video interview on Zoom."))
    expect(r.scamSigns).toEqual([])
  })
})

describe('scam threads from two lookalike senders', () => {
  it('end up as one scam application', () => {
    const t = (from: string, name: string, thread: string, day: number, snippet: string) =>
      toRecord({
        ...mail(from, 'Interview: IT Help Desk Associate', snippet),
        fromName: name,
        id: thread + day,
        threadId: thread,
        date: Date.UTC(2026, 8, day),
      })
    const intro = 'Dear Applicant. Thank you for your interest in the IT Help Desk Associate Role at Gymbrand. Your resume has been shortlisted.'
    const written = 'Since this role is 100% remote, this written interview is conducted on Teams chat.'
    const apps = buildApplications([
      t('ro.nichols@career-gymbrand.com', 'ro.nichols', 'a', 8, intro),
      t('ro.nichols@career-gymbrand.com', 'ro.nichols', 'a', 17, written),
      t('rrnichols@job-gymbrand.com', 'ronald nichols', 'b', 18, intro),
    ])
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ company: 'Gymbrand', title: 'IT Help Desk Associate', status: 'scam' })
  })
})
