import { useCallback, useEffect, useState } from 'react'

declare const chrome: any

const hasChromeStorage = () => typeof chrome !== 'undefined' && !!chrome?.storage?.local

/**
 * A value persisted in chrome.storage.local (or localStorage when running
 * outside the extension, e.g. `npm run dev`). Returns [value, set, loading].
 * Stays in sync if the popup and the full window are open at the same time.
 */
export function useChromeStorage<T>(key: string, initial: T): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    if (hasChromeStorage()) {
      chrome.storage.local.get([key], (res: Record<string, unknown>) => {
        if (!alive) return
        if (res && key in res) setValue(res[key] as T)
        setLoading(false)
      })
      const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area === 'local' && key in changes) setValue((changes[key].newValue ?? initial) as T)
      }
      chrome.storage.onChanged.addListener(onChange)
      return () => {
        alive = false
        chrome.storage.onChanged.removeListener(onChange)
      }
    }
    try {
      const raw = localStorage.getItem(key)
      if (raw != null) setValue(JSON.parse(raw) as T)
    } catch {
      /* unavailable or corrupt: keep the default */
    }
    setLoading(false)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const set = useCallback(
    (next: T) => {
      setValue(next)
      if (hasChromeStorage()) chrome.storage.local.set({ [key]: next })
      else
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          /* ignore */
        }
    },
    [key],
  )

  return [value, set, loading]
}
