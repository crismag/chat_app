/*
 * What the report dialog refuses to do.
 *
 * The interesting assertions here are negative ones. A report button is where
 * a product decides whether it will arbitrate disagreement, and whether the
 * person pressing it gets to choose somebody else's punishment. Both answers
 * are no, and both are easy to erode later by adding "just one more" category.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PUBLICATION_REPORT_REASONS, reportIsSubmittable } from '@chat/shared'
import { ReportDialog } from './ReportDialog.tsx'

afterEach(cleanup)

function open() {
  const onSubmit = vi.fn(async () => {})
  const onClose = vi.fn()
  render(
    <ReportDialog
      title="Report this reflection"
      lead="What is wrong with it?"
      reasons={[...PUBLICATION_REPORT_REASONS]}
      isSubmittable={reportIsSubmittable}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  )
  return { onSubmit, onClose }
}

test('it does not offer to settle a disagreement', () => {
  open()
  /*
   * People here write about Scripture. Strong disagreement about what a
   * passage means is the substance of that, not an infraction.
   */
  for (const absent of [/disagree/i, /false teaching/i, /bad theology/i, /interpretation/i, /denomination/i]) {
    expect(screen.queryByText(absent)).toBeNull()
  }
  expect(screen.getByText('Spam or advertising')).toBeInTheDocument()
  expect(screen.getByText('Scam or suspicious link')).toBeInTheDocument()
})

test('it does not ask the reporter what should happen to the author', () => {
  open()
  for (const absent of [/should this person be banned/i, /delete this/i, /suspend/i]) {
    expect(screen.queryByText(absent)).toBeNull()
  }
})

test('“Something else” cannot be sent without a sentence', () => {
  const { onSubmit } = open()
  fireEvent.click(screen.getByRole('radio', { name: 'Something else' }))
  expect(screen.getByRole('button', { name: 'Submit report' })).toBeDisabled()

  fireEvent.change(screen.getByLabelText(/Tell us more/), {
    target: { value: 'It links to a page asking for card details.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))
  expect(onSubmit).toHaveBeenCalledWith('other', 'It links to a page asking for card details.')
})

test('an ordinary reason needs no explanation, and the note is optional', () => {
  const { onSubmit } = open()
  fireEvent.click(screen.getByRole('radio', { name: 'Spam or advertising' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))
  expect(onSubmit).toHaveBeenCalledWith('spam', '')
})

test('afterwards it says the report arrived, and promises nothing', async () => {
  open()
  fireEvent.click(screen.getByRole('radio', { name: 'Spam or advertising' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))

  expect(await screen.findByText('Report received.')).toBeInTheDocument()
  /* Not "we will remove this" — nobody has looked at it yet. */
  expect(screen.queryByText(/will be removed/i)).toBeNull()
})

test('a failed report keeps what was typed, and says it can be tried again', async () => {
  /*
   * The failure path had no catch at all: a refused request left the dialog
   * unchanged with nothing on screen to explain it, and an unhandled
   * rejection behind the scenes. What must never happen is being asked to
   * write the sentence a second time.
   */
  const onSubmit = vi
    .fn<(reason: string, note: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error('The network dropped. Nothing was sent.'))
    .mockResolvedValueOnce(undefined)

  render(
    <ReportDialog
      title="Report this reflection"
      lead="What is wrong with it?"
      reasons={[...PUBLICATION_REPORT_REASONS]}
      isSubmittable={reportIsSubmittable}
      onClose={() => {}}
      onSubmit={onSubmit}
    />,
  )

  fireEvent.click(screen.getByRole('radio', { name: /something else/i }))
  const note = screen.getByLabelText(/tell us more/i)
  fireEvent.change(note, { target: { value: 'This is the sentence I do not want to retype.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/network dropped/i)
  /* Still there, every word of it. */
  expect(screen.getByLabelText(/tell us more/i)).toHaveValue(
    'This is the sentence I do not want to retype.',
  )
  expect(screen.getByRole('radio', { name: /something else/i })).toBeChecked()

  /* And it can simply be sent again. */
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Report received.')).toBeInTheDocument()
  expect(onSubmit).toHaveBeenCalledTimes(2)
})
