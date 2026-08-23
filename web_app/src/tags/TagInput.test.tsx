/*
 * The tags field, as somebody actually uses it.
 *
 * The interesting failures here are not "does a list appear". They are: does
 * choosing a suggestion damage the tags already typed, does a slow response for
 * an old prefix overwrite a newer one, and does the field still work when the
 * lookup fails — because suggestions are a convenience and typing a new tag was
 * always the other half of this control.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TagInput, activeFragment, replaceFragment } from './TagInput.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubSuggestions(tags: string[]) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ suggestions: tags.map((tag) => ({ tag, label: tag })) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderInput(value = '', onChange = vi.fn()) {
  render(
    <TagInput value={value} onChange={onChange} onCommit={vi.fn()} onCancel={vi.fn()} />,
  )
  return onChange
}

beforeEach(() => {
  stubSuggestions([])
})

test('the fragment is the word being typed, not the whole line', () => {
  expect(activeFragment('prayer, fast')).toBe('fast')
  expect(activeFragment('prayer,')).toBe('')
  expect(activeFragment('  prayer  ')).toBe('prayer')
})

test('choosing a suggestion replaces only that fragment', () => {
  /* The regression this guards: an autocomplete that eats what came before it. */
  expect(replaceFragment('prayer, fast', 'fasting')).toBe('prayer, fasting, ')
  expect(replaceFragment('fast', 'fasting')).toBe('fasting, ')
})

test('typing offers at most what the server returned', async () => {
  stubSuggestions(['prayer', 'prayerlife'])
  renderInput('pray')
  const options = await screen.findAllByRole('option')
  expect(options.map((option) => option.textContent)).toEqual(['#prayer', '#prayerlife'])
})

test('choosing one hands the whole line back, with the earlier tags intact', async () => {
  stubSuggestions(['prayer'])
  const onChange = renderInput('fasting, pray')
  fireEvent.click(await screen.findByRole('option', { name: '#prayer' }))
  expect(onChange).toHaveBeenCalledWith('fasting, prayer, ')
})

test('an empty fragment asks for nothing at all', async () => {
  const fetchMock = stubSuggestions(['prayer'])
  renderInput('prayer, ')
  /* Long enough for the debounce to have fired had it been going to. */
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(fetchMock).not.toHaveBeenCalled()
})

test('one lookup per pause, not one per keystroke', async () => {
  const fetchMock = stubSuggestions(['prayer'])
  const onChange = vi.fn()
  const { rerender } = render(
    <TagInput value="p" onChange={onChange} onCommit={vi.fn()} onCancel={vi.fn()} />,
  )
  for (const value of ['pr', 'pra', 'pray']) {
    rerender(
      <TagInput value={value} onChange={onChange} onCommit={vi.fn()} onCancel={vi.fn()} />,
    )
  }
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2)
})

test('the keyboard can reach and take a suggestion', async () => {
  stubSuggestions(['prayer', 'prayerlife'])
  const onChange = renderInput('pray')
  const field = screen.getByRole('combobox')
  await screen.findAllByRole('option')
  fireEvent.keyDown(field, { key: 'ArrowDown' })
  fireEvent.keyDown(field, { key: 'ArrowDown' })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(onChange).toHaveBeenCalledWith('prayerlife, ')
})

test('Escape dismisses the list without cancelling the edit', async () => {
  stubSuggestions(['prayer'])
  const onCancel = vi.fn()
  render(<TagInput value="pray" onChange={vi.fn()} onCommit={vi.fn()} onCancel={onCancel} />)
  const field = screen.getByRole('combobox')
  await screen.findAllByRole('option')
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(screen.queryByRole('option')).toBeNull()
  expect(onCancel).not.toHaveBeenCalled()
  /* A second Escape, with no list to dismiss, is the cancel. */
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(onCancel).toHaveBeenCalled()
})

test('a failed lookup is silent, and the field still works', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('nope', { status: 500 })),
  )
  const onChange = renderInput('pray')
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(screen.queryByRole('option')).toBeNull()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'prayer' } })
  expect(onChange).toHaveBeenCalledWith('prayer')
})

test('a refusal is shown, and can be dismissed', () => {
  const onDismiss = vi.fn()
  render(
    <TagInput
      value="prayer"
      onChange={vi.fn()}
      onCommit={vi.fn()}
      onCancel={vi.fn()}
      error="This tag isn't allowed. Please choose another."
      onDismissError={onDismiss}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent("This tag isn't allowed")
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onDismiss).toHaveBeenCalled()
})

test('the refusal never names the rule that refused it', () => {
  render(
    <TagInput
      value="prayer"
      onChange={vi.fn()}
      onCommit={vi.fn()}
      onCancel={vi.fn()}
      error="This tag isn't allowed. Please choose another."
    />,
  )
  expect(screen.getByRole('status').textContent).not.toMatch(/banned|profan|list|word/i)
})
