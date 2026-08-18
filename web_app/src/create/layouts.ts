import {
  CREATE_FORMAT_SIZE,
  CREATE_FORMATS,
  CREATE_LAYOUTS,
  type CreateFormat,
  type CreateLayout,
} from '@chat/shared'
import {
  COMMON_VARS,
  fitStudioFlowToPage,
  type StudioElement,
  type StudioFlowSpec,
  type StudioFlowTextNode,
  type StudioMetadata,
  type StudioPage,
  type StudioTextElement,
} from '@crismag/create-studio'
import { estimateTextHeight } from './overflow.ts'
import type { ReflectionField, StudioReflectionSource } from './host-adapter.ts'

const FIELD_LABELS: Record<ReflectionField, string> = {
  heart: 'Heart',
  application: 'Application',
  testimony: 'Testimony',
  reflection: 'Reflection',
}

const SECTION_LABELS = {
  content: 'Content',
  heart: 'Heart',
  application: 'Application',
  testimony: 'Testimony',
  verse: 'Verse',
  reflection: 'Reflection',
} as const

export interface LayoutContent {
  title: string
  passage: string
  reference: string
  translation: string
  sourceId: string
  selected: { field: ReflectionField; content: string; authorOrigin: string } | null
  sections: { id: string; label: string; content: string; slot: string; authorOrigin: string }[]
}

export function layoutContent(
  source: StudioReflectionSource,
  passageText: string,
  reference: string,
  translation: string,
  selectedField: ReflectionField | null,
  includeEmpty = false,
): LayoutContent {
  const selected = selectedField
    ? {
      field: selectedField,
      content: selectedField === 'reflection'
        ? source.condensed.reflection.content
        : source.sections[selectedField].content,
      authorOrigin: selectedField === 'reflection'
        ? source.condensed.reflection.authorOrigin
        : source.sections[selectedField].authorOrigin,
    }
    : null
  const sections = source.format === 'condensed'
    ? [
      { id: 'verse', label: SECTION_LABELS.verse, content: passageText || source.condensed.verse.content, slot: 'scripture.passage', authorOrigin: source.condensed.verse.authorOrigin },
      { id: 'reflection', label: SECTION_LABELS.reflection, content: source.condensed.reflection.content, slot: 'reflection.reflection', authorOrigin: source.condensed.reflection.authorOrigin },
    ]
    : [
      { id: 'content', label: SECTION_LABELS.content, content: source.sections.content.content, slot: 'reflection.content', authorOrigin: source.sections.content.authorOrigin },
      { id: 'heart', label: SECTION_LABELS.heart, content: source.sections.heart.content, slot: 'reflection.heart', authorOrigin: source.sections.heart.authorOrigin },
      { id: 'application', label: SECTION_LABELS.application, content: source.sections.application.content, slot: 'reflection.application', authorOrigin: source.sections.application.authorOrigin },
      { id: 'testimony', label: SECTION_LABELS.testimony, content: source.sections.testimony.content, slot: 'reflection.testimony', authorOrigin: source.sections.testimony.authorOrigin },
    ]
  return {
    title: source.title,
    passage: passageText || source.sections.content.content.trim() || source.condensed.verse.content.trim() || 'Add a saved passage to this reflection.',
    reference,
    translation,
    sourceId: source.id,
    selected,
    sections: sections.filter((section) => includeEmpty || section.content.trim().length > 0),
  }
}

function textElement(
  id: string,
  text: string,
  geometry: StudioTextElement['geometry'],
  layerIndex: number,
  options: Partial<Pick<StudioTextElement, 'fontSize' | 'fontWeight' | 'color' | 'textAlign' | 'lineHeight'>> & {
    metadata: StudioMetadata
    name: string
    overflow?: 'warn' | 'shrink'
    minimumFontSize?: number
  },
): StudioTextElement {
  return {
    id,
    kind: 'text',
    name: options.name,
    text,
    geometry,
    opacity: 1,
    isVisible: true,
    isLocked: false,
    layerIndex,
    fontFamily: 'Georgia, serif',
    fontSize: options.fontSize ?? 42,
    fontWeight: options.fontWeight ?? 400,
    color: options.color ?? '#2b241c',
    textAlign: options.textAlign ?? 'left',
    lineHeight: options.lineHeight ?? 1.25,
    metadata: {
      ...options.metadata,
      ...(options.minimumFontSize ? { minimumFontSize: options.minimumFontSize } : {}),
      ...(options.overflow ? { overflowResolution: options.overflow } : {}),
    },
  }
}

function overlay(width: number, height: number): StudioElement {
  return {
    id: 'card.overlay',
    kind: 'rectangle',
    name: 'Photographic overlay',
    geometry: { x: 0, y: 0, width, height, rotation: 0 },
    opacity: 0,
    isVisible: false,
    isLocked: true,
    layerIndex: 0,
    fill: '#1a0c08',
    stroke: 'transparent',
    strokeWidth: 0,
    metadata: { semanticSlot: 'style.overlay' },
  }
}

function pageLabel(width: number, layerIndex: number): StudioTextElement {
  return textElement(
    'card.page-label',
    '1 / 1',
    { x: width - 200, y: 28, width: 128, height: 28, rotation: 0 },
    layerIndex,
    { name: 'Page', fontSize: 18, fontWeight: 600, textAlign: 'right', metadata: { semanticSlot: 'layout.page-label' } },
  )
}

function panel(id: string, geometry: StudioTextElement['geometry'], layerIndex: number, slot: string): StudioElement {
  return {
    id,
    kind: 'rounded-rectangle',
    name: 'Panel',
    geometry,
    opacity: 1,
    isVisible: true,
    isLocked: false,
    layerIndex,
    fill: '#fffaf2',
    stroke: '#d9cbb8',
    strokeWidth: 2,
    cornerRadius: 32,
    metadata: { semanticSlot: slot },
  }
}

interface PageCursor {
  width: number
  height: number
  y: number
  elements: StudioElement[]
}

function startPage(width: number, height: number): PageCursor {
  const elements = [overlay(width, height)]
  elements.push(pageLabel(width, elements.length))
  return { width, height, y: 56, elements }
}

function footerY(height: number): number {
  return height - 44
}

function push(cursor: PageCursor, element: StudioElement): void {
  cursor.elements.push({ ...element, layerIndex: cursor.elements.length })
}

function finishPage(cursor: PageCursor, id: string, format: CreateFormat, layout: CreateLayout): StudioPage {
  return {
    id,
    width: cursor.width,
    height: cursor.height,
    background: { kind: 'solid', color: '#f6efe4' },
    elements: cursor.elements.map((element, layerIndex) => ({
      ...element,
      id: `${id}.${element.id}`,
      layerIndex,
    })),
    metadata: { format, layout },
  }
}

function addTitle(cursor: PageCursor, title: string, sourceId: string): void {
  const height = estimateTextHeight(title, cursor.width - 160, 34)
  push(cursor, textElement(
    'card.title',
    title,
    { x: 80, y: cursor.y, width: cursor.width - 160, height, rotation: 0 },
    cursor.elements.length,
    { name: 'Title', fontSize: 34, fontWeight: 600, overflow: 'shrink', minimumFontSize: 22, metadata: { semanticSlot: 'reflection.title', sourceReflectionId: sourceId } },
  ))
  cursor.y += height + 18
}

export function usesSelectedField(layout: CreateLayout): boolean {
  return layout === CREATE_LAYOUTS.QUOTE_FOCUS || layout === CREATE_LAYOUTS.VERSE_REFLECTION
}

export function buildLayoutPages(
  layout: CreateLayout,
  format: CreateFormat,
  content: LayoutContent,
): StudioPage[] {
  const size = CREATE_FORMAT_SIZE[format]
  if (layout === CREATE_LAYOUTS.QUOTE_FOCUS) return quoteFocus(size, format, content)
  if (layout === CREATE_LAYOUTS.CHAT_TWO_COLUMN) return twoColumn(size, format, content)
  if (layout === CREATE_LAYOUTS.CHAT_STACKED) return stacked(size, format, content)
  return verseReflection(size, format, content)
}

function quoteFocus(
  size: { width: number; height: number },
  format: CreateFormat,
  content: LayoutContent,
): StudioPage[] {
  const cursor = startPage(size.width, size.height)
  addTitle(cursor, content.title, content.sourceId)
  const quote = content.selected?.content.trim() || content.passage
  const caption = `${content.reference}${content.translation ? ` · ${content.translation}` : ''}`
  const boxTop = cursor.y
  const boxHeight = footerY(size.height) - boxTop - 90
  push(cursor, panel('card.quote-panel', { x: 72, y: boxTop, width: size.width - 144, height: boxHeight, rotation: 0 }, cursor.elements.length, 'layout.quote-panel'))
  const quoteHeight = Math.min(boxHeight - 120, estimateTextHeight(quote, size.width - 280, 48))
  push(cursor, textElement(
    'card.quote',
    quote,
    { x: 140, y: boxTop + 48, width: size.width - 280, height: quoteHeight, rotation: 0 },
    cursor.elements.length,
    {
      name: content.selected ? FIELD_LABELS[content.selected.field] : 'Quote',
      fontSize: 48,
      textAlign: 'center',
      overflow: 'shrink',
      minimumFontSize: 28,
      metadata: {
        semanticSlot: content.selected ? `reflection.${content.selected.field}` : 'scripture.passage',
        sourceReflectionId: content.sourceId,
        ...(content.selected ? { authorOrigin: content.selected.authorOrigin } : {}),
      },
    },
  ))
  push(cursor, textElement(
    'card.reference',
    caption,
    { x: 140, y: boxTop + boxHeight - 64, width: size.width - 280, height: 40, rotation: 0 },
    cursor.elements.length,
    { name: 'Scripture reference', fontSize: 22, fontWeight: 600, textAlign: 'center', overflow: 'warn', minimumFontSize: 16, metadata: { semanticSlot: 'scripture.reference', translation: content.translation } },
  ))
  return [finishPage(cursor, 'page.1', format, CREATE_LAYOUTS.QUOTE_FOCUS)]
}

function verseReflection(
  size: { width: number; height: number },
  format: CreateFormat,
  content: LayoutContent,
): StudioPage[] {
  const cursor = startPage(size.width, size.height)
  addTitle(cursor, content.title, content.sourceId)
  const passageHeight = Math.min(format === CREATE_FORMATS.PORTRAIT ? 420 : 330, estimateTextHeight(content.passage, size.width - 240, 42))
  const reference = `${content.reference}${content.translation ? ` · ${content.translation}` : ''}`
  const referenceHeight = estimateTextHeight(reference, size.width - 240, 24)
  const panelHeight = passageHeight + referenceHeight + 70
  push(cursor, panel('card.passage-panel', { x: 72, y: cursor.y, width: size.width - 144, height: panelHeight, rotation: 0 }, cursor.elements.length, 'layout.passage-panel'))
  push(cursor, textElement(
    'card.passage',
    content.passage,
    { x: 120, y: cursor.y + 28, width: size.width - 240, height: passageHeight, rotation: 0 },
    cursor.elements.length,
    { name: 'Scripture passage', fontSize: 42, overflow: 'shrink', minimumFontSize: 26, metadata: { semanticSlot: 'scripture.passage' } },
  ))
  push(cursor, textElement(
    'card.reference',
    reference,
    { x: 120, y: cursor.y + 36 + passageHeight, width: size.width - 240, height: referenceHeight, rotation: 0 },
    cursor.elements.length,
    { name: 'Scripture reference', fontSize: 24, fontWeight: 600, textAlign: 'right', overflow: 'warn', minimumFontSize: 16, metadata: { semanticSlot: 'scripture.reference', translation: content.translation } },
  ))
  cursor.y += panelHeight + 36
  if (content.selected) {
    const labelHeight = estimateTextHeight(FIELD_LABELS[content.selected.field], size.width - 176, 21)
    push(cursor, textElement(
      'card.reflection-label',
      FIELD_LABELS[content.selected.field],
      { x: 88, y: cursor.y, width: size.width - 176, height: labelHeight, rotation: 0 },
      cursor.elements.length,
      { name: `${FIELD_LABELS[content.selected.field]} label`, fontSize: 21, fontWeight: 600, metadata: { semanticSlot: `reflection.${content.selected.field}.label` } },
    ))
    cursor.y += labelHeight + 12
    const bodyHeight = Math.max(120, footerY(size.height) - cursor.y)
    push(cursor, textElement(
      'card.reflection',
      content.selected.content,
      { x: 88, y: cursor.y, width: size.width - 176, height: bodyHeight, rotation: 0 },
      cursor.elements.length,
      {
        name: FIELD_LABELS[content.selected.field],
        fontSize: 34,
        overflow: 'shrink',
        minimumFontSize: 22,
        metadata: {
          semanticSlot: `reflection.${content.selected.field}`,
          authorOrigin: content.selected.authorOrigin,
          sourceReflectionId: content.sourceId,
        },
      },
    ))
  }
  return [finishPage(cursor, 'page.1', format, CREATE_LAYOUTS.VERSE_REFLECTION)]
}

function stacked(
  size: { width: number; height: number },
  format: CreateFormat,
  content: LayoutContent,
  idStart = 1,
): StudioPage[] {
  const layout = COMMON_VARS.layout
  const children: StudioFlowTextNode[] = [
    {
      kind: 'text',
      id: 'card.title',
      slot: 'reflection.title',
      text: content.title || 'Untitled reflection',
      role: 'headline',
      priority: 'essential',
      typographyGroup: 'headline',
      typography: layout.headline,
      fontWeight: 600,
      name: 'Title',
      metadata: { sourceReflectionId: content.sourceId },
    },
  ]
  const reference = `${content.reference}${content.translation ? ` · ${content.translation}` : ''}`.trim()
  if (reference) {
    children.push({
      kind: 'text',
      id: 'card.reference',
      slot: 'scripture.reference',
      text: reference,
      role: 'caption',
      priority: 'important',
      typographyGroup: 'caption',
      typography: layout.caption,
      fontWeight: 600,
      name: 'Scripture reference',
      metadata: { translation: content.translation },
    })
  }
  const passage = content.passage.trim()
  const contentText = content.sections.find((section) => section.id === 'content')?.content.trim() ?? ''
  if (passage && passage !== contentText && passage.length <= 280 && passage !== 'Add a saved passage to this reflection.') {
    children.push({
      kind: 'text',
      id: 'card.passage',
      slot: 'scripture.passage',
      text: passage,
      role: 'caption',
      priority: 'important',
      typographyGroup: 'caption',
      typography: { ...layout.caption, maximumLines: 3 },
      name: 'Scripture passage',
    })
  }

  for (const section of content.sections) {
    const body = section.content.trim() || (section.id === 'content' ? passage : '')
    children.push({
      kind: 'text',
      id: `card.${section.id}.label`,
      slot: `${section.slot}.label`,
      text: section.label,
      role: 'label',
      priority: 'essential',
      typographyGroup: 'label',
      typography: layout.label,
      fontWeight: 600,
      name: `${section.label} label`,
    })
    children.push({
      kind: 'text',
      id: `card.${section.id}`,
      slot: section.slot,
      text: body,
      role: 'body',
      priority: 'essential',
      grow: true,
      typographyGroup: 'body',
      typography: layout.body,
      name: section.label,
      metadata: { authorOrigin: section.authorOrigin, sourceReflectionId: content.sourceId },
    })
  }

  const spec: StudioFlowSpec = {
    page: {
      id: `page.${idStart}`,
      width: size.width,
      height: size.height,
      background: { kind: 'solid', color: '#f6efe4' },
    },
    direction: 'vertical',
    fit: 'page',
    padding: layout.padding,
    gap: layout.gap,
    children,
    fontFamily: 'Georgia, serif',
  }
  const fitted = fitStudioFlowToPage(spec)
  const overlayElement = overlay(size.width, size.height)
  const elements: StudioElement[] = [
    overlayElement,
    ...fitted.page.elements.map((element, layerIndex) => ({
      ...element,
      id: `${fitted.page.id}.${element.id}`,
      layerIndex: layerIndex + 1,
    })),
  ]
  return [{
    ...fitted.page,
    elements,
    metadata: {
      ...fitted.page.metadata,
      format,
      layout: CREATE_LAYOUTS.CHAT_STACKED,
      fitted: fitted.fitted,
      density: fitted.profile.density,
    },
  }]
}

function twoColumn(
  size: { width: number; height: number },
  format: CreateFormat,
  content: LayoutContent,
): StudioPage[] {
  const cursor = startPage(size.width, size.height)
  addTitle(cursor, content.title, content.sourceId)
  const reference = `${content.reference}${content.translation ? ` · ${content.translation}` : ''}`
  push(cursor, textElement(
    'card.reference',
    reference,
    { x: 80, y: cursor.y, width: size.width - 160, height: 32, rotation: 0 },
    cursor.elements.length,
    { name: 'Scripture reference', fontSize: 22, fontWeight: 600, textAlign: 'right', overflow: 'warn', minimumFontSize: 16, metadata: { semanticSlot: 'scripture.reference', translation: content.translation } },
  ))
  cursor.y += 48
  const gutter = 28
  const columnWidth = (size.width - 144 - gutter) / 2
  const columnHeight = footerY(size.height) - cursor.y
  const leftX = 72
  const rightX = 72 + columnWidth + gutter
  const left = content.sections[0]
  const right = content.sections.slice(1)
  push(cursor, panel('card.left-panel', { x: leftX, y: cursor.y, width: columnWidth, height: columnHeight, rotation: 0 }, cursor.elements.length, 'layout.passage-panel'))
  push(cursor, panel('card.right-panel', { x: rightX, y: cursor.y, width: columnWidth, height: columnHeight, rotation: 0 }, cursor.elements.length, 'layout.reflection-panel'))
  if (left) {
    push(cursor, textElement(
      `card.${left.id}.label`,
      left.label,
      { x: leftX + 24, y: cursor.y + 24, width: columnWidth - 48, height: 28, rotation: 0 },
      cursor.elements.length,
      { name: `${left.label} label`, fontSize: 18, fontWeight: 600, metadata: { semanticSlot: `${left.slot}.label` } },
    ))
    push(cursor, textElement(
      `card.${left.id}`,
      left.content,
      { x: leftX + 24, y: cursor.y + 60, width: columnWidth - 48, height: columnHeight - 84, rotation: 0 },
      cursor.elements.length,
      {
        name: left.label,
        fontSize: 28,
        overflow: 'shrink',
        minimumFontSize: 18,
        metadata: { semanticSlot: left.slot, authorOrigin: left.authorOrigin, sourceReflectionId: content.sourceId },
      },
    ))
  }
  let rightY = cursor.y + 24
  const rightBottom = cursor.y + columnHeight - 24
  for (const section of right) {
    const remaining = rightBottom - rightY
    if (remaining < 80) break
    push(cursor, textElement(
      `card.${section.id}.label`,
      section.label,
      { x: rightX + 24, y: rightY, width: columnWidth - 48, height: 26, rotation: 0 },
      cursor.elements.length,
      { name: `${section.label} label`, fontSize: 18, fontWeight: 600, metadata: { semanticSlot: `${section.slot}.label` } },
    ))
    rightY += 30
    const bodyHeight = Math.min(remaining - 40, Math.max(70, estimateTextHeight(section.content, columnWidth - 48, 24)))
    push(cursor, textElement(
      `card.${section.id}`,
      section.content,
      { x: rightX + 24, y: rightY, width: columnWidth - 48, height: bodyHeight, rotation: 0 },
      cursor.elements.length,
      {
        name: section.label,
        fontSize: 24,
        overflow: 'shrink',
        minimumFontSize: 16,
        metadata: { semanticSlot: section.slot, authorOrigin: section.authorOrigin, sourceReflectionId: content.sourceId },
      },
    ))
    rightY += bodyHeight + 16
  }
  const pages = [finishPage(cursor, 'page.1', format, CREATE_LAYOUTS.CHAT_TWO_COLUMN)]
  const placedSlots = new Set(
    pages[0]?.elements
      .filter((element) => element.kind === 'text')
      .map((element) => element.metadata?.['semanticSlot'])
      ?? [],
  )
  const missing = right.filter((section) => !placedSlots.has(section.slot))
  if (missing.length > 0) {
    pages.push(...stacked(size, format, { ...content, sections: missing }, 2).map((page) => ({
      ...page,
      metadata: { ...page.metadata, layout: CREATE_LAYOUTS.CHAT_TWO_COLUMN },
    })))
  }
  return pages
}
