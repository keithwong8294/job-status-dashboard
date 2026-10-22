// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { classify, toRecord } from './classify'
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
