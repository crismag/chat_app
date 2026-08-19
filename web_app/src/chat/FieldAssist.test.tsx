/*
 * What the assistance controls promise, tested on the controls themselves.
 *
 * The four claims here are the ones a person is actually relying on: that a
 * suggestion is visibly a suggestion, that discarding leaves their words alone,
 * that accepting can be undone, and that a control which cannot work says why
 * to a screen reader rather than only to a mouse pointer.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AI_GUIDANCE_NOTICE } from '@chat/shared'
import { AssistMenu, AssistResults, type FieldAssistProps } from './FieldAssist.tsx'
import { isGuidanceSection } from './sections.ts'
import type { AssistState } from './types.ts'

afterEach(cleanup)

const idle: AssistState = {
  available: true,
  unavailableReason: null,
  busyField: null,
  busyKind: null,
  guidance: {},
  improvement: null,
  clarification: null,
  error: null,
  undoable: null,
  onAsk: () => {},
  onImprove: () => {},
  onAccept: () => {},
  onDiscard: () => {},
  onDismissGuidance: () => {},
  onUndo: () => {},
}

/*
 * The trigger and the results are two components now — the control sits in the
 * section's heading and a result opens under the textarea it is about — so
 * both are rendered here, exactly as the section renders them.
 */
function renderAssist(overrides: Partial<FieldAssistProps> = {}) {
  const handlers = {
    onAsk: vi.fn(),
    onImprove: vi.fn(),
    onDiscuss: vi.fn(),
    onAccept: vi.fn(),
    onDiscard: vi.fn(),
    onDismissGuidance: vi.fn(),
    onUndo: vi.fn(),
  }
  const props: FieldAssistProps = {
    field: 'heart',
    name: 'Heart',
    available: idle.available,
    unavailableReason: idle.unavailableReason,
    hasText: true,
    busy: null,
    guidance: null,
    improvement: null,
    clarification: null,
    error: null,
    undoable: false,
    ...handlers,
    ...overrides,
  }
  render(
    <MemoryRouter>
      <AssistMenu {...props} />
      <AssistResults {...props} />
    </MemoryRouter>,
  )
  return handlers
}

/** The actions live behind one press now; this is that press. */
function openAssist() {
  fireEvent.click(screen.getByRole('button', { name: /Assistance for Heart/i }))
  return screen.getByRole('menu', { name: /Assistance for Heart/i })
}

describe('only the four C.H.A.T. sections can be asked about', () => {
  test('Heart is one of them, and the Condensed fields are not', () => {
    expect(isGuidanceSection('heart')).toBe(true)
    expect(isGuidanceSection('content')).toBe(true)
    expect(isGuidanceSection('application')).toBe(true)
    expect(isGuidanceSection('testimony')).toBe(true)
    expect(isGuidanceSection('verse')).toBe(false)
    expect(isGuidanceSection('reflection')).toBe(false)
  })
})

describe('guiding questions', () => {
  test('are shown as questions, marked as AI, with the notice that came with them', () => {
    renderAssist({
      guidance: {
        questions: ['Which words stayed with you?', 'Where does this meet you today?'],
        notice: AI_GUIDANCE_NOTICE,
      },
    })

    expect(screen.getByText('Which words stayed with you?')).toBeInTheDocument()
    /* Marked, and marked in words rather than only in colour. */
    expect(screen.getByText('AI suggestion')).toBeInTheDocument()
    expect(screen.getByText(/Nothing has been written for you/)).toBeInTheDocument()
    expect(screen.getByText(AI_GUIDANCE_NOTICE)).toBeInTheDocument()
    /* Reachable by name, so a screen reader can find and describe the group. */
    expect(
      screen.getByRole('group', { name: /AI questions to think about for Heart/i }),
    ).toBeInTheDocument()
  })

  test('an empty result says so rather than showing nothing at all', () => {
    renderAssist({ guidance: { questions: [], notice: AI_GUIDANCE_NOTICE } })
    expect(screen.getByText(/No questions came back/)).toBeInTheDocument()
  })
})

describe('improved wording', () => {
  const improvement = {
    original: 'i could not see it but i trusted anyway',
    suggested: 'I could not see it, but I trusted anyway.',
    summaryOfChanges: ['Capitalised the sentence.', 'Added a comma.'],
  }

  test('shows the original beside the suggestion, and changes neither', () => {
    renderAssist({ improvement })
    expect(screen.getByText(improvement.original)).toBeInTheDocument()
    expect(screen.getByText(improvement.suggested)).toBeInTheDocument()
    expect(screen.getByText('Your words')).toBeInTheDocument()
    expect(screen.getByText(/Your Heart has not changed/)).toBeInTheDocument()
    expect(screen.getByText('Added a comma.')).toBeInTheDocument()
  })

  test('accept and discard are both explicit, and named', () => {
    const handlers = renderAssist({ improvement })

    fireEvent.click(screen.getByRole('button', { name: 'Use this in Heart' }))
    expect(handlers.onAccept).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: /Discard — keep my words/ }))
    expect(handlers.onDiscard).toHaveBeenCalledOnce()
  })

  test('undo is offered after accepting, so the original stays recoverable', () => {
    const handlers = renderAssist({ undoable: true })
    openAssist()
    fireEvent.click(screen.getByRole('menuitem', { name: /Undo — put my words back/ }))
    expect(handlers.onUndo).toHaveBeenCalledOnce()
  })

  test('a clarifying question is shown as a question, with nothing to accept', () => {
    renderAssist({ clarification: 'Did you mean the promise, or the person?' })
    expect(screen.getByText('Did you mean the promise, or the person?')).toBeInTheDocument()
    expect(screen.getByText(/Nothing has changed/)).toBeInTheDocument()
    /* Nothing to accept, because nothing was suggested. */
    expect(screen.queryByRole('button', { name: /Use this in/ })).not.toBeInTheDocument()
  })
})

describe('the controls explain themselves', () => {
  /*
   * One control per section instead of three. What matters is that the three
   * actions are all still reachable and still named — consolidating their
   * presentation was the point; losing one of them would not be.
   */
  test('all three actions are behind one named control', () => {
    renderAssist()
    /* Named, because a sparkle is not a word. */
    openAssist()
    expect(screen.getByRole('menuitem', { name: 'Ask me questions' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Improve wording' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Discuss in Reflect' })).toBeEnabled()
  })

  test('choosing an action runs it and closes the menu', () => {
    const handlers = renderAssist()
    openAssist()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Improve wording' }))
    expect(handlers.onImprove).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('a request in flight disables what would send a second one', () => {
    renderAssist({ busy: 'questions' })
    openAssist()
    expect(screen.getByRole('menuitem', { name: 'Ask me questions' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Improve wording' })).toBeDisabled()
    /* Loading is announced, not merely implied by a label changing. */
    expect(screen.getByRole('status')).toHaveTextContent(/Asking for questions about Heart/)
  })

  test('with nothing written, Improve wording is disabled and says why', () => {
    renderAssist({ hasText: false })
    openAssist()
    const improve = screen.getByRole('menuitem', { name: 'Improve wording' })
    expect(improve).toBeDisabled()
    /*
     * The reason is attached to the control, not only to a tooltip a mouse can
     * find. A greyed-out button with no explanation is the failure this page
     * already fixed once for Suggest title.
     */
    const describedBy = improve.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /Write something in Heart first/,
    )
  })

  test('when assistance is unavailable, the reason is the server’s own sentence', () => {
    renderAssist({
      available: false,
      unavailableReason: 'AI assistance is switched off for this server.',
    })
    openAssist()
    const ask = screen.getByRole('menuitem', { name: 'Ask me questions' })
    expect(ask).toBeDisabled()
    expect(document.getElementById(ask.getAttribute('aria-describedby')!)).toHaveTextContent(
      /switched off for this server/,
    )
  })

  test('a failure is announced, and points back at writing by hand', () => {
    renderAssist({
      error: 'AI assistance is unavailable right now. You can continue writing normally.',
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/continue writing normally/)
  })
})
