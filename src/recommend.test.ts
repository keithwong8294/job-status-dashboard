import { describe, expect, it } from 'vitest'
import { parsePay } from './classify'
import { isRecommended, region, resumeFamilies, resumeSkills, scoreLead, yearsRequired, type Profile } from './recommend'

// A made-up profile; real resumes stay in the browser.
const profile: Profile = {
  resume: 'Skills: Python, SQL, Tableau, Microsoft 365, troubleshooting, Active Directory. Help desk intern.',
  targetTitles: 'IT Support Specialist, Junior Systems Administrator, Data Analyst',
  minPay: 50000,
  includeRemote: true,
}

describe('recommend', () => {
  it('pulls known skills out of a resume', () => {
    expect(resumeSkills(profile.resume)).toEqual(expect.arrayContaining(['python', 'sql', 'tableau', 'microsoft 365', 'active directory']))
    expect(resumeSkills('I like React')).not.toContain('r')
  })

  it('knows the tristate area', () => {
    expect(region('Newark, NJ')).toBe('tristate')
    expect(region('New York NY US')).toBe('tristate')
    expect(region('Stamford, CT')).toBe('tristate')
    expect(region('Syracuse, NY')).toBe('far')
    expect(region('Austin, TX')).toBe('far')
    expect(region('Remote')).toBe('remote')
    expect(region(undefined)).toBe('unknown')
  })

  it('reads years of experience', () => {
    expect(yearsRequired('Requires 3+ years of relevant experience')).toBe(3)
    expect(yearsRequired('1-2 years experience preferred')).toBe(1)
    expect(yearsRequired('Great team')).toBeUndefined()
  })

  it('recommends an on-target, local, entry-level job that pays enough', () => {
    const m = scoreLead({ title: 'Help Desk Analyst I', location: 'Jersey City, NJ', pay: parsePay('$26 - $30 an hour') }, profile)
    expect(m.score).toBeGreaterThanOrEqual(70)
    expect(isRecommended(m)).toBe(true)
  })

  it('does not recommend senior, far-away or underpaid jobs', () => {
    const senior = scoreLead({ title: 'Senior Systems Administrator', location: 'New York, NY', pay: parsePay('$120K a year') }, profile)
    const far = scoreLead({ title: 'IT Support Specialist', location: 'Syracuse, NY', pay: parsePay('$60K a year') }, profile)
    const low = scoreLead({ title: 'IT Support Specialist', location: 'Newark, NJ', pay: parsePay('$18 - $20 an hour') }, profile)
    // Judged by the bottom of the range: $45K–$60K could mean $45K.
    const range = scoreLead({ title: 'IT Support Specialist', location: 'Newark, NJ', pay: parsePay('$45,000 - $60,000 a year') }, profile)
    for (const m of [senior, far, low, range]) expect(isRecommended(m)).toBe(false)
  })

  it('ranks a matching job above an unrelated one', () => {
    const it_ = scoreLead({ title: 'IT Support Specialist', location: 'Brooklyn, NY' }, profile)
    const driver = scoreLead({ title: 'Delivery Driver', location: 'Brooklyn, NY' }, profile)
    expect(it_.score).toBeGreaterThan(driver.score + 25)
  })
})

describe('recommend from a resume alone', () => {
  // Made-up resume text shaped like a new IT grad's; no target titles filled in.
  const resumeOnly: Profile = {
    resume:
      'B.A. Information Technology. Skills: SQL, T-SQL, Python, TypeScript, Tableau, ETL, Microsoft 365, Agile. ' +
      'Instructional Technology Specialist: technical support, troubleshooting classroom hardware. Operations intern: inventory, logistics.',
    targetTitles: '',
    minPay: 50000,
    includeRemote: true,
  }

  it('finds role families in the resume', () => {
    expect(resumeFamilies(resumeOnly.resume)).toEqual(
      expect.arrayContaining(['IT support', 'data & analytics', 'software', 'operations & logistics']),
    )
  })

  it('recommends matching local jobs with no target titles', () => {
    for (const title of ['Help Desk Technician', 'IT Support Specialist', 'Data Analyst', 'Junior Software Developer', 'Desktop Support Analyst']) {
      const m = scoreLead({ title, company: 'Acme', location: 'Newark, NJ' }, resumeOnly)
      expect(isRecommended(m), title).toBe(true)
    }
  })

  it('still skips unrelated, senior and far-away jobs', () => {
    const skip = [
      scoreLead({ title: 'Delivery Driver', location: 'Newark, NJ' }, resumeOnly),
      scoreLead({ title: 'Registered Nurse', location: 'New York, NY' }, resumeOnly),
      scoreLead({ title: 'Senior Data Analyst', location: 'New York, NY' }, resumeOnly),
      scoreLead({ title: 'Data Analyst', location: 'Austin, TX' }, resumeOnly),
    ]
    for (const m of skip) expect(isRecommended(m)).toBe(false)
  })
})
