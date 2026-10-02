import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()

window.addEventListener('popstate', () => listeners.forEach((fn) => fn()))

export function navigate(path: string): void {
  history.pushState(null, '', path)
  listeners.forEach((fn) => fn())
}

export function usePathname(): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => location.pathname,
  )
}
