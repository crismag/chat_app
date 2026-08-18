import { expect, test } from 'vitest'
import {
  AUTHOR_ORIGINS,
  BIBLE_PROVIDERS,
  CREATE_FORMATS,
  CREATE_LAYOUTS,
  CREATE_STYLES,
  emptyChatSections,
} from '@chat/shared'
import { validateStudioDocument } from '@crismag/create-studio'
import { applyChatStudioStyle } from './styles.ts'
import { collectOverflowingText } from './overflow.ts'
import { buildChatStudioDocument, type StudioReflectionSource } from './host-adapter.ts'

const source: StudioReflectionSource = {
  id: 'reflection-1',
  format: 'full',
  title: 'Remain in the vine',
  scriptureReference: 'John 15:5',
  updatedAt: '2026-08-16T12:00:00.000Z',
  sections: {
    ...emptyChatSections(),
    content: { type: 'content', content: 'I am the vine; you are the branches.', authorOrigin: AUTHOR_ORIGINS.USER },
    heart: { type: 'heart', content: 'I am invited to remain, not strive.', authorOrigin: AUTHOR_ORIGINS.USER },
    application: { type: 'application', content: 'Stay with the people God has given me.', authorOrigin: AUTHOR_ORIGINS.USER },
    testimony: { type: 'testimony', content: 'He keeps those who remain.', authorOrigin: AUTHOR_ORIGINS.USER },
  },
  condensed: {
    verse: { type: 'verse', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
    reflection: { type: 'reflection', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
  },
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
  retrievedAt: '2026-08-15T12:00:00.000Z',
}

test('maps the exact saved passage, translation, selected field, and provenance', () => {
  const document = buildChatStudioDocument(source, passage, 'heart')

  expect(() => validateStudioDocument(document)).not.toThrow()
  expect(document.pages[0]?.width).toBe(1080)
  expect(document.pages[0]?.height).toBe(1350)
  expect(document.pages[0]?.elements).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'text', text: 'I am the vine; you are the branches.' }),
    expect.objectContaining({ kind: 'text', text: 'John 15:5 · NIV' }),
    expect.objectContaining({ kind: 'text', text: 'I am invited to remain, not strive.', metadata: expect.objectContaining({ authorOrigin: 'user' }) }),
  ]))
  expect(JSON.stringify(document)).not.toContain('https://')
  expect(JSON.stringify(document)).not.toContain('Scripture quotation notice.')
  expect(JSON.stringify(document)).not.toContain('scripture.attribution')
})

test('layout, style, and format combinations stay valid and independent', () => {
  for (const layout of Object.values(CREATE_LAYOUTS)) {
    for (const style of Object.values(CREATE_STYLES)) {
      for (const format of Object.values(CREATE_FORMATS)) {
        const document = buildChatStudioDocument(source, passage, 'heart', { layout, style, format })
        expect(() => validateStudioDocument(document)).not.toThrow()
        expect(document.metadata).toEqual(expect.objectContaining({ layout, style, format }))
        expect(document.pages[0]?.height).toBe(format === CREATE_FORMATS.PORTRAIT ? 1350 : 1080)
      }
    }
  }
})

test('stacked and two-column layouts carry every authored C.H.A.T. section', () => {
  const stacked = buildChatStudioDocument(source, passage, 'heart', { layout: CREATE_LAYOUTS.CHAT_STACKED })
  const twoColumn = buildChatStudioDocument(source, passage, 'heart', { layout: CREATE_LAYOUTS.CHAT_TWO_COLUMN })
  const texts = (document: ReturnType<typeof buildChatStudioDocument>) =>
    document.pages.flatMap((page) => page.elements.filter((element) => element.kind === 'text').map((element) => element.text))

  expect(texts(stacked).join('\n')).toContain('Stay with the people God has given me.')
  expect(texts(stacked).join('\n')).toContain('He keeps those who remain.')
  expect(texts(twoColumn).join('\n')).toContain('Stay with the people God has given me.')
  expect(twoColumn.pages[0]?.elements.some((element) => element.kind === 'text' && element.geometry.x > 500)).toBe(true)
})

test('changing style repaints colors without rewriting Scripture', () => {
  const cream = buildChatStudioDocument(source, passage, 'heart', { style: CREATE_STYLES.CREAM_BOTANICAL })
  const dark = applyChatStudioStyle(cream, CREATE_STYLES.DARK_WORSHIP)
  const creamPassage = cream.pages[0]?.elements.find((element) => element.kind === 'text' && element.metadata?.['semanticSlot'] === 'reflection.content')
  const darkPassage = dark.pages[0]?.elements.find((element) => element.kind === 'text' && element.metadata?.['semanticSlot'] === 'reflection.content')
  expect(creamPassage?.kind === 'text' ? creamPassage.text : '').toBe(darkPassage?.kind === 'text' ? darkPassage.text : '')
  expect(dark.pages[0]?.background).toEqual({ kind: 'solid', color: '#16121c' })
  expect(darkPassage?.kind === 'text' ? darkPassage.color : '').toBe('#ebe4da')
})

test('overflowing reflection text is split across cards instead of dropped', () => {
  const longHeart = `${'Remain in the vine and do not hurry. '.repeat(80)}End of the reflection.`
  const overflowing = buildChatStudioDocument({
    ...source,
    sections: {
      ...source.sections,
      heart: { type: 'heart', content: longHeart, authorOrigin: AUTHOR_ORIGINS.USER },
    },
  }, passage, 'heart', { layout: CREATE_LAYOUTS.QUOTE_FOCUS, format: CREATE_FORMATS.SQUARE })

  expect(() => validateStudioDocument(overflowing)).not.toThrow()
  const joined = overflowing.pages
    .flatMap((page) => page.elements.filter((element) => element.kind === 'text').map((element) => element.text))
    .join(' ')
  expect(joined).toContain('End of the reflection.')
  expect(overflowing.pages.length).toBeGreaterThan(1)
  expect(collectOverflowingText(overflowing)).toEqual([])
})
