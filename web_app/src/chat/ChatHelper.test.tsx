/*
 * The conversation panel's three states, and the one thing it must never do.
 *
 * The claim being protected is that a reply is unmistakably the assistant's.
 * Everything else here — the note-only mode, the pending bubble — exists so the
 * panel is honest about what it is at the moment someone looks at it.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AI_CHAT_NOTE_ONLY_MESSAGE, AI_CHAT_NOTICE } from '@chat/shared'
import { ChatHelper } from './ChatHelper.tsx'
import type { Message } from './types.ts'

afterEach(cleanup)

const messages: Message[] = [
  { id: 'm1', role: 'user', content: 'What is Paul saying here?', authorOrigin: 'user' },
  {
    id: 'm2',
    role: 'assistant',
    content: 'Paul is writing to a church under pressure.',
    authorOrigin: 'ai_generated',
  },
]

function renderHelper(overrides: Partial<Parameters<typeof ChatHelper>[0]> = {}) {
  render(
    <ChatHelper
      format="full"
      messages={messages}
      draft=""
      sending={false}
      discussing={null}
      proposal={null}
      busyAction={null}
      onDraft={vi.fn()}
      onSend={vi.fn()}
      onAction={vi.fn()}
      onUseInField={vi.fn()}
      onStopDiscussing={vi.fn()}
      onDismissProposal={vi.fn()}
      composerRef={{ current: null }}
      replying={false}
      chatError={null}
      chatAvailable
      chatNotice={AI_CHAT_NOTICE}
      onDismissChatError={vi.fn()}
      {...overrides}
    />,
  )
}

describe('whose words these are', () => {
  test('an assistant reply is named and badged, never left to look like the author’s', () => {
    renderHelper()
    expect(screen.getByText('Paul is writing to a church under pressure.')).toBeInTheDocument()
    /* Named in words, not only positioned or coloured differently. */
    expect(screen.getByText('C.H.A.T. assistant')).toBeInTheDocument()
    expect(screen.getByText('AI drafted')).toBeInTheDocument()
  })

  test('the author’s own message carries no AI badge', () => {
    renderHelper()
    expect(screen.getByText('You')).toBeInTheDocument()
    /* Exactly one badge in the thread, and it is not on their message. */
    expect(screen.getAllByText(/AI drafted/)).toHaveLength(1)
  })

  test('the caveat appears once under the thread, not on every reply', () => {
    renderHelper()
    expect(screen.getAllByText(AI_CHAT_NOTICE)).toHaveLength(1)
  })
})

describe('waiting for a reply', () => {
  test('is shown where the reply will appear, and announced', () => {
    renderHelper({ replying: true })
    const pending = screen.getByText(/Thinking about this with you/)
    expect(pending).toBeInTheDocument()
    /* A screen reader is told a reply is coming rather than meeting silence. */
    expect(pending.closest('[aria-live]')).not.toBeNull()
  })
})

describe('when nothing can answer', () => {
  test('the composer stays, and says it is a notebook rather than pretending', () => {
    renderHelper({ chatAvailable: false })
    expect(screen.getByText(AI_CHAT_NOTE_ONLY_MESSAGE)).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(/Write a note to yourself about this passage/),
    ).toBeInTheDocument()
    /* The composer is still there and still usable — that is the whole promise. */
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  test('the caveat is not shown, because nothing is being claimed', () => {
    renderHelper({ chatAvailable: false })
    expect(screen.queryByText(AI_CHAT_NOTICE)).not.toBeInTheDocument()
  })
})

describe('when a reply fails', () => {
  test('it says so beside the thread, and what was written is left alone', () => {
    renderHelper({ chatError: 'AI assistance is unavailable right now.' })
    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable right now/)
    /* Their message is still on screen — a failed reply is not a failed message. */
    expect(screen.getByText('What is Paul saying here?')).toBeInTheDocument()
  })
})
