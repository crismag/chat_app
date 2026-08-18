import type {
  BiblePassage,
  ChatSection,
  ChatSectionType,
  CondensedSection,
  CondensedSectionType,
} from '@chat/shared'
import {
  STUDIO_DOCUMENT_SCHEMA_VERSION,
  type StudioDocument,
  type StudioElement,
  type StudioMetadata,
  type StudioTextElement,
} from '@crismag/create-studio'

export const CHAT_SQUARE_TEMPLATE = { id: 'chat.square-reflection', version: 1 } as const

/**
 * Host policy for the square verse-plus-reflection card. Pages, drawing,
 * callouts and Studio's built-in templates stay off until C.H.A.T. maps
 * those layouts itself. Generated backgrounds remain available through the
 * host callback when the API has a provider.
 */
export const CHAT_STUDIO_CAPABILITIES = {
  images: false,
  imageAdjustments: false,
  lines: false,
  pages: false,
  groups: false,
  drawing: false,
  callouts: false,
} as const

export const CHAT_STUDIO_TEMPLATES = [] as const

export type ReflectionField = 'heart' | 'application' | 'testimony' | 'reflection'

export interface StudioReflectionSource {
  id: string
  format?: 'full' | 'condensed'
  title: string
  scriptureReference: string | null
  updatedAt: string
  sections: Record<ChatSectionType, ChatSection>
  condensed: Record<CondensedSectionType, CondensedSection>
}

const FIELD_LABELS: Record<ReflectionField, string> = {
  heart: 'Heart',
  application: 'Application',
  testimony: 'Testimony',
  reflection: 'Reflection',
}

function textElement(
  id: string,
  text: string,
  geometry: StudioTextElement['geometry'],
  layerIndex: number,
  options: Partial<Pick<StudioTextElement, 'fontSize' | 'fontWeight' | 'color' | 'textAlign' | 'lineHeight'>> & {
    metadata: StudioMetadata
    name: string
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
    metadata: options.metadata,
  }
}

function textHeight(text: string, width: number, fontSize: number, lineHeight = 1.25): number {
  const charactersPerLine = Math.max(1, Math.floor(width / (fontSize * 0.52)))
  const lines = text.split('\n').reduce(
    (total, paragraph) => total + Math.max(1, Math.ceil(paragraph.length / charactersPerLine)),
    0,
  )
  return Math.ceil(lines * fontSize * lineHeight)
}

export function availableReflectionFields(source: StudioReflectionSource): ReflectionField[] {
  if (source.format === 'condensed') {
    return source.condensed.reflection.content.trim() ? ['reflection'] : []
  }
  return (['heart', 'application', 'testimony'] as const).filter(
    (field) => source.sections[field].content.trim().length > 0,
  )
}

export function defaultReflectionField(source: StudioReflectionSource): ReflectionField | null {
  return availableReflectionFields(source)[0] ?? null
}

function fieldValue(source: StudioReflectionSource, field: ReflectionField | null) {
  if (!field) return null
  const section = field === 'reflection' ? source.condensed.reflection : source.sections[field]
  return { field, content: section.content, authorOrigin: section.authorOrigin }
}

/**
 * Map C.H.A.T.-owned meaning into neutral Studio elements. Create Studio never
 * receives application types; source identity and authorship remain metadata.
 */
export function buildChatStudioDocument(
  source: StudioReflectionSource,
  passage: BiblePassage | null,
  selectedField: ReflectionField | null = defaultReflectionField(source),
): StudioDocument {
  const reflection = fieldValue(source, selectedField)
  const passageText = passage?.content.trim() || source.sections.content.content.trim() || source.condensed.verse.content.trim()
  const reference = passage?.reference || source.scriptureReference || 'Scripture reflection'
  const translation = passage?.abbreviation ?? ''
  const elements: StudioElement[] = []
  const passageDisplay = passageText || 'Add a saved passage to this reflection.'
  const passageHeight = Math.min(330, textHeight(passageDisplay, 840, 42))
  const referenceDisplay = `${reference}${translation ? ` · ${translation}` : ''}`
  const referenceHeight = textHeight(referenceDisplay, 840, 24)
  const referenceY = 218 + passageHeight + 20
  const panelHeight = referenceY + referenceHeight + 28 - 176
  const reflectionLabelY = 176 + panelHeight + 54
  const reflectionY = reflectionLabelY + 46

  elements.push({
    id: 'card.accent',
    kind: 'rounded-rectangle',
    name: 'Passage panel',
    geometry: { x: 72, y: 176, width: 936, height: panelHeight, rotation: 0 },
    opacity: 1,
    isVisible: true,
    isLocked: false,
    layerIndex: elements.length,
    fill: '#fffaf2',
    stroke: '#d9cbb8',
    strokeWidth: 2,
    cornerRadius: 32,
    metadata: { semanticSlot: 'layout.passage-panel' },
  })
  elements.push(textElement(
    'card.title',
    source.title,
    { x: 80, y: 66, width: 920, height: textHeight(source.title, 920, 34), rotation: 0 },
    elements.length,
    { name: 'Title', fontSize: 34, fontWeight: 600, metadata: { semanticSlot: 'reflection.title', sourceReflectionId: source.id } },
  ))
  elements.push(textElement(
    'card.passage',
    passageDisplay,
    { x: 120, y: 218, width: 840, height: passageHeight, rotation: 0 },
    elements.length,
    {
      name: 'Scripture passage',
      fontSize: 42,
      metadata: {
        semanticSlot: 'scripture.passage',
        source: passage ? 'saved-passage' : 'reflection-field',
        ...(passage ? { provider: passage.provider, passageId: passage.passageId, translationId: passage.translationId } : {}),
      },
    },
  ))
  elements.push(textElement(
    'card.reference',
    referenceDisplay,
    { x: 120, y: referenceY, width: 840, height: referenceHeight, rotation: 0 },
    elements.length,
    { name: 'Scripture reference', fontSize: 24, fontWeight: 600, textAlign: 'right', metadata: { semanticSlot: 'scripture.reference', translation } },
  ))

  if (reflection) {
    elements.push(textElement(
      'card.reflection-label',
      FIELD_LABELS[reflection.field],
      { x: 88, y: reflectionLabelY, width: 904, height: textHeight(FIELD_LABELS[reflection.field], 904, 21), rotation: 0 },
      elements.length,
      { name: `${FIELD_LABELS[reflection.field]} label`, fontSize: 21, fontWeight: 600, color: '#7b5d3e', metadata: { semanticSlot: `reflection.${reflection.field}.label` } },
    ))
    elements.push(textElement(
      'card.reflection',
      reflection.content,
      { x: 88, y: reflectionY, width: 904, height: Math.min(250, textHeight(reflection.content, 904, 34)), rotation: 0 },
      elements.length,
      {
        name: FIELD_LABELS[reflection.field],
        fontSize: 34,
        metadata: {
          semanticSlot: `reflection.${reflection.field}`,
          authorOrigin: reflection.authorOrigin,
          sourceReflectionId: source.id,
        },
      },
    ))
  }

  if (passage?.copyright) {
    elements.push(textElement(
      'card.attribution',
      passage.copyright,
      { x: 88, y: 1020, width: 904, height: Math.min(34, textHeight(passage.copyright, 904, 14)), rotation: 0 },
      elements.length,
      { name: 'Translation attribution', fontSize: 14, color: '#6d6256', textAlign: 'center', metadata: { semanticSlot: 'scripture.attribution' } },
    ))
  }

  return {
    schemaVersion: STUDIO_DOCUMENT_SCHEMA_VERSION,
    id: `chat.studio.${source.id}`,
    title: `${source.title} image`,
    metadata: {
      sourceApplication: 'chat_app',
      sourceReflectionId: source.id,
      sourceUpdatedAt: source.updatedAt,
      templateId: CHAT_SQUARE_TEMPLATE.id,
      templateVersion: CHAT_SQUARE_TEMPLATE.version,
      ...(selectedField ? { selectedField } : {}),
    },
    pages: [{
      id: 'page.square',
      width: 1080,
      height: 1080,
      background: { kind: 'solid', color: '#f6efe4' },
      elements,
      metadata: { format: 'square' },
    }],
  }
}
