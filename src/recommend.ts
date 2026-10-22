import type { Job } from './types'

/** What the match score compares jobs against. Saved only in this browser. */
export interface Profile {
  resume: string
  /** Comma- or line-separated job titles you're aiming for. */
  targetTitles: string
  minPay: number
  includeRemote: boolean
}

export const DEFAULT_PROFILE: Profile = { resume: '', targetTitles: '', minPay: 50000, includeRemote: true }

export const hasProfile = (p: Profile) => !!(p.resume.trim() || p.targetTitles.trim())

/** Skills we look for in a resume. Matching is whole-word and case-insensitive. */
const SKILLS = [
  'active directory', 'agile', 'aws', 'azure', 'bash', 'c#', 'c++', 'cisco', 'citrix', 'cloud', 'crm', 'css',
  'customer service', 'data analysis', 'data entry', 'data modeling', 'dhcp', 'dns', 'docker', 'etl', 'excel',
  'firewall', 'git', 'google workspace', 'hardware', 'help desk', 'helpdesk', 'html', 'intune', 'itil', 'java',
  'javascript', 'jira', 'jupyter', 'kubernetes', 'lan', 'linux', 'mac', 'macos', 'microsoft 365', 'office 365',
  'm365', 'mysql', 'networking', 'node', 'olap', 'oltp', 'outlook', 'pandas', 'postgresql', 'power bi',
  'powershell', 'python', 'r', 'react', 'salesforce', 'scrum', 'sdlc', 'servicenow', 'sharepoint', 'sql',
  'sql server', 'sqlite', 'stored procedures', 't-sql', 'tableau', 'tcp/ip', 'teams', 'ticketing', 'troubleshooting',
  'typescript', 'vba', 'vmware', 'vpn', 'windows', 'windows server', 'zendesk',
]

/** Words that say nothing about the kind of job. */
const STOP = new Set(
  'a an and the of for to in at with on or i ii iii iv 1 2 3 level tier full time part remote hybrid onsite on-site nyc new york temporary contract'.split(' '),
)

const SENIOR = /\b(?:senior|sr\.?|lead|principal|staff|manager|director|head of|vp|vice president|architect|iii|iv|level (?:3|4|iii|iv)|tier (?:3|iii))\b/i
const ENTRY = /\b(?:junior|jr\.?|entry[- ]level|entry|associate|intern|internship|trainee|apprentice|assistant|i|1|level (?:1|i)|tier (?:1|i)|new grad|graduate)\b/i

/** Upstate New York and other places outside commuting range of NYC. */
const FAR_FROM_NYC =
  /\b(?:albany|syracuse|rochester|buffalo|ithaca|binghamton|utica|morrisville|plattsburgh|watertown|schenectady|troy|saratoga|oswego|elmira|jamestown|oneonta|cortland|geneva|canton|potsdam|niagara|rome|auburn|batavia|olean|hartford|new london|storrs|norwich|cape may|atlantic city|vineland|millville)\b/i

/** Different names for the same kind of work, so "Help Desk Analyst" matches "IT Support Analyst". */
const SYNONYMS: [RegExp, string][] = [
  [/\b(?:help ?desk|service desk|desktop support|tech(?:nical)? support|it support)\b/g, 'it support'],
  [/\binformation technology\b/g, 'it'],
  [/\bsys ?admin\b/g, 'systems administrator'],
  [/\bsystem\b/g, 'systems'],
  [/\badmin\b/g, 'administrator'],
  [/\btechnician\b/g, 'specialist'],
]

const words = (s: string) =>
  SYNONYMS.reduce((t, [re, to]) => t.replace(re, to), s.toLowerCase())
    .split(/[^a-z0-9#+/]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))

const hasWord = (text: string, phrase: string) =>
  new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i').test(text)

export function resumeSkills(resume: string): string[] {
  return SKILLS.filter((s) => hasWord(resume, s))
}

export function targetTitles(p: Profile): string[] {
  return p.targetTitles
    .split(/[,\n;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export type Region = 'tristate' | 'remote' | 'far' | 'unknown'

export function region(location?: string): Region {
  if (!location) return 'unknown'
  if (/\bremote\b/i.test(location)) return 'remote'
  if (FAR_FROM_NYC.test(location)) return 'far'
  if (/\b(?:NY|NJ|CT)\b|new york|new jersey|connecticut/i.test(location)) return 'tristate'
  if (/\bUnited States\b/i.test(location)) return 'unknown'
  return 'far'
}

export interface Match {
  score: number
  /** Short reasons, good ones first, shown under the score. */
  reasons: { good: boolean; text: string }[]
}

/** Years of experience asked for, e.g. "3+ years of experience". */
export function yearsRequired(text?: string): number | undefined {
  const m = text?.match(/(\d{1,2})\s*(?:\+|or more)?\s*(?:-\s*\d+\s*)?years?(?: of)?(?: \w+){0,3} experience/i)
  return m ? Number(m[1]) : undefined
}

/**
 * Kinds of work a resume can point to. A job title in a family the resume
 * supports counts as on-target even when no target titles are filled in.
 */
export const ROLE_FAMILIES: { name: string; title: RegExp; resume: RegExp }[] = [
  {
    name: 'IT support',
    title:
      /\b(?:help ?desk|service desk|desktop support|tech(?:nical)? support|it support|it specialist|it technician|it associate|computer (?:support|technician)|field (?:service )?technician|support (?:specialist|technician|analyst)|end[- ]user|audio[- ]?visual|av technician|(?:instructional|classroom|educational) technolog\w*|deskside|it analyst|technology (?:specialist|associate|assistant)|it intern)\b/i,
    resume: /\b(?:tech(?:nical)? support|troubleshoot\w*|help ?desk|hardware|instructional technology|service management)\b/i,
  },
  {
    name: 'systems & networks',
    title: /\b(?:network (?:administrator|technician|support|specialist|analyst|engineer|operations)|noc|systems? (?:administrator|analyst|support|technician)|sys ?admin|it administrator|infrastructure (?:technician|analyst|support)|cloud support)\b/i,
    resume: /\b(?:network\+|networking|ccna|windows server|active directory|tcp\/ip)(?!\w)/i,
  },
  {
    name: 'data & analytics',
    title:
      /\b(?:data (?:analyst|analytics|specialist|associate|coordinator|technician|engineer|scientist)|business (?:intelligence|analyst|systems analyst)|bi (?:analyst|developer)|reporting (?:analyst|specialist)|analytics|sql (?:developer|analyst)|database (?:administrator|analyst|developer)|insights analyst|operations analyst|financial data)\b/i,
    resume: /\b(?:sql|tableau|power bi|data analytics|pandas|etl|data modeling)\b/i,
  },
  {
    name: 'software',
    title: /\b(?:software (?:engineer|developer)|web developer|application developer|full[- ]?stack|front[- ]?end|back[- ]?end|programmer|developer|qa (?:analyst|tester|engineer)|software tester)\b/i,
    resume: /\b(?:typescript|javascript|c#|python|next\.js|react|object[- ]oriented)(?!\w)/i,
  },
  {
    name: 'operations & logistics',
    title: /\b(?:operations (?:associate|coordinator|assistant|specialist)|logistics|supply chain|inventory (?:analyst|coordinator|specialist)|fulfillment coordinator|procurement)\b/i,
    resume: /\b(?:logistics|inventory|shipstation|supply chain)\b/i,
  },
  {
    name: 'HR & people ops',
    title: /\b(?:hr (?:assistant|coordinator|generalist|associate|analyst|specialist)|human resources|recruit(?:ing|ment)? coordinator|talent acquisition coordinator|people operations|hris)\b/i,
    resume: /\b(?:human resource\w*|hr management|hris|recruit\w*)\b/i,
  },
  {
    name: 'project coordination',
    title: /\b(?:project (?:coordinator|assistant|analyst)|it coordinator|technical coordinator|implementation (?:specialist|analyst|coordinator)|program coordinator|pmo)\b/i,
    resume: /\b(?:project management|agile|scrum|sdlc)\b/i,
  },
]

/** The role families a resume shows experience or training for. */
export function resumeFamilies(resume: string): string[] {
  return ROLE_FAMILIES.filter((f) => f.resume.test(resume)).map((f) => f.name)
}

/** Words that hint at tech work without naming the role, worth partial credit. */
const TECH_HINT = /\b(?:it|technology|technical|technician|computer|systems?|data|digital|software|analyst)\b/i

/**
 * Scores how good a fit a job lead is, out of 100:
 * title 35, skills 15, location 20, pay 15, experience level 15.
 */
export function scoreLead(job: Job, profile: Profile): Match {
  const reasons: Match['reasons'] = []
  const title = job.title ?? ''
  const text = `${title}\n${job.company ?? ''}\n${job.description ?? ''}`
  let score = 0

  // Title: overlap with the closest target title, or a role family the resume supports.
  const titleWords = new Set(words(title))
  let best = 0
  let bestTarget = ''
  for (const t of targetTitles(profile)) {
    const tw = words(t)
    if (!tw.length) continue
    const overlap = tw.filter((w) => titleWords.has(w)).length / Math.max(tw.length, Math.min(titleWords.size, 4))
    if (overlap > best) [best, bestTarget] = [overlap, t]
  }
  const targetPoints = Math.round(35 * Math.min(1, best * 1.25))
  const families = resumeFamilies(profile.resume)
  const family = ROLE_FAMILIES.find((f) => families.includes(f.name) && f.title.test(title))
  const familyPoints = family ? 32 : profile.resume.trim() && TECH_HINT.test(title) ? 14 : 0
  const titlePoints = Math.max(targetPoints, familyPoints)
  score += titlePoints
  if (targetPoints >= 20 && targetPoints >= familyPoints) reasons.push({ good: true, text: `like "${bestTarget}"` })
  else if (family) reasons.push({ good: true, text: `${family.name} role` })
  else if (titlePoints < 10) reasons.push({ good: false, text: 'title off-target' })

  // Skills from the resume that the listing mentions.
  const skills = resumeSkills(profile.resume).filter((s) => hasWord(text, s))
  score += Math.min(15, skills.length * 5)
  if (skills.length) reasons.push({ good: true, text: skills.slice(0, 3).join(', ') })

  // Location.
  const where = region(job.location)
  if (where === 'tristate') {
    score += 20
    reasons.push({ good: true, text: 'tristate area' })
  } else if (where === 'remote') {
    score += profile.includeRemote ? 20 : 0
    reasons.push({ good: profile.includeRemote, text: 'remote' })
  } else if (where === 'unknown') {
    score += 10
  } else {
    reasons.push({ good: false, text: 'outside tristate' })
  }

  // Pay, already converted to yearly (hourly × 2,080).
  if (!job.pay) score += 8
  else if (job.pay.maxAnnual >= profile.minPay) {
    score += 15
    reasons.push({ good: true, text: `pays $${Math.round(job.pay.maxAnnual / 1000)}K` })
  } else reasons.push({ good: false, text: `under $${Math.round(profile.minPay / 1000)}K` })

  // Experience level.
  const years = yearsRequired(job.description)
  if (SENIOR.test(title) || (years !== undefined && years > 2)) {
    reasons.push({ good: false, text: years !== undefined && years > 2 ? `${years}+ yrs required` : 'senior role' })
  } else if (ENTRY.test(title) || (years !== undefined && years <= 2)) {
    score += 15
    reasons.push({ good: true, text: 'entry level' })
  } else score += 10

  return { score: Math.min(100, score), reasons: [...reasons.filter((r) => r.good), ...reasons.filter((r) => !r.good)] }
}

/** Good chance and worth applying: on-target, in range, not senior, not underpaid. */
export function isRecommended(m: Match): boolean {
  return m.score >= 55 && !m.reasons.some((r) => !r.good && /senior|yrs required|outside|under \$|off-target/.test(r.text))
}
