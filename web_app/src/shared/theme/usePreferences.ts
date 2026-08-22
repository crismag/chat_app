import { useContext } from 'react'

import { ThemeContext } from './theme-context.ts'

export function usePreferences() {
  return useContext(ThemeContext)
}
