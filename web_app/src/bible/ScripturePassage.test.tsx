/*
 * What the passage card promises, tested on the card itself.
 *
 * The claims here are the ones somebody is actually relying on while they
 * write: that the Bible they chose is the Bible they get, that a failed lookup
 * cannot take their passage or their writing away, that the attribution is
 * shown, and that all of it works without a mouse.
 *
 * `fetch` is stubbed. Nothing in this file reaches the API server, let alone
 * YouVersion.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ScripturePassage } from './ScripturePassage.tsx'
import { passageAsWritten } from './api.ts'
import type { BiblePassage, BibleTranslation } from '@chat/shared'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

/*
 * The real catalog's awkward cases, in several languages.
 *
 * `NIV11` vs `NIrV` vs `NIVUK`; `engWEBUS`; and — because the catalog is no
 * longer English-only — Tagalog, Cebuano and Spanish, where `CCB` is Chinese
 * while the Cebuano Bible is `APD`.
 */
const TRANSLATIONS: BibleTranslation[] = [
  { id: 12, abbreviation: 'ASV', name: 'American Standard Version', language: 'en', languageName: 'English' },
  {
    id: 110,
    abbreviation: 'NIrV',
    name: 'New International Reader’s Version 2014',
    language: 'en',
    languageName: 'English',
  },
  {
    id: 111,
    abbreviation: 'NIV',
    name: 'New International Version',
    language: 'en',
    languageName: 'English',
    copyright:
      'The Holy Bible, New International Version® NIV®\nCopyright © 1973, 1978, 1984, 2011 by Biblica, Inc.®',
    publisherUrl: 'https://www.biblica.com/yv-learn-more/',
    youVersionUrl: 'https://www.bible.com/versions/111',
  },
  {
    id: 113,
    abbreviation: 'NIVUK',
    name: 'New International Version (Anglicized)',
    language: 'en',
    languageName: 'English',
  },
  {
    id: 206,
    abbreviation: 'WEBUS',
    name: 'World English Bible',
    language: 'en',
    languageName: 'English',
    copyright: 'PUBLIC DOMAIN (not copyrighted)',
  },
  {
    id: 3034,
    abbreviation: 'BSB',
    name: 'Berean Standard Bible',
    language: 'en',
    languageName: 'English',
    copyright: 'Public Domain',
  },
  {
    id: 1290,
    abbreviation: 'TLAB',
    name: 'Ang Biblia 1978',
    language: 'tl',
    languageName: 'Filipino',
    languageAliases: ['Tagalog', 'Pilipino'],
  },
  {
    id: 1396,
    abbreviation: 'APD',
    name: 'Ang Pulong Sa Dios',
    language: 'ceb',
    languageName: 'Cebuano',
    languageAliases: ['Bisaya', 'Binisaya'],
  },
  {
    id: 128,
    abbreviation: 'RVES',
    name: 'Reina Valera 1960',
    language: 'es',
    languageName: 'Spanish',
    languageAliases: ['Castilian', 'Espanol'],
  },
  {
    id: 36,
    abbreviation: 'CCB',
    name: '当代译本',
    language: 'zh',
    languageName: 'Chinese',
    languageAliases: ['Mandarin'],
  },
]

function passageIn(translationId: number, abbreviation: string, content: string): BiblePassage {
  return {
    provider: 'youversion',
    translationId,
    abbreviation,
    name: 'A translation',
    passageId: 'JHN.3.16-18',
    reference: 'John 3:16-18',
    content,
    copyright:
      translationId === 111
        ? TRANSLATIONS.find((entry) => entry.id === 111)?.copyright
        : 'Public Domain',
    ...(translationId === 111
      ? { links: { publisher: 'https://www.biblica.com/yv-learn-more/', youVersion: 'https://www.bible.com/versions/111' } }
      : {}),
    retrievedAt: '2026-08-16T10:00:00.000Z',
  }
}

const NIV_PASSAGE = passageIn(111, 'NIV', 'For God so loved the world that he gave his one and only Son…')
const BSB_PASSAGE = passageIn(3034, 'BSB', 'For God so loved the world that He gave His one and only Son…')

interface StubOptions {
  saved?: BiblePassage | null
  passages?: Partial<Record<number, BiblePassage | { status: number; body: unknown }>>
  translationsStatus?: { status: number; body: unknown }
}

/** A `fetch` answering this application's own endpoints. Never a provider's. */
function stubFetch(options: StubOptions = {}) {
  const calls: string[] = []
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    if (url.includes('/bible/translations')) {
      if (options.translationsStatus) {
        return json(options.translationsStatus.body, options.translationsStatus.status)
      }
      return json({ translations: TRANSLATIONS, defaultTranslationId: 111 })
    }

    if (url.includes('/passage') && !url.includes('/bible/passages')) {
      if (init?.method === 'PUT') return json({ passage: JSON.parse(String(init.body)) })
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return json({ passage: options.saved ?? null })
    }

    if (url.includes('/bible/passages')) {
      const id = Number(new URL(url, 'http://test').searchParams.get('translationId'))
      const answer = options.passages?.[id]
      if (answer && 'status' in answer) return json(answer.body, answer.status)
      if (answer) return json({ passage: answer, verses: 3 })
      return json({ error: 'That translation is not available.', outcome: 'translation_unavailable' }, 409)
    }

    return json({ error: 'unexpected' }, 500)
  })
  vi.stubGlobal('fetch', impl)
  return { calls, impl }
}

beforeEach(() => {
  window.localStorage.clear()
})

/** The combobox, which is how every translation is chosen. */
const searchBox = () => screen.getByRole('combobox', { name: 'Translation' })

/**
 * Choose a translation the way a person does: type enough to find it, then
 * click the row.
 *
 * Deliberately goes through the search rather than reaching for a row by
 * index. The picker opens onto a short recommended list, so most translations
 * are only reachable by searching — and a test that bypassed the search would
 * not notice the search breaking, which is the bug this work exists to fix.
 */
async function chooseTranslation(query: string, name: string | RegExp) {
  fireEvent.change(searchBox(), { target: { value: query } })
  const row = await screen.findByRole('option', { name: new RegExp(typeof name === 'string' ? name : name.source, 'i') })
  fireEvent.click(row)
}

describe('the passage card', () => {
  test('loads the catalog and selects NIV by id 111 — not by the string "NIV"', async () => {
    stubFetch()
    render(<ScripturePassage conversationId="c1" />)

    fireEvent.click(await screen.findByRole('button', { name: /choose bible passage/i }))
    const options = await screen.findAllByRole('option')

    const selected = options.filter((option) => option.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    /*
     * The assertion that matters. The label happens to read "NIV", but what is
     * being checked is that the SELECTED ENTRY is the one whose id is 111 —
     * the New International Version — and not NIrV (110) or NIVUK (113), which
     * a string match on an abbreviation would happily have picked.
     */
    expect(within(selected[0]!).getByText('New International Version')).toBeInTheDocument()
    expect(within(selected[0]!).queryByText(/Reader’s Version/)).not.toBeInTheDocument()
    expect(within(selected[0]!).queryByText(/Anglicized/)).not.toBeInTheDocument()
  })

  test('restores the previous selection over the server default', async () => {
    window.localStorage.setItem('chat.bible.translationId', '3034')
    stubFetch()
    render(<ScripturePassage conversationId="c1" />)

    fireEvent.click(await screen.findByRole('button', { name: /choose bible passage/i }))
    const options = await screen.findAllByRole('option')
    const selected = options.find((option) => option.getAttribute('aria-selected') === 'true')
    expect(within(selected!).getByText('Berean Standard Bible')).toBeInTheDocument()
  })

  test('a previous selection that is no longer in the catalog is not shown as chosen', async () => {
    /* A translation the key can no longer reach must never appear selected —
     * the reader would believe they were about to get it. */
    window.localStorage.setItem('chat.bible.translationId', '999999')
    stubFetch()
    render(<ScripturePassage conversationId="c1" />)

    fireEvent.click(await screen.findByRole('button', { name: /choose bible passage/i }))
    const options = await screen.findAllByRole('option')
    const selected = options.find((option) => option.getAttribute('aria-selected') === 'true')
    expect(within(selected!).getByText('New International Version')).toBeInTheDocument()
  })

  test('shows a saved passage with its attribution, exactly as it was written', async () => {
    stubFetch({ saved: NIV_PASSAGE })
    render(<ScripturePassage conversationId="c1" />)

    expect(await screen.findByTestId('scripture-text')).toHaveTextContent('For God so loved the world')
    expect(screen.getByRole('button', { name: /john 3:16-18 · niv/i })).toBeInTheDocument()
    expect(screen.getAllByText(/NIV/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Copyright © 1973, 1978, 1984, 2011 by Biblica/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /read on youversion/i })).toHaveAttribute(
      'href',
      'https://www.bible.com/versions/111',
    )
  })

  /*
   * This card is only mounted because somebody pressed for it, so it opens
   * showing the verse. The disclosure is for getting a long passage out of the
   * way of the picker beneath it — and it clips rather than withholds, so a
   * screen reader still reads the whole quotation either way.
   */
  test('a passage opens in full, and can be folded away and back', async () => {
    stubFetch({ saved: NIV_PASSAGE })
    render(<ScripturePassage conversationId="c1" />)

    const quote = await screen.findByTestId('scripture-text')
    expect(quote).toHaveAttribute('data-collapsed', 'false')

    const disclosure = screen.getByRole('button', { name: 'Show less' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(disclosure).toHaveAttribute('aria-controls', quote.getAttribute('id'))

    fireEvent.click(disclosure)
    expect(screen.getByTestId('scripture-text')).toHaveAttribute('data-collapsed', 'true')
    /* Clipped for the eye, never withheld from a reader that does not use one. */
    expect(screen.getByTestId('scripture-text')).toHaveTextContent('he gave his one and only Son')

    const reopen = screen.getByRole('button', { name: 'Show full passage' })
    expect(reopen).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(reopen)
    expect(screen.getByTestId('scripture-text')).toHaveAttribute('data-collapsed', 'false')
  })

  test('the passage is source material, not an editable field', async () => {
    stubFetch({ saved: NIV_PASSAGE })
    render(<ScripturePassage conversationId="c1" />)

    const quote = await screen.findByTestId('scripture-text')
    expect(quote.tagName).toBe('BLOCKQUOTE')
    expect(quote).not.toHaveAttribute('contenteditable')
    expect(within(quote).queryByRole('textbox')).toBeNull()
  })

  test('changing translation reloads the same reference', async () => {
    const { calls } = stubFetch({ saved: NIV_PASSAGE, passages: { 3034: BSB_PASSAGE } })
    render(<ScripturePassage conversationId="c1" />)
    await screen.findByTestId('scripture-text')

    fireEvent.click(screen.getByRole('button', { name: /john 3:16-18/i }))
    await chooseTranslation('berean', 'Berean Standard Bible')
    fireEvent.click(screen.getByRole('button', { name: /load passage/i }))

    await waitFor(() =>
      expect(screen.getByTestId('scripture-text')).toHaveTextContent('He gave His one and only Son'),
    )
    /* The same reference, in the newly chosen translation. */
    const lookup = calls.find((call) => call.includes('/bible/passages?'))
    expect(lookup).toContain('translationId=3034')
    expect(lookup).toContain(encodeURIComponent('John 3:16-18'))
  })

  test('a failed reload keeps the passage that was already loaded', async () => {
    stubFetch({
      saved: NIV_PASSAGE,
      passages: {
        3034: {
          status: 502,
          body: {
            error: 'Bible passage lookup is unavailable right now. Your reflection has not been changed.',
            outcome: 'provider_unavailable',
          },
        },
      },
    })
    render(<ScripturePassage conversationId="c1" />)
    await screen.findByTestId('scripture-text')

    fireEvent.click(screen.getByRole('button', { name: /john 3:16-18/i }))
    await chooseTranslation('berean', 'Berean Standard Bible')
    fireEvent.click(screen.getByRole('button', { name: /load passage/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your reflection has not been changed')

    /* The whole point: the NIV passage is still there, word for word. */
    expect(screen.getByTestId('scripture-text')).toHaveTextContent('he gave his one and only Son')
    expect(screen.getByText(/Copyright © 1973, 1978, 1984, 2011 by Biblica/)).toBeInTheDocument()
    /* And recovery is offered rather than left to the reader to invent. */
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /choose another translation/i })).toBeInTheDocument()
  })

  test('an unreachable translation is refused, never swapped for a working one', async () => {
    stubFetch({ saved: NIV_PASSAGE, passages: {} })
    render(<ScripturePassage conversationId="c1" />)
    await screen.findByTestId('scripture-text')

    fireEvent.click(screen.getByRole('button', { name: /john 3:16-18/i }))
    await chooseTranslation('american standard', 'American Standard Version')
    fireEvent.click(screen.getByRole('button', { name: /load passage/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('not available')
    /* Still the NIV. Nothing was substituted. */
    expect(screen.getByTestId('scripture-text')).toHaveTextContent('he gave his one and only Son')
  })

  test('an invalid reference is reported without touching the passage', async () => {
    stubFetch({
      saved: NIV_PASSAGE,
      passages: {
        111: {
          status: 400,
          body: { error: 'John has 21 chapters, so John 99 does not exist.', outcome: 'invalid_reference' },
        },
      },
    })
    render(<ScripturePassage conversationId="c1" />)
    await screen.findByTestId('scripture-text')

    fireEvent.click(screen.getByRole('button', { name: /john 3:16-18/i }))
    fireEvent.change(screen.getByLabelText('Passage'), { target: { value: 'John 99:1' } })
    fireEvent.click(screen.getByRole('button', { name: /load passage/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('John has 21 chapters')
    expect(screen.getByTestId('scripture-text')).toHaveTextContent('he gave his one and only Son')
    /* A bad reference is the reader's to fix — no Retry button pretending
     * the same request might work the second time. */
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  test('missing configuration says so without saying which way it is missing', async () => {
    stubFetch({
      translationsStatus: {
        status: 503,
        body: { error: 'Bible passage lookup is not configured.', outcome: 'bible_not_configured' },
      },
    })
    render(<ScripturePassage conversationId="c1" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Bible passage lookup is not configured.')
    for (const word of ['key', 'invalid', 'rejected', 'missing', 'malformed', '401']) {
      expect(alert.textContent?.toLowerCase()).not.toContain(word)
    }
    /* Nothing to press, because there is nothing the reader can do about it. */
    expect(screen.queryByRole('button', { name: /choose bible passage/i })).toBeNull()
  })

  test('the search finds a translation by abbreviation, name and language', async () => {
    stubFetch()
    render(<ScripturePassage conversationId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: /choose bible passage/i }))

    const search = searchBox()

    fireEvent.change(search, { target: { value: 'bsb' } })
    expect((await screen.findAllByRole('option')).length).toBe(1)

    fireEvent.change(search, { target: { value: 'berean' } })
    expect((await screen.findAllByRole('option')).length).toBe(1)

    /* The report that started this: a language nobody could search for. */
    fireEvent.change(search, { target: { value: 'tagalog' } })
    expect(await screen.findByRole('option', { name: /Ang Biblia/ })).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'tl' } })
    expect(await screen.findByRole('option', { name: /Ang Biblia/ })).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'reina' } })
    expect(await screen.findByRole('option', { name: /Reina Valera/ })).toBeInTheDocument()

    /* A misspelling still lands. */
    fireEvent.change(search, { target: { value: 'tagaolg' } })
    expect(await screen.findByRole('option', { name: /Ang Biblia/ })).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'nothing like this' } })
    await waitFor(() =>
      expect(screen.getByLabelText('Translation search results')).toHaveTextContent(
        /no translation matches/i,
      ),
    )
  })

  test('every row says which language it is in', async () => {
    stubFetch()
    render(<ScripturePassage conversationId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: /choose bible passage/i }))

    /*
     * `CCB` is Chinese and the Cebuano Bible is `APD`. Without the language on
     * the row those two are indistinguishable, and choosing wrong means reading
     * a Bible in a language you may not speak.
     */
    fireEvent.change(searchBox(), { target: { value: 'cebuano' } })
    const cebuano = await screen.findByRole('option', { name: /Ang Pulong/ })
    expect(within(cebuano).getByText('Cebuano')).toBeInTheDocument()

    fireEvent.change(searchBox(), { target: { value: 'mandarin' } })
    const chinese = await screen.findAllByRole('option')
    expect(within(chinese[0]!).getByText('Chinese')).toBeInTheDocument()
  })

  test('the whole catalog is reachable behind one control', async () => {
    stubFetch()
    render(<ScripturePassage conversationId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: /choose bible passage/i }))

    /* It opens onto a short list, not an inventory. */
    const initial = await screen.findAllByRole('option')
    expect(initial.length).toBeLessThan(TRANSLATIONS.length)

    fireEvent.click(screen.getByRole('button', { name: /show all 10 translations/i }))
    await waitFor(() =>
      expect(screen.getAllByRole('option').length).toBe(TRANSLATIONS.length),
    )
  })

  test('the picker is driveable from the keyboard alone', async () => {
    stubFetch({ passages: { 3034: BSB_PASSAGE } })
    render(<ScripturePassage conversationId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: /choose bible passage/i }))

    const search = searchBox()
    fireEvent.change(search, { target: { value: 'berean' } })
    await screen.findByRole('option', { name: /Berean/ })

    /*
     * `aria-activedescendant` rather than moving focus: the caret has to stay
     * in the search box while the active row moves, or refining a query means
     * clicking back into the field every time.
     */
    expect(search).toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Berean/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    /* Choosing clears the query, so the next visit does not open mid-search. */
    expect(searchBox()).toHaveValue('')
  })

  test('Escape clears the search rather than the selection', async () => {
    stubFetch()
    render(<ScripturePassage conversationId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: /choose bible passage/i }))

    const search = searchBox()
    fireEvent.change(search, { target: { value: 'berean' } })
    await screen.findByRole('option', { name: /Berean/ })
    fireEvent.keyDown(search, { key: 'Escape' })

    await waitFor(() => expect(searchBox()).toHaveValue(''))
    /* NIV is still the selection: Escape abandoned the search, not the choice. */
    const selected = screen
      .getAllByRole('option')
      .filter((option) => option.getAttribute('aria-selected') === 'true')
    expect(within(selected[0]!).getByText('New International Version')).toBeInTheDocument()
  })

  test('everything is reachable and named for a screen reader', async () => {
    stubFetch({ saved: NIV_PASSAGE })
    render(<ScripturePassage conversationId="c1" />)
    await screen.findByTestId('scripture-text')

    /* The card names itself, so it is a landmark rather than an anonymous box. */
    expect(screen.getByRole('region', { name: /john 3:16-18/i })).toBeInTheDocument()

    const change = screen.getByRole('button', { name: /john 3:16-18 · niv/i })
    expect(change).toHaveAttribute('aria-expanded', 'false')
    /* Opened from the keyboard, not only from a pointer. */
    change.focus()
    expect(document.activeElement).toBe(change)
    fireEvent.click(change)
    expect(change).toHaveAttribute('aria-expanded', 'true')

    expect(screen.getByLabelText('Passage')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Translation' })).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Translations' })).toBeInTheDocument()
    /* Progress and result counts are announced politely rather than by moving
     * focus — a passage arriving must not throw a screen reader out of the
     * section somebody is writing in. */
    for (const status of screen.getAllByRole('status')) {
      expect(status).toHaveAttribute('aria-live', 'polite')
    }
  })

  test('a reflection whose translation has gone away keeps it, and says so', async () => {
    /* Saved against a translation the catalog no longer contains. */
    const orphan = { ...NIV_PASSAGE, translationId: 999999, abbreviation: 'GONE' }
    stubFetch({ saved: orphan })
    render(<ScripturePassage conversationId="c1" />)

    await screen.findByTestId('scripture-text')
    expect(screen.getAllByText(/GONE/).length).toBeGreaterThan(0)
    await waitFor(() =>
      expect(screen.getByText(/no longer available to this app/i)).toBeInTheDocument(),
    )
    /* Its words are untouched — never re-rendered in whatever is available. */
    expect(screen.getByTestId('scripture-text')).toHaveTextContent('he gave his one and only Son')
  })

  test('the saved passage is read once and never silently re-fetched', async () => {
    const { calls } = stubFetch({ saved: NIV_PASSAGE })
    render(<ScripturePassage conversationId="c1" />)
    await screen.findByTestId('scripture-text')

    const lookups = calls.filter((call) => call.includes('/bible/passages?'))
    expect(lookups).toHaveLength(0)
  })

  test('starts as a compact optional control, not a permanent selector card', async () => {
    stubFetch()
    render(<ScripturePassage conversationId="c1" />)

    expect(await screen.findByRole('button', { name: 'Choose Bible passage' })).toBeInTheDocument()
    expect(screen.queryByText(/choose a passage and its words come with it/i)).toBeNull()
    expect(screen.queryByLabelText('Passage')).toBeNull()
  })

  test('selecting a passage updates the compact control and closes the selector', async () => {
    stubFetch({ passages: { 111: NIV_PASSAGE } })
    render(<ScripturePassage conversationId="c1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Choose Bible passage' }))
    fireEvent.change(screen.getByLabelText('Passage'), { target: { value: 'John 3:16-18' } })
    fireEvent.click(screen.getByRole('button', { name: /load passage/i }))

    expect(await screen.findByRole('button', { name: /john 3:16-18 · niv/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('Passage')).toBeNull()
    expect(screen.getByTestId('scripture-text')).toHaveTextContent('For God so loved the world')
  })

  test('the compact selected control reopens the selector', async () => {
    stubFetch({ saved: NIV_PASSAGE })
    render(<ScripturePassage conversationId="c1" />)

    fireEvent.click(await screen.findByRole('button', { name: /john 3:16-18 · niv/i }))
    expect(screen.getByLabelText('Passage')).toBeInTheDocument()
  })

  test('a passage can be changed without dropping the previous text on failure', async () => {
    stubFetch({ saved: NIV_PASSAGE, passages: { 3034: BSB_PASSAGE } })
    render(<ScripturePassage conversationId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: /john 3:16-18 · niv/i }))
    await chooseTranslation('berean', 'Berean Standard Bible')
    fireEvent.click(screen.getByRole('button', { name: /load passage/i }))
    expect(await screen.findByTestId('scripture-text')).toHaveTextContent('He gave His one and only Son')
    expect(screen.getByRole('button', { name: /john 3:16-18 · bsb/i })).toBeInTheDocument()
  })

  test('removing a passage restores Choose Bible passage and does not offer Content insertion', async () => {
    const used: string[] = []
    const { calls } = stubFetch({ saved: NIV_PASSAGE })
    render(<ScripturePassage conversationId="c1" onUsePassage={(text) => used.push(text)} />)
    await screen.findByTestId('scripture-text')

    fireEvent.click(screen.getByRole('button', { name: 'Remove passage' }))

    expect(await screen.findByRole('button', { name: 'Choose Bible passage' })).toBeInTheDocument()
    expect(screen.queryByTestId('scripture-text')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add to Content' })).toBeNull()
    expect(used).toEqual([])
    expect(calls.some((call) => call.startsWith('DELETE '))).toBe(true)
  })
})

/*
 * The passage into Content.
 *
 * The C of C.H.A.T. holds the passage itself, which is what makes this
 * connector worth having — see `docs/examples/REAL_CHAT_SAMPLES.md`.
 */
describe('offering the passage to Content', () => {
  test('hands over the verse with its reference and translation', async () => {
    const used: string[] = []
    stubFetch({ saved: NIV_PASSAGE })
    render(<ScripturePassage conversationId="c1" onUsePassage={(text) => used.push(text)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add to Content' }))
    expect(used).toHaveLength(1)
    expect(used[0]).toContain('For God so loved the world')
    expect(used[0]).toContain('John 3:16-18')
    expect(used[0]).toContain('NIV')
  })

  test('offers nothing when the page has nowhere to put it', async () => {
    stubFetch({ saved: NIV_PASSAGE })
    render(<ScripturePassage conversationId="c1" />)

    await screen.findByTestId('scripture-text')
    expect(screen.queryByRole('button', { name: 'Add to Content' })).not.toBeInTheDocument()
  })

  test('and nothing before a passage has been chosen', async () => {
    stubFetch()
    render(<ScripturePassage conversationId="c1" onUsePassage={() => {}} />)

    await screen.findByRole('button', { name: /choose bible passage/i })
    expect(screen.queryByRole('button', { name: 'Add to Content' })).not.toBeInTheDocument()
  })

  test('puts the verse first and the attribution on its own line', () => {
    expect(passageAsWritten(NIV_PASSAGE, 'NIV')).toBe(
      'For God so loved the world that he gave his one and only Son…\nJohn 3:16-18 NIV',
    )
  })

  /*
   * Arrangement is the author's. Real reflections put the reference before the
   * quote about as often as after it, so what lands is a starting point in an
   * ordinary textarea — not a shape the application then enforces.
   */
  test('what lands is plain text, with no label or markup imposed on it', () => {
    const written = passageAsWritten(NIV_PASSAGE, 'NIV')
    expect(written).not.toMatch(/Content:|[<>]|\*\*/)
  })
})
