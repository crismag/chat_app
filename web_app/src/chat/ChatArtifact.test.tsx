import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ChatArtifact } from './ChatArtifact.tsx'
import type { AssistState } from './types.ts'

afterEach(cleanup)

const assist: AssistState = {
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

function renderArtifact(value = (field: string) => (field === 'heart' ? 'It stayed with me.' : '')) {
  return render(
    <ChatArtifact
      format="full"
      valueOf={value}
      dirtyFields={new Set()}
      discussing={null}
      proposal={null}
      overflow={null}
      assist={assist}
      flashed={null}
      onCaret={() => {}}
      onChange={() => {}}
      onSave={() => {}}
      onDiscuss={() => {}}
      onApplyProposal={() => {}}
      onDismissProposal={() => {}}
    />,
  )
}

test('written sections keep their names on the card', () => {
  renderArtifact()
  for (const name of ['Content', 'Heart', 'Application', 'Testimony']) {
    expect(screen.getByRole('heading', { name })).toBeVisible()
  }
})

/*
 * The compaction, stated as behaviour rather than as pixels.
 *
 * Four sections used to carry three assistance buttons each, plus a status
 * light, an origin mark and a save control apiece — twenty or so persistent
 * controls around a page whose job is writing. What is asserted here is that
 * they are gone from the surface and still reachable, because "removed the
 * clutter" and "removed the feature" look identical in a screenshot.
 */
test('a section carries one assistance control, not three', () => {
  renderArtifact()

  /* Not four sections × three buttons on the face of the page. */
  expect(screen.queryByRole('button', { name: /Discuss in chat/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Ask me questions$/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Improve wording$/ })).toBeNull()

  /* One per section, named, and everything is behind it. */
  const triggers = screen.getAllByRole('button', { name: /^Assistance for / })
  expect(triggers).toHaveLength(4)

  fireEvent.click(screen.getByRole('button', { name: 'Assistance for Heart' }))
  const menu = screen.getByRole('menu', { name: 'Assistance for Heart' })
  for (const action of ['Ask me questions', 'Improve wording', 'Discuss in Reflect']) {
    expect(within(menu).getByRole('menuitem', { name: action })).toBeInTheDocument()
  }
})

test('nothing reports a state the field itself already shows', () => {
  renderArtifact()
  /* No "empty"/"written" traffic light, and no "Your words" on your words. */
  expect(screen.queryByLabelText(/Heart: nothing written yet/i)).toBeNull()
  expect(screen.queryByText('Your words')).toBeNull()
  /* And no save control until there is something unsaved. */
  expect(screen.queryByRole('button', { name: /Save Heart/i })).toBeNull()
})
