import { Share } from '@capacitor/share'
import { isNativeApp } from './platform.ts'

export type SharePayload = {
  title?: string
  text?: string
  url?: string
  files?: string[]
}

/**
 * Hand content to the platform share sheet when there is one, and fall back to
 * the clipboard on the web. Community never invents a public URL here — the
 * caller only passes a URL the server already authorised.
 */
export async function shareWithPlatform(payload: SharePayload): Promise<'shared' | 'copied'> {
  const title = payload.title?.trim() || undefined
  const text = payload.text?.trim() || undefined
  const url = payload.url?.trim() || undefined
  const files = payload.files?.filter(Boolean)

  if (isNativeApp()) {
    await Share.share({
      title,
      text,
      url,
      files,
      dialogTitle: title,
    })
    return 'shared'
  }

  if (typeof navigator.share === 'function' && !files?.length) {
    await navigator.share({ title, text, url })
    return 'shared'
  }

  const copied = url ?? text
  if (copied && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(copied)
    return 'copied'
  }

  throw new Error('Sharing is not available in this browser.')
}
