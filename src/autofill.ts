/**
 * Hand-off to the optional "Job Autofill" browser extension (kept outside this repo, on the
 * owner's PC). When the extension is installed it marks <html data-job-autofill="1">, and Apply
 * asks it to open the posting and fill in the Easy Apply form, stopping at Submit.
 * Without the extension, Apply just opens the posting in a new tab like before.
 */
import type { Job } from './types'

export function autofillAvailable(doc: Document = document): boolean {
  return doc.documentElement.dataset.jobAutofill === '1'
}

export interface AutofillJob {
  title?: string
  company?: string
  location?: string
  pay?: string
  description?: string
}

export function autofillMessage(url: string, job: Job) {
  const payload: AutofillJob = {
    title: job.title,
    company: job.company,
    location: job.location,
    pay: job.pay?.text,
    description: job.description,
  }
  return { type: 'job-autofill:open' as const, url, job: payload }
}

/** Opens a job posting, through the autofill extension when it's installed. */
export function openApplication(url: string, job: Job, win: Window = window): 'autofill' | 'tab' {
  if (autofillAvailable(win.document)) {
    win.postMessage(autofillMessage(url, job), win.location.origin)
    return 'autofill'
  }
  win.open(url, '_blank', 'noopener')
  return 'tab'
}
