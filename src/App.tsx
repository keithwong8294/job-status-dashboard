import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toRecord } from './classify'
import { clearAll, getMeta, loadAll, setAppStatus, setLeadStatus, setMeta, setOverride, type LeadStatus } from './db'
import { demoEmails } from './demo'
import { AuthExpired, isSignedIn, setRateLimitListener, signIn, signOut, START_DATE } from './gmail'
import {
  buildApplications,
  buildLeads,
  EMPTY_FILTERS,
  formatPay,
  inGroup,
  isExpired,
  LEAD_EXPIRY_DAYS,
  matches,
  sortBy,
  STATUS_GROUPS,
  STATUS_LABELS,
  weekly,
  withEditedStatus,
  type Application,
  type Filters,
  type Lead,
  type SortDir,
  type StatusGroup,
  type Status,
} from './model'
import { DEFAULT_PROFILE, hasProfile, isRecommended, resumeFamilies, resumeSkills, scoreLead, type Match, type Profile } from './recommend'
import { pdfText } from './pdf'
import { syncGmail } from './sync'
import { CATEGORY_LABELS, type Category, type EmailRecord, type RawEmail } from './types'

const POLL_MS = 2 * 60 * 1000
const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

const SOURCE_LABELS = { linkedin: 'LinkedIn', indeed: 'Indeed', glassdoor: 'Glassdoor', direct: 'Employer' }

const fmtDate = (t?: number) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')
const gmailLink = (e: EmailRecord) => `https://mail.google.com/mail/u/0/#all/${e.threadId}`

function readStored(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}
function writeStored(key: string, value: string | undefined) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* private mode */
  }
}

type Tab = 'applications' | 'leads' | 'emails'

export default function App() {
  const [clientId, setClientId] = useState(ENV_CLIENT_ID || readStored('clientId') || '')
  const [raws, setRaws] = useState<RawEmail[]>([])
  const [overrides, setOverrides] = useState(new Map<string, Category>())
  const [leadStatus, setLeadStatusState] = useState(new Map<string, { status: LeadStatus; at: number }>())
  const [appStatus, setAppStatusState] = useState(new Map<string, Status>())
  const [profile, setProfileState] = useState<Profile>(DEFAULT_PROFILE)
  const [demo, setDemo] = useState(false)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState<number>()
  const [tab, setTab] = useState<Tab>('applications')
  const [appGroup, setAppGroup] = useState<StatusGroup>('all')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const syncing = useRef(false)

  const reload = useCallback(async () => {
    const { emails, overrides, leadStatus, appStatus } = await loadAll()
    setAppStatusState(appStatus)
    setProfileState({ ...DEFAULT_PROFILE, ...(await getMeta<Profile>('profile')) })
    setRaws(emails)
    setOverrides(overrides)
    setLeadStatusState(leadStatus)
    setLastSync(await getMeta<number>('lastSync'))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const sync = useCallback(async () => {
    if (syncing.current || !isSignedIn()) return
    syncing.current = true
    setError('')
    try {
      setRateLimitListener((sec) => setBusy(`Gmail asked us to slow down. Resuming in ${sec} seconds…`))
      await syncGmail(setBusy, reload)
      await reload()
    } catch (e) {
      if (e instanceof AuthExpired) {
        setConnected(false)
        setError('Your Gmail session timed out (Google limits it to an hour). Click Reconnect to keep live updates going.')
      } else setError(String(e instanceof Error ? e.message : e))
    } finally {
      setRateLimitListener(undefined)
      syncing.current = false
      setBusy('')
    }
  }, [reload])

  // Live updates: poll while signed in, and whenever the tab regains focus.
  useEffect(() => {
    if (!connected) return
    sync()
    const timer = setInterval(sync, POLL_MS)
    const onFocus = () => sync()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [connected, sync])

  async function connect() {
    if (!clientId) return
    setError('')
    setDemo(false)
    try {
      await signIn(clientId, !readStored('connectedOnce'))
      writeStored('connectedOnce', '1')
      setConnected(true)
    } catch (e) {
      setError(`Couldn't connect to Gmail: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function disconnect() {
    signOut()
    setConnected(false)
    if (confirm('Also delete the emails saved in this browser?')) {
      await clearAll()
      writeStored('connectedOnce', undefined)
      await reload()
    }
  }

  const demoData = useMemo(() => (demo ? demoEmails() : []), [demo])
  const source = demo ? demoData : raws
  const records = useMemo(
    () => source.filter((r) => r.date >= START_DATE.getTime()).map((r) => toRecord(r, overrides.get(r.id))),
    [source, overrides],
  )

  async function relabel(id: string, category: Category | '') {
    const next = new Map(overrides)
    if (category) next.set(id, category)
    else next.delete(id)
    setOverrides(next)
    if (!demo) await setOverride(id, category || undefined)
  }

  async function markLead(key: string, status: LeadStatus | undefined) {
    const next = new Map(leadStatus)
    const at = Date.now()
    if (status) next.set(key, { status, at })
    else next.delete(key)
    setLeadStatusState(next)
    if (!demo) await setLeadStatus(key, status, at)
  }

  async function editAppStatus(key: string, status: Status | undefined) {
    const next = new Map(appStatus)
    if (status) next.set(key, status)
    else next.delete(key)
    setAppStatusState(next)
    if (!demo) await setAppStatus(key, status)
  }

  async function saveProfile(p: Profile) {
    setProfileState(p)
    await setMeta('profile', p)
  }

  const applications = useMemo(() => withEditedStatus(buildApplications(records), appStatus), [records, appStatus])
  const leads = useMemo(() => buildLeads(records), [records])
  const counts = useMemo(() => {
    const c = { application: 0, response: 0, rejection: 0, lead: 0, other: 0 }
    for (const r of records) c[r.category]++
    return c
  }, [records])
  const groupCount = (g: StatusGroup) => applications.filter((a) => inGroup(a, g)).length
  const total = groupCount('all')
  const scams = groupCount('scam')
  const action = groupCount('action')
  const interviews = groupCount('interviews')
  const rejected = groupCount('rejected')
  const offers = applications.filter((a) => a.status === 'interview_offer').length
  const afterInterview = applications.filter((a) => a.status === 'interview_rejected').length
  const chart = useMemo(() => weekly(applications, START_DATE), [applications])
  const showGroup = (g: StatusGroup) => {
    setAppGroup(g)
    setTab('applications')
  }

  const hasData = records.length > 0

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Job search dashboard</h1>
          <p className="muted">
            {demo
              ? 'Showing made-up sample data.'
              : connected
                ? `Live from Gmail. ${busy || (lastSync ? `Last checked ${new Date(lastSync).toLocaleTimeString()}.` : '')}`
                : hasData
                  ? `Saved data${lastSync ? ` as of ${new Date(lastSync).toLocaleString()}` : ''}. Reconnect for live updates.`
                  : 'Counting job emails since May 1, 2026.'}
          </p>
        </div>
        <div className="actions">
          {connected ? (
            <>
              <button onClick={sync} disabled={!!busy}>
                Check now
              </button>
              <button className="ghost" onClick={disconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              <button onClick={connect} disabled={!clientId}>
                {readStored('connectedOnce') ? 'Reconnect Gmail' : 'Connect Gmail'}
              </button>
              <button className="ghost" onClick={() => setDemo(!demo)}>
                {demo ? 'Hide sample data' : 'Try with sample data'}
              </button>
            </>
          )}
        </div>
      </header>

      {!clientId && !demo && <Setup onSave={(id) => (writeStored('clientId', id), setClientId(id))} />}
      {error && <p className="error" role="alert">{error}</p>}

      {hasData && (
        <>
          <section className="tiles">
            <Tile
              label="Applications"
              value={total}
              sub={`${groupCount('applied')} with no reply yet${scams ? `, not counting ${scams} scams` : ''}`}
              onClick={() => showGroup('all')}
            />
            <Tile label="Action needed" value={action} sub="replies waiting on you" onClick={() => showGroup('action')} />
            <Tile label="Interviews" value={interviews} sub={`${offers} ${offers === 1 ? 'offer' : 'offers'}`} onClick={() => showGroup('interviews')} />
            <Tile
              label="Rejections"
              value={rejected}
              sub={afterInterview ? `${afterInterview} after an interview` : total ? `${Math.round((rejected / total) * 100)}% of applications` : ''}
              onClick={() => showGroup('rejected')}
            />
            <Tile label="Job leads" value={leads.length} sub={`from ${counts.lead} LinkedIn, Indeed and Glassdoor emails`} />
          </section>

          <section className="card">
            <h2>Activity by week</h2>
            <div className="chart" role="img" aria-label="Weekly counts of applications, responses and rejections">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chart} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="week" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip
                    cursor={{ fill: 'var(--hover)' }}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                    labelFormatter={(w) => `Week of ${w}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 13, color: 'var(--text-2)' }} iconType="circle" />
                  <Bar dataKey="application" name="Applications" stackId="a" fill="var(--series-1)" stroke="var(--surface)" strokeWidth={1} />
                  <Bar dataKey="response" name="Responses" stackId="a" fill="var(--series-3)" stroke="var(--surface)" strokeWidth={1} />
                  <Bar dataKey="rejection" name="Rejections" stackId="a" fill="var(--series-2)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <nav className="tabs" role="tablist">
              {(
                [
                  ['applications', `Applications (${total})`],
                  ['leads', `Job leads (${leads.length})`],
                  ['emails', `All emails (${records.length})`],
                ] as const
              ).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </nav>
            {tab !== 'emails' && <FilterBar filters={filters} onChange={setFilters} />}
            {tab === 'applications' && <ApplicationsTable apps={applications} filters={filters} onEdit={editAppStatus} group={appGroup} onGroup={setAppGroup} />}
            {tab === 'leads' && (
              <>
                <ProfileCard profile={profile} onSave={saveProfile} />
                <LeadsTable key={hasProfile(profile) ? "scored" : "plain"} leads={leads} filters={filters} statuses={leadStatus} onMark={markLead} profile={profile} />
              </>
            )}
            {tab === 'emails' && <EmailsTable records={records} onRelabel={relabel} />}
          </section>
        </>
      )}

      {!hasData && !demo && clientId && !busy && (
        <p className="muted empty">Connect Gmail to load your job emails, or try the sample data first.</p>
      )}
      {busy && !hasData && <p className="muted empty">{busy}</p>}

      <footer className="muted">
        Read-only Gmail access. Emails are stored only in this browser.{' '}
        {clientId && !ENV_CLIENT_ID && (
          <button className="link" onClick={() => (writeStored('clientId', undefined), setClientId(''))}>
            Change Google client ID
          </button>
        )}
      </footer>
    </div>
  )
}

function Tile({ label, value, sub, onClick }: { label: string; value: number; sub?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={onClick ? 'tile tile-button' : 'tile'} onClick={onClick} title={onClick ? `Show these in the applications list` : undefined}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </Tag>
  )
}

function Setup({ onSave }: { onSave: (id: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <section className="card setup">
      <h2>One-time setup</h2>
      <p>
        Paste the OAuth client ID you created in Google Cloud Console. It ends in <code>.apps.googleusercontent.com</code>.
        The README has the steps.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onSave(value.trim())
        }}
      >
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" aria-label="Google OAuth client ID" />
        <button type="submit">Save</button>
      </form>
    </section>
  )
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)
  return (
    <div className="filters">
      <label>
        Job title
        <input value={filters.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. analyst" />
      </label>
      <label>
        Location
        <input value={filters.location} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Remote, WA" />
      </label>
      <label>
        Minimum pay
        <select value={filters.minPay} onChange={(e) => set({ minPay: Number(e.target.value) })}>
          <option value={0}>Any</option>
          {[50, 60, 70, 80, 90, 100, 120, 150].map((k) => (
            <option key={k} value={k * 1000}>
              ${k}K+/yr
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Responsibilities include
        <input value={filters.responsibilities} onChange={(e) => set({ responsibilities: e.target.value })} placeholder="e.g. sql python" />
      </label>
      {active && (
        <button className="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
          Clear
        </button>
      )}
    </div>
  )
}

interface Column<T> {
  key: string
  label: string
  get: (t: T) => string | number | undefined
  render?: (t: T) => ReactNode
}

function SortableTable<T extends { key: string }>({
  items,
  columns,
  initial,
  detail,
  empty,
}: {
  items: T[]
  columns: Column<T>[]
  initial: { key: string; dir: SortDir }
  detail?: (t: T) => ReactNode
  empty: string
}) {
  const [sort, setSort] = useState(initial)
  const [open, setOpen] = useState<string>()
  const col = columns.find((c) => c.key === sort.key) ?? columns[0]
  const rows = sortBy(items, col.get, sort.dir)
  if (!rows.length) return <p className="muted empty">{empty}</p>
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button
                  onClick={() => setSort({ key: c.key, dir: sort.key === c.key && sort.dir === 'desc' ? 'asc' : 'desc' })}
                >
                  {c.label}
                  <span className="arrow">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.key} item={r} columns={columns} open={open === r.key} onToggle={detail ? () => setOpen(open === r.key ? undefined : r.key) : undefined} detail={detail} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row<T>({ item, columns, open, onToggle, detail }: { item: T; columns: Column<T>[]; open: boolean; onToggle?: () => void; detail?: (t: T) => ReactNode }) {
  return (
    <>
      <tr className={onToggle ? 'clickable' : ''} onClick={onToggle}>
        {columns.map((c) => (
          <td key={c.key} data-label={c.label}>
            {c.render ? c.render(item) : c.get(item)}
          </td>
        ))}
      </tr>
      {open && detail && (
        <tr className="detail">
          <td colSpan={columns.length}>{detail(item)}</td>
        </tr>
      )}
    </>
  )
}

function ApplicationsTable({
  apps,
  filters,
  onEdit,
  group,
  onGroup,
}: {
  apps: Application[]
  filters: Filters
  onEdit: (key: string, status: Status | undefined) => void
  group: StatusGroup
  onGroup: (g: StatusGroup) => void
}) {
  const matching = apps.filter((a) => matches(a, a.emails.map((e) => e.body).join('\n'), filters))
  const items = matching.filter((a) => inGroup(a, group))
  return (
    <>
      <div className="filters">
        <label className="narrow">
          Show
          <select value={group} onChange={(e) => onGroup(e.target.value as StatusGroup)}>
            {(Object.keys(STATUS_GROUPS) as StatusGroup[]).map((g) => (
              <option key={g} value={g}>
                {STATUS_GROUPS[g].label} ({matching.filter((a) => inGroup(a, g)).length})
              </option>
            ))}
          </select>
        </label>
        <p className="muted hint">The counts at the top use these same groups. Remove hides an application from every count; find it again under Removed.</p>
      </div>
      <SortableTable
        items={items}
        initial={{ key: 'updated', dir: 'desc' }}
        empty="No applications match these filters."
        columns={[
          { key: 'company', label: 'Company', get: (a) => a.company },
          { key: 'title', label: 'Job title', get: (a) => a.title },
          { key: 'location', label: 'Location', get: (a) => a.location },
          { key: 'pay', label: 'Pay', get: (a) => a.pay?.maxAnnual, render: (a) => formatPay(a.pay) },
          {
            key: 'status',
            label: 'Status',
            get: (a) => a.status,
            render: (a) => (
              <select
                className={`pill status-select ${a.status}`}
                value={a.status}
                aria-label={`Status for ${a.company}`}
                title={a.edited ? `Set by you. Emails say: ${STATUS_LABELS[a.emailStatus]}` : 'From your emails'}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const s = e.target.value as Status
                  onEdit(a.key, s === a.emailStatus ? undefined : s)
                }}
              >
                {Object.entries(STATUS_LABELS)
                  .filter(([k]) => k !== 'removed' || a.status === 'removed')
                  .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                    {a.edited && k === a.emailStatus ? ' (from emails)' : ''}
                  </option>
                  ))}
              </select>
            ),
          },
          { key: 'applied', label: 'Applied', get: (a) => a.appliedOn, render: (a) => fmtDate(a.appliedOn) },
          { key: 'updated', label: 'Last update', get: (a) => a.lastUpdate, render: (a) => fmtDate(a.lastUpdate) },
          {
            key: 'remove',
            label: '',
            get: () => undefined,
            render: (a) => (
              <button
                className="ghost small"
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(a.key, a.status === 'removed' ? undefined : 'removed')
                }}
              >
                {a.status === 'removed' ? 'Restore' : 'Remove'}
              </button>
            ),
          },
        ]}
        detail={(a) => (
          <>
          {a.scamSigns.length > 0 && (
            <p className="scam-note">
              ⚠ Possible scam: {a.scamSigns.join('; ')}. Never send money, buy equipment, or deposit a check for a job.
            </p>
          )}
          <ul className="thread">
            {a.emails.map((e) => (
              <li key={e.id}>
                <span className="muted">{fmtDate(e.date)}</span> <strong>{CATEGORY_LABELS[e.category]}</strong>{' '}
                <a href={gmailLink(e)} target="_blank" rel="noreferrer">
                  {e.subject}
                </a>
                <div className="muted snippet">{e.snippet}</div>
              </li>
            ))}
          </ul>
          </>
        )}
      />
    </>
  )
}

function MatchCell({ match }: { match: Match }) {
  const tone = match.score >= 70 ? 'responded' : match.score >= 50 ? 'applied' : 'muted-pill'
  return (
    <div className="match">
      <span className={`pill ${tone}`}>{match.score}</span>
      <div className="reasons">
        {match.reasons.slice(0, 4).map((r) => (
          <span key={r.text} className={r.good ? 'good' : 'bad'}>
            {r.good ? '✓' : '✗'} {r.text}
          </span>
        ))}
      </div>
    </div>
  )
}

function ProfileCard({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const [open, setOpen] = useState(!hasProfile(profile))
  const [draft, setDraft] = useState(profile)
  const [reading, setReading] = useState('')
  useEffect(() => setDraft(profile), [profile])
  const skills = resumeSkills(draft.resume)
  if (!open) {
    return (
      <p className="muted profile-line">
        Ranking leads against your resume ({resumeFamilies(profile.resume).join(', ') || 'no role types found'}; {resumeSkills(profile.resume).length} skills, {profile.targetTitles.split(/[,\n;]+/).filter((t) => t.trim()).length} target titles,
        ${Math.round(profile.minPay / 1000)}K+, NY/NJ/CT{profile.includeRemote ? ' or remote' : ''}).{' '}
        <button className="link" onClick={() => setOpen(true)}>
          Edit
        </button>
      </p>
    )
  }
  return (
    <form
      className="profile"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(draft)
        setOpen(false)
      }}
    >
      <p className="muted">
        Recommendations compare each lead with your resume. This stays in your browser and is never uploaded.
      </p>
      <div className="resume-upload">
        <label className="button ghost">
          Upload resume (PDF or .txt)
          <input
            type="file"
            accept="application/pdf,.pdf,.txt,text/plain"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setReading(`Reading ${file.name}…`)
              try {
                const text = file.name.toLowerCase().endsWith('.pdf') ? await pdfText(file) : await file.text()
                if (!text.trim()) throw new Error('no text found (is it a scanned image?)')
                setDraft((d) => ({ ...d, resume: text }))
                setReading(`Read ${file.name}.`)
              } catch (err) {
                setReading(`Couldn't read ${file.name}: ${err instanceof Error ? err.message : err}`)
              }
            }}
          />
        </label>
        {reading && <span className="muted">{reading}</span>}
      </div>
      <label>
        Resume text (filled in from the upload, or paste it)
        <textarea rows={5} value={draft.resume} onChange={(e) => setDraft({ ...draft, resume: e.target.value })} />
      </label>
      {skills.length > 0 && <p className="muted hint">Skills found: {skills.join(', ')}</p>}
      {draft.resume.trim() && (
        <p className="muted hint">
          Role types it fits: {resumeFamilies(draft.resume).join(', ') || 'none found, so add target titles below'}
        </p>
      )}
      <div className="filters">
        <label className="wide">
          Job titles you want (comma separated)
          <input
            value={draft.targetTitles}
            onChange={(e) => setDraft({ ...draft, targetTitles: e.target.value })}
            placeholder="e.g. IT Support Specialist, Junior Systems Administrator"
          />
        </label>
        <label className="narrow">
          Minimum pay per year
          <input
            type="number"
            step={5000}
            value={draft.minPay}
            onChange={(e) => setDraft({ ...draft, minPay: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.includeRemote} onChange={(e) => setDraft({ ...draft, includeRemote: e.target.checked })} />
          Include remote jobs
        </label>
      </div>
      <div className="actions">
        <button type="submit">Save</button>
        {hasProfile(profile) && (
          <button type="button" className="ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

type LeadView = 'recommended' | 'new' | LeadStatus | 'expired' | 'all'

function LeadsTable({
  leads,
  filters,
  statuses,
  onMark,
  profile,
}: {
  leads: Lead[]
  filters: Filters
  statuses: Map<string, { status: LeadStatus; at: number }>
  onMark: (key: string, status: LeadStatus | undefined) => void
  profile: Profile
}) {
  const scored = hasProfile(profile)
  const [view, setView] = useState<LeadView>(scored ? 'recommended' : 'new')
  const scores = useMemo(() => new Map(leads.map((l) => [l.key, scoreLead(l, profile)])), [leads, profile])
  const matching = leads.filter((l) => matches(l, l.description ?? l.email.body, filters))
  const inView = (l: Lead, v: LeadView) => {
    const status = statuses.get(l.key)?.status ?? 'new'
    // Expired only hides leads you haven't acted on; applied and dismissed stay in their lists.
    if (status === 'new' && isExpired(l)) return v === 'expired' || v === 'all'
    if (v === 'recommended') return status === 'new' && scored && isRecommended(scores.get(l.key)!)
    return v === 'all' || status === v
  }
  const count = (v: LeadView) => matching.filter((l) => inView(l, v)).length
  const items = matching.filter((l) => inView(l, view)).map((l) => ({ ...l, match: scores.get(l.key)! }))

  function apply(l: Lead) {
    if (l.url) window.open(l.url, '_blank', 'noopener')
    onMark(l.key, 'applied')
  }

  return (
    <>
      <div className="filters">
        <label className="narrow">
          Show
          <select value={view} onChange={(e) => setView(e.target.value as LeadView)}>
            {scored && <option value="recommended">Recommended ({count('recommended')})</option>}
            <option value="new">New ({count('new')})</option>
            <option value="applied">Applied ({count('applied')})</option>
            <option value="dismissed">Dismissed ({count('dismissed')})</option>
            <option value="expired">Likely expired ({count('expired')})</option>
            <option value="all">All ({count('all')})</option>
          </select>
        </label>
        <p className="muted hint">
          Apply opens the posting and marks the job as applied. Jobs no alert has listed in {LEAD_EXPIRY_DAYS} days count as
          likely expired.
        </p>
      </div>
      <SortableTable
        key={scored ? 'scored' : 'plain'}
        items={items}
        initial={{ key: scored ? 'match' : 'date', dir: 'desc' }}
        empty={view === 'new' || view === 'recommended' ? 'No new job leads match these filters.' : 'No job leads here yet.'}
        columns={[
          ...(scored
            ? [
                {
                  key: 'match',
                  label: 'Match',
                  get: (l: Lead & { match: Match }) => l.match.score,
                  render: (l: Lead & { match: Match }) => <MatchCell match={l.match} />,
                },
              ]
            : []),
          {
            key: 'title',
            label: 'Job title',
            get: (l) => l.title,
            render: (l) =>
              l.url ? (
                <a href={l.url} target="_blank" rel="noreferrer">
                  {l.title}
                </a>
              ) : (
                l.title
              ),
          },
          { key: 'company', label: 'Company', get: (l) => l.company },
          { key: 'location', label: 'Location', get: (l) => l.location },
          { key: 'pay', label: 'Pay', get: (l) => l.pay?.maxAnnual, render: (l) => formatPay(l.pay) },
          { key: 'source', label: 'From', get: (l) => SOURCE_LABELS[l.source] },
          { key: 'date', label: 'Received', get: (l) => l.date, render: (l) => fmtDate(l.date) },
          {
            key: 'action',
            label: '',
            get: (l) => statuses.get(l.key)?.at,
            render: (l) => {
              const s = statuses.get(l.key)
              if (s) {
                return (
                  <span className="lead-actions">
                    <span className={`pill ${s.status === 'applied' ? 'responded' : 'muted-pill'}`}>
                      {s.status === 'applied' ? `Applied ${fmtDate(s.at)}` : 'Dismissed'}
                    </span>
                    <button className="link" onClick={() => onMark(l.key, undefined)}>
                      Undo
                    </button>
                  </span>
                )
              }
              return (
                <span className="lead-actions">
                  <button className="small" onClick={() => apply(l)} disabled={!l.url} title={l.url ? undefined : 'No link in the email'}>
                    Apply
                  </button>
                  <button className="small ghost" onClick={() => onMark(l.key, 'dismissed')} aria-label={`Dismiss ${l.title}`}>
                    Dismiss
                  </button>
                </span>
              )
            },
          },
        ]}
      />
    </>
  )
}

function EmailsTable({ records, onRelabel }: { records: EmailRecord[]; onRelabel: (id: string, c: Category | '') => void }) {
  const [show, setShow] = useState<Category | 'all'>('all')
  const items = records.filter((r) => show === 'all' || r.category === show).map((r) => ({ ...r, key: r.id }))
  return (
    <>
      <div className="filters">
        <label className="narrow">
          Show
          <select value={show} onChange={(e) => setShow(e.target.value as Category | 'all')}>
            <option value="all">All types</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <p className="muted hint">Sorted wrong? Change the type and the dashboard remembers it.</p>
      </div>
      <SortableTable
        items={items}
        initial={{ key: 'date', dir: 'desc' }}
        empty="No emails of this type."
        columns={[
          { key: 'date', label: 'Date', get: (r) => r.date, render: (r) => fmtDate(r.date) },
          { key: 'from', label: 'From', get: (r) => r.fromName || r.from },
          {
            key: 'subject',
            label: 'Subject',
            get: (r) => r.subject,
            render: (r) => (
              <a href={gmailLink(r)} target="_blank" rel="noreferrer">
                {r.subject || '(no subject)'}
              </a>
            ),
          },
          {
            key: 'category',
            label: 'Type',
            get: (r) => r.category,
            render: (r) => (
              <select
                value={r.category}
                className={r.overridden ? 'overridden' : ''}
                aria-label={`Type for ${r.subject}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onRelabel(r.id, e.target.value as Category)}
              >
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            ),
          },
        ]}
      />
    </>
  )
}
