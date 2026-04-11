'use client'

import { useRef, useEffect } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import type { TranscriptSegment } from '../../types'

interface TranscriptFeedProps {
  segments: TranscriptSegment[]
  highlightedSegmentId?: number | null
}

const SPEAKER_STYLES: Record<
  string,
  { labelKey: string; fallbackLabel: string; container: string; badge: string; dot: string }
> = {
  rep: {
    labelKey: 'voice_channels.copilot.transcript.speaker.rep',
    fallbackLabel: 'Sales rep',
    container: 'border-blue-500/30 bg-slate-950',
    badge: 'border-blue-500/40 bg-blue-500/15 text-blue-200',
    dot: 'bg-blue-500',
  },
  customer: {
    labelKey: 'voice_channels.copilot.transcript.speaker.customer',
    fallbackLabel: 'Customer',
    container: 'border-violet-500/30 bg-slate-950',
    badge: 'border-violet-500/40 bg-violet-500/15 text-violet-200',
    dot: 'bg-violet-500',
  },
  unknown: {
    labelKey: 'voice_channels.copilot.transcript.speaker.unknown',
    fallbackLabel: 'Unknown',
    container: 'border-slate-700 bg-slate-950',
    badge: 'border-slate-600 bg-slate-800 text-slate-200',
    dot: 'bg-slate-400',
  },
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function TranscriptFeed({ segments, highlightedSegmentId }: TranscriptFeedProps) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [segments.length])

  if (segments.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[15px] text-slate-500">
        {t('voice_channels.copilot.transcript.waiting', 'Waiting for transcript...')}
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
      <div className="space-y-3">
        {segments.map((segment) => {
          const style = SPEAKER_STYLES[segment.speaker] || SPEAKER_STYLES.unknown
          const isHighlighted = segment.segmentId === highlightedSegmentId

          return (
            <div
              key={segment.segmentId}
              className={cn(
                'animate-[fadeIn_0.3s_ease-in] rounded-xl border p-4 shadow-xs transition-all',
                style.container,
                isHighlighted &&
                  'animate-[highlightPulse_1.5s_ease-in-out_2] border-amber-400 bg-amber-500/10 shadow-md',
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn('inline-block size-2 rounded-full', isHighlighted ? 'bg-amber-500' : style.dot)}
                  />
                  <Badge
                    variant="outline"
                    className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', style.badge)}
                  >
                    {t(style.labelKey, style.fallbackLabel)}
                  </Badge>
                </div>
                <span className="text-[11px] text-slate-500">
                  {formatTime(segment.startTime)}
                </span>
              </div>
              <div className="text-[15px] leading-6 text-slate-100">{segment.text}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
