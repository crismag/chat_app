import { expect, test } from 'vitest'
import {
  AUTHOR_ORIGINS,
  BIBLE_PROVIDERS,
  CREATE_FORMATS,
  CREATE_LAYOUTS,
  emptyChatSections,
} from '@chat/shared'
import {
  applyStudioElementTransform,
  interpretStudioRuntimeTransform,
  runStudioCanonicalOperation,
  validateStudioDocument,
  type StudioTextElement,
} from '@crismag/create-studio'
import { buildChatStudioDocument, type StudioReflectionSource } from './host-adapter.ts'

const source: StudioReflectionSource = {
  id: 'reliability-chat',
  format: 'full',
  title: 'Remain in the vine',
  scriptureReference: 'John 15:5',
  updatedAt: '2026-08-18T12:00:00.000Z',
  sections: {
    ...emptyChatSections(),
    content: { type: 'content', content: 'I am the vine; you are the branches.', authorOrigin: AUTHOR_ORIGINS.USER },
    heart: { type: 'heart', content: 'I am invited to remain.', authorOrigin: AUTHOR_ORIGINS.USER },
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
  retrievedAt: '2026-08-18T12:00:00.000Z',
}

function textBySlot(document: ReturnType<typeof buildChatStudioDocument>, slot: string) {
  return document.pages[0]?.elements.find((element) =>
    element.kind === 'text' && element.metadata?.['semanticSlot'] === slot,
  ) as StudioTextElement | undefined
}

test('dragging Title or a C.H.A.T. layer does not resize or rewrite the composition', () => {
  const document = buildChatStudioDocument(source, passage, null, {
    layout: CREATE_LAYOUTS.CHAT_STACKED,
    format: CREATE_FORMATS.PORTRAIT,
  })
  const pageId = document.pages[0]?.id
  const title = textBySlot(document, 'reflection.title')
  const heart = textBySlot(document, 'reflection.heart')
  if (!pageId || !title || !heart) throw new Error('Expected Title and Heart layers.')

  const titleMove = interpretStudioRuntimeTransform({
    elementId: title.id,
    pageId,
    x: title.geometry.x + 24,
    y: title.geometry.y + 16,
    width: 48,
    height: 12,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    canonical: title.geometry,
  })
  expect(titleMove.ok).toBe(true)
  if (!titleMove.ok) return

  const afterTitle = applyStudioElementTransform(document, pageId, titleMove.change)
  const movedTitle = textBySlot(afterTitle, 'reflection.title')
  expect(movedTitle?.geometry).toEqual({
    ...title.geometry,
    x: title.geometry.x + 24,
    y: title.geometry.y + 16,
  })
  expect(movedTitle?.text).toBe('Remain in the vine')
  expect(textBySlot(afterTitle, 'reflection.heart')?.text).toBe('I am invited to remain.')
  expect(textBySlot(afterTitle, 'reflection.content')?.text).toBe('I am the vine; you are the branches.')

  const heartMove = interpretStudioRuntimeTransform({
    elementId: heart.id,
    pageId,
    x: heart.geometry.x + 10,
    y: heart.geometry.y + 10,
    width: 20,
    height: 20,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    canonical: heart.geometry,
  })
  expect(heartMove.ok).toBe(true)
  if (!heartMove.ok) return
  const afterHeart = applyStudioElementTransform(afterTitle, pageId, heartMove.change)
  expect(() => validateStudioDocument(afterHeart)).not.toThrow()
  expect(textBySlot(afterHeart, 'reflection.heart')?.geometry.width).toBe(heart.geometry.width)
  expect(textBySlot(afterHeart, 'reflection.heart')?.text).toBe('I am invited to remain.')
})

test('invalid or stale Full C.H.A.T. transforms are rejected without replacing the document', () => {
  const document = buildChatStudioDocument(source, passage, null, {
    layout: CREATE_LAYOUTS.CHAT_STACKED,
    format: CREATE_FORMATS.PORTRAIT,
  })
  const pageId = document.pages[0]?.id
  const title = textBySlot(document, 'reflection.title')
  if (!pageId || !title) throw new Error('Expected a Title layer.')

  const nan = runStudioCanonicalOperation({
    operation: 'transform-element',
    execute: () => applyStudioElementTransform(document, pageId, {
      elementId: title.id,
      x: Number.NaN,
      y: title.geometry.y,
      width: title.geometry.width,
      height: title.geometry.height,
      rotation: 0,
    }),
  })
  expect(nan.ok).toBe(false)
  if (!nan.ok) {
    expect(nan.issue.message).not.toMatch(/Invalid StudioDocument/)
    expect(nan.issue.recoverable).toBe(true)
  }

  const stale = runStudioCanonicalOperation({
    operation: 'transform-element',
    execute: () => applyStudioElementTransform(document, pageId, {
      elementId: 'layer.deleted',
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      rotation: 0,
    }),
  })
  expect(stale.ok).toBe(false)
  expect(document.pages[0]?.elements).toHaveLength(buildChatStudioDocument(source, passage, null, {
    layout: CREATE_LAYOUTS.CHAT_STACKED,
    format: CREATE_FORMATS.PORTRAIT,
  }).pages[0]?.elements.length ?? 0)
})
