import { ROLE_FAMILIES } from './recommend'

const family = (name: string) => ROLE_FAMILIES.find((f) => f.name === name)!.title

/** Broad kinds of work, checked in order, so "IT Support Engineer" lands in IT support rather than software. */
const FIELDS: [string, RegExp][] = [
  ['Cybersecurity', /\b(?:cyber|security analyst|information security|infosec|soc analyst|security engineer)\b/i],
  ['IT support', family('IT support')],
  ['Systems & networks', family('systems & networks')],
  ['Data & analytics', family('data & analytics')],
  // Before the broad tech words, so "Vet Tech" and "Behavior Technician" don't read as IT.
  [
    'Healthcare & animal care',
    /\b(?:vet|veterinar\w*|animal|kennel|groomer|behaviou?r(?:al)? (?:tech\w*|therap\w*|specialist|interventionist)|rbt|aba|nurs\w*|medical|pharmac\w*|clinical|patient|dental|caregiver|phlebotom\w*|therap\w*|home health|health aide|cna|emt|paramedic|optometr\w*|radiolog\w*|sonograph\w*)\b/i,
  ],
  ['IT support', /\b(?:it|information technology|technology|computer|desktop|tech)\b/i],
  ['Data & analytics', /\b(?:data|analytics|analyst)\b/i],
  ['Software & engineering', family('software')],
  ['Software & engineering', /\b(?:engineer(?:ing)?|developer|ai|machine learning)\b/i],
  ['Project coordination', family('project coordination')],
  ['HR & recruiting', family('HR & people ops')],
  ['HR & recruiting', /\b(?:recruit\w*|talent|human resource\w*|hr)\b/i],
  ['Operations & logistics', family('operations & logistics')],
  ['Operations & logistics', /\b(?:operations|logistics|supply|inventory|purchasing|procurement)\b/i],
  ['Customer service', /\b(?:customer (?:service|support|success|care|experience)|call center|client (?:service|support)|help line)\b/i],
  ['Sales & business development', /\b(?:sales|telesales|account (?:executive|manager|representative)|business development|brand ambassador)\b/i],
  ['Admin & office', /\b(?:admin\w*|office|receptionist|front desk|executive assistant|data entry|clerk|secretary|coordinator|assistant)\b/i],
  ['Finance & accounting', /\b(?:accountant|accounting|finance|financial|bookkeep\w*|audit\w*|payroll|tax|billing|bank\w*)\b/i],
  ['Marketing & design', /\b(?:marketing|social media|content|graphic|design\w*|brand|communications|creative|copywriter)\b/i],
  ['Education', /\b(?:teacher|tutor|instructor|education\w*|school|teaching|academic)\b/i],
  ['Warehouse, retail & food', /\b(?:warehouse|package|stock|retail|cashier|store|barista|server|cook|kitchen|driver|delivery|sort\w*|handler|grocery)\b/i],
]

export const FIELD_NAMES = [...new Set(FIELDS.map(([name]) => name)), 'Other']

/** Fields hidden from new leads unless you choose otherwise: far from IT, data and office work. */
export const DEFAULT_HIDDEN_FIELDS = ['Healthcare & animal care', 'Warehouse, retail & food', 'Sales & business development']

/** The broad field a job title belongs to, e.g. "Help Desk Technician" → "IT support". */
export function fieldOf(title?: string): string {
  if (!title) return 'Other'
  return FIELDS.find(([, re]) => re.test(title))?.[0] ?? 'Other'
}

const LEVEL =
  /\b(?:junior|jr|senior|sr|entry[- ]level|entry|lead|principal|staff|i{1,3}|iv|[1-4]|level [1-4i]+|tier [1-3i]+|trainee|apprentice|new grad|full[- ]time|part[- ]time|remote|hybrid|on-?site|temporary|temp|contract|seasonal|summer|fall|spring|winter|\d{4})\b/gi

/**
 * A title with level, schedule and team details taken out, so "Junior IT Support
 * Specialist II (Hybrid)" and "IT Support Specialist - NYC" group together.
 */
export function titleGroup(title?: string): string {
  if (!title) return 'No title'
  const core = title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/\s+[-–|:@,]\s+|\s*[|:,]\s*|\s+[-–]\s*/)[0]
    .replace(LEVEL, ' ')
    .replace(/[^A-Za-z0-9&/+#. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!core) return title.trim()
  // Title case, keeping acronyms like IT, HR and AV.
  return core
    .split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
    .replace(/\bIt\b/g, 'IT')
    .replace(/\bHr\b/g, 'HR')
}

/** A town to group by: "Edison, NJ 08817 (Hybrid)" and "Edison, NJ" are one place. */
export function placeOf(location?: string): string {
  if (!location) return 'Location not listed'
  if (/\bremote\b/i.test(location)) return 'Remote'
  const m = location.match(/^(.+?),?\s+([A-Z]{2})\b/)
  if (m) {
    const town = m[1].replace(/\bNew York City\b/i, 'New York').replace(/^(?:hybrid|on-?site) (?:work )?in /i, '').trim()
    return `${town}, ${m[2]}`
  }
  return location.replace(/\s*\((?:hybrid|on-?site|remote)\)\s*$/i, '').trim()
}
