import {
  analyzeStudioTextOverflow,
  measureStudioTextBlock,
  resolveStudioTextOverflow,
  type StudioDocument,
  type StudioElement,
  type StudioTextElement,
} from '@crismag/create-studio'

export function estimateTextHeight(text: string, width: number, fontSize: number, lineHeight = 1.25): number {
  const charactersPerLine = Math.max(1, Math.floor(width / (fontSize * 0.52)))
  const lines = text.split('\n').reduce(
    (total, paragraph) => total + Math.max(1, Math.ceil(paragraph.length / charactersPerLine)),
    0,
  )
  return Math.ceil(lines * fontSize * lineHeight)
}

function isText(element: StudioElement): element is StudioTextElement {
  return element.kind === 'text'
}

function slotOf(element: StudioElement): string {
  return typeof element.metadata?.['semanticSlot'] === 'string' ? element.metadata['semanticSlot'] : ''
}

function cloneDocument(document: StudioDocument): StudioDocument {
  return JSON.parse(JSON.stringify(document)) as StudioDocument
}

function splitAtBudget(text: string, element: StudioTextElement): { kept: string; rest: string } {
  if (!analyzeStudioTextOverflow({ ...element, text }).overflows) return { kept: text, rest: '' }
  let low = 1
  let high = text.length
  let fit = 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (analyzeStudioTextOverflow({ ...element, text: text.slice(0, mid) }).overflows) high = mid - 1
    else {
      fit = mid
      low = mid + 1
    }
  }
  const window = text.slice(0, fit)
  const breakAt = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '))
  const kept = (breakAt >= Math.floor(fit * 0.6) ? window.slice(0, breakAt) : window).trimEnd()
  const rest = text.slice(kept.length).trimStart()
  if (!kept) {
    const forced = text.slice(0, Math.max(1, fit))
    return { kept: forced, rest: text.slice(forced.length) }
  }
  return { kept, rest }
}

function continuationPage(
  source: StudioDocument['pages'][number],
  overflowing: StudioTextElement,
  rest: string,
  pageId: string,
): StudioDocument['pages'][number] {
  const chrome = source.elements.filter((element) => {
    const slot = slotOf(element)
    return slot === 'style.overlay' || slot === 'reflection.title' || slot === 'layout.page-label'
  })
  const top = 180
  const bottomReserved = 80
  const body: StudioTextElement = {
    ...overflowing,
    id: `${pageId}.body`,
    text: rest,
    geometry: {
      ...overflowing.geometry,
      x: 88,
      y: top,
      width: source.width - 176,
      height: Math.max(120, source.height - top - bottomReserved),
    },
    metadata: { ...overflowing.metadata, continuedFrom: overflowing.id },
  }
  const elements = [...chrome, body].map((element, layerIndex) => ({
    ...element,
    id: element.id.startsWith(pageId) ? element.id : `${pageId}.${element.id}`,
    layerIndex,
  }))
  return {
    ...source,
    id: pageId,
    elements,
    metadata: { ...source.metadata, continuedFrom: overflowing.id },
  }
}

/** Shrink text to the template minimum, then split leftover words onto following pages. */
export function fitChatStudioDocument(document: StudioDocument): {
  document: StudioDocument
  overflowRemaining: { elementId: string; pageId: string }[]
} {
  let next = cloneDocument(document)
  for (const page of next.pages) {
    for (const element of page.elements) {
      if (!isText(element)) continue
      if (element.metadata?.['overflowResolution'] !== 'shrink') continue
      next = resolveStudioTextOverflow(next, page.id, element.id).document
    }
  }

  const pages = [...next.pages]
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    if (!page) continue
    for (const element of page.elements) {
      if (!isText(element) || !analyzeStudioTextOverflow(element).overflows) continue
      if (element.metadata?.['overflowResolution'] === 'warn') continue
      const { kept, rest } = splitAtBudget(element.text, element)
      element.text = kept
      if (!rest) continue
      pages.splice(index + 1, 0, continuationPage(page, element, rest, `${page.id}-continued-${index}`))
    }
  }

  next = { ...next, pages: numberPages(pages) }
  return { document: next, overflowRemaining: collectOverflowingText(next) }
}

function numberPages(pages: StudioDocument['pages']): StudioDocument['pages'] {
  const total = pages.length
  return pages.map((page, index) => ({
    ...page,
    metadata: { ...page.metadata, page: index + 1, pageCount: total },
    elements: page.elements.map((element) => {
      if (isText(element) && slotOf(element) === 'layout.page-label') {
        return { ...element, text: `${index + 1} / ${total}`, isVisible: total > 1 }
      }
      return element
    }),
  }))
}

export function collectOverflowingText(document: StudioDocument): { elementId: string; pageId: string }[] {
  return document.pages.flatMap((page) => page.elements
    .filter(isText)
    .filter((element) => {
      const metrics = measureStudioTextBlock({
        text: element.text,
        width: element.geometry.width,
        fontSize: element.fontSize,
        lineHeight: element.lineHeight,
        fontFamily: element.fontFamily,
        fontWeight: element.fontWeight,
      })
      const availableLines = Math.max(1, Math.floor(element.geometry.height / (element.fontSize * element.lineHeight)))
      return metrics.lines > availableLines
    })
    .map((element) => ({ elementId: element.id, pageId: page.id })))
}
