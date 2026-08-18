import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { StatusBar, Style } from '@capacitor/status-bar'
import { isNativeApp } from './platform.ts'

/** Keyboard resize and status bar. Deep links are handled in `DeepLinks`. */
export async function bootstrapNative(): Promise<void> {
  if (!isNativeApp()) return

  await Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => undefined)
  await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined)
  await StatusBar.setStyle({ style: Style.Light }).catch(() => undefined)
  await StatusBar.setBackgroundColor({ color: '#f7f1e6' }).catch(() => undefined)
}
