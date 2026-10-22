import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toRecord } from './classify'
import { clearAll, getMeta, loadAll, setLeadStatus, setOverride, type LeadStatus } from './db'
import { demoEmails } from './demo'
import { AuthExpired, isSignedIn, setRateLimitListener, signIn, signOut, START_DATE } from './gmail'
import {
  buildApplications,
  buildLeads,
  EMPTY_FILTERS,
  formatPay,
  matches,
  sortBy,
  weekly,
  type Application,
  type Filters,
  type Lead,
  type SortDir,
} from './model'
import { syncGmail } from './sync'
import { CATEGORY_LABELS, type Category, type EmailRecord, type RawEmail } from './types'

const POLL_MS = 2 * 60 * 1000
const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

const SOURCE_LABELS = { linkedin: 'LinkedIn', indeed: 'Indeed', glassdoor: 'Glassdoor', direct: 'Employer' }
const STATUS_LABELS = { applied: 'Applied', responded: 'Responded', rejected: 'Rejected' }

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
  const [demo, setDemo] = useState(false)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState<number>()
  const [tab, setTab] = useState<Tab>('applications')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const syncing = useRef(false)

  const reload = useCallback(async () => {
    const { emails, overrides, leadStatus } = await loadAll()
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

  const applications = useMemo(() => buildApplications(records), [records])
  const leads = useMemo(() => buildLeads(records), [records])
  const counts = useMemo(() => {
    const c = { application: 0, response: 0, rejection: 0, lead: 0, other: 0 }
    for (const r of records) c[r.category]++
    return c
  }, [records])
  const responded = applications.filter((a) => a.emails.some((e) => e.category !== 'application')).length
  const chart = useMemo(() => weekly(records, START_DATE), [records])

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
            <Tile label="Applications" value={applications.length} sub={`${counts.application} confirmation emails`} />
            <Tile
              label="Responses"
              value={counts.response}
              sub={applications.length ? `${Math.round((responded / applications.length) * 100)}% of applications heard back` : ''}
            />
            <Tile label="Rejections" value={counts.rejection} />
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
                  ['applications', `Applications (${applications.length})`],
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
            {tab === 'applications' && <ApplicationsTable apps={applications} filters={filters} />}
            {tab === 'leads' && <LeadsTable leads={leads} filters={filters} statuses={leadStatus} onMark={markLead} />}
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

function Tile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
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

function ApplicationsTable({ apps, filters }: { apps: Application[]; filters: Filters }) {
  const items = apps.filter((a) => matches(a, a.emails.map((e) => e.body).join('\n'), filters))
  return (
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
          render: (a) => <span className={`pill ${a.status}`}>{STATUS_LABELS[a.status]}</span>,
        },
        { key: 'applied', label: 'Applied', get: (a) => a.appliedOn, render: (a) => fmtDate(a.appliedOn) },
        { key: 'updated', label: 'Last update', get: (a) => a.lastUpdate, render: (a) => fmtDate(a.lastUpdate) },
      ]}
      detail={(a) => (
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
      )}
    />
  )
}

type LeadView = 'new' | LeadStatus | 'all'

function LeadsTable({
  leads,
  filters,
  statuses,
  onMark,
}: {
  leads: Lead[]
  filters: Filters
  statuses: Map<string, { status: LeadStatus; at: number }>
  onMark: (key: string, status: LeadStatus | undefined) => void
}) {
  const [view, setView] = useState<LeadView>('new')
  const matching = leads.filter((l) => matches(l, l.email.body, filters))
  const count = (v: LeadView) =>
    matching.filter((l) => v === 'all' || (statuses.get(l.key)?.status ?? 'new') === v).length
  const items = matching.filter((l) => view === 'all' || (statuses.get(l.key)?.status ?? 'new') === view)

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
            <option value="new">New ({count('new')})</option>
            <option value="applied">Applied ({count('applied')})</option>
            <option value="dismissed">Dismissed ({count('dismissed')})</option>
            <option value="all">All ({count('all')})</option>
          </select>
        </label>
        <p className="muted hint">Apply opens the posting and marks the job as applied.</p>
      </div>
      <SortableTable
        items={items}
        initial={{ key: 'date', dir: 'desc' }}
        empty={view === 'new' ? 'No new job leads match these filters.' : 'No job leads here yet.'}
        columns={[
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
