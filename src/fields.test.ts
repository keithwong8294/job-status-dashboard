import { describe, expect, it } from 'vitest'
import { fieldOf, placeOf, titleGroup } from './fields'

describe('lead categories', () => {
  it('sorts titles into fields', () => {
    expect(fieldOf('Help Desk Technician')).toBe('IT support')
    expect(fieldOf('IT Support Engineer')).toBe('IT support')
    expect(fieldOf('Junior Data Analyst')).toBe('Data & analytics')
    expect(fieldOf('Software Engineer - Intern')).toBe('Software & engineering')
    expect(fieldOf('Corporate Recruiter')).toBe('HR & recruiting')
    expect(fieldOf('Entry Level Sales Specialist')).toBe('Sales & business development')
    expect(fieldOf('Customer Service Representative')).toBe('Customer service')
    expect(fieldOf('Executive Assistant')).toBe('Admin & office')
    expect(fieldOf('Seasonal Package Handler')).toBe('Warehouse, retail & food')
    expect(fieldOf('Pharmacy Intern')).toBe('Healthcare & animal care')
    expect(fieldOf('Vet Tech')).toBe('Healthcare & animal care')
    expect(fieldOf('Behavior Technician (RBT)')).toBe('Healthcare & animal care')
    expect(fieldOf('IT Support Specialist - Medical Office')).toBe('IT support')
    expect(fieldOf('Clinical Data Analyst')).toBe('Data & analytics')
    expect(fieldOf('Lifeguard')).toBe('Other')
  })

  it('groups titles that differ only in level or details', () => {
    expect(titleGroup('Junior IT Support Specialist II (Hybrid)')).toBe('IT Support Specialist')
    expect(titleGroup('IT Support Specialist - NYC')).toBe('IT Support Specialist')
    expect(titleGroup('Data Analyst I')).toBe('Data Analyst')
    expect(titleGroup('2027 Summer Intern')).toBe('Intern')
  })

  it('groups locations by town', () => {
    expect(placeOf('Edison, NJ 08817 (Hybrid)')).toBe('Edison, NJ')
    expect(placeOf('New York City, NY (Onsite)')).toBe('New York, NY')
    expect(placeOf('New York NY US')).toBe('New York, NY')
    expect(placeOf('Remote in New Jersey')).toBe('Remote')
    expect(placeOf(undefined)).toBe('Location not listed')
  })
})
