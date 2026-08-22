import { useEffect, useId, useState } from 'react'
import { CHAT_FORMATS, THEMES, THEME_LABELS, THEME_LIST, type Theme } from '@chat/shared'

import { fetchTranslations, type BibleTranslation } from '../bible/api.ts'
import { DevicesSection } from './DevicesSection.tsx'
import { usePreferences } from '../shared/theme/usePreferences.ts'
import styles from './SettingsPanel.module.css'

/*
 * Settings, which are three choices and no more.
 *
 * Each one saves as it is changed. There is no Save button and nothing to
 * discard, because every setting here is reversible, visible the instant it is
 * applied, and worth nothing to anybody but the person setting it — the class
 * of change that a confirmation step only gets in the way of.
 */

export function SettingsPanel() {
  const { preferences, update } = usePreferences()
  const ids = useId()
  const [error, setError] = useState<string | null>(null)

  async function change(changes: Parameters<typeof update>[0]) {
    setError(null)
    try {
      await update(changes)
    } catch {
      /*
       * The theme is already applied locally, so this is honest about what
       * failed: it looks right here, and will not on the next device.
       */
      setError('That could not be saved. It will apply here but may not follow you.')
    }
  }

  return (
    <div className={styles.settings}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <ThemeChoice
        current={preferences.theme}
        onChoose={(theme) => void change({ theme })}
      />

      <TranslationChoice
        current={preferences.bibleTranslationId}
        onChoose={(bibleTranslationId) => void change({ bibleTranslationId })}
      />

      <fieldset className={styles.group}>
        <legend className={styles.legend}>New reflections</legend>
        <p className={styles.help} id={`${ids}-format-help`}>
          The shape a reflection starts in. You can still change it while writing.
        </p>
        <div className={styles.choices}>
          {[
            { id: CHAT_FORMATS.FULL, name: 'Full C.H.A.T.', description: 'All four sections.' },
            {
              id: CHAT_FORMATS.CONDENSED,
              name: 'Short',
              description: 'One reflection, in your own words.',
            },
          ].map((format) => (
            <label key={format.id} className={styles.choice}>
              <input
                type="radio"
                name={`${ids}-format`}
                value={format.id}
                checked={preferences.defaultChatFormat === format.id}
                onChange={() => void change({ defaultChatFormat: format.id })}
                aria-describedby={`${ids}-format-help`}
              />
              <span className={styles.choiceText}>
                <span className={styles.choiceName}>{format.name}</span>
                <span className={styles.choiceBody}>{format.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <DevicesSection />
    </div>
  )
}

/**
 * Which palette a swatch should paint itself with.
 *
 * Default has no palette of its own — it is whichever of light and dark the
 * device is asking for — so its sample shows the one this person would
 * actually get. Every other appearance previews itself.
 */
function swatchTheme(theme: Theme): string {
  if (theme !== THEMES.DEFAULT) return theme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function ThemeChoice({
  current,
  onChoose,
}: {
  current: Theme
  onChoose: (theme: Theme) => void
}) {
  const ids = useId()

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Appearance</legend>
      <div className={styles.themes}>
        {THEME_LIST.map((theme) => (
          <label key={theme} className={styles.theme}>
            <input
              type="radio"
              name={`${ids}-theme`}
              value={theme}
              checked={current === theme}
              onChange={() => onChoose(theme)}
            />
            {/*
              A swatch of the theme's own colours, drawn by the theme itself:
              `data-theme` on this element makes the tokens inside resolve to
              that palette, so the sample is the real thing rather than a
              hand-copied approximation that drifts the first time a colour
              changes.
            */}
            <span className={styles.swatch} data-theme={swatchTheme(theme)} aria-hidden="true">
              <span className={styles.swatchPaper}>
                <span className={styles.swatchInk} />
                <span className={styles.swatchAccent} />
              </span>
            </span>
            <span className={styles.choiceText}>
              <span className={styles.choiceName}>{THEME_LABELS[theme].name}</span>
              <span className={styles.choiceBody}>{THEME_LABELS[theme].description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function TranslationChoice({
  current,
  onChoose,
}: {
  current: number | null
  onChoose: (id: number | null) => void
}) {
  const ids = useId()
  const [translations, setTranslations] = useState<BibleTranslation[] | null>(null)

  useEffect(() => {
    let live = true
    fetchTranslations()
      .then((answer) => {
        if (live) setTranslations(answer.translations)
      })
      .catch(() => {
        if (live) setTranslations([])
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className={styles.group}>
      <label className={styles.legend} htmlFor={`${ids}-translation`}>
        Preferred translation
      </label>
      <p className={styles.help} id={`${ids}-translation-help`}>
        Used when you open a passage. You can still choose a different one at any time.
      </p>
      <select
        id={`${ids}-translation`}
        className="input"
        value={current === null ? '' : String(current)}
        aria-describedby={`${ids}-translation-help`}
        disabled={translations === null}
        onChange={(event) => onChoose(event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">No preference</option>
        {(translations ?? []).map((translation) => (
          <option key={translation.id} value={translation.id}>
            {translation.abbreviation} — {translation.name}
          </option>
        ))}
      </select>
    </div>
  )
}
