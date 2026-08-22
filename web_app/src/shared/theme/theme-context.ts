import { createContext } from 'react'
import { DEFAULT_PREFERENCES, type Preferences } from '@chat/shared'

export type ThemeContextValue = {
  preferences: Preferences
  /** Change one or more preferences. Applied at once, saved after. */
  update: (changes: Partial<Preferences>) => Promise<void>
  reload: () => Promise<void>
}

export const ThemeContext = createContext<ThemeContextValue>({
  preferences: DEFAULT_PREFERENCES,
  update: async () => undefined,
  reload: async () => undefined,
})
