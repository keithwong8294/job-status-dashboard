import type { Category, EmailRecord, Job, Pay, Source } from './types'

export type Status = 'applied' | 'responded' | 'rejected'

/** One company you applied to, with every email about it. */
export interface Application {
  key: string
  company: string
  title?: string
  location?: string
  pay?: Pay
  status: Status
  appliedOn?: number
  lastUpdate: number
  emails: EmailRecord[]
}

export interface Lead extends Job {
  key: string
  source: Source
  date: number
  email: EmailRecord
}

const STATUS_OF: Partial<Record<Category, Status>> = {
  application: 'applied',
  response: 'responded',
  rejection: 'rejected',
}

const normalize = (company: string) =>
  company.toLowerCase().replace(/\b(?:inc|llc|ltd|corp|corporation|co|the)\b|[^a-z0-9]/g, '')

/**
 * Groups emails into applications by company and job title. A response or
 * rejection that doesn't name the job is matched to the newest application
 * at that company.
 */
export function buildApplications(records: EmailRecord[]): Application[] {
  const groups = new Map<string, Application>()
  const latestAt = new Map<string, Application>()
  const sorted = records.filter((r) => STATUS_OF[r.category]).sort((a, b) => a.date - b.date)
  for (const r of sorted) {
    const company = r.job.company ?? r.fromName ?? r.fromDomain
    const companyKey = normalize(company) || r.fromDomain
    const title = r.job.title
    let app =
      title !== undefined
        ? groups.get(`${companyKey}|${normalize(title)}`)
        : latestAt.get(companyKey)
    // A new confirmation for a job we already closed out is a re-application.
    if (!app || (r.category === 'application' && app.status !== 'applied' && title === undefined)) {
      const key = `${companyKey}|${title ? normalize(title) : r.id}`
      app = { key, company, status: 'applied', lastUpdate: r.date, emails: [] }
      groups.set(key, app)
    }
    latestAt.set(companyKey, app)
    app.emails.push(r)
    app.title ??= title
    app.location ??= r.job.location
    app.pay ??= r.job.pay
    if (r.category === 'application') app.appliedOn ??= r.date
    // Emails are in date order, so the newest one decides the status.
    app.status = STATUS_OF[r.category]!
    app.lastUpdate = r.date
  }
  return [...groups.values()]
}

export function buildLeads(records: EmailRecord[]): Lead[] {
  return records.flatMap((r) =>
    r.leads.map((l, i) => ({ ...l, key: `${r.id}-${i}`, source: r.source, date: r.date, email: r })),
  )
}

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

/** Counts per week (Monday start) for the chart. */
export function weekly(records: EmailRecord[], start: Date, now = Date.now()) {
  const monday = new Date(start)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  const weeks: { week: string; start: number; application: number; response: number; rejection: number }[] = []
  for (let t = monday.getTime(); t <= now; t += 7 * 864e5) {
    const d = new Date(t)
    weeks.push({ week: `${d.getMonth() + 1}/${d.getDate()}`, start: t, application: 0, response: 0, rejection: 0 })
  }
  for (const r of records) {
    if (r.category !== 'application' && r.category !== 'response' && r.category !== 'rejection') continue
    const i = Math.floor((r.date - monday.getTime()) / (7 * 864e5))
    if (weeks[i]) weeks[i][r.category]++
  }
  return weeks
}

export function formatPay(p?: Pay): string {
  if (!p) return ''
  const k = (n: number) => `$${Math.round(n / 1000)}K`
  return p.minAnnual === p.maxAnnual ? `${k(p.minAnnual)}/yr` : `${k(p.minAnnual)}–${k(p.maxAnnual)}/yr`
}
