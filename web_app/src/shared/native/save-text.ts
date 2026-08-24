import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { isNativeApp } from './platform.ts'
import { shareWithPlatform } from './share.ts'

/**
 * Save a text file. On the web that is a download. On a device there is no
 * download bar, so the file is written then offered to the system share sheet.
 */
export async function saveTextFile(
  contents: string,
  filename: string,
  mimeType: string,
): Promise<'downloaded' | 'shared'> {
  const name = filename.trim() || 'chat-library.txt'
  if (isNativeApp()) {
    const saved = await Filesystem.writeFile({
      path: name,
      data: contents,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    })
    await shareWithPlatform({ title: name, files: [saved.uri] })
    return 'shared'
  }

  const href = URL.createObjectURL(new Blob([contents], { type: mimeType }))
  const link = window.document.createElement('a')
  link.href = href
  link.download = name
  link.click()
  URL.revokeObjectURL(href)
  return 'downloaded'
}
