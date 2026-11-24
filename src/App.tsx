import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toRecord } from './classify'
import { autofillAvailable, openApplication } from './autofill'
import { clearAll, closeAccount, getMeta, loadAll, openAccount, setAppStatus, setLeadStatus, setLeadStatuses, setMeta, setOverride, type LeadStatus } from './db'
import { DEMO_PROFILE, demoEmails } from './demo'
import { accountEmail, AuthExpired, isSignedIn, setRateLimitListener, signIn, signOut, START_DATE } from './gmail'
import {
  buildApplications,
  buildLeads,
  EMPTY_FILTERS,
  formatPay,
  inGroup,
  isExpired,
  LEAD_EXPIRY_DAYS,
  leadsInApplications,
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
import { driveFrom, formatDrive, locate } from './distance'
import { DEFAULT_HIDDEN_FIELDS, FIELD_NAMES, fieldOf, placeOf, titleGroup } from './fields'
import { pdfText } from './pdf'
import { syncGmail } from './sync'
import { CATEGORY_LABELS, type Category, type EmailRecord, type RawEmail } from './types'

const POLL_MS = 2 * 60 * 1000
const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

const SOURCE_LABELS = { linkedin: 'LinkedIn', indeed: 'Indeed', glassdoor: 'Glassdoor', handshake: 'Handshake', direct: 'Employer' }

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

/** What you change while trying the sample data. Kept in memory only, apart from your own saved data. */
interface Edits {
  overrides: Map<string, Category>
  leadStatus: Map<string, { status: LeadStatus; at: number }>
  appStatus: Map<string, Status>
  profile: Profile
}
const freshDemo = (): Edits => ({ overrides: new Map(), leadStatus: new Map(), appStatus: new Map(), profile: DEMO_PROFILE })

/** "?demo" in the address opens the sample data straight away, for sharing the page. */
const demoInUrl = () => {
  try {
    return new URLSearchParams(window.location.search).has('demo')
  } catch {
    return false
  }
}
function setDemoInUrl(on: boolean) {
  try {
    const url = new URL(window.location.href)
    if (on) url.searchParams.set('demo', '')
    else url.searchParams.delete('demo')
    window.history.replaceState(null, '', url.toString().replace('demo=', 'demo').replace(/\?$/, ''))
  } catch {
    /* not a big deal */
  }
}

export default function App() {
  const [clientId, setClientId] = useState(ENV_CLIENT_ID || readStored('clientId') || '')
  const [raws, setRaws] = useState<RawEmail[]>([])
  const [mine, setMine] = useState<Edits>({ overrides: new Map(), leadStatus: new Map(), appStatus: new Map(), profile: DEFAULT_PROFILE })
  const [demoEdits, setDemoEdits] = useState<Edits>(freshDemo)
  const [demo, setDemoState] = useState(demoInUrl)
  const [connected, setConnected] = useState(false)
  /** The Gmail account whose data is showing; nothing loads until someone signs in. */
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState<number>()
  const [tab, setTab] = useState<Tab>('applications')
  const [appGroup, setAppGroup] = useState<StatusGroup>('all')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const syncing = useRef(false)

  // Sample data and your own data never mix: each has its own edits, and only yours are saved.
  const { overrides, leadStatus, appStatus, profile } = demo ? demoEdits : mine
  const setEdits = (patch: Partial<Edits>) => (demo ? setDemoEdits : setMine)((e) => ({ ...e, ...patch }))

  function setDemo(on: boolean) {
    setDemoState(on)
    setDemoInUrl(on)
    setFilters(EMPTY_FILTERS)
    setAppGroup('all')
    setTab('applications')
    if (on) setDemoEdits(freshDemo())
  }

  const reload = useCallback(async () => {
    const { emails, overrides, leadStatus, appStatus } = await loadAll()
    const profile = { ...DEFAULT_PROFILE, ...(await getMeta<Profile>('profile')) }
    setMine({ overrides, leadStatus, appStatus, profile })
    setRaws(emails)
    setLastSync(await getMeta<number>('lastSync'))
  }, [])

  function forget() {
    closeAccount()
    setAccount('')
    setRaws([])
    setMine({ overrides: new Map(), leadStatus: new Map(), appStatus: new Map(), profile: DEFAULT_PROFILE })
    setLastSync(undefined)
  }

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
      const email = await accountEmail()
      if (email !== account) {
        forget()
        await openAccount(email)
        setAccount(email)
        await reload()
      }
      setConnected(true)
    } catch (e) {
      setError(`Couldn't connect to Gmail: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function disconnect() {
    signOut()
    setConnected(false)
    if (account && confirm(`Also delete the data saved in this browser for ${account}?`)) {
      await clearAll()
      writeStored('connectedOnce', undefined)
    }
    forget()
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
    setEdits({ overrides: next })
    if (!demo) await setOverride(id, category || undefined)
  }

  async function markLeads(keys: string[], status: LeadStatus | undefined) {
    const next = new Map(leadStatus)
    const at = Date.now()
    for (const key of keys) {
      if (status) next.set(key, { status, at })
      else next.delete(key)
    }
    setEdits({ leadStatus: next })
    if (!demo) await (keys.length === 1 ? setLeadStatus(keys[0], status, at) : setLeadStatuses(keys, status, at))
  }
  const markLead = (key: string, status: LeadStatus | undefined) => markLeads([key], status)

  async function editAppStatus(key: string, status: Status | undefined) {
    const next = new Map(appStatus)
    if (status) next.set(key, status)
    else next.delete(key)
    setEdits({ appStatus: next })
    if (!demo) await setAppStatus(key, status)
  }

  async function saveProfile(p: Profile) {
    setEdits({ profile: p })
    if (!demo) await setMeta('profile', p)
  }

  const applications = useMemo(() => withEditedStatus(buildApplications(records), appStatus), [records, appStatus])
  const leads = useMemo(() => buildLeads(records), [records])
  const openLeads = useMemo(() => {
    const { place } = leadPlacer(leads, applications, leadStatus, profile)
    return leads.filter((l) => isCounted(place(l))).length
  }, [leads, applications, leadStatus, profile])
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
    document.getElementById('lists')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const hasData = records.length > 0
  const showLanding = !hasData && !demo && !busy

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Job search dashboard</h1>
          {!showLanding && (
            <p className="muted status-line">
              {demo
                ? 'Sample data'
                : connected
                  ? `Live from ${account}. ${busy || (lastSync ? `Last checked ${new Date(lastSync).toLocaleTimeString()}.` : '')}`
                  : hasData
                    ? `Saved data for ${account}${lastSync ? ` as of ${new Date(lastSync).toLocaleString()}` : ''}. Reconnect for live updates.`
                    : busy}
            </p>
          )}
        </div>
        {!showLanding && (
          <div className="actions">
            {connected ? (
              <>
                <button className="ghost" onClick={sync} disabled={!!busy}>
                  Check now
                </button>
                <button className="ghost" onClick={disconnect}>
                  Disconnect
                </button>
              </>
            ) : demo ? (
              <button className="ghost" onClick={() => setDemo(false)}>
                Exit sample data
              </button>
            ) : (
              <button onClick={connect} disabled={!clientId}>
                Reconnect Gmail
              </button>
            )}
          </div>
        )}
      </header>

      {demo && (
        <p className="demo-banner">
          You're looking at a made-up job search, so every feature can be tried without connecting Gmail. Change anything you like: nothing is saved, and
          nothing here is real.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {showLanding && (
        <Landing
          canConnect={!!clientId}
          returning={!!readStored('connectedOnce')}
          onDemo={() => setDemo(true)}
          onConnect={connect}
          setup={!clientId && <Setup onSave={(id) => (writeStored('clientId', id), setClientId(id))} />}
        />
      )}

      {hasData && (
        <>
          <section className="stats" aria-label="Summary">
            <Stat
              label="Applications"
              value={total}
              sub={`${groupCount('applied')} waiting to hear back${scams ? ` · ${scams} ${scams === 1 ? 'scam' : 'scams'} left out` : ''}`}
              onClick={() => showGroup('all')}
            />
            <Stat label="Action needed" value={action} sub="replies waiting on you" tone="warn" onClick={() => showGroup('action')} />
            <Stat label="Interviews" value={interviews} sub={`${offers} ${offers === 1 ? 'offer' : 'offers'}`} tone="good" onClick={() => showGroup('interviews')} />
            <Stat
              label="Rejections"
              value={rejected}
              sub={afterInterview ? `${afterInterview} after an interview` : total ? `${Math.round((rejected / total) * 100)}% of applications` : ''}
              onClick={() => showGroup('rejected')}
            />
            <Stat
              label="Open job leads"
              value={openLeads}
              sub={`from ${counts.lead} job board emails`}
              onClick={() => {
                setTab('leads')
                document.getElementById('lists')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Weekly activity</h2>
              <ul className="legend" aria-hidden="true">
                <li>
                  <i style={{ background: 'var(--series-1)' }} />
                  Applied
                </li>
                <li>
                  <i style={{ background: 'var(--series-3)' }} />
                  Heard back
                </li>
                <li>
                  <i style={{ background: 'var(--series-2)' }} />
                  Rejected
                </li>
              </ul>
            </div>
            <div className="chart" role="img" aria-label="Weekly counts of applications, replies and rejections">
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={chart} barCategoryGap="35%" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="2 4" />
                  <XAxis dataKey="week" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip
                    cursor={{ fill: 'var(--hover)' }}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13 }}
                    labelFormatter={(w) => `Week of ${w}`}
                  />
                  <Bar dataKey="application" name="Applied" stackId="a" fill="var(--series-1)" />
                  <Bar dataKey="response" name="Heard back" stackId="a" fill="var(--series-3)" />
                  <Bar dataKey="rejection" name="Rejected" stackId="a" fill="var(--series-2)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="section" id="lists">
            <nav className="tabs" role="tablist">
              {(
                [
                  ['applications', 'Applications', total],
                  ['leads', 'Job leads', openLeads],
                  ['emails', 'All emails', records.length],
                ] as const
              ).map(([id, label, n]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>
                  {label} <span className="count">{n}</span>
                </button>
              ))}
            </nav>
            {tab === 'applications' && (
              <ApplicationsTable apps={applications} filters={filters} onFilters={setFilters} onEdit={editAppStatus} group={appGroup} onGroup={setAppGroup} demo={demo} />
            )}
            {tab === 'leads' && (
              <>
                <ProfileCard profile={profile} onSave={saveProfile} demo={demo} />
                <LeadsTable
                  key={`${demo ? 'demo' : 'mine'}-${hasProfile(profile) ? 'scored' : 'plain'}`}
                  leads={leads}
                  filters={filters}
                  onFilters={setFilters}
                  statuses={leadStatus}
                  onMark={markLead}
                  onMarkMany={markLeads}
                  applications={applications}
                  profile={profile}
                  demo={demo}
                />
              </>
            )}
            {tab === 'emails' && <EmailsTable records={records} onRelabel={relabel} demo={demo} />}
          </section>
        </>
      )}

      {busy && !hasData && !demo && <p className="muted empty">{busy}</p>}

      <footer className="muted">
        Read-only Gmail access. Emails are stored only in this browser.{' '}
        Drive times are rough estimates from town locations by{' '}
        <a href="https://www.geonames.org" target="_blank" rel="noreferrer">
          GeoNames
        </a>{' '}
        (CC BY 4.0).{' '}
        {clientId && !ENV_CLIENT_ID && (
          <button className="link" onClick={() => (writeStored('clientId', undefined), setClientId(''))}>
            Change Google client ID
          </button>
        )}
      </footer>
    </div>
  )
}

function Landing({
  canConnect,
  returning,
  onDemo,
  onConnect,
  setup,
}: {
  canConnect: boolean
  returning: boolean
  onDemo: () => void
  onConnect: () => void
  setup: ReactNode
}) {
  return (
    <section className="landing">
      <p className="eyebrow">Counting job emails since May 1, 2026</p>
      <h2>Every application, reply and job lead, sorted from your inbox.</h2>
      <p className="lede">
        The dashboard reads job email from Gmail and keeps count for you: where you applied, who wrote back, who passed, and new openings from LinkedIn, Indeed,
        Glassdoor and Handshake, ranked against your resume.
      </p>
      <div className="actions">
        <button className="big" onClick={onDemo}>
          Try with sample data
        </button>
        <button className="big ghost" onClick={onConnect} disabled={!canConnect}>
          {returning ? 'Reconnect Gmail' : 'Connect Gmail'}
        </button>
      </div>
      <p className="muted fine">
        Sample data is a made-up job search, so no sign-in is needed. Connecting Gmail is read-only and your email never leaves your browser. While the app is in
        Google's testing mode, only approved accounts can connect.
      </p>
      <ul className="features">
        <li>
          <strong>Status at a glance</strong>
          <span>Applied, waiting, interviewing, rejected, and likely scams, all from the emails themselves.</span>
        </li>
        <li>
          <strong>Leads worth your time</strong>
          <span>Job alerts split into single listings, scored on title, pay, location and experience.</span>
        </li>
        <li>
          <strong>Sort and filter</strong>
          <span>By job title, location, pay and responsibilities, with drive times from home.</span>
        </li>
      </ul>
      {setup}
    </section>
  )
}

function Stat({ label, value, sub, tone, onClick }: { label: string; value: number; sub?: string; tone?: 'warn' | 'good'; onClick?: () => void }) {
  return (
    <button className={`stat${tone && value ? ` ${tone}` : ''}`} onClick={onClick} title="Show these below">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </button>
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

/** Title and location up front; pay and responsibilities one click away, so the bar stays short. */
function FilterBar({ filters, onChange, children }: { filters: Filters; onChange: (f: Filters) => void; children?: ReactNode }) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)
  const extra = (filters.minPay ? 1 : 0) + (filters.responsibilities.trim() ? 1 : 0)
  const [more, setMore] = useState(extra > 0)
  return (
    <div className="toolbar">
      <div className="toolbar-row">
        {children}
        <input className="search" value={filters.title} onChange={(e) => set({ title: e.target.value })} placeholder="Job title" aria-label="Filter by job title" />
        <input className="search" value={filters.location} onChange={(e) => set({ location: e.target.value })} placeholder="Location" aria-label="Filter by location" />
        <button className={more || extra ? 'chip on' : 'chip'} onClick={() => setMore(!more)} aria-expanded={more}>
          More filters{extra ? ` (${extra})` : ''}
        </button>
        {active && (
          <button className="link" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear
          </button>
        )}
      </div>
      {more && (
        <div className="toolbar-row">
          <select value={filters.minPay} onChange={(e) => set({ minPay: Number(e.target.value) })} aria-label="Minimum pay">
            <option value={0}>Any pay</option>
            {[50, 60, 70, 80, 90, 100, 120, 150].map((k) => (
              <option key={k} value={k * 1000}>
                ${k}K+ a year
              </option>
            ))}
          </select>
          <input
            className="search wide"
            value={filters.responsibilities}
            onChange={(e) => set({ responsibilities: e.target.value })}
            placeholder="Responsibilities include, e.g. sql python"
            aria-label="Responsibilities include"
          />
        </div>
      )}
    </div>
  )
}

/** Rows shown before "Show all", so a long list doesn't swamp the page. */
const PAGE_SIZE = 15

interface Column<T> {
  key: string
  label: string
  get: (t: T) => string | number | undefined
  render?: (t: T) => ReactNode
}

interface RowGroup<T> {
  name: string
  note?: string
  rows: T[]
  /** Smaller groups inside this one, when grouping by two things at once. */
  sub?: RowGroup<T>[]
}

function SortableTable<T extends { key: string }>({
  items,
  columns,
  initial,
  detail,
  empty,
  sortable = true,
  groups,
}: {
  items: T[]
  columns: Column<T>[]
  initial: { key: string; dir: SortDir }
  detail?: (t: T) => ReactNode
  empty: string
  /** False when the order comes from a menu instead of the column headers. */
  sortable?: boolean
  /** Splits the rows under collapsible headings, in the order this returns them. */
  groups?: (rows: T[]) => RowGroup<T>[]
}) {
  const [sort, setSort] = useState(initial)
  const [open, setOpen] = useState<string>()
  const [openGroups, setOpenGroups] = useState(new Set<string>())
  const [limit, setLimit] = useState(PAGE_SIZE)
  const col = columns.find((c) => c.key === sort.key) ?? columns[0]
  const rows = sortBy(items, col.get, sort.dir)
  if (!rows.length) return <p className="muted empty">{empty}</p>
  const renderRow = (r: T) => (
    <Row key={r.key} item={r} columns={columns} open={open === r.key} onToggle={detail ? () => setOpen(open === r.key ? undefined : r.key) : undefined} detail={detail} />
  )
  const grouped = groups?.(rows)
  const toggleGroup = (name: string) => {
    const next = new Set(openGroups)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setOpenGroups(next)
  }
  return (
    <div className="table-wrap">
      {grouped && (
        <p className="group-actions">
          <button className="link" onClick={() => setOpenGroups(new Set(grouped.flatMap((g) => [g.name, ...(g.sub ?? []).map((s) => `${g.name}\u0000${s.name}`)])))}>
            Expand all
          </button>{' '}
          ·{' '}
          <button className="link" onClick={() => setOpenGroups(new Set())}>
            Collapse all
          </button>
        </p>
      )}
      <table>
        <thead>
          <tr>
            {columns.map((c) =>
              sortable ? (
                <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    onClick={() => setSort({ key: c.key, dir: sort.key === c.key && sort.dir === 'desc' ? 'asc' : 'desc' })}
                  >
                    {c.label}
                    <span className="arrow">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                  </button>
                </th>
              ) : (
                <th key={c.key}>
                  <span className="th-label">{c.label}</span>
                </th>
              ),
            )}
          </tr>
        </thead>
        {grouped ? (
          grouped.map((g) => {
            const heading = (id: string, x: RowGroup<T>, inner = false) => (
              <tr key={id} className={inner ? 'group-row sub' : 'group-row'} onClick={() => toggleGroup(id)}>
                <td colSpan={columns.length}>
                  <button className="group-toggle" aria-expanded={openGroups.has(id)}>
                    <span className="caret">{openGroups.has(id) ? '▾' : '▸'}</span> {x.name}{' '}
                    <span className="muted">
                      {x.rows.length}
                      {x.note ? ` · ${x.note}` : ''}
                    </span>
                  </button>
                </td>
              </tr>
            )
            return (
              <tbody key={g.name}>
                {heading(g.name, g)}
                {openGroups.has(g.name) &&
                  (g.sub
                    ? g.sub.flatMap((sg) => {
                        const id = `${g.name}\u0000${sg.name}`
                        return [heading(id, sg, true), ...(openGroups.has(id) ? sg.rows.map(renderRow) : [])]
                      })
                    : g.rows.map(renderRow))}
              </tbody>
            )
          })
        ) : (
          <tbody>{rows.slice(0, limit).map(renderRow)}</tbody>
        )}
      </table>
      {!grouped && rows.length > limit && (
        <p className="more-rows">
          <button className="ghost small" onClick={() => setLimit(rows.length)}>
            Show all {rows.length}
          </button>
        </p>
      )}
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
  onFilters,
  onEdit,
  group,
  onGroup,
  demo,
}: {
  apps: Application[]
  filters: Filters
  onFilters: (f: Filters) => void
  onEdit: (key: string, status: Status | undefined) => void
  group: StatusGroup
  onGroup: (g: StatusGroup) => void
  demo: boolean
}) {
  const matching = apps.filter((a) => matches(a, a.emails.map((e) => e.body).join('\n'), filters))
  const items = matching.filter((a) => inGroup(a, group))
  return (
    <>
      <FilterBar filters={filters} onChange={onFilters}>
        <select
          value={group}
          onChange={(e) => onGroup(e.target.value as StatusGroup)}
          aria-label="Show"
          title="The counts at the top use these same groups. Removed applications leave every count."
        >
          {(Object.keys(STATUS_GROUPS) as StatusGroup[]).map((g) => (
            <option key={g} value={g}>
              {STATUS_GROUPS[g].label} ({matching.filter((a) => inGroup(a, g)).length})
            </option>
          ))}
        </select>
      </FilterBar>
      <SortableTable
        key={group}
        items={items}
        initial={{ key: 'updated', dir: 'desc' }}
        empty="No applications match these filters."
        columns={[
          { key: 'company', label: 'Company', get: (a) => a.company, render: (a) => <span className="strong">{a.company}</span> },
          { key: 'title', label: 'Job title', get: (a) => a.title },
          { key: 'location', label: 'Location', get: (a) => a.location },
          { key: 'pay', label: 'Pay', get: (a) => a.pay?.minAnnual, render: (a) => <span className="nowrap">{formatPay(a.pay)}</span> },
          {
            key: 'status',
            label: 'Status',
            get: (a) => a.status,
            render: (a) => (
              <select
                className={`pill status-select ${a.status}`}
                value={a.status}
                aria-label={`Status for ${a.company}`}
                title={a.edited ? `Set by you. Emails say: ${STATUS_LABELS[a.emailStatus]}` : 'From your emails. Change it if it\'s wrong.'}
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
          {
            key: 'applied',
            label: 'Applied',
            get: (a) => a.appliedOn,
            render: (a) =>
              a.appliedGuessed ? <span title="No confirmation email found, so this is the date of the first email about it">≈ {fmtDate(a.appliedOn)}</span> : fmtDate(a.appliedOn),
          },
          { key: 'updated', label: 'Updated', get: (a) => a.lastUpdate, render: (a) => fmtDate(a.lastUpdate) },
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
                  <span className="muted date">{fmtDate(e.date)}</span>
                  <div>
                    <span className={`kind ${e.category}`}>{CATEGORY_LABELS[e.category]}</span> <EmailSubject email={e} demo={demo} />
                    <div className="muted snippet">{e.snippet}</div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="detail-actions">
              <button className="link" onClick={() => onEdit(a.key, a.status === 'removed' ? undefined : 'removed')}>
                {a.status === 'removed' ? 'Restore this application' : 'Remove from counts'}
              </button>
            </p>
          </>
        )}
      />
    </>
  )
}

/** A link to the email in Gmail, or plain text for sample data, which has nothing to open. */
function EmailSubject({ email, demo }: { email: EmailRecord; demo: boolean }) {
  const text = email.subject || '(no subject)'
  if (demo) return <span title="Sample email">{text}</span>
  return (
    <a href={gmailLink(email)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      {text}
    </a>
  )
}

function MatchCell({ match }: { match: Match }) {
  const tone = match.score >= 70 ? 'responded' : match.score >= 50 ? 'applied' : 'muted-pill'
  return (
    <div className="match" title={match.reasons.map((r) => `${r.good ? '✓' : '✗'} ${r.text}`).join('\n')}>
      <span className={`pill ${tone}`}>{match.score}</span>
      <div className="reasons">
        {match.reasons.slice(0, 2).map((r) => (
          <span key={r.text} className={r.good ? 'good' : 'bad'}>
            {r.good ? '✓' : '✗'} {r.text}
          </span>
        ))}
      </div>
    </div>
  )
}

function ProfileCard({ profile, onSave, demo }: { profile: Profile; onSave: (p: Profile) => void; demo: boolean }) {
  const [open, setOpen] = useState(!hasProfile(profile))
  const [draft, setDraft] = useState(profile)
  const [reading, setReading] = useState('')
  useEffect(() => setDraft(profile), [profile])
  const skills = resumeSkills(draft.resume)
  if (!open) {
    return (
      <p className="muted profile-line" title={`Role types: ${resumeFamilies(profile.resume).join(', ') || 'none found'}. ${resumeSkills(profile.resume).length} skills found.`}>
        Ranked against {demo ? 'a sample resume' : 'your resume'}: ${Math.round(profile.minPay / 1000)}K+, NY/NJ/CT{profile.includeRemote ? ' or remote' : ''}
        {profile.home.trim() ? `, drive times from ${profile.home.trim()}` : ', add a home town for drive times'}.{' '}
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
        {demo
          ? 'Recommendations compare each lead with this made-up resume. Try changing it; nothing is saved.'
          : 'Recommendations compare each lead with your resume. This stays in your browser and is never uploaded.'}
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
        <label className="narrow">
          Home town, for drive times
          <input value={draft.home} onChange={(e) => setDraft({ ...draft, home: e.target.value })} placeholder="e.g. Princeton, NJ" />
          {draft.home.trim() && !locate(draft.home) && <span className="bad-hint">Town not found. Try "Town, ST".</span>}
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.includeRemote} onChange={(e) => setDraft({ ...draft, includeRemote: e.target.checked })} />
          Include remote jobs
        </label>
      </div>
      <fieldset className="field-picks">
        <legend>Hide new leads in these fields</legend>
        {FIELD_NAMES.map((f) => {
          const hidden = draft.hiddenFields ?? DEFAULT_HIDDEN_FIELDS
          return (
            <label key={f} className="check">
              <input
                type="checkbox"
                checked={hidden.includes(f)}
                onChange={(e) => setDraft({ ...draft, hiddenFields: e.target.checked ? [...hidden, f] : hidden.filter((x) => x !== f) })}
              />
              {f}
            </label>
          )
        })}
      </fieldset>
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

type LeadView = 'recommended' | 'new' | LeadStatus | 'expired' | 'unrelated' | 'all'

const titleKey = (t?: string) => (t ? titleGroup(t).toLowerCase() : '')

/** Which list each lead belongs in: what you marked, then applied elsewhere, then expired, then unrelated. */
function leadPlacer(leads: Lead[], applications: Application[], statuses: Map<string, { status: LeadStatus }>, profile: Profile) {
  const viaApps = leadsInApplications(leads, applications, titleKey)
  const hiddenFields = profile.hiddenFields ?? DEFAULT_HIDDEN_FIELDS
  const place = (l: Lead): LeadView => {
    const s = statuses.get(l.key)?.status
    if (s) return s
    if (viaApps.has(l.key)) return 'applied'
    if (isExpired(l)) return 'expired'
    if (hiddenFields.includes(fieldOf(l.title))) return 'unrelated'
    return 'new'
  }
  return { viaApps, place }
}

/** Leads that still count: everything except cleared ones and unrelated fields. */
const isCounted = (v: LeadView) => v !== 'cleared' && v !== 'unrelated'
type LeadOrder = 'match' | 'date' | 'pay' | 'title' | 'field' | 'location'
type LeadGrouping = 'title' | 'field' | 'location'
const GROUPINGS: LeadGrouping[] = ['title', 'field', 'location']
const isGrouping = (o: string): o is LeadGrouping => (GROUPINGS as string[]).includes(o)
/** Orders that can run either way, and what each direction is called. */
const DIRECTIONS: Partial<Record<LeadOrder, Record<SortDir, string>>> = {
  date: { desc: 'Newest first', asc: 'Oldest first' },
  pay: { desc: 'Highest first', asc: 'Lowest first' },
}

const LEAD_ORDERS: Record<LeadOrder, string> = {
  match: 'Best match',
  date: 'Date received',
  pay: 'Pay',
  title: 'Job title',
  field: 'Field',
  location: 'Location',
}

/** Biggest groups first, catch-alls last. */
function bySize<T>(map: Map<string, T[]>, last: string) {
  return [...map]
    .map(([name, rows]) => ({ name, rows }))
    .sort((a, b) => Number(a.name === last) - Number(b.name === last) || b.rows.length - a.rows.length || a.name.localeCompare(b.name))
}

function groupRows<T>(rows: T[], keyOf: (t: T) => string) {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = keyOf(r)
    const list = map.get(k)
    if (list) list.push(r)
    else map.set(k, [r])
  }
  return map
}

function LeadsTable({
  leads,
  filters,
  onFilters,
  statuses,
  onMark,
  onMarkMany,
  applications,
  profile,
  demo,
}: {
  leads: Lead[]
  filters: Filters
  onFilters: (f: Filters) => void
  demo: boolean
  statuses: Map<string, { status: LeadStatus; at: number }>
  onMark: (key: string, status: LeadStatus | undefined) => void
  onMarkMany: (keys: string[], status: LeadStatus | undefined) => void
  applications: Application[]
  profile: Profile
}) {
  const home = locate(profile.home)
  const scored = hasProfile(profile)
  const [view, setView] = useState<LeadView>(scored ? 'recommended' : 'new')
  const [order, setOrderState] = useState<LeadOrder>(() => (readStored('leadOrder') as LeadOrder | undefined) ?? (scored ? 'match' : 'date'))
  const setOrder = (o: LeadOrder) => {
    setOrderState(o)
    if (!demo) writeStored('leadOrder', o)
  }
  const [thenBy, setThenState] = useState<LeadGrouping | ''>(() => (readStored('leadThen') as LeadGrouping | undefined) ?? '')
  const setThen = (o: LeadGrouping | '') => {
    setThenState(o)
    if (!demo) writeStored('leadThen', o)
  }
  const [dir, setDirState] = useState<SortDir>(() => (readStored('leadDir') === 'asc' ? 'asc' : 'desc'))
  const setDir = (d: SortDir) => {
    setDirState(d)
    if (!demo) writeStored('leadDir', d)
  }
  const second = isGrouping(order) && thenBy && thenBy !== order ? thenBy : undefined
  const rowOrder = order === 'pay' ? 'pay' : order === 'date' || !scored ? 'date' : 'match'
  // Pay and date run whichever way you pick; everything else lists best or newest first.
  const rowDir: SortDir = DIRECTIONS[order] ? dir : 'desc'
  function groups<T extends Lead>(rows: T[]): RowGroup<T>[] {
    return groupBy(order, rows).map((g) => (second ? { ...g, sub: groupBy(second, g.rows) } : g))
  }
  function groupBy<T extends Lead>(order: LeadOrder, rows: T[]): RowGroup<T>[] {
    if (order === 'title') return bySize(groupRows(rows, (l) => titleGroup(l.title)), 'No title')
    if (order === 'field') return bySize(groupRows(rows, (l) => fieldOf(l.title)), 'Other')
    if (order !== 'location') return []
    // Remote first, then nearest by drive time when a home town is set, else the most jobs.
    return [...groupRows(rows, (l) => placeOf(l.location))]
      .map(([name, list]) => {
        const to = home && name !== 'Remote' ? locate(name) : undefined
        const drive = home && to ? driveFrom(home, to) : undefined
        return { name, rows: list, note: drive && formatDrive(drive), rank: name === 'Remote' ? -1 : name === 'Location not listed' ? 1e9 : drive ? drive.minutes : 1e6 - list.length }
      })
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  }
  const scores = useMemo(() => new Map(leads.map((l) => [l.key, scoreLead(l, profile)])), [leads, profile])
  const matching = leads.filter((l) => matches(l, l.description ?? l.email.body, filters))
  const { viaApps, place: placeOfLead } = useMemo(() => leadPlacer(leads, applications, statuses, profile), [leads, applications, statuses, profile])
  const inView = (l: Lead, v: LeadView) => {
    const at = placeOfLead(l)
    if (v === 'recommended') return at === 'new' && scored && isRecommended(scores.get(l.key)!)
    if (v === 'all') return isCounted(at)
    return at === v
  }
  const count = (v: LeadView) => matching.filter((l) => inView(l, v)).length
  const items = matching.filter((l) => inView(l, view)).map((l) => ({ ...l, match: scores.get(l.key)! }))

  // Every lead you could clear, ignoring the search filters, so the button does what it says.
  const clearable = leads.filter((l) => ['expired', 'applied'].includes(placeOfLead(l)))
  function clearOld() {
    if (!clearable.length) return
    if (!confirm(`Clear ${clearable.length} expired or applied job leads? You can bring them back from the Cleared list.`)) return
    onMarkMany(
      clearable.map((l) => l.key),
      'cleared',
    )
  }
  const cleared = leads.filter((l) => statuses.get(l.key)?.status === 'cleared')

  function apply(l: Lead) {
    // Sample listings link nowhere real, so trying Apply only marks the job.
    if (l.url && !demo) openApplication(l.url, l)
    onMark(l.key, 'applied')
  }

  return (
    <>
      <FilterBar filters={filters} onChange={onFilters}>
        <select value={view} onChange={(e) => setView(e.target.value as LeadView)} aria-label="Show">
          {scored && <option value="recommended">Recommended ({count('recommended')})</option>}
          <option value="new">New ({count('new')})</option>
          <option value="applied">Applied ({count('applied')})</option>
          <option value="dismissed">Dismissed ({count('dismissed')})</option>
          <option value="expired">Likely expired ({count('expired')})</option>
          <option value="unrelated">Unrelated fields ({count('unrelated')})</option>
          <option value="cleared">Cleared ({count('cleared')})</option>
          <option value="all">All ({count('all')})</option>
        </select>
        <select value={order} onChange={(e) => setOrder(e.target.value as LeadOrder)} aria-label="Sort by">
          {(Object.keys(LEAD_ORDERS) as LeadOrder[])
            .filter((o) => o !== 'match' || scored)
            .map((o) => (
              <option key={o} value={o}>
                {isGrouping(o) ? `Group by ${LEAD_ORDERS[o].toLowerCase()}` : `Sort: ${LEAD_ORDERS[o].toLowerCase()}`}
              </option>
            ))}
        </select>
        {DIRECTIONS[order] && (
          <select value={dir} onChange={(e) => setDir(e.target.value as SortDir)} aria-label="Sort direction">
            <option value="desc">{DIRECTIONS[order]!.desc}</option>
            <option value="asc">{DIRECTIONS[order]!.asc}</option>
          </select>
        )}
        {isGrouping(order) && (
          <select value={second ?? ''} onChange={(e) => setThen(e.target.value as LeadGrouping | '')} aria-label="Then group by">
            <option value="">Then by nothing</option>
            {GROUPINGS.filter((o) => o !== order).map((o) => (
              <option key={o} value={o}>
                Then by {LEAD_ORDERS[o].toLowerCase()}
              </option>
            ))}
          </select>
        )}
      </FilterBar>
      <p className="muted hint">
        {demo
          ? 'Apply marks a sample job as applied. '
          : autofillAvailable()
            ? 'Apply opens the posting, fills in the Easy Apply form, and stops at Submit. '
            : 'Apply opens the posting and marks it applied. '}
        Jobs no alert has listed in {LEAD_EXPIRY_DAYS} days count as likely expired.{' '}
        {view === 'cleared' ? (
          <button className="link" disabled={!cleared.length} onClick={() => onMarkMany(cleared.map((l) => l.key), undefined)}>
            Restore all cleared ({cleared.length})
          </button>
        ) : (
          clearable.length > 0 && (
            <button className="link" onClick={clearOld}>
              Clear {clearable.length} expired or applied
            </button>
          )
        )}
      </p>
      <SortableTable
        key={`${scored ? 'scored' : 'plain'}-${order}-${second ?? ''}-${rowDir}`}
        items={items}
        initial={{ key: rowOrder, dir: rowDir }}
        sortable={false}
        groups={isGrouping(order) ? groups : undefined}
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
              l.url && !demo ? (
                <a href={l.url} target="_blank" rel="noreferrer">
                  {l.title}
                </a>
              ) : (
                l.title
              ),
          },
          { key: 'company', label: 'Company', get: (l) => l.company },
          {
            key: 'location',
            label: 'Location',
            get: (l) => l.location,
            render: (l) => {
              const to = home && locate(l.location)
              return (
                <>
                  {l.location}
                  {to && <div className="muted drive">{formatDrive(driveFrom(home, to))}</div>}
                </>
              )
            },
          },
          { key: 'pay', label: 'Pay', get: (l) => l.pay?.minAnnual, render: (l) => <span className="nowrap">{formatPay(l.pay)}</span> },
          { key: 'source', label: 'From', get: (l) => SOURCE_LABELS[l.source] },
          { key: 'date', label: 'Received', get: (l) => l.date, render: (l) => fmtDate(l.date) },
          {
            key: 'action',
            label: '',
            get: (l) => statuses.get(l.key)?.at,
            render: (l) => {
              const s = statuses.get(l.key)
              const app = !s && viaApps.get(l.key)
              if (app) {
                return (
                  <span className="lead-actions">
                    <span className="pill responded" title={`Matches your application to ${app.company}${app.title ? ` for ${app.title}` : ''}`}>
                      In Applications
                    </span>
                    <button className="link" onClick={() => onMark(l.key, 'cleared')}>
                      Clear
                    </button>
                  </span>
                )
              }
              if (s) {
                return (
                  <span className="lead-actions">
                    <span className={`pill ${s.status === 'applied' ? 'responded' : 'muted-pill'}`}>
                      {s.status === 'applied' ? `Applied ${fmtDate(s.at)}` : s.status === 'cleared' ? 'Cleared' : 'Dismissed'}
                    </span>
                    <button className="link" onClick={() => onMark(l.key, undefined)}>
                      Undo
                    </button>
                  </span>
                )
              }
              return (
                <span className="lead-actions">
                  <button className="small soft" onClick={() => apply(l)} disabled={!l.url} title={l.url ? undefined : 'No link in the email'}>
                    Apply
                  </button>
                  <button className="link quiet" onClick={() => onMark(l.key, 'dismissed')} aria-label={`Dismiss ${l.title}`}>
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

function EmailsTable({ records, onRelabel, demo }: { records: EmailRecord[]; onRelabel: (id: string, c: Category | '') => void; demo: boolean }) {
  const [show, setShow] = useState<Category | 'all'>('all')
  const items = records.filter((r) => show === 'all' || r.category === show).map((r) => ({ ...r, key: r.id }))
  return (
    <>
      <div className="toolbar">
        <div className="toolbar-row">
          <select value={show} onChange={(e) => setShow(e.target.value as Category | 'all')} aria-label="Show">
            <option value="all">All types</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <span className="muted hint">Sorted wrong? Change the type{demo ? '' : ' and the dashboard remembers it'}.</span>
        </div>
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
            render: (r) => <EmailSubject email={r} demo={demo} />,
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
