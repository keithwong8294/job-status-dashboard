// Builds src/places.json, town → [lat, lng] for states near NYC, from two npm data sets:
// GeoNames towns (cities.json, CC BY 4.0) and ZIP code towns (zipcodes, BSD), which
// cover the many New Jersey townships GeoNames leaves out.
// Usage: node scripts/build-places.mjs path/to/cities.json path/to/zipcodes/lib/codes.js
import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'

// States within driving range of the NYC area; farther jobs just show as far away.
const STATES = ['NJ', 'NY', 'CT', 'PA', 'DE', 'MD', 'MA', 'RI', 'DC']
const round = (n) => Number(Number(n).toFixed(3))
const out = {}

for (const c of JSON.parse(readFileSync(process.argv[2], 'utf8'))) {
  if (c.country !== 'US' || !STATES.includes(c.admin1)) continue
  // Keep the first entry when a state has two towns with one name.
  out[`${c.name.toLowerCase()}|${c.admin1}`] ??= [round(c.lat), round(c.lng)]
}

// A town with several ZIP codes goes at their average.
const zips = {}
const codes = createRequire(import.meta.url)(process.argv[3])
for (const z of Object.values(codes.codes ?? codes)) {
  if (!STATES.includes(z.state) || !z.latitude) continue
  const key = `${z.city.toLowerCase()}|${z.state}`
  ;(zips[key] ??= []).push([z.latitude, z.longitude])
}
for (const [key, points] of Object.entries(zips)) {
  out[key] ??= [round(points.reduce((s, p) => s + p[0], 0) / points.length), round(points.reduce((s, p) => s + p[1], 0) / points.length)]
}

// Townships that share a ZIP code with a neighbor, so neither list names them.
const EXTRA = { 'manalapan|NJ': [40.28, -74.343] }
for (const [key, point] of Object.entries(EXTRA)) out[key] ??= point

writeFileSync(new URL('../src/places.json', import.meta.url), JSON.stringify(out))
console.log(Object.keys(out).length, 'places')
