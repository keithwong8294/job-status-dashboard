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
  /not (?:to )?(?:be )?(?:moving|move|proceed|proceeding) forward/i,
  /decided to (?:move|proceed|pursue|go) (?:forward )?with (?:an)?other/i,
  /(?:pursue|proceed with|move forward with) (?:an)?other (?:candidate|applicant)/i,
  /other (?:candidates|applicants) whose/i,
  /position has been filled/i,
  /no longer (?:being )?consider/i,
  /(?:application was |were )?not selected/i,
  /regret to inform/i,
  /while your (?:background|qualifications|experience|skills)/i,
  /not (?:a )?(?:fit|match) for (?:this|the) (?:role|position)/i,
]

/** Checked against the subject first, so "Thank you for applying… complete your assessment" counts as a response. */
const RESPONSE = [
  /\binterview/i,
  /schedule (?:a|some) (?:time|call|chat)/i,
  /phone screen/i,
  /next steps?\b/i,
  /assessment|coding challenge|take[- ]home|hirevue/i,
  /(?:would|'d) (?:like|love) to (?:speak|chat|talk|connect|learn more|meet)/i,
  /your availability/i,
  /offer letter|pleased to offer|extend (?:you )?an offer/i,
  /loves? your (?:resume|background|profile)/i,
]

const APPLICATION = [
  /thank(?:s| you)(?: so much)? for (?:taking the time to )?(?:apply|applying|your application|submitting your application)/i,
  /thank(?:s| you)(?: so much)? for your (?:recent )?(?:application|interest in)/i,
  /application (?:has been |was )?(?:received|submitted)/i,
  /(?:we(?:'ve| have)|we) received your (?:application|resume)/i,
  /your application (?:to|for|was sent|has been)/i,
  /successfully (?:applied|submitted)/i,
  /application confirmation/i,
  /^indeed application:/i,
]

const ALERT = [
  /job alert/i,
  /jobs? (?:for you|you may be interested|recommended|matching)/i,
  /new jobs?/i,
  /more (?:new )?jobs?/i,
  /is hiring/i,
  /are hiring/i,
  /apply now|apply soon/i,
  /similar jobs/i,
  /still available/i,
  /(?:job|role|opportunity) (?:at|for you)/i,
  /great fit/i,
  / @ /,
]

/** Board notifications that are about something other than open jobs. */
const BOARD_NOISE = [
  /viewed your profile|people viewed/i,
  /new connection|invitation|want to connect|popular in your network/i,
  /appeared in \d+ searches/i,
  /messaged you|new message/i,
  /reacted to|commented on|endorsed you|posted/i,
  /password|verify your|security|sign[- ]in/i,
  /premium|free trial|valued member/i,
  /what you need to know/i,
  /you're invited|career talks|webinar|event/i,
  /hiring trends|insights|salary at/i,
  /problem with your/i,
]

/** Account and password mail from hiring sites, which often also says "thanks for your interest". */
const DIRECT_NOISE = [/new account|create (?:a |your )?(?:password|account)|verify your email|reset your password/i]


const anyMatch = (patterns: RegExp[], text: string) => patterns.some((p) => p.test(text))

/** Banks, lenders and stores borrow hiring words ("take the next step", "you're pre-selected"). */
const MARKETING = [
  /\bloans?\b|pre-?(?:screened|selected|approved|qualified)|credit (?:card|score|limit)|\bAPR\b|mortgage|refinanc|direct deposit|cash back|savings account|checking account|\d+% off|free shipping|sale ends|promo code|coupon|subscribe|newsletter|webinar/i,
]

export function classify(raw: RawEmail): Category {
  const source = sourceOf(raw.fromDomain)
  if (raw.labels?.includes('SENT')) return 'other'
  // Gmail's Promotions tab is marketing, except job-board alerts often land there too.
  if (source === 'direct' && raw.labels?.includes('CATEGORY_PROMOTIONS')) return 'other'
  if (source === 'direct' && anyMatch(MARKETING, `${raw.subject}\n${raw.snippet}`)) return 'other'
  const head = `${raw.subject}\n${raw.snippet}`
  const text = `${head}\n${raw.body.slice(0, 4000)}`

  if (source !== 'direct') {
    // Boards forward employer rejections and confirm one-click applications.
    if (anyMatch(REJECTION, head)) return 'rejection'
    if (anyMatch(APPLICATION, head) && !/apply now/i.test(raw.subject)) return 'application'
    if (anyMatch(BOARD_NOISE, raw.subject)) return 'other'
    if (anyMatch(ALERT, raw.subject) || anyMatch(ALERT, raw.snippet)) return 'lead'
    return 'other'
  }
  if (anyMatch(REJECTION, text)) return 'rejection'
  if (anyMatch(DIRECT_NOISE, raw.subject)) return 'other'
  if (anyMatch(RESPONSE, raw.subject)) return 'response'
  if (anyMatch(APPLICATION, head)) return 'application'
  if (anyMatch(RESPONSE, head)) return 'response'
  if (anyMatch(APPLICATION, text)) return 'application'
  return 'other'
}

// ---------- scams ----------

/**
 * Signs of a fake job. Fake-check scams in particular copy a real brand
 * ("career-anytimefitness.com"), interview over chat, and offer to mail a check
 * for "equipment".
 */
const SCAM_TEXT: [RegExp, string][] = [
  [/(?:send|mail|issue|deposit)\w* (?:you )?(?:a |the )?(?:company |cashier'?s? )?check|check (?:to|for) (?:purchase|buy)|mobile deposit/i, 'offers to send you a check'],
  [/(?:purchase|buy) (?:your |the )?(?:equipment|laptop|software|supplies)|(?:approved|preferred) vendor/i, 'asks you to buy equipment'],
  [/\b(?:telegram|signal|whatsapp|google hangouts|wire app|teams chat)\b|written interview|chat interview|text interview|interview (?:via|over|through) (?:chat|text|teams chat)/i, 'chat-only interview'],
  [/gift cards?|bitcoin|crypto(?:currency)? (?:payment|wallet)|zelle|cash ?app/i, 'asks about payments'],
  [/social security|\bssn\b|bank (?:account|details|information)|routing number|driver'?s license (?:number|photo)/i, 'asks for personal or bank details'],
]

/** "career-anytimefitness.com", "job-acme.com": a brand name with a hiring prefix. */
const LOOKALIKE_DOMAIN = /^(?:career|careers|job|jobs|hr|recruit|recruiting|recruitment|hiring|talent|apply|work)[-.]?[a-z]+(?:-[a-z]+)*\.(?:com|net|org|co|us)$/i
const FREE_MAIL = /^(?:gmail|outlook|hotmail|yahoo|aol|icloud|proton(?:mail)?)\./i

export function scamSigns(raw: RawEmail): string[] {
  const signs: string[] = []
  const text = `${raw.subject}\n${raw.snippet}\n${raw.body.slice(0, 6000)}`
  for (const [re, why] of SCAM_TEXT) if (re.test(text)) signs.push(why)
  if (LOOKALIKE_DOMAIN.test(raw.fromDomain)) signs.push(`lookalike sender domain (${raw.fromDomain})`)
  if (FREE_MAIL.test(raw.fromDomain) && /interview|offer|position|role/i.test(raw.subject)) signs.push('recruiter using a personal email')
  return signs
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
    /\$\s?(\d[\d,]*(?:\.\d+)?\s?[kK]?)(?:\s*(?:-|–|to)\s*\$?\s?(\d[\d,]*(?:\.\d+)?\s?[kK]?))?(?:\s*(?:\/|per|an?|a)\s*(hour|hr|year|yr|annum|month|mo|week|wk))?/i,
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
const CITY = `[A-Z][A-Za-z.'-]+(?: (?:of )?[A-Z][A-Za-z.'-]+){0,3}`
const WORK_MODE = `(?: \\((?:Remote|Hybrid|On-site)\\))?`
const LOCATION_RE = new RegExp(
  [
    `${CITY}, (?:${STATES})\\b(?: \\d{5})?${WORK_MODE}`, // "Cranbury, NJ", "Austin, TX (Hybrid)"
    `${CITY} (?:${STATES}) US\\b`, // Indeed: "New York NY US"
    `${CITY} (?:Metropolitan|Metro) Area${WORK_MODE}`, // LinkedIn: "New York City Metropolitan Area"
    `\\bRemote\\b(?: in [A-Z][A-Za-z ,]+)?`,
    `\\bUnited States(?: of America)?\\b${WORK_MODE}`,
  ].join('|'),
)

export function parseLocation(text: string): string | undefined {
  return text.match(LOCATION_RE)?.[0].trim()
}

/** Footers carry the sender's own address (Indeed and Glassdoor are both "Austin, TX"). */
function withoutFooter(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/©|copyright|unsubscribe|privacy policy|\d+ [A-Z]\w* (?:\w+ )?(?:Street|St|Avenue|Ave|Road|Rd|Blvd|Drive)\b/i.test(l))
    .join('\n')
}

// ---------- job details for application / response / rejection ----------

const SUBJECT_PATTERNS: RegExp[] = [
  // "Indeed Application: Data Analyst"
  /^indeed application: (?<title>.+)$/i,
  // "Your application for Software Engineer at Acme"
  /application (?:for|to) (?:the )?(?<title>.+?) (?:position |role )?at (?<company>.+?)$/i,
  // "Leidos -Thank You For Applying to IT Desktop Engineering Intern"
  /^(?<company>[^-–|:]+?) ?[-–|:] ?thank you for applying(?: to| for)? (?<title>.+)$/i,
  // "Amplify : Thank you for applying! - Summer 2027: IT Services Intern"
  /^(?<company>[^-–|:]+?) ?[-–|:] ?thank you for applying!? [-–] (?<title>.+)$/i,
  // "Keith, your application was sent to Acme" (LinkedIn)
  /application was sent to (?<company>.+)$/i,
  // "Thank you for applying to Acme", "An update on your application at Acme"
  /(?:applying|application|interest|update) (?:to|at|in|with|from) (?<company>.+?)$/i,
  // "Acme - Software Engineer application received"
  /^(?<company>[^-–|:]+?) [-–|:] (?<title>.+?) (?:application|role|position)\b/i,
  // "Software Engineer at Acme"
  /^(?<title>.+?) at (?<company>.+?)$/i,
]

const BODY_COMPANY: RegExp[] = [
  /items were sent to (?<company>.+?)\. Good luck/i, // Indeed
  /(?:position|role|opportunity) at (?<company>[A-Z][\w&.,'’-]*(?: [A-Z&][\w&.,'’-]*){0,5})/,
  /(?:interest in|apply(?:ing)? to|apply(?:ing)? with|joining) (?<company>[A-Z][\w&.,'’-]*(?: [A-Z&][\w&.,'’-]*){0,5})/,
]

const BODY_TITLE: RegExp[] = [
  /(?:position|role) of ['‘"]?(?<title>[^'’".\n]{3,80}?)['’"]?(?:\.|\n| -\d| at )/i,
  /(?:position|role) ['‘"](?<title>[^'’"\n]{3,80})['’"]/i,
  /(?:applying|application) (?:for|to) the (?<title>[^.\n]{3,80}?) (?:position|role|opening)\b/i,
  /\b(?:the|for|as an?) (?<title>[A-Z][\w/&+.-]*(?: [A-Z][\w/&+.-]*| I{1,3}| of| and){0,6}) (?:role|position|opening|job)\b/,
]

/** Sender names that are the hiring software or a mailbox, not the employer. */
const GENERIC_SENDER =
  /^(?:workday|indeed(?: apply)?|linkedin|glassdoor|handshake|no-?reply|do-?not-?reply|notifications?|talent|careers|recruiting|hr|jobs|team|hiring|icims|greenhouse|lever|taleo|paylocity|dayforce|paychex|ukg|ashby|smartrecruiters)$/i

function cleanup(s?: string): string | undefined {
  const t = s
    ?.replace(/[\s!.,…–-]+$/, '')
    .replace(/^(?:re|fwd?):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t : undefined
}

/** Trims a company name grabbed from running text: "Acme, LLC. Our team…" → "Acme, LLC". */
function cleanCompany(s?: string): string | undefined {
  const t = cleanup(s?.split(/[.!?] (?=[A-Z])/)[0].replace(/['’]s\b.*$/, ''))
  if (!t || /^(?:us|our\b|the\b|a\b|an\b|company name$)/i.test(t)) return undefined
  return t
}

function senderCompany(raw: RawEmail): string | undefined {
  const name = cleanup(raw.fromName.replace(/\b(?:careers|recruiting|talent(?: acquisition)?|jobs|hr|team|hiring|via \w+)\b/gi, ''))
  if (name && !GENERIC_SENDER.test(name) && !/@/.test(name)) return name
  // "talent@ibm.com" → "ibm"; skip shared hiring-software domains.
  const domain = raw.fromDomain.split('.').slice(-2, -1)[0]
  if (domain && !/myworkday|workday|handshake|icims|greenhouse|lever|taleo|paylocity|dayforce|paychex|saashr|ashbyhq|pinpoint|hrrecruiting|smartrecruiters|indeed|linkedin|glassdoor/i.test(raw.fromDomain)) {
    return domain.length <= 4 ? domain.toUpperCase() : domain[0].toUpperCase() + domain.slice(1)
  }
}

export function extractJob(raw: RawEmail, source: Source): Job {
  const subject = raw.subject.replace(/^(?:re|fwd?):\s*/i, '').trim()
  let job: Job = {}
  for (const re of SUBJECT_PATTERNS) {
    const g = subject.match(re)?.groups
    if (g) {
      job = { title: cleanup(g.title), company: cleanCompany(g.company) }
      break
    }
  }
  const body = withoutFooter(`${raw.snippet}\n${raw.body.slice(0, 4000)}`)
  for (const re of BODY_COMPANY) {
    if (job.company) break
    job.company = cleanCompany(body.match(re)?.groups?.company)
  }
  if (!job.company && source === 'direct') job.company = senderCompany(raw)
  for (const re of BODY_TITLE) {
    if (job.title) break
    job.title = cleanup(body.match(re)?.groups?.title)
  }
  job.location = parseLocation(`${subject}\n${body}`)
  job.pay = parsePay(body)
  return job
}

// ---------- listings inside job-board alerts ----------

const URL_RE = /https?:\/\/[^\s)>\]]+/g
export const JOB_URL_RE =
  /(?:linkedin\.com\/(?:comm\/)?jobs\/view|indeed\.com\/(?:rc\/clk|viewjob|pagead|m\/viewjob)|glassdoor\.com\/(?:partner\/jobListing|job-listing\/(?!api)|Job\/.*JV_))/i
const JUNK_LINE =
  /^(?:view job|apply|easy apply|easily apply|apply with resume.*|see (?:all|more) jobs.*|new|promoted|actively recruiting|this company is actively hiring|be an early applicant|\d+ (?:applicants|connections?|(?:company |school )?alumni).*|.*ago$|\d+[hdw]|\d+\+?d|just posted|responsive employer|urgently hiring|best place to work|top company|hiring multiple candidates|.*(?:employer|glassdoor) est\.?\)?$|[-—=_|•·*★☆\d.\s]+)$/i

function cleanLine(l: string): string {
  return l
    .replace(/^[-•·*|\s]+|[:|\s]+$/g, '')
    .replace(/\s+\d\.\d\s*★$/, '') // Glassdoor rating after the company
    .trim()
}

/**
 * Job alert emails list several jobs, each as a few lines of text followed by a
 * link. We split on the job links and read the lines just before each one.
 */
export function extractLeads(raw: RawEmail): Job[] {
  const text = withoutFooter(raw.body)
  const glassdoor = raw.fromDomain.includes('glassdoor')
  const leads: Job[] = []
  const seen = new Set<string>()
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0]
    const start = m.index ?? 0
    const chunk = text.slice(last, start)
    last = start + url.length
    if (!JOB_URL_RE.test(url)) continue
    const lines = chunk
      .split('\n')
      .map(cleanLine)
      .filter((l) => l && l.length < 400 && !JUNK_LINE.test(l))
      .slice(-8)
    if (!lines.length) continue

    // Anchor on the location line, scanning up from the link. Descriptions are
    // long, so only short lines count.
    let at = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].length < 80 && parseLocation(lines[i])) {
        at = i
        break
      }
    }
    const job: Job = { url }
    if (at >= 0) {
      const line = lines[at]
      // "Acme · Seattle, WA" (LinkedIn) or "Acme - Seattle, WA" (Indeed)
      const split = line.match(/^(?<company>.+?)\s+[·–-]\s+(?<loc>.+)$/)
      if (split?.groups && parseLocation(split.groups.loc)) {
        job.company = split.groups.company
        job.location = split.groups.loc
        job.title = lines[at - 1]
      } else {
        job.location = line
        // Glassdoor puts company first, LinkedIn and Indeed put title first.
        const [a, b] = [lines[at - 2], lines[at - 1]]
        job.title = glassdoor ? b : a ?? b
        job.company = glassdoor ? a : a !== undefined ? b : undefined
      }
      for (const l of lines.slice(at + 1)) {
        if (/\$\s?\d/.test(l) && l.length < 80) job.pay ??= parsePay(l)
        else if (l.length >= 60) job.description = job.description ? `${job.description} ${l}` : l
      }
    } else {
      const [a, b] = lines.filter((l) => l.length < 120).slice(-2)
      job.title = glassdoor ? b ?? a : a
      job.company = b !== undefined ? (glassdoor ? a : b) : undefined
    }
    // Pay lines are dropped as junk when they carry "(Employer est.)", so read the raw chunk too.
    job.pay ??= parsePay(chunk.split('\n').slice(-12).join('\n'))
    job.title = cleanup(job.title)
    job.company = cleanup(job.company)
    const key = `${job.title}|${job.company}|${job.location}`
    if (job.title && !seen.has(key)) {
      seen.add(key)
      leads.push(job)
    }
  }
  // A single-job email ("Acme is hiring for Data Analyst") with no parseable list.
  if (!leads.length) {
    const s = raw.subject.replace(/\.? ?apply (?:now|soon)\.?$/i, '')
    const m =
      s.match(/^(?<company>.+?) is hiring(?: for)?(?: an?)? (?<title>.+?)(?: in .+)?$/i) ??
      s.match(/^(?:keith, )?apply now to ['‘](?<title>.+?) at (?<company>.+?)['’]$/i) ??
      s.match(/^(?<title>.+?) (?:job|role) at (?<company>.+?)(?: - \d+ .*|: .*)?$/i) ??
      s.match(/^(?<title>.+?) @ (?<company>.+?)$/i) ??
      s.match(/^(?<title>.+?) at (?<company>.+?)(?: in (?<loc>.+?))?(?: and \d+ more.*)?$/i)
    if (m?.groups && !/^(?:new )?jobs\b/i.test(m.groups.title)) {
      leads.push({
        title: cleanup(m.groups.title),
        company: cleanup(m.groups.company),
        location: m.groups.loc ?? parseLocation(text),
        pay: parsePay(`${raw.snippet}\n${text}`),
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
    scamSigns: category === 'response' || category === 'application' ? scamSigns(raw) : [],
    leads: category === 'lead' ? extractLeads(raw) : [],
  }
}
