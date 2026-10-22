import { JOB_URL_RE } from './classify'
import type { RawEmail } from './types'

/** Read-only: the app can never send, delete or change mail. */
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const START_DATE = new Date(2026, 4, 1) // May 1, 2026

/**
 * Narrows the mailbox to likely job mail so we don't download every email.
 * Anything this misses can't be counted, so it errs on the broad side.
 */
const JOB_QUERY = [
  'from:linkedin.com',
  'from:indeed.com',
  'from:indeedemail.com',
  'from:glassdoor.com',
  'from:greenhouse.io',
  'from:lever.co',
  'from:myworkday.com',
  'from:workday.com',
  'from:icims.com',
  'from:smartrecruiters.com',
  'from:ashbyhq.com',
  'from:jobvite.com',
  'from:taleo.net',
  'from:successfactors.com',
  'from:bamboohr.com',
  'from:breezy.hr',
  'from:jazzhr.com',
  'from:recruitee.com',
  'from:workable.com',
  'from:paylocity.com',
  'from:dayforce.com',
  'from:paychex.com',
  'from:saashr.com',
  'from:pinpoint.email',
  'from:hrrecruiting.com',
  'from:handshake.com',
  'from:joinhandshake.com',
  'subject:application',
  'subject:applying',
  'subject:interview',
  'subject:candidacy',
  'subject:position',
  'subject:opportunity',
  'subject:recruiting',
  '"thank you for applying"',
  '"your application"',
  '"next steps"',
  '"other candidates"',
].join(' ') // Gmail ORs the terms inside {braces}

// ---------- auth (Google Identity Services, loaded in index.html) ----------

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void
            error_callback?: (e: { type: string; message?: string }) => void
          }): { requestAccessToken(opts?: { prompt?: string }): void }
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

let token: string | undefined
let tokenExpires = 0
let tokenClient: ReturnType<NonNullable<Window['google']>['accounts']['oauth2']['initTokenClient']> | undefined
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | undefined

async function gisReady(): Promise<NonNullable<Window['google']>> {
  for (let i = 0; i < 100 && !window.google?.accounts; i++) await new Promise((r) => setTimeout(r, 100))
  if (!window.google?.accounts) throw new Error('Google sign-in did not load. Check your connection or ad blocker.')
  return window.google
}

export async function signIn(clientId: string, interactive: boolean): Promise<string> {
  const google = await gisReady()
  tokenClient ??= google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (r) => {
      if (r.access_token) {
        token = r.access_token
        tokenExpires = Date.now() + (r.expires_in ?? 3600) * 1000 - 60_000
        pending?.resolve(token)
      } else pending?.reject(new Error(r.error ?? 'Sign-in failed'))
      pending = undefined
    },
    error_callback: (e) => {
      pending?.reject(new Error(e.message ?? e.type))
      pending = undefined
    },
  })
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    tokenClient!.requestAccessToken({ prompt: interactive ? 'consent' : '' })
  })
}

export function signOut() {
  if (token) window.google?.accounts.oauth2.revoke(token)
  token = undefined
  tokenExpires = 0
}

export const isSignedIn = () => !!token && Date.now() < tokenExpires

/**
 * Google access tokens last an hour. Getting a new one opens a Google popup,
 * which browsers only allow after a click, so background syncs stop here and
 * the page asks Keith to click Reconnect.
 */
export class AuthExpired extends Error {
  constructor() {
    super('Gmail session expired')
  }
}

function getToken(): string {
  if (token && Date.now() < tokenExpires) return token
  token = undefined
  throw new AuthExpired()
}

async function api<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } })
    if (res.ok) return res.json() as Promise<T>
    if (res.status === 401) {
      token = undefined
      throw new AuthExpired()
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      continue
    }
    throw new Error(`Gmail API ${res.status}: ${await res.text()}`)
  }
}

// ---------- messages ----------

interface Part {
  mimeType: string
  body?: { data?: string }
  parts?: Part[]
  headers?: { name: string; value: string }[]
}
interface Message {
  id: string
  threadId: string
  internalDate: string
  snippet: string
  payload: Part
}

function decode(data: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('style,script,head').forEach((n) => n.remove())
  // Keep link targets: job alerts are split on job URLs.
  doc.querySelectorAll('a[href]').forEach((a) => a.append(` ${a.getAttribute('href')} `))
  doc.querySelectorAll('br,p,div,tr,li,h1,h2,h3,h4,td,table').forEach((n) => n.append('\n'))
  return (doc.body.textContent ?? '').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n')
}

/**
 * LinkedIn and Indeed alerts have a tidy plain-text part with one job per block,
 * which beats their HTML. Most other mail (Glassdoor, Indeed Apply) keeps the
 * details only in the HTML.
 */
export function chooseBody(plain?: string, html?: string): string {
  if (plain && (!html || JOB_URL_RE.test(plain))) return plain
  return html ? htmlToText(html) : ''
}

function findPart(p: Part, mime: string): string | undefined {
  if (p.mimeType === mime && p.body?.data) return decode(p.body.data)
  for (const c of p.parts ?? []) {
    const found = findPart(c, mime)
    if (found) return found
  }
}

function toRaw(m: Message): RawEmail {
  const h = (name: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? ''
  const from = h('from')
  const addr = from.match(/<([^>]+)>/)?.[1] ?? from
  const body = chooseBody(findPart(m.payload, 'text/plain'), findPart(m.payload, 'text/html'))
  return {
    id: m.id,
    threadId: m.threadId,
    date: Number(m.internalDate),
    from: addr,
    fromName: from.replace(/<[^>]+>/, '').replace(/"/g, '').trim(),
    fromDomain: addr.split('@')[1]?.toLowerCase() ?? '',
    subject: h('subject'),
    snippet: m.snippet,
    body: body.slice(0, 20000),
  }
}

/** Lists ids of job-related messages received after `after` (epoch ms). */
export async function listIds(after: number): Promise<string[]> {
  const q = encodeURIComponent(`after:${Math.floor(after / 1000)} {${JOB_QUERY}}`)
  const ids: string[] = []
  let page: string | undefined
  do {
    const r = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(
      `/messages?q=${q}&maxResults=500${page ? `&pageToken=${page}` : ''}`,
    )
    ids.push(...(r.messages ?? []).map((m) => m.id))
    page = r.nextPageToken
  } while (page)
  return ids
}

export async function fetchMessages(
  ids: string[],
  onProgress?: (done: number) => void,
): Promise<RawEmail[]> {
  const out: RawEmail[] = []
  const CONCURRENCY = 8
  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < ids.length) {
        const id = ids[next++]
        out.push(toRaw(await api<Message>(`/messages/${id}?format=full`)))
        onProgress?.(out.length)
      }
    }),
  )
  return out
}
