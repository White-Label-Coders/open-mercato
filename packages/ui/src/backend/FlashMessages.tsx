"use client"
import * as React from 'react'
import { X } from 'lucide-react'
import { IconButton } from '../primitives/icon-button'
import { Button } from '../primitives/button'

export type FlashKind = 'success' | 'error' | 'warning' | 'info'
export type FlashAction = {
  label: string
  onClick: () => void
}
export type FlashOptions = {
  message: string
  type?: FlashKind
  action?: FlashAction
}

// Programmatic API to show a flash message without navigation.
// Consumers can import { flash } and call flash('text', 'error').
export function flash(message: string, type: FlashKind = 'info') {
  dispatchFlash({ message, type })
}

export function notify(options: FlashOptions) {
  dispatchFlash(options)
}

function dispatchFlash(options: FlashOptions) {
  if (typeof window === 'undefined') return
  const evt = new CustomEvent<FlashOptions>('flash', { detail: options })
  window.dispatchEvent(evt)
}

export function useNotify() {
  return React.useCallback((options: FlashOptions) => {
    notify(options)
  }, [])
}

type HistoryMethod = History['pushState']

function useLocationKey() {
  const [locationKey, setLocationKey] = React.useState(() => {
    if (typeof window === 'undefined') return ''
    return window.location.href
  })
  const locationKeyRef = React.useRef(locationKey)

  React.useEffect(() => {
    locationKeyRef.current = locationKey
  }, [locationKey])

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    let active = true
    const scheduleUpdate = (href: string) => {
      const run = () => {
        if (!active) return
        if (locationKeyRef.current === href) return
        locationKeyRef.current = href
        setLocationKey(href)
      }
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(run)
      } else {
        setTimeout(run, 0)
      }
    }
    const updateLocation = () => {
      if (!active) return
      const href = window.location.href
      if (href === locationKeyRef.current) return
      scheduleUpdate(href)
    }

    const deferredUpdateLocation = () => {
      setTimeout(updateLocation, 0)
    }

    const originalPush: HistoryMethod = window.history.pushState.bind(window.history)
    const originalReplace: HistoryMethod = window.history.replaceState.bind(window.history)

    const pushState: HistoryMethod = (...args) => {
      originalPush(...args)
      deferredUpdateLocation()
    }

    const replaceState: HistoryMethod = (...args) => {
      originalReplace(...args)
      deferredUpdateLocation()
    }

    window.history.pushState = pushState
    window.history.replaceState = replaceState
    window.addEventListener('popstate', updateLocation)
    window.addEventListener('hashchange', updateLocation)
    updateLocation()

    return () => {
      active = false
      window.history.pushState = originalPush
      window.history.replaceState = originalReplace
      window.removeEventListener('popstate', updateLocation)
      window.removeEventListener('hashchange', updateLocation)
    }
  }, [])

  return locationKey
}

function FlashMessagesInner() {
  const [current, setCurrent] = React.useState<FlashOptions | null>(null)
  const locationKey = useLocationKey()
  const dismissTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearDismissTimer = React.useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const showFlash = React.useCallback((options: FlashOptions) => {
    clearDismissTimer()
    setCurrent({
      message: options.message,
      type: options.type ?? 'info',
      action: options.action,
    })
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null
      setCurrent(null)
    }, 3000)
  }, [clearDismissTimer])

  React.useEffect(() => {
    return () => {
      clearDismissTimer()
    }
  }, [clearDismissTimer])

  // Read flash from URL on any navigation change (client-side too)
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const message = url.searchParams.get('flash')
    const type = (url.searchParams.get('type') as FlashKind | null) || 'success'
    if (message) {
      showFlash({ message, type })
      url.searchParams.delete('flash')
      url.searchParams.delete('type')
      window.history.replaceState({}, '', url.toString())
    }
  }, [locationKey, showFlash])

  // Listen for programmatic flash events
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<FlashOptions>
      const text = ce.detail?.message
      if (!text) return
      showFlash({
        message: text,
        type: ce.detail?.type ?? 'info',
        action: ce.detail?.action,
      })
    }
    window.addEventListener('flash', handler as EventListener)
    return () => window.removeEventListener('flash', handler as EventListener)
  }, [showFlash])

  if (!current) return null

  const kind = current.type ?? 'info'
  const color = kind === 'success' ? 'bg-emerald-600' : kind === 'error' ? 'bg-red-600' : kind === 'warning' ? 'bg-amber-500' : 'bg-blue-600'

  return (
    <div className="pointer-events-none fixed left-3 right-3 top-3 z-[1200] sm:left-auto sm:right-4 sm:w-[380px]">
      <div className={`pointer-events-auto rounded px-3 py-2 text-white shadow-md ${color}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm">{current.message}</div>
            {current.action ? (
              <div className="mt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="bg-white/15 text-white hover:bg-white/25"
                  onClick={() => {
                    current.action?.onClick()
                    setCurrent(null)
                  }}
                >
                  {current.action.label}
                </Button>
              </div>
            ) : null}
          </div>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            className="text-white/90 hover:text-white hover:bg-white/10"
            onClick={() => setCurrent(null)}
            aria-label="Dismiss"
          >
            <X size={16} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

export function FlashMessages() {
  return (
    <React.Suspense fallback={null}>
      <FlashMessagesInner />
    </React.Suspense>
  )
}
