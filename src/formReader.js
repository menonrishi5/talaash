// Reads dancer positions out of an ArrangeUs forms PDF.
// Works when the PDF has a text layer (names as selectable text). Extracts
// each name's x-position on the first and last page and classifies it into
// stage thirds. Image-only PDFs and PNGs have no text layer — callers get an
// empty result and should tell the user to fill sides manually.

// pdf.js is heavy (~450 KB) and only needed here, so it loads on demand.
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs
}

async function readPageItems(doc, pageNum) {
  const page = await doc.getPage(pageNum)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  return content.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({
      text: i.str.trim(),
      // center-x of the text run, normalized 0..1 across the page
      x: (i.transform[4] + (i.width || 0) / 2) / viewport.width,
    }))
}

export async function readFormPages(url) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument(url).promise
  const first = await readPageItems(doc, 1)
  const last = await readPageItems(doc, doc.numPages)
  return { first, last, numPages: doc.numPages }
}

// Find one member's x-position among a page's text items.
// Tries full name, then first name, then last name — and only accepts a
// match that is unambiguous on that page.
function findMember(items, member) {
  const norm = (s) => s.toLowerCase().trim()
  const full = norm(member.name)
  const words = full.split(/\s+/)
  const tryMatch = (target) => {
    const hits = items.filter((i) => norm(i.text) === target)
    return hits.length === 1 ? hits[0].x : null
  }
  return tryMatch(full) ?? tryMatch(words[0]) ?? (words.length > 1 ? tryMatch(words.at(-1)) : null)
}

// x (0..1) -> 'L' | 'C' | 'R' in PAGE terms; caller maps page->stage.
const classify = (x) => (x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center')

// pageSide -> stage side value used in segments ('L'|'R'|'C'), honoring
// whether the left of the page is stage left (performer view) or stage
// right (audience view).
export function pageToStage(pageSide, leftIsStageLeft) {
  if (pageSide === 'center') return 'C'
  if (pageSide === 'left') return leftIsStageLeft ? 'L' : 'R'
  return leftIsStageLeft ? 'R' : 'L'
}

// Returns [{memberId, name, enterPage, exitPage}] with page-relative sides
// (null when the member couldn't be found unambiguously on that page).
export function detectMemberSides(pages, castMembers) {
  return castMembers.map((m) => {
    const firstX = findMember(pages.first, m)
    const lastX = findMember(pages.last, m)
    return {
      memberId: m.id,
      name: m.name,
      enterPage: firstX === null ? null : classify(firstX),
      exitPage: lastX === null ? null : classify(lastX),
    }
  })
}
