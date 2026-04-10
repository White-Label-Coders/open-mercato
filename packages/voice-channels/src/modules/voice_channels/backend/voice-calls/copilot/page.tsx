'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { Button } from '@open-mercato/ui/primitives/button'
import type {
  TranscriptSegment,
  SuggestionCard,
  CallStartEventPayload,
  CallEndEventPayload,
} from '@open-mercato/voice-channels/modules/voice_channels/types'
import demoScriptJson from '../../../data/demo-scripts/demo-1-acme-steel.json'
import { DEMO_SUGGESTIONS } from '../../../data/demo-scripts/demo-suggestions'

import { CallHeader } from '../../../components/copilot/CallHeader'
import { TranscriptFeed } from '../../../components/copilot/TranscriptFeed'
import { SuggestionStack } from '../../../components/copilot/SuggestionStack'
import { CopilotToggle } from '../../../components/copilot/CopilotToggle'

type DemoScript = {
  callId: string
  phoneNumber: string
  direction: 'inbound' | 'outbound'
  customerId: string
  customerName: string
  companyName: string
  language: string
  segments: Array<{
    segmentId: number
    speaker: 'rep' | 'customer'
    text: string
    delayMs: number
    expectedIntent?: string
  }>
}

const demoScript = demoScriptJson as DemoScript

const COPILOT_KEYFRAMES = `
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes highlightPulse { 0%, 100% { box-shadow: 0 0 0 rgba(234, 179, 8, 0); } 50% { box-shadow: 0 0 16px rgba(234, 179, 8, 0.4); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
`

const APP_EVENT_DOM_NAME = 'om:event'

function dispatchAppEvent(id: string, payload: unknown) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(APP_EVENT_DOM_NAME, {
      detail: { id, payload, tenantId: null, organizationId: null, createdAt: Date.now() },
    }),
  )
}

export default function CopilotPage() {
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = COPILOT_KEYFRAMES
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [suggestions, setSuggestions] = useState<SuggestionCard[]>([])
  const [callActive, setCallActive] = useState(false)
  const [callInfo, setCallInfo] = useState<CallStartEventPayload | null>(null)
  const [copilotEnabled, setCopilotEnabled] = useState(true)
  const [callDuration, setCallDuration] = useState(0)
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<number | null>(null)
  const [intentToast, setIntentToast] = useState<string | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t))
    timersRef.current = []
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  useAppEvent('voice_channels.call.started', (event) => {
    const payload = event.payload as unknown as CallStartEventPayload
    setCallActive(true)
    setCallInfo(payload)
    setSegments([])
    setSuggestions([])
    setCallDuration(0)
  })

  useAppEvent('voice_channels.call.ended', (event) => {
    const payload = event.payload as unknown as CallEndEventPayload
    setCallActive(false)
    setCallDuration(payload.durationSeconds)
  })

  useAppEvent('voice_channels.call.transcript_segment', (event) => {
    const payload = event.payload as { segment: TranscriptSegment }
    setSegments((prev) => [...prev, payload.segment])
  })

  useAppEvent(
    'voice_channels.copilot.suggestion',
    (event) => {
      if (!copilotEnabled) return
      const payload = event.payload as { suggestion: SuggestionCard }
      const card = payload.suggestion

      if (card.detectedIntent) {
        setIntentToast(card.detectedIntent)
        setTimeout(() => setIntentToast(null), 1200)
      }
      if (card.triggerSegmentId > 0) {
        setHighlightedSegmentId(card.triggerSegmentId)
        setTimeout(() => setHighlightedSegmentId(null), 4000)
      }

      setSuggestions((prev) => {
        const filtered = prev.filter((s) => s.type !== card.type || Date.now() - s.createdAt < 60000)
        const priorityOrder: Record<SuggestionCard['priority'], number> = { high: 0, medium: 1, low: 2 }
        return [...filtered, card]
          .sort((a, b) => {
            const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
            if (pDiff !== 0) return pDiff
            return b.createdAt - a.createdAt
          })
          .slice(0, 5)
      })
    },
    [copilotEnabled],
  )

  const runLocalReplay = useCallback(() => {
    clearTimers()
    const startedAt = Date.now()
    dispatchAppEvent('voice_channels.call.started', {
      callId: demoScript.callId,
      phoneNumber: demoScript.phoneNumber,
      direction: demoScript.direction,
      customerId: demoScript.customerId,
      customerName: demoScript.customerName,
      companyName: demoScript.companyName,
      startedAt,
    } satisfies CallStartEventPayload)

    let cumulative = 0
    let segmentCount = 0
    let suggestionCount = 0
    for (const seg of demoScript.segments) {
      cumulative += seg.delayMs
      const segCumulative = cumulative
      const transcriptSegment: TranscriptSegment = {
        segmentId: seg.segmentId,
        speaker: seg.speaker,
        text: seg.text,
        confidence: 0.95,
        isFinal: true,
        startTime: segCumulative / 1000,
        endTime: segCumulative / 1000 + 2,
        language: demoScript.language,
      }
      timersRef.current.push(
        setTimeout(() => {
          dispatchAppEvent('voice_channels.call.transcript_segment', {
            callId: demoScript.callId,
            segment: transcriptSegment,
          })
          segmentCount += 1
        }, segCumulative),
      )

      const synthCard = DEMO_SUGGESTIONS[seg.segmentId]
      if (synthCard) {
        timersRef.current.push(
          setTimeout(() => {
            const card: SuggestionCard = {
              ...synthCard,
              id: `${synthCard.type}-${seg.segmentId}-${Date.now()}`,
              triggerSegmentId: seg.segmentId,
              triggerText: seg.text,
              createdAt: Date.now(),
            } as SuggestionCard
            dispatchAppEvent('voice_channels.copilot.suggestion', {
              callId: demoScript.callId,
              suggestion: card,
            })
            suggestionCount += 1
          }, segCumulative + 400),
        )
      }
    }

    timersRef.current.push(
      setTimeout(() => {
        dispatchAppEvent('voice_channels.call.ended', {
          callId: demoScript.callId,
          durationSeconds: Math.round(cumulative / 1000),
          segmentCount,
          suggestionCount,
        } satisfies CallEndEventPayload)
      }, cumulative + 1500),
    )
  }, [clearTimers])

  const handleStartDemo = useCallback(() => {
    runLocalReplay()
  }, [runLocalReplay])

  const handleStopDemo = useCallback(() => {
    clearTimers()
    dispatchAppEvent('voice_channels.call.ended', {
      callId: callInfo?.callId ?? demoScript.callId,
      durationSeconds: Math.round((Date.now() - (callInfo?.startedAt ?? Date.now())) / 1000),
      segmentCount: segments.length,
      suggestionCount: suggestions.length,
    } satisfies CallEndEventPayload)
  }, [callInfo, clearTimers, segments.length, suggestions.length])

  const handleDismiss = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId))
  }, [])

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card text-foreground shadow-sm"
      style={{ height: 'calc(100dvh - 11rem)' }}
    >
      <CallHeader callActive={callActive} callInfo={callInfo} callDuration={callDuration} />

      <div className="flex min-h-0 flex-1 gap-px overflow-hidden border-y bg-border">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
          <div className="border-b px-5 py-4 text-sm font-semibold text-muted-foreground">
            Transkrypcja na żywo
          </div>
          <TranscriptFeed segments={segments} highlightedSegmentId={highlightedSegmentId} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/30">
          <div className="flex items-center justify-between border-b px-5 py-4 text-sm font-semibold text-muted-foreground">
            <span>🤖 Call Copilot</span>
            <CopilotToggle enabled={copilotEnabled} onChange={setCopilotEnabled} />
          </div>
          {intentToast && (
            <div
              className="flex items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-[13px] font-semibold text-amber-900"
              style={{ animation: 'fadeIn 0.2s ease-in' }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                style={{ animation: 'pulse 1s infinite' }}
              />
              Wykryto intencję: {intentToast}
            </div>
          )}
          <SuggestionStack suggestions={suggestions} onDismiss={handleDismiss} />
        </div>
      </div>

      <div className="flex items-center gap-3 border-t bg-card px-5 py-3">
        {!callActive ? (
          <Button type="button" onClick={handleStartDemo}>▶ Start Demo Call</Button>
        ) : (
          <Button type="button" variant="destructive" onClick={handleStopDemo}>■ End Call</Button>
        )}
        <span className="text-xs text-muted-foreground">
          {segments.length} segmentów · {suggestions.length} sugestii
        </span>
      </div>
    </div>
  )
}
