import { describe, expect, it, vi } from 'vitest'
import { autofillMessage, openApplication } from './autofill'

function fakeWindow(withExtension: boolean) {
  const dataset: Record<string, string> = withExtension ? { jobAutofill: '1' } : {}
  return {
    document: { documentElement: { dataset } },
    location: { origin: 'https://keithwong8294.github.io' },
    postMessage: vi.fn(),
    open: vi.fn(),
  } as unknown as Window & { postMessage: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> }
}

const job = {
  title: 'IT Support Specialist',
  company: 'Acme',
  location: 'Red Bank, NJ',
  pay: { text: '$55K-$62K', minAnnual: 55000, maxAnnual: 62000 },
}

describe('openApplication', () => {
  it('hands the job to the autofill extension when it is installed', () => {
    const w = fakeWindow(true)
    expect(openApplication('https://www.linkedin.com/jobs/view/1/', job, w)).toBe('autofill')
    expect(w.postMessage).toHaveBeenCalledWith(
      {
        type: 'job-autofill:open',
        url: 'https://www.linkedin.com/jobs/view/1/',
        job: { title: 'IT Support Specialist', company: 'Acme', location: 'Red Bank, NJ', pay: '$55K-$62K', description: undefined },
      },
      'https://keithwong8294.github.io',
    )
    expect(w.open).not.toHaveBeenCalled()
  })

  it('just opens the posting in a new tab without the extension', () => {
    const w = fakeWindow(false)
    expect(openApplication('https://www.indeed.com/viewjob?jk=1', job, w)).toBe('tab')
    expect(w.open).toHaveBeenCalledWith('https://www.indeed.com/viewjob?jk=1', '_blank', 'noopener')
    expect(w.postMessage).not.toHaveBeenCalled()
  })

  it('sends only plain job fields, not the whole email', () => {
    const msg = autofillMessage('https://x', { ...job, description: 'Help desk' })
    expect(Object.keys(msg.job).sort()).toEqual(['company', 'description', 'location', 'pay', 'title'])
  })
})
