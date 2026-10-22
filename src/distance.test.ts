import { describe, expect, it } from 'vitest'
import { driveFrom, formatDrive, locate } from './distance'

describe('drive estimates', () => {
  const home = locate('Princeton, NJ')!

  it('finds towns in the formats job boards use', () => {
    for (const where of ['Edison, NJ', 'New York NY US', 'Hoboken, New Jersey', 'New York City Metropolitan Area', 'Hybrid in Newark, NJ', 'Woodbridge Township, NJ', 'Stamford, CT'])
      expect(locate(where), where).toBeDefined()
    expect(locate('Remote')).toBeUndefined()
    expect(locate('Austin, TX')).toBeUndefined()
  })

  it('gives sensible miles and minutes', () => {
    const near = driveFrom(home, locate('New Brunswick, NJ')!)
    const city = driveFrom(home, locate('New York, NY')!)
    expect(near.miles).toBeGreaterThan(10)
    expect(near.miles).toBeLessThan(25)
    expect(city.miles).toBeGreaterThan(45)
    expect(city.minutes).toBeGreaterThan(near.minutes + 40)
    expect(formatDrive({ miles: 40, minutes: 75 })).toBe('≈40 mi, 1 hr 15 min drive')
  })
})
