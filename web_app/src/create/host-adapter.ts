import {
  CREATE_FORMATS,
  CREATE_LAYOUTS,
  CREATE_STYLES,
  type BiblePassage,
  type ChatSection,
  type ChatSectionType,
  type CondensedSection,
  type CondensedSectionType,
  type CreateFormat,
  type CreateLayout,
  type CreateStyle,
} from '@chat/shared'
import {
  STUDIO_DOCUMENT_SCHEMA_VERSION,
  type StudioDocument,
} from '@crismag/create-studio'
import { buildLayoutPages, layoutContent, usesSelectedField } from './layouts.ts'
import { fitChatStudioDocument } from './overflow.ts'
import { applyChatStudioStyle } from './styles.ts'

export const CHAT_SQUARE_TEMPLATE = { id: 'chat.square-reflection', version: 2 } as const
export const CHAT_STUDIO_TEMPLATE = CHAT_SQUARE_TEMPLATE

/**
 * Host policy for C.H.A.T. compositions. Drawing, callouts and Studio's
 * built-in templates stay off; pages stay on so overflow can become a carousel.
 */
export const CHAT_STUDIO_CAPABILITIES = {
  images: false,
  imageAdjustments: false,
  lines: false,
  pages: true,
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

export interface ChatStudioComposeOptions {
  layout?: CreateLayout
  style?: CreateStyle
  format?: CreateFormat
  selectedField?: ReflectionField | null
}

export { usesSelectedField }

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

export function readComposeOptions(document: StudioDocument | null): Required<Omit<ChatStudioComposeOptions, 'selectedField'>> & { selectedField: ReflectionField | null } {
  const metadata = document?.metadata ?? {}
  const layout = metadata['layout']
  const style = metadata['style']
  const format = metadata['format']
  const selectedField = metadata['selectedField']
  return {
    layout: typeof layout === 'string' && Object.values(CREATE_LAYOUTS).includes(layout as CreateLayout)
      ? layout as CreateLayout
      : CREATE_LAYOUTS.CHAT_STACKED,
    style: typeof style === 'string' && Object.values(CREATE_STYLES).includes(style as CreateStyle)
      ? style as CreateStyle
      : CREATE_STYLES.CREAM_BOTANICAL,
    format: typeof format === 'string' && Object.values(CREATE_FORMATS).includes(format as CreateFormat)
      ? format as CreateFormat
      : CREATE_FORMATS.PORTRAIT,
    selectedField: typeof selectedField === 'string' && ['heart', 'application', 'testimony', 'reflection'].includes(selectedField)
      ? selectedField as ReflectionField
      : null,
  }
}

/**
 * Map C.H.A.T.-owned meaning into a layout × style × format composition.
 * Create Studio never receives application types.
 */
export function buildChatStudioDocument(
  source: StudioReflectionSource,
  passage: BiblePassage | null,
  selectedField: ReflectionField | null = defaultReflectionField(source),
  options: ChatStudioComposeOptions = {},
): StudioDocument {
  const layout = options.layout ?? CREATE_LAYOUTS.CHAT_STACKED
  const style = options.style ?? CREATE_STYLES.CREAM_BOTANICAL
  const format = options.format ?? CREATE_FORMATS.PORTRAIT
  const field = options.selectedField === undefined ? selectedField : options.selectedField
  const passageText = passage?.content.trim() || source.sections.content.content.trim() || source.condensed.verse.content.trim()
  const reference = passage?.reference || source.scriptureReference || 'Scripture reflection'
  const translation = passage?.abbreviation ?? ''
  const includeEmpty = layout === CREATE_LAYOUTS.CHAT_STACKED || layout === CREATE_LAYOUTS.CHAT_TWO_COLUMN
  const content = layoutContent(source, passageText, reference, translation, field, includeEmpty)
  const pages = buildLayoutPages(layout, format, content)
  if (passage) {
    for (const page of pages) {
      for (const element of page.elements) {
        if (element.kind === 'text' && element.metadata?.['semanticSlot'] === 'scripture.passage') {
          element.metadata = {
            ...element.metadata,
            source: 'saved-passage',
            provider: passage.provider,
            passageId: passage.passageId,
            translationId: passage.translationId,
          }
        }
      }
    }
  }
  const assembled: StudioDocument = {
    schemaVersion: STUDIO_DOCUMENT_SCHEMA_VERSION,
    id: `chat.studio.${source.id}`,
    title: `${source.title} image`,
    metadata: {
      sourceApplication: 'chat_app',
      sourceReflectionId: source.id,
      sourceUpdatedAt: source.updatedAt,
      templateId: CHAT_STUDIO_TEMPLATE.id,
      templateVersion: CHAT_STUDIO_TEMPLATE.version,
      layout,
      style,
      format,
      ...(field ? { selectedField: field } : {}),
    },
    pages,
  }
  const styled = applyChatStudioStyle(assembled, style)
  if (layout === CREATE_LAYOUTS.CHAT_STACKED) return styled
  return fitChatStudioDocument(styled).document
}
