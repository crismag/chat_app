import { useEffect, useId, useRef, useState } from 'react'

import { apiUrl } from '../shared/api/client.ts'
import { Sheet } from '../shared/mobile/Sheet.tsx'
import { Avatar } from '../shared/ui/Avatar.tsx'
import { cropRect } from './crop.ts'
import styles from './AvatarField.module.css'

/*
 * Choosing, framing and removing a profile picture.
 *
 * ── Why the cropping happens here and not on the server ─────────────────────
 *
 * The server accepts a small square and checks that it really is one. It does
 * not resize, re-encode or decode pixels, which keeps an untrusted-image
 * decoder out of the API entirely. So the browser has to produce the square:
 * it already has the file, a canvas, and — most importantly — the person who
 * can say which part of the photograph is their face.
 *
 * ── Why a crop step exists at all ───────────────────────────────────────────
 *
 * Every photograph a person owns is the wrong shape for a circle, and the
 * centre of a photograph is very rarely the centre of a face. Without this the
 * common outcome is a beheaded avatar, and the only remedy on offer would be
 * "crop it yourself and try again".
 */

/** The stored square. Large enough for a retina profile header, no larger. */
const EXPORT_SIZE = 512

/** What the person drags inside. Matches the CSS, and the crop maths needs it. */
const VIEWPORT = 288

const MAX_ZOOM = 4

/*
 * JPEG, and quality rather than size. A photograph as PNG is several megabytes
 * and would fail the server's limit; at 512px and 0.85 a photograph lands well
 * under it. Avatars are drawn inside a circle, so nothing here needs alpha.
 */
const EXPORT_TYPE = 'image/jpeg'
const EXPORT_QUALITY = 0.85

export function AvatarField({
  name,
  identity,
  avatarUrl,
  onChanged,
}: {
  name: string
  identity: string
  avatarUrl: string | null
  /** Handed the fresh profile view, so the new URL — stamp and all — comes from the server. */
  onChanged: (avatarUrl: string | null) => void
}) {
  const ids = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<{ url: string; width: number; height: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* An object URL is a live handle to a file; it is released when it is done. */
  useEffect(() => {
    if (!picked) return
    return () => URL.revokeObjectURL(picked.url)
  }, [picked])

  function choose(file: File | undefined) {
    setError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('That file is not a picture.')
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => setPicked({ url, width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      setError('That picture could not be opened.')
    }
    image.src = url
  }

  async function send(body: BodyInit | null, method: 'PUT' | 'DELETE', contentType?: string) {
    setBusy(true)
    setError(null)
    try {
      /*
       * `apiUrl`, not a bare `/api/...` path.
       *
       * This was the only request in the application written as a relative
       * URL. In development it worked, because the dev server proxies /api to
       * the API; in production the web app is served from one host and the API
       * answers on another, so the upload went to the static host, which
       * replied with its 404 *page*. `response.json()` then failed on the
       * first character of `<!DOCTYPE`, and the person adding a picture was
       * shown a JSON parse error.
       *
       * It is a plain `fetch` rather than `api()` because the body is a Blob
       * and the client sets its own Content-Type; only the base was missing.
       */
      const response = await fetch(apiUrl('/profiles/me/avatar'), {
        method,
        credentials: 'include',
        ...(contentType ? { headers: { 'Content-Type': contentType } } : {}),
        ...(body ? { body } : {}),
      })
      /*
       * A response that is not JSON is a response from something that is not
       * this API — a proxy error page, a captive portal, a host's 404. Saying
       * so beats letting the parser's message reach somebody as if it were
       * about their picture.
       */
      const view = (await response.json().catch(() => null)) as
        | { avatarUrl?: string | null; error?: string }
        | null
      if (!response.ok || !view) {
        throw new Error(view?.error ?? 'That picture could not be saved.')
      }
      onChanged(view.avatarUrl ?? null)
      setPicked(null)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That picture could not be saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.field}>
      <span className={styles.legend} id={`${ids}-legend`}>
        Picture
      </span>

      <div className={styles.row}>
        <Avatar name={name} identity={identity} src={avatarUrl} size="large" />

        <div className={styles.actions}>
          {/*
            A real file input, labelled as a button. The native control is the
            only one that reaches a camera on a phone and a file picker on a
            desktop, so it is styled rather than replaced.
          */}
          <label className={styles.action} htmlFor={`${ids}-file`}>
            {avatarUrl ? 'Change picture' : 'Add a picture'}
          </label>
          <input
            ref={fileInput}
            id={`${ids}-file`}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              choose(event.target.files?.[0])
              /* Cleared, so choosing the same file twice still fires a change. */
              event.target.value = ''
            }}
          />

          {avatarUrl ? (
            <button
              type="button"
              className={styles.action}
              disabled={busy}
              onClick={() => void send(null, 'DELETE')}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {picked ? (
        <CropSheet
          picture={picked}
          busy={busy}
          onCancel={() => setPicked(null)}
          onConfirm={async (blob) => {
            await send(blob, 'PUT', EXPORT_TYPE)
          }}
        />
      ) : null}
    </div>
  )
}

function CropSheet({
  picture,
  busy,
  onCancel,
  onConfirm,
}: {
  picture: { url: string; width: number; height: number }
  busy: boolean
  onCancel: () => void
  onConfirm: (blob: Blob) => Promise<void>
}) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)

  const rect = cropRect({
    imageWidth: picture.width,
    imageHeight: picture.height,
    zoom,
    offsetX: offset.x,
    offsetY: offset.y,
    viewport: VIEWPORT,
  })

  /*
   * Pointer events rather than touch or mouse events: one code path covers a
   * finger, a trackpad and a stylus, and pointer capture means a drag that
   * leaves the frame keeps working instead of sticking.
   */
  function move(event: React.PointerEvent) {
    if (!drag.current) return
    const from = drag.current
    drag.current = { x: event.clientX, y: event.clientY }
    setOffset((current) => ({
      x: current.x + (event.clientX - from.x),
      y: current.y + (event.clientY - from.y),
    }))
  }

  async function confirm() {
    const canvas = document.createElement('canvas')
    canvas.width = EXPORT_SIZE
    canvas.height = EXPORT_SIZE
    const context = canvas.getContext('2d')
    if (!context) return

    const image = new Image()
    image.src = picture.url
    /* Already decoded once to measure it, so this resolves immediately. */
    if (!image.complete) await image.decode().catch(() => undefined)
    context.drawImage(image, rect.sx, rect.sy, rect.size, rect.size, 0, 0, EXPORT_SIZE, EXPORT_SIZE)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, EXPORT_TYPE, EXPORT_QUALITY)
    })
    if (blob) await onConfirm(blob)
  }

  return (
    <Sheet
      open
      onClose={onCancel}
      title="Position your picture"
      description="Drag to move it, and use the slider to zoom."
      footer={
        <div className={styles.footer}>
          <button type="button" className="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Use this picture'}
          </button>
        </div>
      }
    >
      <div
        className={styles.viewport}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <img
          className={styles.picture}
          src={picture.url}
          alt=""
          draggable={false}
          style={{
            /*
             * The same model the crop maths uses: cover the frame, then apply
             * the zoom and the drag. If these two ever disagree, the exported
             * square is not the square the person framed.
             */
            width: `${String((picture.width / Math.min(picture.width, picture.height)) * zoom * 100)}%`,
            transform: `translate(calc(-50% + ${String(offset.x)}px), calc(-50% + ${String(offset.y)}px))`,
          }}
        />
        <div className={styles.mask} aria-hidden="true" />
      </div>

      <label className={styles.zoom}>
        <span>Zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
      </label>
    </Sheet>
  )
}
