import { useEffect, useState } from 'react'
import {
  CREATE_LAYOUTS,
  CREATE_STYLES,
  emptyChatSections,
  type ConversationSummary,
  type CreateLayout,
  type CreateStyle,
  type ChatSection,
  type ChatSectionType,
} from '@chat/shared'
import { FIELD_NAMES } from '../chat/sections.ts'
import { api } from '../shared/api/client.ts'
import styles from './CreatePage.module.css'

/*
 * A section's name as a reader should see it.
 *
 * Both the exported image and the preview used to print `section.type` — the
 * raw lowercase enum. That is a machine identifier on a card someone shares
 * publicly, and it is also the one place where a row that had escaped the
 * Context-to-Content migration would have painted the retired name onto a
 * picture. The fallback is the type itself, because a card missing a label is
 * worse than a card with an ugly one.
 */
function nameOf(type: string): string {
  return FIELD_NAMES[type] ?? type
}

type Creation = {
  title: string
  scriptureReference: string | null
  layout: CreateLayout
  style: CreateStyle
  sections: Record<ChatSectionType, ChatSection>
  textRenderedBy: string
}

export function CreatePage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationId, setConversationId] = useState('')
  const [layout, setLayout] = useState<CreateLayout>(CREATE_LAYOUTS.QUOTE_FOCUS)
  const [style, setStyle] = useState<CreateStyle>(CREATE_STYLES.CREAM_BOTANICAL)
  const [creation, setCreation] = useState<Creation | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<ConversationSummary[]>('/conversations')
      .then((items) => {
        setConversations(items)
        setConversationId(items[0]?.id ?? '')
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Unable to load conversations')
      })
  }, [])

  async function preview() {
    if (!conversationId) {
      return
    }
    setError(null)
    try {
      setCreation(
        await api<Creation>('/creations', {
          method: 'POST',
          body: JSON.stringify({ conversationId, layout, style }),
        }),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to preview')
    }
  }

  function exportPng() {
    if (!creation) {
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 1080
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }
    context.fillStyle = style === CREATE_STYLES.DARK_WORSHIP ? '#1b1a17' : '#f6efe4'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = style === CREATE_STYLES.DARK_WORSHIP ? '#f6efe4' : '#2b241c'
    context.font = '32px Georgia'
    context.fillText(creation.title, 80, 140)
    if (creation.scriptureReference) {
      context.font = '24px sans-serif'
      context.fillText(creation.scriptureReference, 80, 190)
    }
    context.font = '28px Georgia'
    let y = 280
    const sections = creation.sections ?? emptyChatSections()
    for (const section of Object.values(sections)) {
      if (!section.content) {
        continue
      }
      context.fillText(`${nameOf(section.type)}: ${section.content.slice(0, 80)}`, 80, y)
      y += 90
    }
    const link = document.createElement('a')
    link.download = `${creation.title}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <section className={styles.page}>
      <h1>Create</h1>
      <p>
        Layout and style are applied by the app. Text is never sent to an image
        model.
      </p>
      <div className={styles.controls}>
        <select value={conversationId} onChange={(event) => setConversationId(event.target.value)}>
          {conversations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <select value={layout} onChange={(event) => setLayout(event.target.value as CreateLayout)}>
          {Object.values(CREATE_LAYOUTS).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={style} onChange={(event) => setStyle(event.target.value as CreateStyle)}>
          {Object.values(CREATE_STYLES).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void preview()}>
          Preview
        </button>
        <button type="button" onClick={exportPng} disabled={!creation}>
          Export PNG
        </button>
      </div>
      {error ? <p>{error}</p> : null}
      {creation ? (
        <article className={styles.card} data-style={style} data-layout={layout}>
          <p className={styles.kicker}>{creation.scriptureReference}</p>
          <h2>{creation.title}</h2>
          {Object.values(creation.sections).map((section) =>
            section.content ? (
              <p key={section.type}>
                <strong>{nameOf(section.type)}:</strong> {section.content}
              </p>
            ) : null,
          )}
          <p className={styles.note}>Text rendered by {creation.textRenderedBy}</p>
        </article>
      ) : null}
    </section>
  )
}
