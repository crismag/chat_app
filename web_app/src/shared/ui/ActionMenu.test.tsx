/*
 * A menu that cannot open off the edge of the screen.
 *
 * The defect this component exists for was visible and unrecoverable: on a
 * phone, the ⋯ menu anchored itself to the right of a control near the left
 * edge and grew leftwards, so its items read "a title", "from conversation",
 * "sual". Nothing was scrollable and nothing was truncated with an ellipsis —
 * the words were simply outside the window.
 *
 * What is tested here is therefore the *shape*: a popover when there is room
 * beside the control, and a sheet when there is not. The rest is what both
 * shapes owe a person either way — a reason on anything they cannot press, and
 * a way out with the keyboard.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ActionMenu } from './ActionMenu.tsx'

afterEach(cleanup)

/** Stand in for a window of a given width, which jsdom does not have. */
function viewport(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: narrow,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )
}

const items = [
  { label: 'Suggest a title', onSelect: vi.fn() },
  { label: 'Delete this reflection', onSelect: vi.fn(), danger: true },
  {
    label: 'Create visual',
    onSelect: vi.fn(),
    reason: 'Write something first.',
  },
]

function open() {
  render(<ActionMenu label="More actions" trigger={<span>⋯</span>} items={items} />)
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  return screen.getByRole('menu', { name: 'More actions' })
}

beforeEach(() => {
  for (const item of items) item.onSelect.mockClear()
})

describe('on a narrow screen', () => {
  beforeEach(() => viewport(true))

  test('the actions come up as a sheet, not a popover beside the control', () => {
    const menu = open()
    /*
     * A sheet is a modal over the page, which is what stops it running off the
     * edge: it is positioned against the window rather than against a control
     * that might be anywhere.
     */
    expect(menu.className).toMatch(/sheet/)
    expect(menu.className).not.toMatch(/popover/)
    /* Named where it can be read, since the trigger is only a mark. */
    expect(within(menu).getByText('More actions')).toBeInTheDocument()
  })

  test('a reason is readable rather than hidden in a tooltip', () => {
    const menu = open()
    /* A touch screen has no hover, so `title` is an explanation nobody reaches. */
    expect(within(menu).getByText('Write something first.')).toBeVisible()
    expect(within(menu).getByRole('menuitem', { name: 'Create visual' })).toBeDisabled()
  })

  test('closing it leaves everything alone', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('menu')).toBeNull()
    for (const item of items) expect(item.onSelect).not.toHaveBeenCalled()
  })
})

describe('on a wide screen', () => {
  beforeEach(() => viewport(false))

  test('the actions stay in a popover beside the control', () => {
    const menu = open()
    expect(menu.className).toMatch(/popover/)
    expect(menu.className).not.toMatch(/sheet/)
  })
})

describe('either way', () => {
  for (const [where, narrow] of [
    ['narrow', true],
    ['wide', false],
  ] as const) {
    test(`choosing an action runs it once and closes the menu (${where})`, () => {
      viewport(narrow)
      const menu = open()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Suggest a title' }))
      expect(items[0]!.onSelect).toHaveBeenCalledOnce()
      expect(screen.queryByRole('menu')).toBeNull()
    })

    test(`a disabled item explains itself to a screen reader (${where})`, () => {
      viewport(narrow)
      const menu = open()
      const blocked = within(menu).getByRole('menuitem', { name: 'Create visual' })
      const describedBy = blocked.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(document.getElementById(describedBy!)).toHaveTextContent('Write something first.')
      /*
       * And the reason is not part of the name: an item called "Create visual
       * Write something first." is one nobody can find by its name.
       */
      expect(blocked).toHaveAccessibleName('Create visual')
    })

    test(`Escape closes it (${where})`, () => {
      viewport(narrow)
      open()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
    })
  }
})
