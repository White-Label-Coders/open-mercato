'use client'

import type { ReactNode } from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'

type CopilotTone = 'blue' | 'emerald' | 'amber' | 'violet' | 'cyan'

const TONE_STYLES: Record<
  CopilotTone,
  {
    card: string
    header: string
    title: string
    dismiss: string
    badge: string
  }
> = {
  blue: {
    card: 'border-blue-500/40 border-l-4 border-l-blue-400 bg-slate-950 text-slate-100',
    header: 'border-b border-blue-500/20 bg-slate-900/90',
    title: 'text-blue-300',
    dismiss: 'text-blue-300 hover:bg-blue-500/15 hover:text-blue-200',
    badge: 'border-blue-500/40 bg-blue-500/15 text-blue-200',
  },
  emerald: {
    card: 'border-emerald-500/40 border-l-4 border-l-emerald-400 bg-slate-950 text-slate-100',
    header: 'border-b border-emerald-500/20 bg-slate-900/90',
    title: 'text-emerald-300',
    dismiss: 'text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200',
    badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  },
  amber: {
    card: 'border-amber-500/40 border-l-4 border-l-amber-400 bg-slate-950 text-slate-100',
    header: 'border-b border-amber-500/20 bg-slate-900/90',
    title: 'text-amber-300',
    dismiss: 'text-amber-300 hover:bg-amber-500/15 hover:text-amber-200',
    badge: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  },
  violet: {
    card: 'border-violet-500/40 border-l-4 border-l-violet-400 bg-slate-950 text-slate-100',
    header: 'border-b border-violet-500/20 bg-slate-900/90',
    title: 'text-violet-300',
    dismiss: 'text-violet-300 hover:bg-violet-500/15 hover:text-violet-200',
    badge: 'border-violet-500/40 bg-violet-500/15 text-violet-200',
  },
  cyan: {
    card: 'border-cyan-500/40 border-l-4 border-l-cyan-400 bg-slate-950 text-slate-100',
    header: 'border-b border-cyan-500/20 bg-slate-900/90',
    title: 'text-cyan-300',
    dismiss: 'text-cyan-300 hover:bg-cyan-500/15 hover:text-cyan-200',
    badge: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
  },
}

interface CopilotCardFrameProps {
  tone: CopilotTone
  title: string
  icon: string
  triggerText?: string
  badge?: ReactNode
  onDismiss: () => void
  dismissLabel: string
  children: ReactNode
}

export function CopilotCardFrame({
  tone,
  title,
  icon,
  triggerText,
  badge,
  onDismiss,
  dismissLabel,
  children,
}: CopilotCardFrameProps) {
  const styles = TONE_STYLES[tone]

  return (
    <Card className={cn('gap-0 overflow-hidden rounded-xl border py-0 shadow-sm', styles.card)}>
      <CardHeader className={cn('grid-cols-[1fr_auto] gap-3 px-4 py-3', styles.header)}>
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className={cn('flex items-center gap-2 text-sm font-semibold', styles.title)}>
            <span aria-hidden>{icon}</span>
            <span>{title}</span>
          </CardTitle>
          {badge}
        </div>
        <CardAction className="col-start-2 row-start-1 row-span-1">
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            className={cn('h-auto', styles.dismiss)}
            onClick={onDismiss}
            aria-label={dismissLabel}
          >
            ✕
          </IconButton>
        </CardAction>
      </CardHeader>
      {triggerText ? (
        <CardContent className="border-b px-4 py-3">
          <p className="text-xs italic text-slate-400">&ldquo;{triggerText}&rdquo;</p>
        </CardContent>
      ) : null}
      <CardContent className="px-4 py-4">{children}</CardContent>
    </Card>
  )
}

export function CopilotAccentBadge({
  tone,
  className,
  children,
}: {
  tone: CopilotTone
  className?: string
  children: ReactNode
}) {
  return (
    <Badge variant="outline" className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', TONE_STYLES[tone].badge, className)}>
      {children}
    </Badge>
  )
}
