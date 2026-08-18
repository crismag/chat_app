import { expect, test } from 'vitest'
import {
  AUTHOR_ORIGINS,
  BIBLE_PROVIDERS,
  CHAT_FORMATS,
  CREATE_FORMATS,
  CREATE_LAYOUTS,
  emptyChatSections,
  validateChat,
} from '@chat/shared'
import { serializeStudioDocument, validateStudioDocument } from '@crismag/create-studio'
import { collectOverflowingText } from './overflow.ts'
import { buildChatStudioDocument, type StudioReflectionSource } from './host-adapter.ts'

function fill(count: number, word = 'remain'): string {
  return Array.from({ length: count }, (_, index) => `${word}${index + 1}`).join(' ')
}

function sourceWith(sections: Partial<StudioReflectionSource['sections']>, title = 'Remain in the vine'): StudioReflectionSource {
  return {
    id: 'full-chat-fit',
    format: 'full',
    title,
    scriptureReference: 'John 15:5',
    updatedAt: '2026-08-18T12:00:00.000Z',
    sections: {
      ...emptyChatSections(),
      content: { type: 'content', content: 'I am the vine; you are the branches.', authorOrigin: AUTHOR_ORIGINS.USER },
      heart: { type: 'heart', content: 'I am invited to remain.', authorOrigin: AUTHOR_ORIGINS.USER },
      application: { type: 'application', content: 'Stay with the people God has given me.', authorOrigin: AUTHOR_ORIGINS.USER },
      testimony: { type: 'testimony', content: 'He keeps those who remain.', authorOrigin: AUTHOR_ORIGINS.USER },
      ...sections,
    },
    condensed: {
      verse: { type: 'verse', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
      reflection: { type: 'reflection', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
    },
  }
}

const passage = {
  provider: BIBLE_PROVIDERS.YOUVERSION,
  translationId: 111,
  abbreviation: 'NIV',
  name: 'New International Version',
  passageId: 'JHN.15.5',
  reference: 'John 15:5',
  content: 'I am the vine; you are the branches.',
  copyright: 'Scripture quotation notice.',
  retrievedAt: '2026-08-18T12:00:00.000Z',
}

function compose(reflection: StudioReflectionSource) {
  return buildChatStudioDocument(reflection, passage, null, {
    layout: CREATE_LAYOUTS.CHAT_STACKED,
    format: CREATE_FORMATS.PORTRAIT,
  })
}

function slots(document: ReturnType<typeof compose>) {
  return document.pages.flatMap((page) => page.elements
    .filter((element) => element.kind === 'text')
    .map((element) => String(element.metadata?.['semanticSlot'] ?? '')))
}

function texts(document: ReturnType<typeof compose>) {
  return document.pages.flatMap((page) => page.elements
    .filter((element) => element.kind === 'text')
    .map((element) => (element.kind === 'text' ? element.text : '')))
}

function bodyFontSizes(document: ReturnType<typeof compose>) {
  return document.pages[0]?.elements
    .filter((element) => element.kind === 'text' && element.metadata?.['typographyGroup'] === 'body')
    .map((element) => (element.kind === 'text' ? element.fontSize : 0)) ?? []
}

function assertFullChatPage(document: ReturnType<typeof compose>, reflection: StudioReflectionSource) {
  expect(() => validateStudioDocument(document)).not.toThrow()
  expect(document.pages).toHaveLength(1)
  expect(document.pages[0]?.width).toBe(1080)
  expect(document.pages[0]?.height).toBe(1350)
  expect(slots(document)).toEqual(expect.arrayContaining([
    'reflection.title',
    'scripture.reference',
    'reflection.content',
    'reflection.content.label',
    'reflection.heart',
    'reflection.heart.label',
    'reflection.application',
    'reflection.application.label',
    'reflection.testimony',
    'reflection.testimony.label',
  ]))
  expect(texts(document).join('\n')).toContain(reflection.title)
  expect(texts(document).join('\n')).toContain('Content')
  expect(texts(document).join('\n')).toContain('Heart')
  expect(texts(document).join('\n')).toContain('Application')
  expect(texts(document).join('\n')).toContain('Testimony')
  expect(slots(document)).not.toContain('scripture.attribution')
  expect(texts(document).join('\n')).not.toContain(passage.copyright)
  expect(collectOverflowingText(document)).toEqual([])
  expect(new Set(bodyFontSizes(document)).size).toBe(1)
  expect(Math.min(...bodyFontSizes(document))).toBeGreaterThanOrEqual(22)
  expect(document.pages[0]?.elements.every((element) => (
    element.geometry.x >= 0
    && element.geometry.y >= 0
    && element.geometry.x + element.geometry.width <= 1080
    && element.geometry.y + element.geometry.height <= 1350
  ))).toBe(true)
  expect(() => JSON.parse(serializeStudioDocument(document))).not.toThrow()
}

test('a short Full C.H.A.T. opens as one portrait page', () => {
  const reflection = sourceWith({})
  assertFullChatPage(compose(reflection), reflection)
})

test('balanced average sections stay on one page with coherent body type', () => {
  const reflection = sourceWith({
    content: { type: 'content', content: fill(40, 'content'), authorOrigin: AUTHOR_ORIGINS.USER },
    heart: { type: 'heart', content: fill(40, 'heart'), authorOrigin: AUTHOR_ORIGINS.USER },
    application: { type: 'application', content: fill(40, 'application'), authorOrigin: AUTHOR_ORIGINS.USER },
    testimony: { type: 'testimony', content: fill(40, 'testimony'), authorOrigin: AUTHOR_ORIGINS.USER },
  })
  const document = compose(reflection)
  assertFullChatPage(document, reflection)
  expect(texts(document).join('\n')).toContain('heart40')
})

test('a long Heart receives more height than a short Content', () => {
  const reflection = sourceWith({
    content: { type: 'content', content: 'Short content.', authorOrigin: AUTHOR_ORIGINS.USER },
    heart: { type: 'heart', content: fill(90, 'heart'), authorOrigin: AUTHOR_ORIGINS.USER },
  })
  const document = compose(reflection)
  assertFullChatPage(document, reflection)
  const content = document.pages[0]?.elements.find((element) => element.metadata?.['semanticSlot'] === 'reflection.content')
  const heart = document.pages[0]?.elements.find((element) => element.metadata?.['semanticSlot'] === 'reflection.heart')
  expect(heart && content && heart.geometry.height > content.geometry.height).toBe(true)
})

test.each([
  ['content', fill(90, 'content')] as const,
  ['heart', fill(90, 'heart')] as const,
  ['application', fill(90, 'application')] as const,
  ['testimony', fill(90, 'testimony')] as const,
])('a long %s section still fits on one portrait page', (field, text) => {
  const reflection = sourceWith({
    [field]: { type: field, content: text, authorOrigin: AUTHOR_ORIGINS.USER },
  })
  assertFullChatPage(compose(reflection), reflection)
})

test('near-recommended Full C.H.A.T. content is accepted by chat_app and fits Create', () => {
  const reflection = sourceWith({
    content: { type: 'content', content: 'a'.repeat(480), authorOrigin: AUTHOR_ORIGINS.USER },
    heart: { type: 'heart', content: 'a'.repeat(480), authorOrigin: AUTHOR_ORIGINS.USER },
    application: { type: 'application', content: 'a'.repeat(480), authorOrigin: AUTHOR_ORIGINS.USER },
    testimony: { type: 'testimony', content: 'a'.repeat(480), authorOrigin: AUTHOR_ORIGINS.USER },
  })
  const draft = {
    title: reflection.title,
    scriptureReference: reflection.scriptureReference ?? '',
    content: reflection.sections.content.content,
    heart: reflection.sections.heart.content,
    application: reflection.sections.application.content,
    testimony: reflection.sections.testimony.content,
  }
  const validation = validateChat(CHAT_FORMATS.FULL, draft)
  expect(validation.status).not.toBe('invalid')
  const document = compose(reflection)
  assertFullChatPage(document, reflection)
  expect(document.pages).toHaveLength(1)
})

test('a long title still leaves C.H.A.T. body on the page', () => {
  const reflection = sourceWith({}, 'A longer title that names the tension without becoming the whole composition')
  assertFullChatPage(compose(reflection), reflection)
})

test('paragraph breaks and long tokens survive fitting', () => {
  const reflection = sourceWith({
    heart: {
      type: 'heart',
      content: `First thought.\n\nSecond thought stays.\n${'A'.repeat(48)}`,
      authorOrigin: AUTHOR_ORIGINS.USER,
    },
  })
  const document = compose(reflection)
  assertFullChatPage(document, reflection)
  expect(texts(document).join('\n')).toContain('\n\n')
  expect(texts(document).join('\n')).toContain('A'.repeat(48))
})

test('removing a passage later is not required for an empty optional quote', () => {
  const document = compose(sourceWith({}))
  expect(slots(document)).toContain('scripture.reference')
  expect(texts(document).some((text) => text.includes('John 15:5'))).toBe(true)
})
