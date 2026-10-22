import { openDB, type DBSchema } from 'idb'
import type { Category, RawEmail } from './types'

/** Everything is stored in this browser only. */
interface Schema extends DBSchema {
  emails: { key: string; value: RawEmail }
  overrides: { key: string; value: { id: string; category: Category } }
  meta: { key: string; value: unknown }
}

const db = openDB<Schema>('job-dashboard', 1, {
  upgrade(d) {
    d.createObjectStore('emails', { keyPath: 'id' })
    d.createObjectStore('overrides', { keyPath: 'id' })
    d.createObjectStore('meta')
  },
})

export async function loadAll() {
  const d = await db
  const [emails, overrides] = await Promise.all([d.getAll('emails'), d.getAll('overrides')])
  return { emails, overrides: new Map(overrides.map((o) => [o.id, o.category])) }
}

export async function saveEmails(emails: RawEmail[]) {
  const tx = (await db).transaction('emails', 'readwrite')
  await Promise.all([...emails.map((e) => tx.store.put(e)), tx.done])
}

export async function setOverride(id: string, category: Category | undefined) {
  const d = await db
  if (category) await d.put('overrides', { id, category })
  else await d.delete('overrides', id)
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db).get('meta', key)) as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await (await db).put('meta', value, key)
}

export async function clearAll() {
  const d = await db
  await Promise.all([d.clear('emails'), d.clear('overrides'), d.clear('meta')])
}
