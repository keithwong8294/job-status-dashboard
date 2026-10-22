import type { Category, EmailRecord, Job, Pay, RawEmail, Source } from './types'

const BOARD_DOMAINS: Record<string, Source> = {
  'linkedin.com': 'linkedin',
  'indeed.com': 'indeed',
  'indeedemail.com': 'indeed',
  'glassdoor.com': 'glassdoor',
}

export function sourceOf(domain: string): Source {
  const d = domain.toLowerCase()
  for (const [suffix, source] of Object.entries(BOARD_DOMAINS)) {
    if (d === suffix || d.endsWith('.' + suffix)) return source
  }
  return 'direct'
}

// Checked in order: a rejection often also says "thank you for applying",
// so rejection wording wins over application wording.
const REJECTION = [
  /unfortunately/i,
  /not (?:be )?(?:moving|move) forward/i,
  /decided to (?:move|proceed|pursue) (?:forward )?with other/i,
  /(?:pursue|proceed with|move forward with) other candidates/i,
  /position has been filled/i,
  /no longer (?:being )?consider/i,
  /not selected/i,
  /regret to inform/i,
  /will not be (?:moving|proceeding)/i,
  /after careful (?:review|consideration)/i,
]

const RESPONSE = [
  /\binterview/i,
  /schedule (?:a|some) (?:time|call|chat)/i,
  /phone screen/i,
  /next steps?\b/i,
  /assessment|coding challenge|take[- ]home/i,
  /(?:would|'d) (?:like|love) to (?:speak|chat|talk|connect|learn more)/i,
  /your availability/i,
  /offer letter|pleased to offer|extend (?:you )?an offer/i,
]

const APPLICATION = [
  /thank(?:s| you) for (?:your )?(?:applying|application|interest in)/i,
  /application (?:has been |was )?(?:received|submitted)/i,
  /we(?:'ve| have) received your application/i,
  /your application (?:to|for|was sent)/i,
  /successfully (?:applied|submitted)/i,
  /application confirmation/i,
]

const ALERT = [
  /job alert/i,
  /jobs? (?:for you|you may be interested|recommended|matching)/i,
  /new jobs?/i,
  /is hiring/i,
  /\bhiring\b/i,
  /apply now/i,
  /similar jobs/i,
]

/** Board notifications that are about something other than jobs. */
const BOARD_NOISE = [
  /viewed your profile/i,
  /new connection|invitation|accepted your invitation/i,
  /appeared in \d+ searches/i,
  /messaged you|new message/i,
  /reacted to|commented on|endorsed you/i,
  /password|verify your|security|sign[- ]in/i,
  /premium/i,
]

const anyMatch = (patterns: RegExp[], text: string) => patterns.some((p) => p.test(text))

export function classify(raw: RawEmail): Category {
  const source = sourceOf(raw.fromDomain)
  const head = `${raw.subject}\n${raw.snippet}`
  const text = `${head}\n${raw.body.slice(0, 4000)}`

  if (anyMatch(REJECTION, text)) return 'rejection'
  // Boards send "your application was sent" confirmations, so check that before
  // treating board mail as a lead.
  if (anyMatch(APPLICATION, head)) return 'application'
  if (source !== 'direct') {
    if (anyMatch(BOARD_NOISE, raw.subject)) return 'other'
    if (anyMatch(ALERT, text) || /\/jobs?\/view|viewjob|jobListingId|jk=/i.test(raw.body)) return 'lead'
    return 'other'
  }
  if (anyMatch(RESPONSE, head)) return 'response'
  if (anyMatch(APPLICATION, text)) return 'application'
  return 'other'
}

// ---------- pay ----------

const HOURS_PER_YEAR = 2080

function toNumber(s: string): number {
  const k = /k$/i.test(s)
  const n = parseFloat(s.replace(/[$,kK]/g, ''))
  return k ? n * 1000 : n
}

/** Parses "$120K - $150K a year", "$25 - $30 an hour", "$95,000/yr", "$4,000 per month". */
export function parsePay(text: string): Pay | undefined {
  const m = text.match(
    /\$\s?(\d[\d,]*(?:\.\d+)?\s?[kK]?)(?:\s*(?:-|–|to)\s*\$?\s?(\d[\d,]*(?:\.\d+)?\s?[kK]?))?(?:\s*(?:\/|per|an?|a)\s*(hour|hr|year|yr|annum|month|mo|week|wk))?/,
  )
  if (!m) return undefined
  let min = toNumber(m[1].replace(/\s/g, ''))
  let max = m[2] ? toNumber(m[2].replace(/\s/g, '')) : min
  if (!isFinite(min) || min <= 0) return undefined
  const unit = (m[3] ?? '').toLowerCase()
  let factor = 1
  if (unit.startsWith('h')) factor = HOURS_PER_YEAR
  else if (unit.startsWith('mo')) factor = 12
  else if (unit.startsWith('w')) factor = 52
  else if (!unit && max < 200) factor = HOURS_PER_YEAR // "$25 - $30" with no unit is hourly
  min *= factor
  max *= factor
  if (max < min) [min, max] = [max, min]
  return { text: m[0].trim(), minAnnual: Math.round(min), maxAnnual: Math.round(max) }
}

// ---------- location ----------

const STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY'
const LOCATION_RE = new RegExp(
  `(?:[A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,3}, (?:${STATES})\\b(?: \\d{5})?(?: \\((?:Remote|Hybrid|On-site)\\))?)|\\bRemote\\b(?: in [A-Z][A-Za-z ,]+)?|\\bUnited States\\b(?: \\((?:Remote|Hybrid|On-site)\\))?`,
)

export function parseLocation(text: string): string | undefined {
  return text.match(LOCATION_RE)?.[0].trim()
}

// ---------- job details for application / response / rejection ----------

const SUBJECT_PATTERNS: RegExp[] = [
  // "Your application for Software Engineer at Acme"
  /application (?:for|to) (?:the )?(?<title>.+?) (?:position |role )?at (?<company>.+?)$/i,
  // "Thank you for applying to Acme"
  /(?:applying|application|interest) (?:to|at|in|with) (?<company>.+?)$/i,
  // "Acme - Software Engineer application received"
  /^(?<company>[^-–|:]+?) [-–|:] (?<title>.+?) (?:application|role|position)\b/i,
  // "Software Engineer at Acme"
  /^(?<title>.+?) at (?<company>.+?)$/i,
]

function cleanup(s?: string): string | undefined {
  const t = s
    ?.replace(/[!.]+$/, '')
    .replace(/^(?:re|fwd?):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t : undefined
}

export function extractJob(raw: RawEmail, source: Source): Job {
  const subject = raw.subject.replace(/^(?:re|fwd?):\s*/i, '').trim()
  let job: Job = {}
  for (const re of SUBJECT_PATTERNS) {
    const g = subject.match(re)?.groups
    if (g) {
      job = { title: cleanup(g.title), company: cleanup(g.company) }
      break
    }
  }
  if (!job.company && source === 'direct') {
    job.company = cleanup(raw.fromName.replace(/\b(?:careers|recruiting|talent( acquisition)?|jobs|hr|team|hiring)\b/gi, '')) ??
      raw.fromDomain.split('.').slice(-2, -1)[0]
  }
  const body = `${raw.subject}\n${raw.body.slice(0, 3000)}`
  job.title ??= cleanup(
    body.match(/\b(?:the|for|as an?) (?<title>[A-Z][\w/&+.-]*(?: [A-Z][\w/&+.-]*| I{1,3}| of| and){0,6}) (?:role|position|opening|job)\b/)?.groups?.title,
  )
  job.location = parseLocation(body)
  job.pay = parsePay(body)
  return job
}

// ---------- listings inside job-board alerts ----------

const URL_RE = /https?:\/\/\S+/g
const JOB_URL_RE = /(?:linkedin\.com\/(?:comm\/)?jobs\/view|indeed\.com\/(?:rc\/clk|viewjob|pagead)|glassdoor\.com\/(?:partner\/jobListing|job-listing|Job))/i
const JUNK_LINE =
  /^(?:view job|apply|easy apply|see (?:all|more) jobs|new|promoted|actively recruiting|be an early applicant|\d+ (?:applicants|connections?|alumni)|.*school alumni.*|.*ago$|just posted|responsive employer|urgently hiring|[★☆\d.\s]+)$/i

/**
 * Job alert emails list several jobs, each as a few lines of text followed by a
 * link. We split on the job links and read the lines just before each one.
 */
export function extractLeads(raw: RawEmail): Job[] {
  const text = raw.body
  const leads: Job[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[)>\]]+$/, '')
    const start = m.index ?? 0
    const chunk = text.slice(last, start)
    last = start + m[0].length
    if (!JOB_URL_RE.test(url)) continue
    const lines = chunk
      .split(/\n/)
      .map((l) => l.replace(/^[-•·*\s]+|[:\s]+$/g, '').trim())
      .filter((l) => l && l.length < 120 && !JUNK_LINE.test(l) && !/^https?:/.test(l))
      .slice(-5)
    if (!lines.length) continue
    const job: Job = { url }
    const rest: string[] = []
    for (const line of lines) {
      // LinkedIn: "Acme · San Francisco, CA (Hybrid)"
      const [c, loc] = line.split(' · ')
      if (loc && !job.company) {
        job.company = c
        job.location ??= loc
      } else if (!job.pay && /\$\s?\d/.test(line)) job.pay = parsePay(line)
      else if (!job.location && parseLocation(line) && line.length < 60) job.location = parseLocation(line)
      else rest.push(line)
    }
    // Glassdoor puts company first, LinkedIn and Indeed put title first.
    if (job.company) job.title = rest.at(-1)
    else {
      const [a, b] = rest.slice(-2)
      const glassdoor = raw.fromDomain.includes('glassdoor')
      job.title = b === undefined || !glassdoor ? a : b
      job.company = b === undefined ? undefined : glassdoor ? a : b
    }
    if (job.title) leads.push(job)
  }
  // A single-job email ("Acme is hiring a Data Analyst") with no parseable list.
  if (!leads.length) {
    const m = raw.subject.match(/^(?<company>.+?) is hiring(?: an?)? (?<title>.+?)(?: in .+)?$/i) ??
      raw.subject.match(/^(?<title>.+?) at (?<company>.+?)$/i)
    if (m?.groups) {
      leads.push({
        title: cleanup(m.groups.title),
        company: cleanup(m.groups.company),
        location: parseLocation(raw.body),
        pay: parsePay(raw.body),
      })
    }
  }
  return leads
}

export function toRecord(raw: RawEmail, override?: Category): EmailRecord {
  const source = sourceOf(raw.fromDomain)
  const category = override ?? classify(raw)
  return {
    ...raw,
    source,
    category,
    overridden: override !== undefined,
    job: category === 'lead' || category === 'other' ? {} : extractJob(raw, source),
    leads: category === 'lead' ? extractLeads(raw) : [],
  }
}
