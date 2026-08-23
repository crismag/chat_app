/*
 * A note, rendered.
 *
 * The first test is the one that matters most and would be easy to leave out:
 * a note is text somebody wrote, it is rendered on their screen, and it must
 * never become markup the browser is asked to trust.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { NoteMarkdown } from './NoteMarkdown.tsx'

afterEach(cleanup)

test('markup in a note is text, not markup', () => {
  render(<NoteMarkdown markdown={'<img src=x onerror="alert(1)">\n<b>bold?</b>'} />)
  /* Printed, not parsed — there is no img and no b element to find. */
  expect(document.querySelector('img')).toBeNull()
  expect(document.querySelector('b')).toBeNull()
  expect(screen.getByText(/<img src=x/)).toBeInTheDocument()
})

test('bold, italic and underline each render as themselves', () => {
  const { container } = render(
    <NoteMarkdown markdown="**strong** and *slanted* and ++underlined++" />,
  )
  expect(container.querySelector('strong')?.textContent).toBe('strong')
  expect(container.querySelector('em')?.textContent).toBe('slanted')
  expect(container.querySelector('u')?.textContent).toBe('underlined')
})

test('bold is matched before italic, so it does not render as asterisks', () => {
  const { container } = render(<NoteMarkdown markdown="**both**" />)
  expect(container.querySelector('strong')?.textContent).toBe('both')
  expect(container.textContent).not.toContain('*')
})

test('emphasis nests', () => {
  const { container } = render(<NoteMarkdown markdown="**bold with *italic* inside**" />)
  const strong = container.querySelector('strong')
  expect(strong?.querySelector('em')?.textContent).toBe('italic')
})

test('code is literal, and no emphasis is parsed inside it', () => {
  const { container } = render(<NoteMarkdown markdown="`a *b* c`" />)
  expect(container.querySelector('code')?.textContent).toBe('a *b* c')
  expect(container.querySelector('em')).toBeNull()
})

test('a bulleted list is a list', () => {
  const { container } = render(<NoteMarkdown markdown={'- milk\n- eggs'} />)
  const items = container.querySelectorAll('li')
  expect([...items].map((li) => li.textContent)).toEqual(['milk', 'eggs'])
})

test('a numbered list is an ordered list', () => {
  const { container } = render(<NoteMarkdown markdown={'1. first\n2. second'} />)
  expect(container.querySelector('ol')).not.toBeNull()
  expect(container.querySelectorAll('ol li')).toHaveLength(2)
})

test('a task list renders real checkboxes in the right state', () => {
  render(<NoteMarkdown markdown={'- [ ] milk\n- [x] eggs'} onToggleTask={vi.fn()} />)
  const boxes = screen.getAllByRole('checkbox')
  expect(boxes).toHaveLength(2)
  expect((boxes[0] as HTMLInputElement).checked).toBe(false)
  expect((boxes[1] as HTMLInputElement).checked).toBe(true)
})

/*
 * The index the checkbox reports is what `toggleTaskAt` counts by. If the
 * renderer numbered by line and the toggle counted by task, pressing one
 * checkbox would tick a different line.
 */
test('a checkbox reports its position among tasks, not among lines', () => {
  const onToggleTask = vi.fn()
  render(
    <NoteMarkdown
      markdown={'# Shopping\n\n- [ ] milk\n\nsome prose\n\n- [ ] eggs'}
      onToggleTask={onToggleTask}
    />,
  )
  fireEvent.click(screen.getAllByRole('checkbox')[1] as HTMLElement)
  expect(onToggleTask).toHaveBeenCalledWith(1)
})

test('without a handler the checkboxes cannot be pressed', () => {
  render(<NoteMarkdown markdown="- [ ] milk" />)
  expect(screen.getByRole('checkbox')).toBeDisabled()
})

test('the whole row is the label, so the text is part of the target', () => {
  render(<NoteMarkdown markdown="- [ ] milk" onToggleTask={vi.fn()} />)
  const label = screen.getByRole('checkbox').closest('label')
  expect(label).not.toBeNull()
  expect(within(label as HTMLElement).getByText('milk')).toBeInTheDocument()
})

/*
 * h3 and h4, never h1. The page around a note already owns the top of the
 * outline, and a note beginning `# Shopping` must not introduce a second
 * document heading into it.
 */
test('a heading in a note does not outrank the page it is on', () => {
  const { container } = render(<NoteMarkdown markdown={'# One\n## Two'} />)
  expect(container.querySelector('h1')).toBeNull()
  expect(container.querySelector('h3')?.textContent).toBe('One')
  expect(container.querySelector('h4')?.textContent).toBe('Two')
})

test('a blank line separates paragraphs, and a single newline does not', () => {
  const { container } = render(<NoteMarkdown markdown={'one\ntwo\n\nthree'} />)
  expect(container.querySelectorAll('p')).toHaveLength(2)
  expect(container.querySelectorAll('br')).toHaveLength(1)
})

test('an empty note says so rather than rendering nothing at all', () => {
  render(<NoteMarkdown markdown="   " />)
  expect(screen.getByText('Nothing written yet.')).toBeInTheDocument()
})
