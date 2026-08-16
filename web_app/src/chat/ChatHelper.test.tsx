/*
 * The conversation panel, after it stopped being a transcript in a form.
 *
 * The claims worth protecting: a reply is identified without being mislabelled
 * a draft, a real draft is unmistakably a draft and names where it would go,
 * nothing is offered on messages nobody would file, and the panel is honest
 * when it cannot answer at all.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AI_CHAT_NOTE_ONLY_MESSAGE, AI_CHAT_NOTICE, AI_CHAT_SHORT_NOTICE } from '@chat/shared'
import { ChatHelper } from './ChatHelper.tsx'
import { AI_CHAT_ACTIONS } from '@chat/shared'
import { canAddToSection, chipsFor } from './chips.ts'
import type { Message } from './types.ts'

afterEach(cleanup)

const reply: Message = {
  id: 'm2',
  role: 'assistant',
  content: 'Paul is writing to a church under pressure, and he does not minimise it.',
  authorOrigin: 'ai_generated',
}

const messages: Message[] = [
  {
    id: 'm1',
    role: 'user',
    content: 'What is Paul actually saying here, and why does it matter?',
    authorOrigin: 'user',
  },
  reply,
]

function renderHelper(overrides: Partial<Parameters<typeof ChatHelper>[0]> = {}) {
  const handlers = {
    onDraft: vi.fn(),
    onSend: vi.fn(),
    onChip: vi.fn(),
    onAction: vi.fn(),
    onUseInField: vi.fn(),
    onStopDiscussing: vi.fn(),
    onDismissProposal: vi.fn(),
    onDismissChatError: vi.fn(),
    onAddDraft: vi.fn(),
    onRetryDraft: vi.fn(),
    onViewSection: vi.fn(),
    onDismissAdded: vi.fn(),
  }
  render(
    <ChatHelper
      format="full"
      reference="Romans 8:28"
      messages={messages}
      draft=""
      sending={false}
      discussing={null}
      proposal={null}
      busyAction={null}
      composerRef={{ current: null }}
      replying={false}
      chatError={null}
      chatAvailable
      chatNotice={AI_CHAT_NOTICE}
      addedNotice={null}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe('the header names the passage, and the caveat is not a block', () => {
  test('the title is about this reflection', () => {
    renderHelper()
    expect(screen.getByRole('heading', { name: 'Reflect on Romans 8:28' })).toBeInTheDocument()
    expect(
      screen.getByText('Explore the passage or develop your C.H.A.T. reflection.'),
    ).toBeInTheDocument()
  })

  test('the full caveat lives behind an info control rather than on screen', () => {
    renderHelper()
    /* Not resident: it is not taking space between the thread and the composer. */
    expect(screen.queryByText(AI_CHAT_NOTICE)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'About AI suggestions' }))
    expect(screen.getByText(AI_CHAT_NOTICE)).toBeInTheDocument()
  })
})

describe('an ordinary reply is not a draft', () => {
  test('it is identified, not labelled with provenance', () => {
    renderHelper()
    /* The identity on the reply itself, not the subtitle that also says it. */
    expect(screen.getByText('C.H.A.T.', { selector: 'p' })).toBeInTheDocument()
    /* The badge is saved for material that really is generated. */
    expect(screen.queryByText('AI drafted')).not.toBeInTheDocument()
  })

  test('the author’s own turn is announced without a label on screen', () => {
    renderHelper()
    /* Still reachable by a screen reader; simply not printed as furniture. */
    expect(screen.getByText('You')).toHaveClass('sr-only')
  })
})

describe('a draft is unmistakably a draft', () => {
  const drafted: Message = {
    id: 'm3',
    role: 'assistant',
    content: 'Here is something you could start from.',
    authorOrigin: 'ai_generated',
    draftText: 'I want to trust this passage even on the days I cannot feel it.',
    draftSection: 'heart',
  }

  test('it names its destination and carries the provenance badge', () => {
    renderHelper({ messages: [...messages, drafted] })
    expect(screen.getByText('Heart draft')).toBeInTheDocument()
    expect(screen.getByText('AI drafted')).toBeInTheDocument()
    expect(screen.getByText(AI_CHAT_SHORT_NOTICE)).toBeInTheDocument()
  })

  test('the action is direct when the section is known — no second picker', () => {
    const handlers = renderHelper({ messages: [...messages, drafted] })
    fireEvent.click(screen.getByRole('button', { name: 'Review in Heart' }))
    expect(handlers.onAddDraft).toHaveBeenCalledWith(
      'heart',
      'I want to trust this passage even on the days I cannot feel it.',
    )
  })

  test('an unplaced draft asks where it should go rather than guessing', () => {
    renderHelper({ messages: [...messages, { ...drafted, draftSection: null }] })
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Add this draft to a section' }),
    ).toBeInTheDocument()
    for (const name of ['Content', 'Heart', 'Application', 'Testimony']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  test('it can be edited before it is added, and the edit is what is added', () => {
    const handlers = renderHelper({ messages: [...messages, drafted] })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = screen.getByRole('textbox', { name: /Edit this draft/ })
    fireEvent.change(editor, { target: { value: 'My own wording.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review in Heart' }))
    expect(handlers.onAddDraft).toHaveBeenCalledWith('heart', 'My own wording.')
  })

  test('and it can be asked for again', () => {
    const handlers = renderHelper({ messages: [...messages, drafted] })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(handlers.onRetryDraft).toHaveBeenCalledOnce()
  })
})

describe('the per-response control is an icon, not a row', () => {
  test('the full-width button is gone', () => {
    renderHelper()
    /* The complaint: a repeated bar under every reply, reading as a form. */
    expect(screen.queryByRole('button', { name: /Add to C\.H\.A\.T\./ })).not.toBeInTheDocument()
  })

  test('an eligible response exposes a named, focusable control', () => {
    renderHelper()
    const control = screen.getByRole('button', { name: 'Use response in reflection' })
    expect(control).toBeInTheDocument()
    /* Hover is never the only way in — it is in the DOM and focusable. */
    expect(control).toHaveAttribute('title', 'Use in reflection')
    expect(control).toHaveAttribute('aria-haspopup', 'menu')
  })

  test('activating it opens a menu naming every destination, plus Copy', () => {
    renderHelper()
    fireEvent.click(screen.getByRole('button', { name: 'Use response in reflection' }))

    const menu = screen.getByRole('menu', { name: 'Use this response' })
    expect(menu).toBeInTheDocument()
    expect(screen.getByText('Use this response')).toBeInTheDocument()
    for (const name of ['Content', 'Heart', 'Application', 'Testimony']) {
      expect(screen.getByRole('menuitem', { name: `Use in ${name}` })).toBeInTheDocument()
    }
    expect(screen.getByRole('menuitem', { name: 'Copy text' })).toBeInTheDocument()
  })

  test('choosing a destination hands it to the page, which decides how it lands', () => {
    const handlers = renderHelper()
    fireEvent.click(screen.getByRole('button', { name: 'Use response in reflection' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use in Content' }))
    expect(handlers.onUseInField).toHaveBeenCalledWith('content', reply.content, 'ai_generated')
    /* And it dismisses on selection. */
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('Escape dismisses it', () => {
    renderHelper()
    fireEvent.click(screen.getByRole('button', { name: 'Use response in reflection' }))
    /* Handled on the document, so it works whether or not focus is inside. */
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('the author’s own messages carry no such control', () => {
    /* Their words are already theirs. An action there made the thread a form. */
    expect(
      canAddToSection({
        id: 'u',
        role: 'user',
        content: 'A long enough sentence that length alone would not exclude it.',
        authorOrigin: 'user',
      }),
    ).toBe(false)
  })

  test('nor do greetings, acknowledgements, scraps, or drafts', () => {
    for (const text of ['ok', 'thanks', 'Amen', 'Good morning', 'yep', 'it is midnight']) {
      expect(
        canAddToSection({ id: 'x', role: 'assistant', content: text, authorOrigin: 'ai_generated' }),
      ).toBe(false)
    }
    /* A draft has its own card and its own direct action. */
    expect(
      canAddToSection({
        id: 'd',
        role: 'assistant',
        content: 'Here is a draft you could start from, and it is long enough to qualify.',
        authorOrigin: 'ai_generated',
        draftText: 'Some draft.',
      }),
    ).toBe(false)
  })

  test('a real response does', () => {
    expect(canAddToSection(reply)).toBe(true)
  })
})

describe('chips follow the state', () => {
  test('the default set contains no Polish or Shorten', () => {
    renderHelper()
    expect(screen.getByRole('button', { name: 'Explain simply' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft Content' })).toBeInTheDocument()
    /* Meaningless as conversation starters: there is nothing to polish yet. */
    expect(screen.queryByRole('button', { name: 'Polish' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Shorten' })).not.toBeInTheDocument()
  })

  test('Polish and Shorten appear once a draft exists', () => {
    renderHelper({
      messages: [
        ...messages,
        {
          id: 'm4',
          role: 'assistant',
          content: 'A draft.',
          authorOrigin: 'ai_generated',
          draftText: 'Some draft text.',
          draftSection: 'content',
        },
      ],
    })
    expect(screen.getByRole('button', { name: 'Polish' })).toBeInTheDocument()
  })

  test('they adapt to the scoped section', () => {
    renderHelper({ discussing: 'testimony' })
    expect(screen.getByRole('button', { name: 'Ask a faith question' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft Testimony' })).toBeInTheDocument()
  })

  test('every chip carries a structured identifier, never prompt text', () => {
    const known = Object.values(AI_CHAT_ACTIONS)
    for (const section of [null, 'content', 'heart', 'application', 'testimony'] as const) {
      for (const chip of chipsFor(section)) {
        expect(known).toContain(chip.action)
        /* Something readable for the thread, so it still reads as a conversation. */
        expect(chip.message.length).toBeGreaterThan(0)
      }
    }
  })

  test('only the draft action may produce a draft, and it names its destination', () => {
    for (const section of ['content', 'heart', 'application', 'testimony'] as const) {
      const drafts = chipsFor(section).filter(
        (chip) => chip.action === AI_CHAT_ACTIONS.DRAFT_SECTION,
      )
      expect(drafts).toHaveLength(1)
      expect(drafts[0]?.section).toBe(section)
    }
    /* The other three are conversation, and carry no destination at all. */
    for (const chip of chipsFor(null)) {
      if (chip.action !== AI_CHAT_ACTIONS.DRAFT_SECTION) {
        expect(chip.section).toBeUndefined()
      }
    }
  })

  test('pressing one invokes the action immediately', () => {
    const handlers = renderHelper()
    fireEvent.click(screen.getByRole('button', { name: 'Explain simply' }))
    expect(handlers.onChip).toHaveBeenCalledWith(
      expect.objectContaining({ action: AI_CHAT_ACTIONS.EXPLAIN_SIMPLY }),
    )
  })

  test('and they are disabled while a reply is in flight, so clicks cannot pile up', () => {
    renderHelper({ replying: true })
    const chip = screen.getByRole('button', { name: 'Explain simply' })
    expect(chip).toBeDisabled()
    /* The reason is in words, not only in the grey. */
    expect(chip).toHaveAttribute('title', 'Waiting for the last reply')
  })
})

describe('scoped mode', () => {
  test('says which section, and can be dismissed', () => {
    const handlers = renderHelper({ discussing: 'heart' })
    expect(screen.getByText(/Discussing:/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop discussing Heart' }))
    expect(handlers.onStopDiscussing).toHaveBeenCalledOnce()
  })
})

describe('after something is added', () => {
  test('the destination is confirmed and can be gone to', () => {
    const handlers = renderHelper({ addedNotice: { field: 'content', at: Date.now() } })
    expect(screen.getByRole('status')).toHaveTextContent('Added to Content')
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(handlers.onViewSection).toHaveBeenCalledWith('content')
  })
})

describe('when nothing can answer', () => {
  test('the composer stays and says it is a notebook', () => {
    renderHelper({ chatAvailable: false })
    expect(screen.getByText(AI_CHAT_NOTE_ONLY_MESSAGE)).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(/Write a note to yourself about this passage/),
    ).toBeInTheDocument()
    /* And no chips, because there is nothing to ask. */
    expect(screen.queryByRole('button', { name: 'Explain simply' })).not.toBeInTheDocument()
  })
})

describe('waiting, and failing', () => {
  test('a reply on its way is announced where it will appear', () => {
    renderHelper({ replying: true })
    expect(screen.getByText(/C\.H\.A\.T\. is thinking/).closest('[aria-live]')).not.toBeNull()
  })

  test('a failure points back at writing by hand', () => {
    renderHelper({ chatError: 'AI assistance is unavailable right now.' })
    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable right now/)
  })
})
