import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Status } from './model'
import type { Category, RawEmail } from './types'

/**
 * Everything is stored in this browser only, in a separate database for each
 * Gmail account, opened only after that account signs in.
 */
interface Schema extends DBSchema {
  emails: { key: string; value: RawEmail }
  overrides: { key: string; value: { id: string; category: Category } }
  meta: { key: string; value: unknown }
  leadStatus: { key: string; value: { key: string; status: LeadStatus; at: number } }
  appStatus: { key: string; value: { key: string; status: Status } }
}

export type LeadStatus = 'applied' | 'dismissed'

const open = (name: string) =>
  openDB<Schema>(name, 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('emails', { keyPath: 'id' })
        d.createObjectStore('overrides', { keyPath: 'id' })
        d.createObjectStore('meta')
      }
      if (oldVersion < 2) d.createObjectStore('leadStatus', { keyPath: 'key' })
      if (oldVersion < 3) d.createObjectStore('appStatus', { keyPath: 'key' })
    },
  })

/** Before accounts were kept apart, everything lived in one shared database. */
const LEGACY_DB = 'job-dashboard'
const STORES = ['emails', 'overrides', 'meta', 'leadStatus', 'appStatus'] as const

let current: Promise<IDBPDatabase<Schema>> | undefined

function db() {
  if (!current) throw new Error('Sign in to see your saved data.')
  return current
}

/** Switches to the signed-in account's database. */
export async function openAccount(email: string) {
  current = open(`${LEGACY_DB}:${email.toLowerCase()}`)
  await adoptLegacyData(await current)
}

/** Forgets which account's data is open, without deleting it. */
export function closeAccount() {
  current?.then((d) => d.close())
  current = undefined
}

/** Moves data saved before accounts were kept apart to the first account that signs in here. */
async function adoptLegacyData(d: IDBPDatabase<Schema>) {
  const names = (await indexedDB.databases?.())?.map((x) => x.name) ?? []
  if (!names.includes(LEGACY_DB)) return
  if ((await d.count('emails')) === 0) {
    const old = await open(LEGACY_DB)
    for (const store of STORES) {
      const keys = await old.getAllKeys(store)
      const values = await old.getAll(store)
      const tx = d.transaction(store, 'readwrite')
      await Promise.all([...values.map((v, i) => (store === 'meta' ? tx.store.put(v, keys[i]) : tx.store.put(v as never))), tx.done])
    }
    old.close()
  }
  await deleteDB(LEGACY_DB)
}

export async function loadAll() {
  const d = await db()
  const [emails, overrides, leadStatus, appStatus] = await Promise.all([
    d.getAll('emails'),
    d.getAll('overrides'),
    d.getAll('leadStatus'),
    d.getAll('appStatus'),
  ])
  return {
    appStatus: new Map(appStatus.map((a) => [a.key, a.status])),
    emails,
    overrides: new Map(overrides.map((o) => [o.id, o.category])),
    leadStatus: new Map(leadStatus.map((l) => [l.key, { status: l.status, at: l.at }])),
  }
}

export async function saveEmails(emails: RawEmail[]) {
  const tx = (await db()).transaction('emails', 'readwrite')
  await Promise.all([...emails.map((e) => tx.store.put(e)), tx.done])
}

export async function setOverride(id: string, category: Category | undefined) {
  const d = await db()
  if (category) await d.put('overrides', { id, category })
  else await d.delete('overrides', id)
}

export async function setLeadStatus(key: string, status: LeadStatus | undefined, at: number) {
  const d = await db()
  if (status) await d.put('leadStatus', { key, status, at })
  else await d.delete('leadStatus', key)
}

export async function setAppStatus(key: string, status: Status | undefined) {
  const d = await db()
  if (status) await d.put('appStatus', { key, status })
  else await d.delete('appStatus', key)
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await (await db()).put('meta', value, key)
}

/** Removes saved emails that are no longer in the Gmail results. */
export async function keepOnlyEmails(ids: Set<string>) {
  const tx = (await db()).transaction('emails', 'readwrite')
  const stale = (await tx.store.getAllKeys()).filter((id) => !ids.has(id))
  await Promise.all([...stale.map((id) => tx.store.delete(id)), tx.done])
}

export async function clearAll() {
  const d = await db()
  await Promise.all([d.clear('emails'), d.clear('overrides'), d.clear('meta'), d.clear('leadStatus'), d.clear('appStatus')])
}
