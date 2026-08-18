import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ChatArtifact } from './ChatArtifact.tsx'
import type { AssistState } from './types.ts'

afterEach(cleanup)

const assist: AssistState = {
  available: false,
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

test('written sections keep their names on the card', () => {
  render(
    <ChatArtifact
      format="full"
      hasWritten
      valueOf={(field) => (field === 'heart' ? 'It stayed with me.' : '')}
      originOf={() => 'user'}
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

  for (const name of ['Content', 'Heart', 'Application', 'Testimony']) {
    expect(screen.getByRole('heading', { name })).toBeVisible()
  }
})
