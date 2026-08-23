/*
 * The header's quick access to Intro and About, tested on its own.
 *
 * Its presence in a signed-in and a signed-out shell is App.test.tsx's job —
 * that is where "regardless of `user`" actually means something. What this
 * file owns is the control itself: opening, closing, where its two items
 * actually take the router, and that it behaves like any other menu in the
 * application.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import { InfoMenu } from './InfoMenu.tsx'

afterEach(cleanup)

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<InfoMenu />} />
        <Route path="/intro" element={<p>The intro page</p>} />
        <Route path="/about" element={<p>The about page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('closed by default, and named for what it opens', () => {
  renderMenu()
  const trigger = screen.getByRole('button', { name: 'Intro and About' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('menu')).toBeNull()
})

test('opens on click, to exactly Intro and About, in that order', () => {
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Intro and About' }))

  const items = screen.getAllByRole('menuitem')
  expect(items.map((item) => item.textContent)).toEqual(['Intro', 'About'])
})

test('Intro takes the router to /intro', () => {
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Intro and About' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Intro' }))

  expect(screen.getByText('The intro page')).toBeInTheDocument()
  expect(screen.queryByRole('menu')).toBeNull()
})

test('About takes the router to /about', () => {
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Intro and About' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'About' }))

  expect(screen.getByText('The about page')).toBeInTheDocument()
})

test('Escape closes it and returns focus to the trigger', () => {
  renderMenu()
  const trigger = screen.getByRole('button', { name: 'Intro and About' })
  fireEvent.click(trigger)
  const menu = screen.getByRole('menu')
  fireEvent.keyDown(menu, { key: 'Escape' })

  expect(screen.queryByRole('menu')).toBeNull()
  expect(trigger).toHaveFocus()
})

test('a click outside closes it', () => {
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Intro and About' }))
  expect(screen.getByRole('menu')).toBeInTheDocument()

  fireEvent.mouseDown(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
})

test('the arrow keys move focus between the two items', () => {
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Intro and About' }))
  const [intro, about] = screen.getAllByRole('menuitem')

  expect(intro).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
  expect(about).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
  expect(intro).toHaveFocus()
})
