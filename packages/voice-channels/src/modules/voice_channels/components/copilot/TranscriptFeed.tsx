'use client'

import { useRef, useEffect } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranscriptSegment } from '../../types'

interface TranscriptFeedProps {
  segments: TranscriptSegment[]
  highlightedSegmentId?: number | null
}

const SPEAKER_STYLES: Record<string, { color: string; labelKey: string; fallbackLabel: string; bg: string }> = {
  rep: { color: '#2563eb', labelKey: 'voice_channels.copilot.transcript.speaker.rep', fallbackLabel: 'Sales rep', bg: '#eff6ff' },
  customer: { color: '#7c3aed', labelKey: 'voice_channels.copilot.transcript.speaker.customer', fallbackLabel: 'Customer', bg: '#f5f3ff' },
  unknown: { color: '#6b7280', labelKey: 'voice_channels.copilot.transcript.speaker.unknown', fallbackLabel: 'Unknown', bg: '#f9fafb' },
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
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: '15px',
        }}
      >
        {t('voice_channels.copilot.transcript.waiting', 'Waiting for transcript...')}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px' }}
    >
      {segments.map((segment) => {
        const style = SPEAKER_STYLES[segment.speaker] || SPEAKER_STYLES.unknown
        const isHighlighted = segment.segmentId === highlightedSegmentId

        return (
          <div
            key={segment.segmentId}
            style={{
              marginBottom: '12px',
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor: isHighlighted ? '#fefce8' : style.bg,
              borderLeft: `3px solid ${isHighlighted ? '#eab308' : style.color}`,
              animation: isHighlighted
                ? 'highlightPulse 1.5s ease-in-out 2'
                : 'fadeIn 0.3s ease-in',
              boxShadow: isHighlighted ? '0 0 12px rgba(234, 179, 8, 0.3)' : 'none',
              transition: 'all 0.3s ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '4px',
              }}
            >
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: style.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {t(style.labelKey, style.fallbackLabel)}
              </span>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                {formatTime(segment.startTime)}
              </span>
            </div>
            <div style={{ fontSize: '15px', color: '#1e293b', lineHeight: 1.5 }}>
              {segment.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}
