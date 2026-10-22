import type { Category, EmailRecord, Job, Pay, Source } from './types'

/**
 * Where an application stands. Emails set all but "removed", which only you
 * can set; you can override any of them by hand.
 */
export type Status = 'applied' | 'action' | 'rejected' | 'interview_rejected' | 'interview_offer' | 'scam' | 'removed'

export const STATUS_LABELS: Record<Status, string> = {
  applied: 'Applied',
  action: 'Action needed',
  rejected: 'Rejected',
  interview_rejected: 'Interview + rejection',
  interview_offer: 'Interview + offer',
  scam: 'Scam',
  removed: 'Removed',
}

/** Statuses from before the current list, still saved in some browsers. */
const LEGACY_STATUS: Record<string, Status> = {
  responded: 'action',
  interviewing: 'action',
  offer: 'interview_offer',
  withdrawn: 'removed',
}

/** How the tiles, chart and list group statuses, so all three always agree. */
export type StatusGroup = 'all' | 'applied' | 'action' | 'interviews' | 'rejected' | 'scam' | 'removed'

export const STATUS_GROUPS: Record<StatusGroup, { label: string; statuses: Status[] }> = {
  all: { label: 'All applications', statuses: ['applied', 'action', 'rejected', 'interview_rejected', 'interview_offer'] },
  applied: { label: 'Applied, no reply yet', statuses: ['applied'] },
  action: { label: 'Action needed', statuses: ['action'] },
  interviews: { label: 'Interviewed', statuses: ['interview_rejected', 'interview_offer'] },
  rejected: { label: 'Rejected', statuses: ['rejected', 'interview_rejected'] },
  scam: { label: 'Scams', statuses: ['scam'] },
  removed: { label: 'Removed', statuses: ['removed'] },
}

export const inGroup = (a: Application, g: StatusGroup) => STATUS_GROUPS[g].statuses.includes(a.status)

/** One company you applied to, with every email about it. */
export interface Application {
  key: string
  company: string
  title?: string
  location?: string
  pay?: Pay
  status: Status
  /** What the emails say, before any status you set by hand. */
  emailStatus: Status
  edited: boolean
  /** Why this looks like a fake job, if it does. */
  scamSigns: string[]
  appliedOn?: number
  lastUpdate: number
  emails: EmailRecord[]
}

export interface Lead extends Job {
  /** Title + company, so the same job from several alerts is one row. */
  key: string
  source: Source
  date: number
  email: EmailRecord
  /** How many alert emails listed this job. */
  seen: number
}

const STATUS_OF: Partial<Record<Category, Status>> = {
  application: 'applied',
  response: 'action',
  rejection: 'rejected',
}

const INTERVIEW = /\binterview(?:ed|ing|s)?\b|phone screen|video call|meet with (?:the|our) team/i
const OFFER = /\b(?:pleased|happy|excited|delighted) to (?:extend|offer)\b|\boffer letter\b|\bjob offer\b|\boffer of employment\b/i

/** The status the emails point to, once they're in date order. */
function statusFromEmails(emails: EmailRecord[]): Status {
  const text = (e: EmailRecord) => `${e.subject}\n${e.snippet}\n${e.body}`
  const responses = emails.filter((e) => e.category === 'response')
  const interviewed = responses.some((e) => INTERVIEW.test(text(e)))
  const last = emails.at(-1)!
  if (last.category === 'rejection') return interviewed ? 'interview_rejected' : 'rejected'
  if (responses.some((e) => OFFER.test(text(e)))) return 'interview_offer'
  return STATUS_OF[last.category]!
}

const normalize = (company: string) =>
  company.toLowerCase().replace(/\b(?:inc|llc|ltd|corp|corporation|co|the)\b|[^a-z0-9]/g, '')

/**
 * Groups emails into applications by company and job title. A response or
 * rejection that doesn't name the job is matched to the newest application
 * at that company.
 */
/**
 * Groups emails into applications. Emails in the same Gmail thread always stay
 * together. Otherwise they group by company and job title; a response or
 * rejection that doesn't name the job goes to the newest application at that
 * company, and back-to-back confirmations from one sender count once.
 */
export function buildApplications(records: EmailRecord[]): Application[] {
  const groups = new Map<string, Application>()
  const byThread = new Map<string, Application>()
  const latestAt = new Map<string, Application>()
  const lastFrom = new Map<string, { app: Application; date: number }>()
  const sorted = records.filter((r) => STATUS_OF[r.category]).sort((a, b) => a.date - b.date)
  for (const r of sorted) {
    const company = r.job.company ?? r.fromName ?? r.fromDomain
    const companyKey = normalize(company) || r.fromDomain
    const title = r.job.title
    const recent = lastFrom.get(r.from)
    let app =
      byThread.get(r.threadId) ??
      (title !== undefined ? groups.get(`${companyKey}|${normalize(title)}`) : latestAt.get(companyKey)) ??
      (recent && r.date - recent.date < 2 * 3600e3 && (!title || !recent.app.title || title === recent.app.title)
        ? recent.app
        : undefined)
    // A new confirmation for a job we already closed out is a re-application.
    if (!app || (r.category === 'application' && app.emails.at(-1)!.category !== 'application' && title === undefined && !byThread.has(r.threadId))) {
      const key = `${companyKey}|${title ? normalize(title) : r.id}`
      app = { key, company, status: 'applied', emailStatus: 'applied', edited: false, scamSigns: [], lastUpdate: r.date, emails: [] }
      groups.set(key, app)
    }
    byThread.set(r.threadId, app)
    latestAt.set(companyKey, app)
    lastFrom.set(r.from, { app, date: r.date })
    app.emails.push(r)
    app.title ??= title
    app.location ??= r.job.location
    app.pay ??= r.job.pay
    for (const s of r.scamSigns) if (!app.scamSigns.includes(s)) app.scamSigns.push(s)
    if (r.category === 'application') app.appliedOn ??= r.date
    app.lastUpdate = r.date
  }
  for (const app of groups.values()) {
    app.status = app.emailStatus = statusFromEmails(app.emails)
    // Two red flags is enough to call it; one alone (say, a chat interview) is common in real jobs.
    if (app.scamSigns.length >= 2) app.status = app.emailStatus = 'scam'
  }
  return [...groups.values()]
}

export function withEditedStatus(apps: Application[], edits: Map<string, Status>): Application[] {
  return apps.map((a) => {
    const saved = edits.get(a.key)
    const status = saved && (LEGACY_STATUS[saved] ?? saved)
    return status ? { ...a, status, edited: true } : a
  })
}

export function buildLeads(records: EmailRecord[]): Lead[] {
  const byKey = new Map<string, Lead>()
  for (const r of [...records].sort((a, b) => b.date - a.date)) {
    for (const l of r.leads) {
      const key = `${normalize(l.title ?? '')}|${normalize(l.company ?? '')}`
      const found = byKey.get(key)
      if (!found) {
        byKey.set(key, { ...l, key, source: r.source, date: r.date, email: r, seen: 1 })
        continue
      }
      // Keep the newest listing but fill gaps from older ones.
      found.seen++
      found.location ??= l.location
      found.pay ??= l.pay
      found.url ??= l.url
    }
  }
  return [...byKey.values()]
}

/** Most postings close within a month, so a job no alert has listed since then is likely gone. */
export const LEAD_EXPIRY_DAYS = 30

export const isExpired = (lead: Lead, now = Date.now()) => now - lead.date > LEAD_EXPIRY_DAYS * 864e5

export interface Filters {
  title: string
  location: string
  minPay: number
  responsibilities: string
}

export const EMPTY_FILTERS: Filters = { title: '', location: '', minPay: 0, responsibilities: '' }

const has = (hay: string | undefined, needle: string) =>
  !needle || (hay ?? '').toLowerCase().includes(needle.toLowerCase().trim())

/** Every space-separated word must appear somewhere in the text. */
const hasAll = (hay: string, words: string) =>
  words
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.toLowerCase().includes(w))

export function matches(
  item: { title?: string; location?: string; pay?: Pay },
  text: string,
  f: Filters,
): boolean {
  return (
    has(item.title, f.title) &&
    has(item.location, f.location) &&
    (!f.minPay || (item.pay?.maxAnnual ?? 0) >= f.minPay) &&
    hasAll(text, f.responsibilities)
  )
}

export type SortDir = 'asc' | 'desc'

export function sortBy<T>(items: T[], get: (t: T) => string | number | undefined, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    // Blanks always sink to the bottom.
    if (x === undefined || x === '') return y === undefined || y === '' ? 0 : 1
    if (y === undefined || y === '') return -1
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sign
  })
}

/**
 * Applications per week (Monday start) for the chart, counted the same way as
 * the tiles: each application once when sent, then in the week it got a
 * reply and the week it was rejected, if it was.
 */
export function weekly(apps: Application[], start: Date, now = Date.now()) {
  const monday = new Date(start)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  const weeks: { week: string; start: number; application: number; response: number; rejection: number }[] = []
  for (let t = monday.getTime(); t <= now; t += 7 * 864e5) {
    const d = new Date(t)
    weeks.push({ week: `${d.getMonth() + 1}/${d.getDate()}`, start: t, application: 0, response: 0, rejection: 0 })
  }
  const add = (date: number, kind: 'application' | 'response' | 'rejection') => {
    const i = Math.floor((date - monday.getTime()) / (7 * 864e5))
    if (weeks[i]) weeks[i][kind]++
  }
  for (const a of apps) {
    if (!inGroup(a, 'all')) continue
    add(a.appliedOn ?? a.emails[0]?.date ?? a.lastUpdate, 'application')
    // A reply and a rejection each land in the week of their first email; a status set by hand falls back to the last update.
    if (a.status !== 'applied' && a.status !== 'rejected')
      add(a.emails.find((e) => e.category === 'response')?.date ?? a.lastUpdate, 'response')
    if (inGroup(a, 'rejected')) add(a.emails.find((e) => e.category === 'rejection')?.date ?? a.lastUpdate, 'rejection')
  }
  return weeks
}

export function formatPay(p?: Pay): string {
  if (!p) return ''
  const k = (n: number) => `$${Math.round(n / 1000)}K`
  return p.minAnnual === p.maxAnnual ? `${k(p.minAnnual)}/yr` : `${k(p.minAnnual)}–${k(p.maxAnnual)}/yr`
}
