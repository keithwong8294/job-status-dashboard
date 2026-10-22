/** Reads the text out of a PDF in the browser. The file never leaves the page. */
export async function pdfText(file: File): Promise<string> {
  // Loaded on demand: pdf.js is large and only needed when a resume is added.
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join(''))
  }
  return pages.join('\n').replace(/[ \t]+/g, ' ').trim()
}
