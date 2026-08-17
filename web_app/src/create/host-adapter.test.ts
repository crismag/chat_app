import { expect, test } from 'vitest'
import { AUTHOR_ORIGINS, BIBLE_PROVIDERS, emptyChatSections } from '@chat/shared'
import { validateStudioDocument } from '@crismag/create-studio'
import { buildChatStudioDocument, type StudioReflectionSource } from './host-adapter.ts'

const source: StudioReflectionSource = {
  id: 'reflection-1',
  format: 'full',
  title: 'Remain in the vine',
  scriptureReference: 'John 15:5',
  updatedAt: '2026-08-16T12:00:00.000Z',
  sections: {
    ...emptyChatSections(),
    heart: { type: 'heart', content: 'I am invited to remain, not strive.', authorOrigin: AUTHOR_ORIGINS.USER },
  },
  condensed: {
    verse: { type: 'verse', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
    reflection: { type: 'reflection', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
  },
}

test('maps the exact saved passage, translation, selected field, and provenance', () => {
  const document = buildChatStudioDocument(source, {
    provider: BIBLE_PROVIDERS.YOUVERSION,
    translationId: 111,
    abbreviation: 'NIV',
    name: 'New International Version',
    passageId: 'JHN.15.5',
    reference: 'John 15:5',
    content: 'I am the vine; you are the branches.',
    copyright: 'Scripture quotation notice.',
    retrievedAt: '2026-08-15T12:00:00.000Z',
  }, 'heart')

  expect(() => validateStudioDocument(document)).not.toThrow()
  expect(document.pages[0]?.elements).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'text', text: 'I am the vine; you are the branches.' }),
    expect.objectContaining({ kind: 'text', text: 'John 15:5 · NIV' }),
    expect.objectContaining({ kind: 'text', text: 'I am invited to remain, not strive.', metadata: expect.objectContaining({ authorOrigin: 'user' }) }),
  ]))
  expect(JSON.stringify(document)).not.toContain('https://')
})
