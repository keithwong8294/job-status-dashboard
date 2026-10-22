import { describe, expect, it } from 'vitest'
import { parsePay } from './classify'
import { isRecommended, region, resumeSkills, scoreLead, yearsRequired, type Profile } from './recommend'

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
    for (const m of [senior, far, low]) expect(isRecommended(m)).toBe(false)
  })

  it('ranks a matching job above an unrelated one', () => {
    const it_ = scoreLead({ title: 'IT Support Specialist', location: 'Brooklyn, NY' }, profile)
    const driver = scoreLead({ title: 'Delivery Driver', location: 'Brooklyn, NY' }, profile)
    expect(it_.score).toBeGreaterThan(driver.score + 25)
  })
})
