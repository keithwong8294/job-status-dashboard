import type { RawEmail } from './types'

/** Made-up emails so the dashboard can be tried before connecting Gmail. */

const COMPANIES = ['Northwind Labs', 'Contoso', 'Fabrikam', 'Tailspin Health', 'Litware', 'Adatum', 'Proseware', 'Wingtip Games', 'Fourth Coffee', 'Margie Travel', 'Blue Yonder Air', 'Lucerne Publishing']
const TITLES = ['Software Engineer', 'Data Analyst', 'Associate Product Manager', 'Frontend Developer', 'Business Analyst', 'Junior Data Scientist', 'QA Engineer', 'Solutions Engineer']
const PLACES = ['Seattle, WA', 'San Francisco, CA', 'New York, NY', 'Austin, TX', 'Remote', 'Boston, MA', 'Chicago, IL', 'Denver, CO']
const PAY = ['$95K - $120K a year', '$28 - $34 an hour', '$110,000 - $135,000 a year', '$70K - $85K a year', '$40 - $48 an hour', '$125K - $150K a year']

let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]

function email(i: number, date: number, from: string, subject: string, body: string): RawEmail {
  const [name, addr] = from.split('|')
  return {
    id: `demo-${i}`,
    threadId: `demo-${i}`,
    date,
    from: addr,
    fromName: name,
    fromDomain: addr.split('@')[1],
    subject,
    snippet: body.slice(0, 140).replace(/\s+/g, ' '),
    body,
  }
}

export function demoEmails(now = Date.now()): RawEmail[] {
  seed = 7
  const start = new Date(2026, 4, 1).getTime()
  const out: RawEmail[] = []
  let i = 0
  const at = () => start + rand() * (now - start)

  for (let n = 0; n < 46; n++) {
    const company = pick(COMPANIES)
    const title = pick(TITLES)
    const place = pick(PLACES)
    const d = at()
    const slug = company.toLowerCase().replace(/\W/g, '')
    out.push(email(i++, d, `${company} Careers|careers@${slug}.com`, `Thank you for applying to ${company}`,
      `Hi Keith,\nThank you for applying for the ${title} position at ${company} in ${place}. We have received your application and our team will review it.\nThe role pays ${pick(PAY)}. Responsibilities include building data pipelines, writing SQL, and working with stakeholders.`))
    const r = rand()
    if (r < 0.3) {
      out.push(email(i++, d + 9 * 864e5 * rand() + 864e5, `${company} Recruiting|recruiting@${slug}.com`, `${company} - next steps for ${title}`,
        `Hi Keith,\nWe'd love to schedule a phone screen to talk about the ${title} role. Please share your availability for an interview this week.`))
    } else if (r < 0.65) {
      out.push(email(i++, d + 20 * 864e5 * rand() + 864e5, `${company} Talent|no-reply@${slug}.com`, `Your application to ${company}`,
        `Hi Keith,\nThank you for your interest in the ${title} role. Unfortunately, we have decided to move forward with other candidates whose experience more closely matches our needs.`))
    }
  }

  const boards = [
    ['LinkedIn Job Alerts|jobalerts-noreply@linkedin.com', 'https://www.linkedin.com/comm/jobs/view/'],
    ['Indeed|alert@indeed.com', 'https://www.indeed.com/rc/clk?jk='],
    ['Glassdoor Jobs|noreply@glassdoor.com', 'https://www.glassdoor.com/partner/jobListing.htm?jobListingId='],
  ]
  for (let n = 0; n < 30; n++) {
    const [from, url] = pick(boards)
    const glassdoor = from.includes('glassdoor')
    const listings = Array.from({ length: 2 + Math.floor(rand() * 3) }, (_, k) => {
      const t = pick(TITLES), c = pick(COMPANIES), p = pick(PLACES), pay = pick(PAY)
      const lines = glassdoor ? [c, t, p, pay] : [t, c, p, pay]
      return `${lines.join('\n')}\n${url}${n}${k}\n`
    })
    out.push(email(i++, at(), from, `${pick(TITLES)}: new jobs for you`, `Jobs you may be interested in\n\n${listings.join('\n')}`))
  }
  out.push(email(i++, at(), 'LinkedIn|messages-noreply@linkedin.com', 'You appeared in 12 searches this week', 'See who is looking.'))
  return out.sort((a, b) => b.date - a.date)
}
