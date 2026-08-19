import { useEffect, useState } from 'react'

/**
 * Whether a media query matches, kept up to date.
 *
 * Small enough to be worth writing rather than depending on. It lives here
 * rather than beside one page because layout is not the only thing that has to
 * know how wide the window is: a menu that is a popover on a desktop has to be
 * something else on a phone, and both callers must agree on where the line is.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/**
 * The width at which this application stops being a desktop layout.
 *
 * The same line the editor uses to swap its columns for drawers, so a person
 * does not meet a popover on one control and a sheet on the next.
 */
export const NARROW_QUERY = '(max-width: 899px)'
