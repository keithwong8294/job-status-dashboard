import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { closeAccount, getMeta, loadAll, openAccount, saveEmails } from './db'
import type { RawEmail } from './types'

const email = (id: string) => ({ id, threadId: id, date: 0, from: '', fromName: '', fromDomain: '', subject: '', snippet: '', body: '' }) as RawEmail

describe('saved data per account', () => {
  it('moves data from the old shared database to the first account, then deletes it', async () => {
    const old = await openDB('job-dashboard', 3, {
      upgrade(d) {
        d.createObjectStore('emails', { keyPath: 'id' })
        d.createObjectStore('overrides', { keyPath: 'id' })
        d.createObjectStore('meta')
        d.createObjectStore('leadStatus', { keyPath: 'key' })
        d.createObjectStore('appStatus', { keyPath: 'key' })
      },
    })
    await old.put('emails', email('a'))
    await old.put('meta', { home: 'Somewhere, NJ' }, 'profile')
    old.close()

    await openAccount('first@example.com')
    expect((await loadAll()).emails.map((e) => e.id)).toEqual(['a'])
    expect(await getMeta('profile')).toEqual({ home: 'Somewhere, NJ' })
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain('job-dashboard')
  })

  it('never shows one account the other account’s data', async () => {
    await openAccount('first@example.com')
    await saveEmails([email('b')])
    closeAccount()
    await expect(loadAll()).rejects.toThrow()

    await openAccount('second@example.com')
    expect((await loadAll()).emails).toEqual([])
    await openAccount('FIRST@example.com')
    expect((await loadAll()).emails.map((e) => e.id).sort()).toEqual(['a', 'b'])
  })
})
