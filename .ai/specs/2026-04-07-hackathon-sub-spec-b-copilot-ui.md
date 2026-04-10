# SUB-SPEC-B — Frontend Call Copilot UI

**Parent**: `.ai/specs/HACKATHON-MASTER-SPEC.md` (§1 shared contracts, §3 source)
**Sibling MVP doc**: `.ai/specs/2026-04-07-hackathon-copilot-ui-mvp.md`
**Agent**: Rafał's AI agent
**Edition**: OSS
**Status**: Pending / hackathon

---

## 1. TLDR

Self-contained frontend delivery for the Voice Channels Call Copilot: a full-screen page at `/backend/voice-calls/copilot` plus a component tree (CallHeader, TranscriptFeed, SuggestionStack, CopilotToggle, and 5 card components) consuming four frozen SSE events through `useAppEvent()`. No backend code, no MCP tools, no seed data — those are owned by Sub-Specs A and C. The UI is buildable and demoable in isolation via a `?mock=local` fallback that replays a static demo script JSON.

---

## 2. Overview

This spec lives inside the standalone `@open-mercato/voice-channels` package (NOT inside `@open-mercato/core`). It produces only files under:

```
packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/
packages/voice-channels/src/modules/voice_channels/widgets/
```

Boundaries:

- **Consumes from Sub-Spec A**: events `voice_channels.call.{started,ended,transcript_segment}` and `voice_channels.copilot.suggestion`; HTTP endpoints `POST /api/voice_channels/mock/{start,stop}`.
- **Consumes from Sub-Spec C**: the demo script JSON at `packages/voice-channels/src/modules/voice_channels/data/demo-scripts/demo-1-acme-steel.json` (shape `MockCallScript`).
- **Produces**: React components. No database entities, no API routes, no subscribers, no workers.

---

## 3. Problem Statement

A sales rep on a live voice call needs contextual assistance (product matches, price floors, customer history, open deals, next-step actions) within the same second the customer raises a topic. Traditional tools require the rep to task-switch and search during the call, which breaks rapport and loses deals. The Call Copilot UI must surface relevant information *reactively* from the transcript, with visual cause-effect linkage, and without blocking or cluttering the rep's primary focus: the conversation.

---

## 4. Proposed Solution

A single full-screen React page that:

- Subscribes via `useAppEvent()` to the four frozen event IDs defined in `HACKATHON-MASTER-SPEC.md` §1.5.
- Maintains entirely client-side state (`segments`, `suggestions`, `callActive`, `callInfo`, `copilotEnabled`, `callDuration`, `highlightedSegmentId`, `intentToast`).
- Renders a split layout: live transcript (left 50%) + prioritized suggestion stack (right 50%), with a blue/green call header on top and a control bar at the bottom.
- Reacts to each `voice_channels.copilot.suggestion` by: (a) flashing a 1.2 s amber intent toast, (b) glowing the triggering transcript segment for 4 s via `triggerSegmentId`, (c) deduplicating + sorting + slicing the suggestion stack to top 5.
- Offers a dev-only `?mock=local` fallback that replays the static demo JSON through local `setState` calls, bypassing SSE entirely for isolated development.

---

## 5. Architecture

### 5.1 File Tree

```
packages/voice-channels/src/modules/voice_channels/
├── backend/
│   └── voice-calls/
│       └── copilot/
│           ├── page.tsx              # Main page, SSE subscriptions, layout
│           ├── CallHeader.tsx
│           ├── TranscriptFeed.tsx
│           ├── SuggestionStack.tsx
│           ├── CopilotToggle.tsx
│           └── cards/
│               ├── ProductCard.tsx
│               ├── PricingCard.tsx
│               ├── ContextCard.tsx
│               ├── DealCard.tsx
│               └── ActionCard.tsx
├── widgets/
│   ├── injection-table.ts            # Maps widget files to spot IDs
│   └── injection/
│       └── copilot-panel/
│           ├── widget.ts             # InjectionWidgetModule metadata
│           └── CopilotPanel.tsx      # (optional) Sidebar variant
```

### 5.2 Component Responsibilities

| Component | Responsibility |
|---|---|
| `page.tsx` | Owns all state, subscribes to 4 events, injects keyframes, wires Start/Stop buttons, renders layout. |
| `CallHeader` | Displays contact + phone + direction, pulsing live dot, tabular-num elapsed timer. |
| `TranscriptFeed` | Renders scrolling list of `TranscriptSegment`s, auto-scrolls on new segment, highlights `highlightedSegmentId`. |
| `SuggestionStack` | Renders top-5 `SuggestionCard`s with slide-in animation; dispatches dismiss. |
| `CopilotToggle` | Client-side ON/OFF pill. |
| `ProductCard` / `PricingCard` / `ContextCard` / `DealCard` / `ActionCard` | Render the 5 discriminated union types of `SuggestionCard`. Each has: colored left border, header w/ icon + confidence badge, trigger-text quote, type-specific body, dismiss ✕. |

### 5.3 State

| State | Type | Reset on |
|---|---|---|
| `segments` | `TranscriptSegment[]` | `call.started` |
| `suggestions` | `SuggestionCard[]` (top 5) | `call.started` |
| `callActive` | `boolean` | `call.started` / `call.ended` |
| `callInfo` | `CallStartEventPayload \| null` | `call.started` |
| `copilotEnabled` | `boolean` | User toggle |
| `callDuration` | `number` (seconds) | `call.ended` payload |
| `highlightedSegmentId` | `number \| null` | Auto-clear after 4 s |
| `intentToast` | `string \| null` | Auto-clear after 1.2 s |

### 5.4 Event → State Transition Table

| Event ID | Action |
|---|---|
| `voice_channels.call.started` | `callActive=true`, `callInfo=payload`, clear `segments`, `suggestions`, reset `callDuration=0`. |
| `voice_channels.call.ended` | `callActive=false`, `callDuration=payload.durationSeconds`. |
| `voice_channels.call.transcript_segment` | Append `payload.segment` to `segments`. |
| `voice_channels.copilot.suggestion` | If `copilotEnabled`: set `intentToast` (1.2 s), set `highlightedSegmentId=card.triggerSegmentId` (4 s), dedup `suggestions` by `type` (60 s window), push new card, sort by `priority` then `createdAt desc`, slice top 5. |

### 5.5 Sort + Dedup Rule

```ts
const priorityOrder = { high: 0, medium: 1, low: 2 }
setSuggestions(prev => {
  const filtered = prev.filter(s => s.type !== card.type || Date.now() - s.createdAt < 60000)
  return [...filtered, card]
    .sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (pDiff !== 0) return pDiff
      return b.createdAt - a.createdAt
    })
    .slice(0, 5)
})
```

### 5.6 CSS Keyframes (injected once on mount)

```css
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes highlightPulse { 0%, 100% { box-shadow: 0 0 0 rgba(234, 179, 8, 0); } 50% { box-shadow: 0 0 16px rgba(234, 179, 8, 0.4); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
```

Transforms only — no layout-affecting animations — to keep the 1920×1080 projector render smooth.

---

## 6. Data Models

All types are **imported** from `@open-mercato/voice-channels/modules/voice_channels/types` (defined in `HACKATHON-MASTER-SPEC.md` §1.1). This spec defines **no new types**.

Consumed:

- `TranscriptSegment`
- `SuggestionCard` (discriminated union of `ProductSuggestionCard | PricingAlertCard | CustomerContextCard | DealStatusCard | QuickActionCard`)
- `CallStartEventPayload`, `CallEndEventPayload`
- `TranscriptSegmentEventPayload`, `CopilotSuggestionEventPayload`
- `MockCallScript` (only for `?mock=local` fallback replay)

---

## 7. API Contracts (consumed only)

| Method | Path | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/voice_channels/mock/start` | `{ script: MockCallScript }` | Start mock call in orchestrator. |
| `POST` | `/api/voice_channels/mock/stop` | `{ callId: string }` | Stop active mock call. |

All HTTP calls MUST use `apiCall` from `@open-mercato/ui/backend/utils/apiCall` — never raw `fetch`.

Response shape is opaque to the UI (fire-and-forget); the UI reacts to follow-up SSE events, not HTTP response bodies.

---

## 8. Injection & RBAC

### 8.1 Injection Spot IDs (from §1.7 of master spec)

| Spot ID | Purpose |
|---|---|
| `voice_channels.copilot.sidebar` | Sidebar variant of the Copilot panel (optional, for future embedding). |
| `voice_channels.call.controls` | Call control buttons area (reserved). |

Both registered in `widgets/injection-table.ts`. Primary demo uses the full-page at `/backend/voice-calls/copilot`, not the injected sidebar.

### 8.2 RBAC

Page metadata declares:

```ts
export const metadata = {
  requireAuth: true,
  requireFeatures: ['voice_channels.copilot.view'],
}
```

Feature IDs are defined in Sub-Spec A's `acl.ts` (see master spec §2.A.1).

---

## 9. Components — Full Source

All code blocks below are the verbatim contents to be created. They use inline styles (scoped to the demo) and match the shared contract types exactly.

### 9.1 `page.tsx`

```tsx
'use client'

import { useState, useCallback, useEffect } from 'react'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type {
  TranscriptSegment,
  SuggestionCard,
  CallStartEventPayload,
  CallEndEventPayload,
} from '@open-mercato/voice-channels/modules/voice_channels/types'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import demoScript from '../../data/demo-scripts/demo-1-acme-steel.json'

import { CallHeader } from './CallHeader'
import { TranscriptFeed } from './TranscriptFeed'
import { SuggestionStack } from './SuggestionStack'
import { CopilotToggle } from './CopilotToggle'

const COPILOT_KEYFRAMES = `
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes highlightPulse { 0%, 100% { box-shadow: 0 0 0 rgba(234, 179, 8, 0); } 50% { box-shadow: 0 0 16px rgba(234, 179, 8, 0.4); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
`

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
    setSegments(prev => [...prev, payload.segment])
  })

  useAppEvent('voice_channels.copilot.suggestion', (event) => {
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

    setSuggestions(prev => {
      const filtered = prev.filter(s => s.type !== card.type || Date.now() - s.createdAt < 60000)
      const updated = [...filtered, card]
      return updated
        .sort((a, b) => {
          const priorityOrder = { high: 0, medium: 1, low: 2 }
          const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
          if (pDiff !== 0) return pDiff
          return b.createdAt - a.createdAt
        })
        .slice(0, 5)
    })
  })

  const handleStartDemo = useCallback(async () => {
    await apiCall('/api/voice_channels/mock/start', {
      method: 'POST',
      body: JSON.stringify({ script: demoScript }),
    })
  }, [])

  const handleStopDemo = useCallback(async () => {
    await apiCall('/api/voice_channels/mock/stop', {
      method: 'POST',
      body: JSON.stringify({ callId: callInfo?.callId ?? demoScript.callId }),
    })
  }, [callInfo])

  const handleDismiss = useCallback((suggestionId: string) => {
    setSuggestions(prev => prev.filter(s => s.id !== suggestionId))
  }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: '#f8fafc',
    }}>
      <CallHeader callActive={callActive} callInfo={callInfo} callDuration={callDuration} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: '1px', backgroundColor: '#e2e8f0' }}>
        <div style={{ flex: '1 1 50%', backgroundColor: '#ffffff', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: '14px', color: '#475569' }}>
            Transkrypcja na żywo
          </div>
          <TranscriptFeed segments={segments} highlightedSegmentId={highlightedSegmentId} />
        </div>

        <div style={{ flex: '1 1 50%', backgroundColor: '#f8fafc', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: '14px', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>🤖 Call Copilot</span>
            <CopilotToggle enabled={copilotEnabled} onChange={setCopilotEnabled} />
          </div>
          {intentToast && (
            <div style={{
              padding: '8px 16px', backgroundColor: '#fef3c7', borderBottom: '1px solid #fde68a',
              fontSize: '13px', fontWeight: 600, color: '#92400e',
              display: 'flex', alignItems: 'center', gap: '8px', animation: 'fadeIn 0.2s ease-in',
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f59e0b', animation: 'pulse 1s infinite' }} />
              {intentToast}
            </div>
          )}
          <SuggestionStack suggestions={suggestions} onDismiss={handleDismiss} />
        </div>
      </div>

      <div style={{ padding: '12px 20px', backgroundColor: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '12px', alignItems: 'center' }}>
        {!callActive ? (
          <button onClick={handleStartDemo} style={{ padding: '8px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}>
            ▶ Start Demo Call
          </button>
        ) : (
          <button onClick={handleStopDemo} style={{ padding: '8px 24px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}>
            ■ End Call
          </button>
        )}
        <span style={{ fontSize: '13px', color: '#94a3b8' }}>
          {segments.length} segments · {suggestions.length} suggestions
        </span>
      </div>
    </div>
  )
}
```

### 9.2 `CallHeader.tsx`

```tsx
'use client'

import { useState, useEffect } from 'react'
import type { CallStartEventPayload } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface CallHeaderProps {
  callActive: boolean
  callInfo: CallStartEventPayload | null
  callDuration: number
}

export function CallHeader({ callActive, callInfo, callDuration }: CallHeaderProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!callActive || !callInfo) { setElapsed(0); return }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - callInfo.startedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [callActive, callInfo])

  const displayTime = callActive ? elapsed : callDuration
  const minutes = Math.floor(displayTime / 60)
  const seconds = displayTime % 60
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return (
    <div style={{
      padding: '16px 24px',
      backgroundColor: callActive ? '#1e40af' : '#334155',
      color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {callActive && (
          <span style={{ width: '10px', height: '10px', backgroundColor: '#22c55e', borderRadius: '50%', animation: 'pulse 2s infinite' }} />
        )}
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>
            {callInfo ? `${callInfo.customerName} — ${callInfo.companyName}` : 'Brak aktywnego połączenia'}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.8 }}>
            {callInfo ? callInfo.phoneNumber : '—'}
            {callInfo && ` · ${callInfo.direction === 'outbound' ? 'Połączenie wychodzące' : 'Połączenie przychodzące'}`}
          </div>
        </div>
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '2px' }}>
        {timeStr}
      </div>
    </div>
  )
}
```

### 9.3 `TranscriptFeed.tsx`

```tsx
'use client'

import { useRef, useEffect } from 'react'
import type { TranscriptSegment } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface TranscriptFeedProps {
  segments: TranscriptSegment[]
  highlightedSegmentId?: number | null
}

const SPEAKER_STYLES: Record<string, { color: string; label: string; bg: string }> = {
  rep: { color: '#2563eb', label: 'Handlowiec', bg: '#eff6ff' },
  customer: { color: '#7c3aed', label: 'Klient', bg: '#f5f3ff' },
  unknown: { color: '#6b7280', label: 'Nieznany', bg: '#f9fafb' },
}

export function TranscriptFeed({ segments, highlightedSegmentId }: TranscriptFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [segments.length])

  if (segments.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '15px' }}>
        Oczekiwanie na transkrypcję...
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      {segments.map((segment) => {
        const style = SPEAKER_STYLES[segment.speaker] || SPEAKER_STYLES.unknown
        const isHighlighted = segment.segmentId === highlightedSegmentId
        return (
          <div
            key={segment.segmentId}
            style={{
              marginBottom: '12px', padding: '12px 16px', borderRadius: '8px',
              backgroundColor: isHighlighted ? '#fefce8' : style.bg,
              borderLeft: `3px solid ${isHighlighted ? '#eab308' : style.color}`,
              animation: isHighlighted ? 'highlightPulse 1.5s ease-in-out 2' : 'fadeIn 0.3s ease-in',
              boxShadow: isHighlighted ? '0 0 12px rgba(234, 179, 8, 0.3)' : 'none',
              transition: 'all 0.3s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: style.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {style.label}
              </span>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{formatTime(segment.startTime)}</span>
            </div>
            <div style={{ fontSize: '15px', color: '#1e293b', lineHeight: 1.5 }}>{segment.text}</div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
```

### 9.4 `SuggestionStack.tsx`

```tsx
'use client'

import type { SuggestionCard } from '@open-mercato/voice-channels/modules/voice_channels/types'
import { ProductCard } from './cards/ProductCard'
import { PricingCard } from './cards/PricingCard'
import { ContextCard } from './cards/ContextCard'
import { DealCard } from './cards/DealCard'
import { ActionCard } from './cards/ActionCard'

interface SuggestionStackProps {
  suggestions: SuggestionCard[]
  onDismiss: (id: string) => void
}

export function SuggestionStack({ suggestions, onDismiss }: SuggestionStackProps) {
  if (suggestions.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '15px', padding: '20px', textAlign: 'center' }}>
        AI Copilot nasłuchuje rozmowy i zasugeruje odpowiednie produkty, ceny i działania...
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
      {suggestions.map((suggestion) => (
        <div key={suggestion.id} style={{ marginBottom: '12px', animation: 'slideIn 0.4s ease-out' }}>
          {renderCard(suggestion, onDismiss)}
        </div>
      ))}
    </div>
  )
}

function renderCard(card: SuggestionCard, onDismiss: (id: string) => void) {
  switch (card.type) {
    case 'product_suggestion':
      return <ProductCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'pricing_alert':
      return <PricingCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'customer_context':
      return <ContextCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'deal_status':
      return <DealCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'quick_action':
      return <ActionCard card={card} onDismiss={() => onDismiss(card.id)} />
    default:
      return null
  }
}
```

### 9.5 `CopilotToggle.tsx`

```tsx
'use client'

interface CopilotToggleProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

export function CopilotToggle({ enabled, onChange }: CopilotToggleProps) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px',
        backgroundColor: enabled ? '#dcfce7' : '#f1f5f9',
        border: `1px solid ${enabled ? '#86efac' : '#cbd5e1'}`,
        borderRadius: '16px', cursor: 'pointer',
        fontSize: '12px', fontWeight: 600,
        color: enabled ? '#166534' : '#64748b',
        transition: 'all 0.2s',
      }}
    >
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: enabled ? '#22c55e' : '#94a3b8' }} />
      {enabled ? 'ON' : 'OFF'}
    </button>
  )
}
```

### 9.6 `cards/ProductCard.tsx`

```tsx
'use client'

import { useState } from 'react'
import type { ProductSuggestionCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: ProductSuggestionCard; onDismiss: () => void }

export function ProductCard({ card, onDismiss }: Props) {
  const [addedProductIds, setAddedProductIds] = useState<Set<string>>(new Set())
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #2563eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '12px 16px', backgroundColor: '#eff6ff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e40af' }}>📦 Sugestia produktu</span>
          <span style={{
            fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '8px',
            backgroundColor: card.matchConfidence >= 80 ? '#dcfce7' : '#fef9c3',
            color: card.matchConfidence >= 80 ? '#166534' : '#854d0e',
          }}>
            {card.matchConfidence}% match
          </span>
        </div>
        <button onClick={onDismiss} style={dismissBtnStyle}>✕</button>
      </div>
      <div style={{ padding: '12px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
        "{card.triggerText}"
      </div>
      {card.products.map((product) => (
        <div key={product.id} style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>{product.name}</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>SKU: {product.sku}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: '16px', color: '#059669' }}>
                {product.price.amount.toFixed(2)} {product.price.currency}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>{product.price.priceType}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
            <span style={{ fontSize: '12px', color: product.available ? '#059669' : '#dc2626', fontWeight: 500 }}>
              {product.available
                ? `✓ W magazynie${product.stockQuantity ? ` (${product.stockQuantity} szt.)` : ''}`
                : '✗ Brak w magazynie'}
            </span>
            <button
              onClick={() => setAddedProductIds(prev => new Set(prev).add(product.id))}
              disabled={addedProductIds.has(product.id)}
              style={{
                padding: '4px 12px',
                backgroundColor: addedProductIds.has(product.id) ? '#dcfce7' : '#2563eb',
                color: addedProductIds.has(product.id) ? '#166534' : '#fff',
                border: addedProductIds.has(product.id) ? '1px solid #86efac' : 'none',
                borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                cursor: addedProductIds.has(product.id) ? 'default' : 'pointer',
                transition: 'all 0.3s ease',
              }}
            >
              {addedProductIds.has(product.id) ? '✓ Dodano do oferty' : '+ Dodaj do oferty'}
            </button>
          </div>
          {product.matchReason && (
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>{product.matchReason}</div>
          )}
        </div>
      ))}
    </div>
  )
}

const dismissBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px',
}
```

### 9.7 `cards/PricingCard.tsx`

```tsx
'use client'

import type { PricingAlertCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: PricingAlertCard; onDismiss: () => void }

export function PricingCard({ card, onDismiss }: Props) {
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #f59e0b', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '12px 16px', backgroundColor: '#fffbeb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#92400e' }}>💰 Alert cenowy</span>
          <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '8px', backgroundColor: '#fef9c3', color: '#854d0e' }}>
            {card.matchConfidence}% match
          </span>
        </div>
        <button onClick={onDismiss} style={dismissBtnStyle}>✕</button>
      </div>
      <div style={{ padding: '12px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
        "{card.triggerText}"
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
          <div style={{ flex: 1, textAlign: 'center', padding: '8px', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#64748b' }}>Cena klienta</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>
              {card.currentPrice.toFixed(2)} {card.currency}
            </div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', padding: '8px', backgroundColor: '#fef2f2', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#64748b' }}>Cena minimalna</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#dc2626' }}>
              {card.floorPrice.toFixed(2)} {card.currency}
            </div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', padding: '8px', backgroundColor: '#f0fdf4', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#64748b' }}>Max rabat</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#059669' }}>{card.maxDiscountPercent}%</div>
          </div>
        </div>
        {card.activePromotions.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Aktywne promocje:</div>
            {card.activePromotions.map((promo, i) => (
              <div key={i} style={{ fontSize: '12px', color: '#059669', padding: '4px 0' }}>
                🏷️ {promo.name}: {promo.discount} (do {promo.validUntil})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const dismissBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px',
}
```

### 9.8 `cards/ContextCard.tsx`

```tsx
'use client'

import type { CustomerContextCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: CustomerContextCard; onDismiss: () => void }

export function ContextCard({ card, onDismiss }: Props) {
  const c = card.customer
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #8b5cf6', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '12px 16px', backgroundColor: '#f5f3ff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#5b21b6' }}>👤 Kontekst klienta</span>
        <button onClick={onDismiss} style={dismissBtnStyle}>✕</button>
      </div>
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>{c.name}</div>
        <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '12px' }}>{c.company}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <StatBox label="Wartość klienta (LTV)" value={`${c.lifetimeValue.toLocaleString()} ${c.currency}`} />
          <StatBox label="Ostatnie zamówienie" value={c.lastOrderDate} />
          <StatBox label="Liczba zamówień" value={String(c.orderCount)} />
          <StatBox label="Śr. wartość zamówienia" value={`${c.avgOrderValue.toLocaleString()} ${c.currency}`} />
        </div>

        {c.topCategories.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Top kategorie:</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {c.topCategories.map((cat, i) => (
                <span key={i} style={{ padding: '2px 8px', backgroundColor: '#f1f5f9', borderRadius: '12px', fontSize: '11px', color: '#475569' }}>
                  {cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {c.notes && (
          <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fffbeb', borderRadius: '6px', fontSize: '12px', color: '#92400e' }}>
            📝 {c.notes}
          </div>
        )}
      </div>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '6px 8px', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>{value}</div>
    </div>
  )
}

const dismissBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px',
}
```

### 9.9 `cards/DealCard.tsx`

```tsx
'use client'

import type { DealStatusCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: DealStatusCard; onDismiss: () => void }

export function DealCard({ card, onDismiss }: Props) {
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #06b6d4', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '12px 16px', backgroundColor: '#ecfeff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#155e75' }}>📊 Otwarte deale</span>
        <button onClick={onDismiss} style={dismissBtnStyle}>✕</button>
      </div>
      <div style={{ padding: '0 16px 12px' }}>
        {card.deals.map((deal) => (
          <div key={deal.id} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>{deal.title}</span>
              <span style={{ fontWeight: 700, fontSize: '14px', color: '#059669' }}>
                {deal.value.toLocaleString()} {deal.currency}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '12px' }}>
              <span style={{ padding: '2px 8px', backgroundColor: '#f0f9ff', borderRadius: '4px', color: '#0369a1' }}>
                {deal.stage}
              </span>
              <span style={{ color: '#64748b' }}>{deal.daysInStage} dni w etapie</span>
              {deal.isStalled && (
                <span style={{ color: '#dc2626', fontWeight: 600, animation: 'pulse 2s infinite' }}>⚠ Wstrzymany</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const dismissBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px',
}
```

### 9.10 `cards/ActionCard.tsx`

```tsx
'use client'

import type { QuickActionCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: QuickActionCard; onDismiss: () => void }

export function ActionCard({ card, onDismiss }: Props) {
  const handleAction = (actionType: string) => {
    alert(`Akcja: ${actionType} — w produkcji otworzy formularz.`)
  }

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #22c55e', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '12px 16px', backgroundColor: '#f0fdf4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#166534' }}>⚡ Szybkie akcje</span>
        <button onClick={onDismiss} style={dismissBtnStyle}>✕</button>
      </div>
      <div style={{ padding: '12px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
        "{card.triggerText}"
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {card.actions.map((action, i) => (
          <button
            key={i}
            onClick={() => handleAction(action.actionType)}
            style={{
              padding: '8px 16px', backgroundColor: '#f0fdf4', color: '#166534',
              border: '1px solid #bbf7d0', borderRadius: '6px',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const dismissBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px',
}
```

---

## 10. Standalone Development Mode

Rafał's agent must be able to work without any Sub-Spec A runtime. Add a dev-only switch inside `page.tsx` that activates when `?mock=local` is present:

- Read `window.location.search` in a `useEffect`.
- If `mock=local`, iterate `demoScript.segments` with cumulative `setTimeout` (using `delayMs`), dispatching directly into local state via the same transitions the event handlers use.
- Suggestions are optionally layered on top by synthesizing `SuggestionCard` objects from a small hardcoded map keyed by `expectedIntent` so the UI can still demo all 5 card types without the orchestrator.
- The switch is a pure additive side-effect; remove or gate behind `NODE_ENV !== 'production'` before shipping.

This is the hard fallback for the Risk "SSE bridge not live at demo".

---

## 11. "Wow" Moments

| Effect | Trigger | Implementation |
|---|---|---|
| Intent toast | `voice_channels.copilot.suggestion` with `detectedIntent` | `intentToast` state, 1.2 s amber flash above suggestion stack. |
| Transcript segment glow | Same event; uses `card.triggerSegmentId` | `highlightedSegmentId`, 4 s `highlightPulse` keyframe. |
| Added to quote | User click on `+ Dodaj do oferty` | Local `addedProductIds` Set; button swaps to `✓ Dodano do oferty`. |
| Live dot | `callActive === true` | 10 px green circle, `pulse 2s infinite`. |
| Confidence badge | Every card header | Green ≥80, yellow <80 background. |
| Card slide-in | New card appended | `slideIn 0.4s ease-out` on wrapper. |

---

## 12. Accessibility & UX Notes

- Timer uses `fontVariantNumeric: tabular-nums` so seconds don't jiggle.
- Colors chosen for ≥ WCAG AA contrast on white / tinted backgrounds.
- Dismiss button is a native `<button>` so it's keyboard-focusable.
- Nice-to-have (not MVP): global `Escape` to dismiss the topmost card; focus ring on toggle; `aria-live="polite"` on transcript feed for screen readers.
- All interactive controls have visible hover/disabled states.

---

## 13. Risks & Impact Review

| # | Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | SSE bridge not live at demo time | High | Integration | `?mock=local` replays `demo-1-acme-steel.json` directly into state. | Low |
| 2 | Suggestion stack floods during long call | Medium | UX | 60 s dedup by `type` + top-5 slice + priority sort. | Low |
| 3 | Animation jank on 1920×1080 projector | Medium | Perf | CSS transforms only; no JS-driven layout; inline-style reads avoided. | Low |
| 4 | Inline styles drift from UI kit | Low | Consistency | Scoped to this demo page; documented hackathon exception; not reused elsewhere. | Accepted |
| 5 | Missing `demo-1-acme-steel.json` at build | High | Sub-Spec C dep | Commit a placeholder JSON with the `MockCallScript` shape so `import` resolves; Sub-Spec C later overwrites with realistic content. | Low |
| 6 | Event payload shape drift vs master spec | High | Contract | Import all types from `@open-mercato/voice-channels/modules/voice_channels/types`; CI type-check gates integration. | Low |
| 7 | Polish strings hard-coded in MVP | Low | i18n | Documented exception; localization tracked for post-hackathon work. | Accepted |

---

## 14. Integration Tests

Per `AGENTS.md`: integration tests live alongside the feature. Playwright test at `.ai/qa/tests/hackathon-copilot-ui.spec.ts`:

1. Navigate to `/backend/voice-calls/copilot?mock=local` (self-contained; no backend dependency).
2. Assert empty-state placeholder “Oczekiwanie na transkrypcję...” visible.
3. Click **Start Demo Call**; wait for first segment to render; assert speaker label `Handlowiec` or `Klient`.
4. Wait for first `ProductCard` to appear; assert it contains the expected SKU from the demo script.
5. Click the ✕ dismiss button on the product card; assert it is removed.
6. Toggle **CopilotToggle** to OFF; continue replay; assert `suggestions.length` does not grow.
7. Toggle back ON; continue; assert new card appears.
8. Click **End Call**; assert header color reverts to slate and footer shows final counts.

Test MUST create its own fixtures (the `?mock=local` fallback is self-contained) and clean up via `page.goto('about:blank')` in teardown.

---

## 15. Backward Compatibility

This spec introduces a brand-new package and new surface area. No existing contract is modified.

- **Category 6 (Widget Injection Spot IDs)**: Adds `voice_channels.copilot.sidebar` and `voice_channels.call.controls`. Additive only.
- **Category 7 (API Route URLs)**: Consumes new routes owned by Sub-Spec A; no existing route touched.
- **Category 5 (Event IDs)**: Consumes new event IDs owned by Sub-Spec A; frozen in §1.5 of master spec.

No deprecation path required.

---

## 16. Final Compliance Report

- **Task Router guides consulted**:
  - `packages/core/AGENTS.md` — module development, widget injection.
  - `packages/ui/AGENTS.md` — `apiCall` usage, inline style exception for demo page.
  - `packages/events/AGENTS.md` — DOM Event Bridge, `useAppEvent`.
  - `.ai/specs/AGENTS.md` — spec format rules.
- **Naming**: plural snake_case module (`voice_channels`), camelCase identifiers, dotted event IDs.
- **No `any`**: all event payloads narrowed via `as unknown as <PayloadType>`.
- **No raw `fetch`**: all HTTP via `apiCall`.
- **RBAC**: `requireFeatures: ['voice_channels.copilot.view']` on page metadata.
- **i18n exception**: Polish strings hard-coded for hackathon demo — documented and scoped to this page only.
- **Inline styles exception**: scoped to the demo page; not reused in other modules.
- **No cross-module ORM relations**: frontend-only, no ORM surface touched.

---

## 17. Verification Checklist

- [ ] Page renders at `/backend/voice-calls/copilot` with no console errors.
- [ ] `?mock=local` replay runs end-to-end without backend.
- [ ] TranscriptFeed auto-scrolls on new segments.
- [ ] All 5 card types render with correct styling and data.
- [ ] Cards animate in (slide/fade) without jank.
- [ ] Dismiss button removes card from stack.
- [ ] `CopilotToggle` disables new suggestions when OFF.
- [ ] `CallHeader` shows elapsed timer during active call and freezes on end.
- [ ] Transcript-segment glow fires on matching `triggerSegmentId`.
- [ ] Intent toast flashes before card slide-in.
- [ ] Empty states show Polish placeholder text.
- [ ] Layout intact at 1920×1080 (projector resolution).
- [ ] Playwright test `.ai/qa/tests/hackathon-copilot-ui.spec.ts` green.
- [ ] `npm run modules:prepare` clean.
- [ ] `yarn lint` clean for `@open-mercato/voice-channels`.

---

## 18. Changelog

- **2026-04-07** — Initial SUB-SPEC-B extracted from `HACKATHON-MASTER-SPEC.md` §3 for standalone Rafał-agent execution. Adds standalone `?mock=local` development mode, explicit integration test plan, risks table, and compliance report sections not present in the master spec.
