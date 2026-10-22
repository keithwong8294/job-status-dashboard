import placesJson from './places.json'

/** Town → [lat, lng], keyed "town name|ST", for states near NYC (GeoNames, CC BY 4.0). */
const PLACES = placesJson as unknown as Record<string, [number, number]>

const STATE_NAMES: Record<string, string> = {
  'new jersey': 'NJ',
  'new york': 'NY',
  connecticut: 'CT',
  pennsylvania: 'PA',
  delaware: 'DE',
  maryland: 'MD',
  massachusetts: 'MA',
  'rhode island': 'RI',
}

/** Names job boards use that GeoNames spells differently. */
const ALIASES: Record<string, string> = {
  'new york|NY': 'new york city|NY',
  'nyc|NY': 'new york city|NY',
  'long island city|NY': 'queens|NY',
  'staten island|NY': 'staten island|NY',
  'washington|DC': 'washington|DC',
}

/** Metro-area labels LinkedIn uses instead of a town. */
const METROS: [RegExp, string][] = [
  [/new york city metropolitan|greater new york|new york metropolitan/i, 'new york city|NY'],
  [/greater philadelphia|philadelphia metropolitan/i, 'philadelphia|PA'],
  [/greater boston/i, 'boston|MA'],
  [/greater hartford/i, 'hartford|CT'],
  [/greater new haven/i, 'new haven|CT'],
  [/greater trenton|trenton metropolitan/i, 'trenton|NJ'],
  [/greater pittsburgh/i, 'pittsburgh|PA'],
  [/baltimore city|greater baltimore/i, 'baltimore|MD'],
]

const clean = (town: string) =>
  town
    .toLowerCase()
    .replace(/\b(?:township|twp\.?|borough|boro|city of|village of|town of)\b/g, '')
    .replace(/\bst\.? /g, 'saint ')
    .replace(/\bmt\.? /g, 'mount ')
    .replace(/\s+/g, ' ')
    .trim()

function lookup(town: string, state: string): [number, number] | undefined {
  const key = `${clean(town)}|${state}`
  const tries = [ALIASES[key] ?? key, key.replace('saint ', 'st. '), key.replace(/ (?:center|heights|park)\|/, '|')]
  for (const k of tries) if (PLACES[k]) return PLACES[k]
}

/** Finds where a job location string is, if it names a town we know. */
export function locate(location?: string): [number, number] | undefined {
  if (!location) return undefined
  for (const [re, key] of METROS) if (re.test(location)) return PLACES[key]
  // "Edison, NJ", "New York NY US", "Hoboken, New Jersey", "Hybrid in Newark, NJ"
  const m = location.match(
    /([A-Za-z][A-Za-z .'-]*?),?\s+(NJ|NY|CT|PA|DE|MD|MA|RI|DC|new jersey|new york|connecticut|pennsylvania|delaware|maryland|massachusetts|rhode island)\b/i,
  )
  if (!m) return undefined
  const state = m[2].length === 2 ? m[2].toUpperCase() : STATE_NAMES[m[2].toLowerCase()]
  const town = m[1].replace(/^(?:.*\bin |remote |hybrid |on-?site )/i, '')
  return lookup(town, state)
}

/** East of the Hudson and inside the city: Manhattan, Brooklyn, Queens and the Bronx. */
const inNYC = ([lat, lng]: [number, number]) => lat > 40.55 && lat < 40.92 && lng > -74.02 && lng < -73.7

function miles([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(a))
}

export interface Distance {
  miles: number
  minutes: number
}

/**
 * A rough driving estimate: roads run about 1.3× the straight line, average
 * speed rises from ~25 mph on short local trips toward highway speed on long
 * ones, and driving into New York City adds bridge and tunnel traffic.
 */
export function driveFrom(home: [number, number], to: [number, number]): Distance {
  const road = miles(home, to) * 1.3
  const mph = Math.min(55, 25 + road * 0.5)
  const intoCity = inNYC(to) && !inNYC(home)
  return { miles: Math.round(road), minutes: Math.round((road / mph) * 60 + (intoCity ? 20 : 0)) }
}

export function formatDrive(d: Distance): string {
  const time = d.minutes < 60 ? `${d.minutes} min` : `${Math.floor(d.minutes / 60)} hr ${d.minutes % 60 ? `${d.minutes % 60} min` : ''}`.trim()
  return `≈${d.miles} mi, ${time} drive`
}
