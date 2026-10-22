import { getMeta, keepOnlyEmails, loadAll, saveEmails, setMeta } from './db'
import { fetchMessages, listIds, START_DATE } from './gmail'

const DAY = 864e5

/** Bump when saved emails need fields they didn't have, so they're downloaded again. */
const DATA_VERSION = 2 // 2: Gmail labels, and your own replies left out

/**
 * Pulls job mail newer than the last sync. Overlaps by a day because Gmail's
 * `after:` filter works on whole seconds and mail can arrive late.
 */
export async function syncGmail(onProgress?: (msg: string) => void, onSaved?: () => Promise<void>): Promise<number> {
  // After an upgrade, download everything again but overwrite in place so the
  // dashboard stays filled while it runs.
  const upgrade = (await getMeta<number>('dataVersion')) !== DATA_VERSION
  const last = upgrade ? START_DATE.getTime() + DAY : ((await getMeta<number>('lastSync')) ?? START_DATE.getTime() + DAY)
  const startedAt = Date.now()
  onProgress?.('Checking Gmail…')
  const ids = await listIds(Math.max(START_DATE.getTime(), last - DAY))
  const known = new Set((await loadAll()).emails.map((e) => e.id))
  const fresh = upgrade ? ids : ids.filter((id) => !known.has(id))
  if (fresh.length) {
    // Newest first, so recent mail shows up while older mail is still downloading.
    await fetchMessages(fresh, async (emails, done) => {
      await saveEmails(emails)
      onProgress?.(`${upgrade ? 'Refreshing' : 'Downloaded'} ${done} of ${fresh.length} emails…`)
      await onSaved?.()
    })
  }
  if (upgrade) {
    await keepOnlyEmails(new Set(ids))
    await setMeta('dataVersion', DATA_VERSION)
  }
  await setMeta('lastSync', startedAt)
  return fresh.length
}
