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
    expect(apps[0].status).toBe('action')
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

describe('Handshake, Indeed and LinkedIn formats (November 2026)', () => {
  it('reads a Handshake weekly digest', () => {
    // As the app's HTML-to-text turns it out: every card link is the same tracking redirect.
    const link = ' https://email.g.joinhandshake.com/c/abc'
    const body = [
      'Your weekly jobs round-up',
      'New jobs just for you, sent every week.',
      link,
      'Acme Labs',
      'Technical Support Specialist',
      '$26–36/hr • Full-Time • Parsippany, NJ (Onsite)',
      link,
      link,
      'Widget Co',
      'Data Analyst',
      'Full-Time • Remote',
      link,
      link,
      'Helpful Org',
      'Tech Setup Specialist',
      'Promoted • $50–60K/yr • Full-Time • Carteret, NJ +1 (Hybrid)',
      link,
      'View more jobs',
    ].join('\n')
    const r = toRecord(mail('handshake@g.joinhandshake.com', 'Keith, Acme Labs sees you as a top applicant for Technical Support Specialist and more', '', body))
    expect(r.category).toBe('lead')
    expect(r.source).toBe('handshake')
    expect(r.leads).toEqual([
      expect.objectContaining({ title: 'Technical Support Specialist', company: 'Acme Labs', location: 'Parsippany, NJ (Onsite)', pay: expect.objectContaining({ minAnnual: 54080 }) }),
      expect.objectContaining({ title: 'Data Analyst', company: 'Widget Co', location: 'Remote' }),
      expect.objectContaining({ title: 'Tech Setup Specialist', company: 'Helpful Org', location: 'Carteret, NJ (Hybrid)', pay: expect.objectContaining({ minAnnual: 50000, maxAnnual: 60000 }) }),
    ])
  })

  it('counts a Handshake application by company and skips recruiter messages', () => {
    const sent = toRecord(
      mail('handshake@notifications.joinhandshake.com', "Application sent to Acme Labs Inc. — here's what's next", 'Your application was sent to Acme Labs Inc.', 'Your application was sent to Acme Labs Inc.\nView application\nApply to similar jobs\nWidget Co\nCorporate Recruiter\n$70–80K/yr • Full-Time • McLean, VA (Onsite)'),
    )
    expect(sent.category).toBe('application')
    expect(sent.job.company).toBe('Acme Labs Inc')
    const pitch = mail('handshake@notifications.joinhandshake.com', 'Thank you for your interest in Widget!', 'Pat just messaged you about a job Hi Keith! I wanted to follow up')
    expect(classify(pitch)).toBe('other')
  })

  it('treats an Indeed employer message as a response', () => {
    const r = toRecord(mail('no-reply@indeed.com', 'New Message from Acme Builders, LLC - Help Desk Specialist', 'Log in to view and respond to the message'))
    expect(r.category).toBe('response')
    expect(r.job).toMatchObject({ company: 'Acme Builders, LLC', title: 'Help Desk Specialist' })
  })

  it('recognizes newer alert subjects', () => {
    expect(classify(mail('donotreply@jobalert.indeed.com', 'Sales Specialist at Acme Recruiting. 9 more Teen jobs in Edison, NJ'))).toBe('lead')
    expect(classify(mail('jobalerts-noreply@linkedin.com', 'You may be a fit for Acme’s Analyst Intern role - 119 school alumni'))).toBe('lead')
    expect(classify(mail('messages-noreply@linkedin.com', 'View Acme jobs and your next steps'))).toBe('lead')
  })

  it('reads LinkedIn recommendations that give a bare town and "See who was hired" links', () => {
    const body = [
      'Recommendations based on your activity.',
      'IT jobs',
      'https://www.linkedin.com/comm/jobs/search-results/?keywords=intern',
      '',
      '2027 Technology Summer Internship Program',
      'Acme',
      'Warren',
      'View job: https://www.linkedin.com/comm/jobs/view/111/?trackingId=a',
      '',
      '---------------------------------------------------------',
      '',
      'IT Intern',
      'Widget Energy',
      'KearnySee who Widget Energy has hired for this role: https://www.linkedin.com/comm/search/results/people/?title=IT',
      'Apply with resume & profile',
      'View job: https://www.linkedin.com/comm/jobs/view/222/?trackingId=b',
    ].join('\n')
    const r = toRecord(mail('jobs-noreply@linkedin.com', 'Acme is hiring for a IT role', '', body))
    expect(r.leads).toEqual([
      expect.objectContaining({ title: '2027 Technology Summer Internship Program', company: 'Acme', location: 'Warren' }),
      expect.objectContaining({ title: 'IT Intern', company: 'Widget Energy', location: 'Kearny' }),
    ])
  })
})

describe('Handshake applications', () => {
  const sent = (company: string, minute: number, similar: string) =>
    toRecord({
      ...mail(
        'handshake@notifications.joinhandshake.com',
        `Application sent to ${company} — here's what's next`,
        `Handshake KW Your application was sent to ${company} View application Apply to similar jobs ${similar}`,
        `Your application was sent to ${company}\nView application\nApply to similar jobs\n${similar}`,
      ),
      id: company,
      threadId: company,
      date: Date.UTC(2026, 10, 12, 15, minute),
    })

  it('keeps applications to different companies apart, even minutes apart', () => {
    const apps = buildApplications([
      sent('Acme Labs', 0, 'Widget Co\nExecutive Assistant\n$80–90K/yr • Full-Time • New York City, NY (Hybrid)'),
      sent('Helpful Org', 2, 'Other Co\nJunior AI Developer\n$18–25/hr • Part-Time • Addison, TX (Onsite)'),
      sent('Bigco', 5, 'Third Co\nData Analyst\nFull-Time • New York, NY (Onsite)'),
    ])
    expect(apps.map((a) => a.company).sort()).toEqual(['Acme Labs', 'Bigco', 'Helpful Org'])
  })

  it('ignores pay and location from the similar jobs section', () => {
    const r = sent('Acme Labs', 0, 'Widget Co\nExecutive Assistant\n$80–90K/yr • Full-Time • New York City, NY (Hybrid)')
    expect(r.job).toEqual({ company: 'Acme Labs' })
  })
})

describe('several jobs at one employer, and one job confirmed twice', () => {
  const peoplesoft = (id: string, minute: number, position: string) =>
    toRecord({
      ...mail('HRSRecruiting@metro.edu', 'Your online application has been successfully submitted'),
      id,
      threadId: 'same-subject-thread',
      date: Date.UTC(2026, 10, 24, 4, minute),
      // Plain-text parts come with \r\n line endings, as Gmail serves them.
      body: `Dear Keith Wong:\r\n\r\nThank you for your interest in employment at Metro University. This message acknowledges receipt of your application for the following position(s) submitted on 2026-11-23:\r\n\r\n${position}\r\n\r\nTo review your information, click on the following link:\n\nhttps://example.edu/apply\n\nThanks and stay safe!`,
    })

  it('keeps different jobs apart even when Gmail threads their confirmations', () => {
    const apps = buildApplications([
      peoplesoft('a', 37, '33039-IT Assistant - Network, Level 1 (Provisional)'),
      peoplesoft('b', 38, '32994-HR Coordinator (Assistant to HEO)'),
      peoplesoft('c', 39, '33099-IT Support Assistant (Provisional) - Department of Information Technology'),
      peoplesoft('d', 47, '32907-IT Support Assistant (Hourly) 2 Positions'),
    ])
    expect(apps.map((a) => a.title)).toEqual([
      'IT Assistant - Network, Level 1 (Provisional)',
      'HR Coordinator (Assistant to HEO)',
      'IT Support Assistant (Provisional) - Department of Information Technology',
      'IT Support Assistant (Hourly) 2 Positions',
    ])
  })

  const indeed = (title: string, company: string, second: number) =>
    toRecord({
      ...mail('indeedapply@indeed.com', `Indeed Application: ${title}`, "We'll help you get started"),
      id: `indeed-${title}`,
      body: `Application submitted\n${title}\n${company} - New York, NY\nThe following items were sent to ${company}. Good luck!`,
      date: Date.UTC(2026, 10, 24, 1, 54, second),
    })
  const employer = (snippet: string, second: number) =>
    toRecord({
      ...mail('do_not_reply@clearcompany.com', 'Application Received', snippet),
      fromName: 'Human Resources',
      id: `employer-${second}`,
      body: snippet.replace(/&amp;/g, '&'),
      date: Date.UTC(2026, 10, 24, 1, 54, second),
    })

  it("counts a job board's confirmation and the employer's own as one application", () => {
    // Gmail escapes snippets, so the company first reads "Bigfirm &amp; Co".
    const apps = buildApplications([
      indeed('Jr. Operations Specialist (DTC)', 'Bigfirm & Co. Inc.', 54),
      employer('Dear KEITH, Thank you for your interest in Bigfirm &amp; Co. Inc. and the Jr. Operations Specialist (DTC) position. We have received your application', 56),
    ])
    expect(apps).toHaveLength(1)
    expect(apps[0].emails).toHaveLength(2)
  })

  it('still keeps two different jobs at that employer apart', () => {
    const apps = buildApplications([
      indeed('Jr. Operations Specialist (DTC)', 'Bigfirm & Co. Inc.', 54),
      employer('Dear KEITH, Thank you for your interest in Bigfirm &amp; Co. Inc. and the Compliance Analyst position. We have received your application', 56),
    ])
    expect(apps).toHaveLength(2)
  })
})
