import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/*
 * One app bar, filled in by whichever screen is showing.
 *
 * The alternative — each page rendering its own bar under the shell's — is how
 * an application ends up with two headers on a phone, one saying what the
 * product is called and one saying what the page is, together eating a fifth
 * of the screen. The shell keeps the only bar there is; a screen describes
 * what should be in it and the shell renders that.
 *
 * Describing rather than rendering is the point. A screen cannot accidentally
 * produce a second bar, because it never had one to produce.
 *
 * On a desktop the shell's own header — wordmark, destinations, account — is
 * unchanged and this is ignored.
 */
export type MobileBarConfig = {
  /** What this screen is. Shown as the bar's heading. */
  title: string
  /**
   * Whether the bar's title is the page's heading.
   *
   * On the collection and on Community it is: their own headings were removed
   * because the bar says the same thing. On the viewer it is not — the bar
   * names the passage, and the page's heading is the reflection's title, in
   * full, directly underneath. Both being `h1` gave those pages two.
   */
  titleIsHeading?: boolean
  /** A back affordance, when this screen is somewhere you go *into*. */
  onBack?: () => void
  backLabel?: string
  /** Up to three icon buttons. The bar is one row and does not wrap. */
  actions?: ReactNode
  /** Replaces the whole bar — used by search, which takes it over entirely. */
  replace?: ReactNode
}

const BarContext = createContext<{
  config: MobileBarConfig | null
  setConfig: (config: MobileBarConfig | null) => void
}>({ config: null, setConfig: () => {} })

export function MobileBarProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<MobileBarConfig | null>(null)
  const value = useMemo(() => ({ config, setConfig }), [config])
  return <BarContext.Provider value={value}>{children}</BarContext.Provider>
}

/** What the shell should render. Read by the shell, never by a screen. */
export function useMobileBarConfig(): MobileBarConfig | null {
  return useContext(BarContext).config
}

/**
 * Describe this screen's app bar for as long as this screen is mounted.
 *
 * The dependency list is the caller's, because the contents are the caller's:
 * a bar carrying a live filter count has to be re-described when that count
 * changes, and a bar carrying nothing but a title never does.
 */
export function useMobileBar(build: () => MobileBarConfig, deps: unknown[]): void {
  const { setConfig } = useContext(BarContext)
  useEffect(() => {
    setConfig(build())
    return () => setConfig(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
