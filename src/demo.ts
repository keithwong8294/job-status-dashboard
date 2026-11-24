import type { Profile } from './recommend'
import type { RawEmail } from './types'

/**
 * Made-up emails so anyone can try the dashboard without connecting Gmail.
 * Every company, person, address and link here is fictional, and nothing in
 * demo mode is read from or saved to Gmail or the browser's saved data.
 * The emails are written in the same shapes real ones take, so they run
 * through the real classifier and exercise every part of the dashboard.
 */

/** The made-up job seeker the sample data belongs to. */
export const DEMO_PROFILE: Profile = {
  resume: [
    'Jordan Rivera — B.S. Information Technology, May 2026',
    'Help desk intern: troubleshooting Windows and macOS laptops, Active Directory accounts, Microsoft 365 and Teams, ticketing in ServiceNow.',
    'Student data analyst: SQL queries, Excel and Tableau dashboards, Python (pandas) for cleaning survey data.',
    'Skills: SQL, Python, Tableau, Excel, Windows, Active Directory, Microsoft 365, customer service, hardware.',
  ].join('\n'),
  targetTitles: 'IT Support Specialist, Help Desk Technician, Junior Data Analyst',
  minPay: 50000,
  includeRemote: true,
  home: 'New Brunswick, NJ',
}

const COMPANIES = [
  'Northwind Labs',
  'Contoso Health',
  'Fabrikam Financial',
  'Tailspin Logistics',
  'Litware Systems',
  'Adatum Insurance',
  'Proseware',
  'Wingtip Media',
  'Woodgrove Bank',
  'Lucerne Publishing',
  'Trey Research',
  'Relecloud',
  'Alpine Health Partners',
  'Coho Analytics',
  'Blue Yonder Airlines',
  'Fourth Coffee',
  'Humongous Insurance',
  'Margie Travel',
]
const TITLES = [
  'IT Support Specialist',
  'Help Desk Technician',
  'Junior Data Analyst',
  'Desktop Support Technician',
  'Business Analyst',
  'Technical Support Analyst',
  'Data Analyst',
  'Service Desk Analyst',
  'Reporting Analyst',
  'Junior Systems Administrator',
  'IT Associate',
  'Operations Analyst',
]
const PLACES = [
  'New York, NY',
  'Jersey City, NJ',
  'Newark, NJ',
  'Edison, NJ',
  'Princeton, NJ',
  'Stamford, CT',
  'Hoboken, NJ',
  'Parsippany, NJ',
  'Brooklyn, NY',
  'Morristown, NJ',
  'Remote',
  'Philadelphia, PA',
]
const PAY = [
  '$55,000 - $65,000 a year',
  '$24 - $30 an hour',
  '$62K - $75K a year',
  '$70,000 - $85,000 a year',
  '$48K - $56K a year',
  '$58K - $68K a year',
  '$27 - $33 an hour',
]
const DUTIES = [
  'Resolve hardware and software tickets in ServiceNow, image Windows laptops, and manage Active Directory accounts.',
  'Write SQL queries and build Tableau dashboards that track weekly sales for the operations team.',
  'Support Microsoft 365, Teams and VPN access for 300 employees across two offices.',
  'Clean and analyze data in Excel and Python, and present findings to stakeholders.',
  'Troubleshoot printers, phones and conference room equipment; document fixes in the knowledge base.',
  'Gather requirements, map processes, and turn reports into recommendations for leadership.',
]

let seed = 11
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)]
const DAY = 864e5

const slug = (company: string) => company.toLowerCase().replace(/\W/g, '')

function email(id: string, thread: string, date: number, from: string, subject: string, body: string): RawEmail {
  const [name, addr] = from.split('|')
  return {
    id,
    threadId: thread,
    date: Math.round(date),
    from: addr,
    fromName: name,
    fromDomain: addr.split('@')[1],
    subject,
    snippet: body.replace(/\s+/g, ' ').slice(0, 160),
    body,
  }
}

type Outcome = 'none' | 'screen' | 'assessment' | 'rejected' | 'interview_rejected' | 'offer'

interface Story {
  company: string
  title: string
  place: string
  pay: string
  duties: string
  /** How the application was sent: straight to the employer, or through a job board. */
  via: 'direct' | 'linkedin' | 'indeed'
  outcome: Outcome
  applied: number
}

/** The emails one application produces, in the shapes employers and job boards send. */
function storyEmails(n: number, s: Story, now: number): RawEmail[] {
  const out: RawEmail[] = []
  const thread = `demo-app-${n}`
  const domain = `${slug(s.company)}.example`
  const employer = `${s.company} Careers|careers@${domain}`
  const recruiter = `Sam Patel, ${s.company}|sam.patel@${domain}`
  let k = 0
  const add = (date: number, from: string, subject: string, body: string) => {
    if (date < now) out.push(email(`${thread}-${k++}`, thread, date, from, subject, body))
  }

  if (s.via === 'linkedin') {
    add(s.applied, 'LinkedIn|jobs-noreply@linkedin.com', `Jordan, your application was sent to ${s.company}`,
      `Your application was sent to ${s.company}\n\nYou applied for the ${s.title} role.\n${s.company} · ${s.place}\n${s.pay}\n\nGood luck!`)
  } else if (s.via === 'indeed') {
    add(s.applied, 'Indeed Apply|indeedapply@indeed.com', `Indeed Application: ${s.title}`,
      `Application submitted\n\n${s.title}\n${s.company} - ${s.place}\n${s.pay}\n\nThe following items were sent to ${s.company}. Good luck!\n• Resume\n• Cover letter`)
  } else {
    add(s.applied, employer, `Thank you for applying to ${s.company} - ${s.title}`,
      `Hi Jordan,\n\nThank you for applying for the ${s.title} position at ${s.company} in ${s.place}. We have received your application and our hiring team will review it over the next two weeks.\n\nThe posted pay range is ${s.pay}.\n\nIn this role you will: ${s.duties}\n\n${s.company} Talent Team`)
  }

  const reply = s.applied + (3 + rand() * 9) * DAY
  const later = reply + (5 + rand() * 10) * DAY
  const subjectTag = `${s.company} - ${s.title} application`
  switch (s.outcome) {
    case 'screen':
      add(reply, recruiter, `${subjectTag}: next steps`,
        `Hi Jordan,\n\nThanks for your interest in the ${s.title} role. I'd love to set up a 20-minute phone screen this week. Could you send me your availability for Tuesday or Wednesday?\n\nBest,\nSam`)
      break
    case 'assessment':
      add(reply, employer, `${subjectTag}: online assessment`,
        `Hi Jordan,\n\nAs a next step for the ${s.title} position, please complete a short online assessment (about 30 minutes) within five days.\n\nThank you,\n${s.company} Talent Team`)
      break
    case 'rejected':
      add(reply + 6 * DAY, `${s.company} Talent|no-reply@${domain}`, `Your application to ${s.company}`,
        `Hi Jordan,\n\nThank you for your interest in the ${s.title} role. Unfortunately, we have decided to move forward with other candidates whose experience more closely matches our needs.\n\nWe wish you the best in your search.`)
      break
    case 'interview_rejected':
      add(reply, recruiter, `Interview invitation - ${s.title}`,
        `Hi Jordan,\n\nWe'd like to invite you to interview for the ${s.title} position. Please share your availability for a video call with the team next week.\n\nBest,\nSam`)
      add(later, recruiter, `${s.company} - ${s.title} update`,
        `Hi Jordan,\n\nThank you for taking the time to interview with us. Unfortunately, we have decided to move forward with another candidate for the ${s.title} role. We enjoyed meeting you.\n\nBest,\nSam`)
      break
    case 'offer':
      add(reply, recruiter, `Interview invitation - ${s.title}`,
        `Hi Jordan,\n\nWe'd like to invite you to interview for the ${s.title} position. Please share your availability for a video call with the team next week.\n\nBest,\nSam`)
      add(later, recruiter, `Offer letter - ${s.title}`,
        `Hi Jordan,\n\nWe are pleased to offer you the ${s.title} position at ${s.company}! Your offer letter is attached. Let us know if you have any questions before you sign.\n\nCongratulations,\nSam`)
      break
  }
  return out
}

/** A fake-check scam, the most common kind a new grad sees. */
function scamEmails(date: number): RawEmail[] {
  const from = 'Quillmark Group Hiring|hiring@quillmark-group.example'
  return [
    email('demo-scam-0', 'demo-scam', date, from, 'Thank you for applying to Quillmark Group - Remote Data Entry Assistant',
      'Hi Jordan,\n\nThank you for applying for the Remote Data Entry Assistant position at Quillmark Group. Pay is $32 an hour, fully remote.'),
    email('demo-scam-1', 'demo-scam', date + 1.5 * DAY, from, 'Quillmark Group: interview for Remote Data Entry Assistant',
      'Hi Jordan,\n\nYour interview will be a written interview over Teams chat. Once hired, we will mail you a check to purchase your equipment from our approved vendor.'),
  ]
}

/** One listing in a job-board alert, written the way each board lays them out. */
interface Listing {
  title: string
  company: string
  place: string
  pay?: string
  description?: string
}

const BOARDS = {
  linkedin: { from: 'LinkedIn Job Alerts|jobalerts-noreply@linkedin.com', url: 'https://www.linkedin.com/comm/jobs/view/' },
  indeed: { from: 'Indeed|alert@indeed.com', url: 'https://www.indeed.com/rc/clk?jk=demo' },
  glassdoor: { from: 'Glassdoor Jobs|noreply@glassdoor.com', url: 'https://www.glassdoor.com/partner/jobListing.htm?jobListingId=' },
  handshake: { from: 'Handshake|jobs@mail.joinhandshake.com', url: 'https://app.joinhandshake.com/jobs/' },
}
type Board = keyof typeof BOARDS

function alertBody(board: Board, listings: Listing[], n: number): string {
  const url = BOARDS[board].url
  const rows = listings.map((l, k) => {
    const link = `${url}${4100000 + n * 10 + k}`
    if (board === 'linkedin') return [l.title, `${l.company} · ${l.place}`, l.pay, link].filter(Boolean).join('\n')
    if (board === 'indeed') return [l.title, `${l.company} - ${l.place}`, l.pay, l.description, link].filter(Boolean).join('\n')
    if (board === 'glassdoor') return [l.company, l.title, l.place, l.pay, link].filter(Boolean).join('\n')
    const pay = l.pay?.replace(/ an hour$/, '/hr').replace(/ a year$/, '/yr')
    return [l.company, l.title, `${pay ? `${pay} • ` : ''}Full-Time • ${l.place}`, link].join('\n')
  })
  const intro = board === 'handshake' ? 'Jobs picked for you this week' : 'Jobs you may be interested in'
  return `${intro}\n\n${rows.join('\n\n')}\n\nYou are receiving this alert because you saved a job search.`
}

const ALERT_SUBJECT: Record<Board, (l: Listing) => string> = {
  linkedin: (l) => `"${l.title}": new jobs in New Jersey`,
  indeed: (l) => `${l.title} at ${l.company} and more new jobs for you`,
  glassdoor: (l) => `${l.company} is hiring for ${l.title}. Apply now.`,
  handshake: () => 'Jobs round-up: you could be a top applicant for these jobs',
}

/** Listings outside the target field or level, so the lead filters have something to filter. */
const OFF_TARGET: Listing[] = [
  { title: 'Senior Systems Engineer', company: 'Relecloud', place: 'New York, NY', pay: '$135K - $160K a year', description: 'Lead our cloud migration. 7+ years of experience with VMware and Azure required.' },
  { title: 'Veterinary Assistant', company: 'Happy Paws Clinic', place: 'Edison, NJ', pay: '$17 - $19 an hour' },
  { title: 'Warehouse Associate', company: 'Tailspin Logistics', place: 'Carteret, NJ', pay: '$19 - $21 an hour' },
  { title: 'Retail Sales Associate', company: 'Fourth Coffee', place: 'Hoboken, NJ', pay: '$16 - $18 an hour' },
  { title: 'Data Analyst', company: 'Coho Analytics', place: 'Austin, TX', pay: '$75K - $90K a year', description: 'Build dashboards in Power BI and write SQL for our sales team.' },
  { title: 'Front Desk Receptionist', company: 'Alpine Health Partners', place: 'Princeton, NJ', pay: '$18 - $20 an hour' },
]

function listing(): Listing {
  if (rand() < 0.22) return pick(OFF_TARGET)
  const title = rand() < 0.2 ? `Junior ${pick(['IT Support Specialist', 'Data Analyst', 'Business Analyst'])}` : pick(TITLES)
  return { title, company: pick(COMPANIES), place: pick(PLACES), pay: rand() < 0.85 ? pick(PAY) : undefined, description: rand() < 0.6 ? pick(DUTIES) : undefined }
}

export function demoEmails(now = Date.now()): RawEmail[] {
  seed = 11
  const start = new Date(2026, 4, 1).getTime()
  const span = Math.max(30 * DAY, now - start)
  // More applications as the search picks up: dates lean toward recent weeks.
  const when = () => start + Math.sqrt(rand()) * (span - 4 * DAY)
  const out: RawEmail[] = []

  const outcomes: Outcome[] = ['none', 'none', 'none', 'rejected', 'rejected', 'rejected', 'screen', 'assessment', 'interview_rejected']
  const used = new Set<string>()
  for (let n = 0; n < 36; n++) {
    let company: string, title: string
    do {
      company = pick(COMPANIES)
      title = pick(TITLES)
    } while (used.has(`${company}|${title}`))
    used.add(`${company}|${title}`)
    const via = rand() < 0.2 ? 'linkedin' : rand() < 0.2 ? 'indeed' : 'direct'
    const outcome = n === 3 || n === 17 ? 'offer' : pick(outcomes)
    out.push(...storyEmails(n, { company, title, place: pick(PLACES), pay: pick(PAY), duties: pick(DUTIES), via, outcome, applied: when() }, now))
  }
  out.push(...scamEmails(start + 0.55 * span))

  // Job-board alerts, more of them recently, each listing a few jobs.
  const boards: Board[] = ['linkedin', 'indeed', 'glassdoor', 'handshake', 'linkedin', 'indeed']
  for (let n = 0; n < 34; n++) {
    const board = pick(boards)
    const listings = Array.from({ length: 2 + Math.floor(rand() * 3) }, listing)
    const date = n < 8 ? start + rand() * span * 0.6 : now - rand() * 28 * DAY
    out.push(email(`demo-alert-${n}`, `demo-alert-${n}`, date, BOARDS[board].from, ALERT_SUBJECT[board](listings[0]), alertBody(board, listings, n)))
  }

  // Inbox noise the dashboard should leave out.
  out.push(email('demo-noise-0', 'demo-noise-0', now - 2 * DAY, 'LinkedIn|notifications-noreply@linkedin.com', 'You appeared in 14 searches this week', 'See who is looking at your profile.'))
  out.push(email('demo-noise-1', 'demo-noise-1', now - 9 * DAY, 'Woodgrove Bank|offers@woodgrovebank.example', 'Jordan, you are pre-approved for a credit card', 'Take the next step toward 2% cash back.'))
  return out.filter((e) => e.date < now).sort((a, b) => b.date - a.date)
}
