import { useEffect } from 'react'

/*
 * Knowing when the software keyboard is open, so the page can get out of its
 * way.
 *
 * There is no event for this. What there is, on both mobile Safari and mobile
 * Chrome, is `visualViewport`: when the keyboard opens the visual viewport
 * gets shorter while the layout viewport does not, and the difference is the
 * keyboard. That is a heuristic, so it is written down as one — a threshold
 * rather than a certainty, and everything that depends on it degrades to the
 * ordinary layout if the browser has no `visualViewport` at all.
 *
 * What it drives is one attribute on `<body>`, which CSS reads. The
 * alternative — components each subscribing and each deciding — gives three
 * answers to one question on a page with three of them.
 *
 * Why bother: the bottom navigation is fixed to the bottom of the screen,
 * which is exactly where the keyboard appears. Left alone it either sits on
 * top of the field being typed into or floats absurdly above the keyboard.
 */
const KEYBOARD_THRESHOLD = 140

export function useSoftKeyboard(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    /*
     * Remembered so the page can be put back where it was. A keyboard opening
     * scrolls the page; a keyboard closing should not leave somebody somewhere
     * they never navigated to.
     */
    let scrollBeforeKeyboard: number | null = null

    const update = () => {
      const hidden = window.innerHeight - viewport.height
      const open = hidden > KEYBOARD_THRESHOLD
      const wasOpen = document.body.dataset['keyboard'] === 'open'
      if (open === wasOpen) return

      if (open) {
        scrollBeforeKeyboard = window.scrollY
        document.body.dataset['keyboard'] = 'open'
      } else {
        delete document.body.dataset['keyboard']
        if (scrollBeforeKeyboard !== null) {
          const restore = scrollBeforeKeyboard
          scrollBeforeKeyboard = null
          /* After the browser has finished its own adjustment, not during it. */
          requestAnimationFrame(() => window.scrollTo({ top: restore }))
        }
      }
    }

    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      delete document.body.dataset['keyboard']
    }
  }, [])
}
