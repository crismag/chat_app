import { useState } from 'react'
import type { AiGuidanceSection } from '@chat/shared'

import { api } from '../shared/api/client.ts'
import { assistMessage } from './ai-message.ts'
import type { Chip } from './chips.ts'
import type { FieldType } from './types.ts'

/** The four sections a scoped conversation may be about. */
const SECTION_FIELDS: AiGuidanceSection[] = ['content', 'heart', 'application', 'testimony']

/*
 * The bounded conversation beside the card.
 *
 * `replying` is deliberately not the same thing as sending. Sending a message
 * is over in milliseconds and must never be held up by a provider; waiting for
 * a reply is a different, slower thing, and the composer stays usable
 * throughout it. Keeping both in one hook is what stops that distinction from
 * being quietly collapsed later.
 *
 * What travels to the server is an identifier from a fixed set, never prompt
 * text, and the scoped section as application state. The server decides what a
 * chip means, whether a turn may produce a draft at all, and where a draft
 * would go — not anything the model says.
 */
export function useReflectionChat({
  discussing,
  openedId,
  reopen,
}: {
  /** The section being worked on, when the conversation is scoped to one. */
  discussing: FieldType | null
  /** Which reflection is on screen right now, read at the moment a reply lands. */
  openedId: () => string | null
  /** Re-read a reflection so a stored reply appears. */
  reopen: (id: string) => Promise<unknown>
}) {
  const [replying, setReplying] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  /* A message whose reply is waiting behind the disclosure. */
  const [pendingChat, setPendingChat] = useState<
    { id: string; message: string; chip?: Chip } | null
  >(null)
  /** The last reply request, so "Try again" repeats it without re-sending it. */
  const [lastRequest, setLastRequest] = useState<
    { conversationId: string; message: string; chip?: Chip } | null
  >(null)


  async function requestReply(conversationId: string, message: string, chip?: Chip) {
    setReplying(true)
    setChatError(null)
    setLastRequest({ conversationId, message, ...(chip ? { chip } : {}) })
    try {
      await api('/ai/reflection-chat', {
        method: 'POST',
        body: JSON.stringify({
          conversationId,
          message,
          /*
           * An identifier from a fixed set, not prompt text. The server decides
           * what it means and — crucially — whether this turn may produce a
           * draft at all.
           */
          ...(chip ? { action: chip.action } : {}),
          ...(chip?.section ? { section: chip.section } : {}),
          /*
           * Scoped mode travels as application state. The server validates it
           * against the section enum anyway and uses it — not anything the
           * model says — to decide where a draft would go.
           */
          ...(discussing && SECTION_FIELDS.includes(discussing as never)
            ? { focusSection: discussing }
            : {}),
        }),
      })
      /*
       * The reply was stored server-side; re-reading is what puts it on screen.
       *
       * Only if the author is still here, though. A reply takes seconds, and in
       * those seconds they may have started a new reflection — at which point
       * re-opening the old one drags them back to a reflection they left AND
       * runs the switch reset over whatever they have begun typing in the new
       * one. Nothing is lost by skipping it: the reply is stored, and it is
       * there when they come back.
       */
      if (openedId() === conversationId) {
        await reopen(conversationId)
      }
    } catch (caught: unknown) {
      /*
       * A failed reply is not a failed message. What they wrote is already
       * saved, so this reports beside the thread and leaves it alone.
       */
      setChatError(assistMessage(caught))
    } finally {
      setReplying(false)
    }
  }

  function retryLast() {
    if (!lastRequest || replying) return
    void requestReply(lastRequest.conversationId, lastRequest.message, lastRequest.chip)
  }

  return {
    replying,
    chatError,
    setChatError,
    pendingChat,
    setPendingChat,
    lastRequest,
    requestReply,
    retryLast,
  }
}
