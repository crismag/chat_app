import { Directory, Filesystem } from '@capacitor/filesystem'
import { isNativeApp } from './platform.ts'
import { shareWithPlatform } from './share.ts'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Unable to read the image for saving.'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

function pngName(filename: string): string {
  const base = filename.trim() || 'reflection'
  return base.toLowerCase().endsWith('.png') ? base : `${base}.png`
}

/**
 * Save a PNG. On the web that is a download. On a device there is no download
 * bar, so the file is written then offered to the system share sheet — which is
 * how someone puts it in Photos, Files, or Messages without a second product
 * path.
 */
export async function savePng(blob: Blob, filename: string): Promise<'downloaded' | 'shared'> {
  const name = pngName(filename)
  if (isNativeApp()) {
    const saved = await Filesystem.writeFile({
      path: name,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    })
    await shareWithPlatform({ title: name, files: [saved.uri] })
    return 'shared'
  }

  const href = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = href
  link.download = name
  link.click()
  URL.revokeObjectURL(href)
  return 'downloaded'
}
