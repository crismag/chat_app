import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { App } from '@capacitor/app'
import { isNativeApp } from './platform.ts'
import { pathFromAppUrl } from './urls.ts'

/**
 * Follow Capacitor `appUrlOpen` into React Router. The URL is not a
 * permission; it is only a path. Auth still happens on the next API call.
 */
export function DeepLinks() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNativeApp()) return

    function go(url: string) {
      const path = pathFromAppUrl(url)
      if (path) navigate(path)
    }

    void App.getLaunchUrl()
      .then((launch) => {
        if (launch?.url) go(launch.url)
      })
      .catch(() => undefined)

    const ready = App.addListener('appUrlOpen', (event) => go(event.url))
    return () => {
      void ready.then((handle) => handle.remove())
    }
  }, [navigate])

  return null
}
