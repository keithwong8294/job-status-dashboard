export type Category = 'application' | 'response' | 'rejection' | 'lead' | 'other'

export const CATEGORY_LABELS: Record<Category, string> = {
  application: 'Application',
  response: 'Response',
  rejection: 'Rejection',
  lead: 'Job lead',
  other: 'Not job-related',
}

export type Source = 'linkedin' | 'indeed' | 'glassdoor' | 'direct'

/** Pay normalized to an annual USD range so hourly and salaried jobs sort together. */
export interface Pay {
  text: string
  minAnnual: number
  maxAnnual: number
}

export interface Job {
  title?: string
  company?: string
  location?: string
  pay?: Pay
  url?: string
}

/** The raw fields we keep from a Gmail message. */
export interface RawEmail {
  id: string
  threadId: string
  date: number // epoch ms
  from: string
  fromName: string
  fromDomain: string
  subject: string
  snippet: string
  body: string
}

export interface EmailRecord extends RawEmail {
  category: Category
  /** True when Keith relabeled this email by hand. */
  overridden: boolean
  source: Source
  /** The company/title an application, response or rejection is about. */
  job: Job
  /** Listings found inside a job-board alert email (one email can hold many). */
  leads: Job[]
}
