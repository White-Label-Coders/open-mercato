# HACKATHON MASTER SPEC: Voice Channels Hub + AI Call Copilot

**Implementation Blueprint for 3 Parallel AI Coding Agents**

Open Mercato Hackathon 2026 · Track 3: Showcase · Sopot, 10–12 April

---

## 0. How to Read This Spec

This document is the **single source of truth** for all three parallel workstreams. It is structured for AI coding agents:

- **Section 1** — Shared contracts (types, events, interfaces). All three agents MUST read this first. It defines the data shapes that cross boundaries.
- **Section 2** — SUB-SPEC-A: Backend orchestrator + voice_channels module (Artur's agent)
- **Section 3** — SUB-SPEC-B: Frontend Copilot UI (Rafał's agent)
- **Section 4** — SUB-SPEC-C: Data layer, MCP tools, seed data, mock transcript simulator (Serhii's agent)

**Dependency rule**: Each sub-spec depends ONLY on Section 1 (shared contracts). Sub-specs do NOT depend on each other. All three can be built in complete isolation, then integrated.

**Codebase root**: All paths are relative to the monorepo root.

---

## 1. SHARED CONTRACTS — All Agents Must Implement These Exactly

These types are the integration boundary. Every agent produces or consumes these shapes. Any deviation breaks integration.

### 1.1 File: `packages/voice-channels/src/modules/voice_channels/types.ts`

This file MUST be created first by any agent that starts work. If the file already exists, do NOT overwrite — read and use the existing version.

```typescript
/**
 * Voice Channels — Shared Types
 *
 * Shared across hub module, provider packages, and Copilot UI.
 * SPEC-070 + SPEC-072
 */

// ─── Call Status ──────────────────────────────────────────────

export type UnifiedCallStatus =
  | 'ringing'
  | 'active'
  | 'on_hold'
  | 'completed'
  | 'missed'
  | 'failed'
  | 'voicemail'
  | 'cancelled'

// ─── Transcript Segment ──────────────────────────────────────

export interface TranscriptSegment {
  /** Sequential segment ID */
  segmentId: number
  /** Speaker label */
  speaker: 'rep' | 'customer' | 'unknown'
  /** Transcribed text */
  text: string
  /** Confidence score 0–1 */
  confidence: number
  /** Whether this is a final or interim result */
  isFinal: boolean
  /** Segment start time (seconds from call start) */
  startTime: number
  /** Segment end time (seconds from call start) */
  endTime: number
  /** ISO language code detected */
  language?: string
}

// ─── Intent Detection ────────────────────────────────────────

export type CopilotIntent =
  | 'product_need'
  | 'price_objection'
  | 'competitor_mention'
  | 'order_intent'
  | 'feature_question'
  | 'complaint'
  | 'small_talk'

export interface IntentDetectionResult {
  intent: CopilotIntent
  confidence: number
  /** Keywords that triggered this intent */
  keywords: string[]
  /** The segment that triggered this */
  segmentId: number
}

// ─── Suggestion Cards ────────────────────────────────────────

export type SuggestionCardType =
  | 'product_suggestion'
  | 'pricing_alert'
  | 'customer_context'
  | 'deal_status'
  | 'quick_action'

export interface SuggestionCardBase {
  /** Unique ID for this suggestion instance */
  id: string
  type: SuggestionCardType
  priority: 'high' | 'medium' | 'low'
  /** The customer speech that triggered this card */
  triggerText: string
  /** Segment ID that triggered this card (used for transcript highlighting) */
  triggerSegmentId: number
  /** Confidence score 0–100 shown on card UI */
  matchConfidence: number
  /** Detected intent label (shown in toast before card appears) */
  detectedIntent?: string
  /** Timestamp when this card was generated */
  createdAt: number
}

export interface ProductSuggestionCard extends SuggestionCardBase {
  type: 'product_suggestion'
  products: Array<{
    id: string
    name: string
    sku: string
    price: { amount: number; currency: string; priceType: string }
    available: boolean
    stockQuantity?: number
    matchReason: string
  }>
}

export interface PricingAlertCard extends SuggestionCardBase {
  type: 'pricing_alert'
  currentPrice: number
  floorPrice: number
  maxDiscountPercent: number
  currency: string
  activePromotions: Array<{
    name: string
    discount: string
    validUntil: string
  }>
}

export interface CustomerContextCard extends SuggestionCardBase {
  type: 'customer_context'
  customer: {
    id: string
    name: string
    company: string
    lifetimeValue: number
    currency: string
    lastOrderDate: string
    orderCount: number
    avgOrderValue: number
    topCategories: string[]
    openTickets: number
    assignedRep: string
    notes: string
  }
}

export interface DealStatusCard extends SuggestionCardBase {
  type: 'deal_status'
  deals: Array<{
    id: string
    title: string
    stage: string
    value: number
    currency: string
    daysInStage: number
    isStalled: boolean
  }>
}

export interface QuickActionCard extends SuggestionCardBase {
  type: 'quick_action'
  actions: Array<{
    label: string
    actionType: 'create_quote' | 'schedule_followup' | 'add_note'
    prefill?: Record<string, unknown>
  }>
}

export type SuggestionCard =
  | ProductSuggestionCard
  | PricingAlertCard
  | CustomerContextCard
  | DealStatusCard
  | QuickActionCard

// ─── SSE Event Payloads ──────────────────────────────────────

/**
 * These are the `payload` shapes inside AppEventPayload.
 * The event `id` tells the frontend which type to expect.
 */

export interface TranscriptSegmentEventPayload {
  callId: string
  segment: TranscriptSegment
}

export interface CopilotSuggestionEventPayload {
  callId: string
  suggestion: SuggestionCard
}

export interface CallStartEventPayload {
  callId: string
  phoneNumber: string
  direction: 'inbound' | 'outbound'
  customerId?: string
  customerName?: string
  companyName?: string
  startedAt: number
}

export interface CallEndEventPayload {
  callId: string
  durationSeconds: number
  segmentCount: number
  suggestionCount: number
}

// ─── Mock Call Script Format ─────────────────────────────────

export interface MockCallScript {
  callId: string
  phoneNumber: string
  direction: 'inbound' | 'outbound'
  customerId: string
  customerName: string
  companyName: string
  language: string
  segments: MockScriptSegment[]
}

export interface MockScriptSegment {
  segmentId: number
  speaker: 'rep' | 'customer'
  text: string
  /** Delay in ms BEFORE this segment is emitted (from previous segment) */
  delayMs: number
  /** Expected intent (for testing/validation) */
  expectedIntent?: CopilotIntent
}

// ─── MCP Tool Response Shapes ────────────────────────────────

export interface CopilotProductSearchResult {
  products: Array<{
    id: string
    name: string
    sku: string
    price: { amount: number; currency: string; priceType: string }
    available: boolean
    stockQuantity: number
    category: string
  }>
}

export interface CopilotCustomerContextResult {
  customer: {
    id: string
    name: string
    company: string
    lifetimeValue: number
    currency: string
    lastOrderDate: string
    orderCount: number
    avgOrderValue: number
    topCategories: string[]
    openTickets: number
    assignedRep: string
    notes: string
  }
}

export interface CopilotPricingCheckResult {
  productId: string
  productName: string
  basePrice: number
  customerPrice: number
  currency: string
  floorPrice: number
  maxDiscountPercent: number
  activePromotions: Array<{
    name: string
    discount: string
    validUntil: string
  }>
}

export interface CopilotOpenDealsResult {
  deals: Array<{
    id: string
    title: string
    stage: string
    value: number
    currency: string
    daysInStage: number
    isStalled: boolean
    probability: number
  }>
}
```

### 1.2 Shared barrel export

Create `packages/voice-channels/src/modules/voice_channels/index.ts`:

```typescript
export * from './types'
```

### 1.3 ORM Entity Reference — Actual Class Names

MCP tools and seed data MUST use these exact class names (discovered from codebase):

| Entity Class | Table | Module | Key Fields for Copilot |
|---|---|---|---|
| `CatalogProduct` | `catalog_products` | catalog | `id`, `title`, `sku`, `isActive`, `organizationId`, `primaryCurrencyCode` |
| `CatalogProductPrice` | `catalog_product_variant_prices` | catalog | `unitPriceNet`, `unitPriceGross`, `currencyCode`, `kind`, `minQuantity`, `customerId`, `customerGroupId` |
| `CatalogOffer` | `catalog_product_offers` | catalog | `title`, `isActive`, `startDate`, `endDate` |
| `CustomerEntity` | `customer_entities` | customers | `id`, `kind` ('person' or 'company'), `displayName`, `primaryEmail`, `primaryPhone`, `ownerUserId` |
| `CustomerPersonProfile` | `customer_people` | customers | `firstName`, `lastName`, `jobTitle`, `company` (ManyToOne → CustomerEntity) |
| `CustomerCompanyProfile` | `customer_companies` | customers | `legalName`, `brandName`, `industry`, `domain` |
| `CustomerDeal` | `customer_deals` | customers | `title`, `status`, `pipelineStageId`, `valueAmount`, `valueCurrency`, `probability`, `expectedCloseAt` |
| `CustomerActivity` | `customer_activities` | customers | `contactId`, `notes`, `createdAt` |
| `SalesOrder` | `sales_orders` | sales | `customerEntityId`, `grandTotalGrossAmount`, `currencyCode`, `status`, `placedAt` |
| `SalesOrderLine` | (via OneToMany on SalesOrder) | sales | `productName`, `quantity`, `unitPriceGross` |

**Customer model note**: Customers use a polymorphic pattern. `CustomerEntity` is the base with `kind: 'person'|'company'`. Person-specific data is in `CustomerPersonProfile` (OneToOne). To get a person with company: query `CustomerEntity` with `kind: 'person'`, populate `personProfile` and `personProfile.company`.

**EntityManager pattern** (use in MCP tools and API handlers):
```typescript
const em = (ctx.container.resolve('em') as EntityManager).fork()
const product = await em.findOne(CatalogProduct, { id: productId, organizationId: ctx.organizationId })
```

### 1.4 Environment Requirements

```bash
# Required for LLM intent detection (Copilot orchestrator)
ANTHROPIC_API_KEY=sk-ant-...

# Model for intent classification (fast, cheap)
COPILOT_INTENT_MODEL=claude-haiku-4-5-20251001

# Optional: Override for suggestion generation (higher quality)
COPILOT_SUGGESTION_MODEL=claude-sonnet-4-5-20241022
```

### 1.5 Event IDs — Frozen Contract

These event IDs are used by both backend (emitting) and frontend (subscribing). They MUST match exactly.

| Event ID | Payload Type | clientBroadcast | Emitted By |
|---|---|---|---|
| `voice_channels.call.started` | `CallStartEventPayload` | `true` | Sub-Spec A (orchestrator) |
| `voice_channels.call.ended` | `CallEndEventPayload` | `true` | Sub-Spec A (orchestrator) |
| `voice_channels.call.transcript_segment` | `TranscriptSegmentEventPayload` | `true` | Sub-Spec A (orchestrator) |
| `voice_channels.copilot.suggestion` | `CopilotSuggestionEventPayload` | `true` | Sub-Spec A (orchestrator) |

### 1.6 API Route Contract

| Method | Path | Purpose | Implemented By |
|---|---|---|---|
| `POST` | `/api/voice_channels/mock/start` | Start a mock call from a script JSON | Sub-Spec A |
| `POST` | `/api/voice_channels/mock/stop` | Stop an active mock call | Sub-Spec A |
| `GET` | `/api/voice_channels/mock/status` | Get status of current mock call | Sub-Spec A |
| `GET` | `/api/voice_channels/copilot/calls` | List active/recent calls for Copilot UI | Sub-Spec A |
| `POST` | `/api/voice_channels/mock/cache` | Toggle response cache on/off at runtime | Sub-Spec A |

### 1.7 Injection Spot IDs

| Spot ID | Purpose | Widget Provider |
|---|---|---|
| `voice_channels.copilot.sidebar` | Main Copilot panel in call view | Sub-Spec B |
| `voice_channels.call.controls` | Call control buttons | Sub-Spec B |

---

## 2. SUB-SPEC-A: Voice Channels Hub Module + Copilot Orchestrator

**Agent assignment**: Artur's AI agent
**Scope**: Backend-only. Creates the voice_channels module, mock transcript simulator, intent detection pipeline, and suggestion emission.
**Produces**: Events (via DOM Event Bridge) that the frontend consumes.
**Does NOT build**: Any UI components, any MCP tool handlers, any seed data.

### 2.A.1 Module Skeleton

Create the voice_channels module at `packages/voice-channels/src/modules/voice_channels/`.

Follow exactly the patterns from the customers module.

#### `packages/voice-channels/src/modules/voice_channels/index.ts`

```typescript
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'voice_channels',
  title: 'Voice Channels Hub',
  version: '0.1.0',
  description: 'Voice integration hub with AI Call Copilot for real-time sales assistance.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
```

#### `packages/voice-channels/src/modules/voice_channels/acl.ts`

```typescript
export const features = [
  { id: 'voice_channels.calls.view', title: 'View voice calls', module: 'voice_channels' },
  { id: 'voice_channels.calls.manage', title: 'Manage voice calls', module: 'voice_channels' },
  { id: 'voice_channels.copilot.view', title: 'View Call Copilot', module: 'voice_channels' },
  { id: 'voice_channels.copilot.configure', title: 'Configure Call Copilot', module: 'voice_channels' },
  { id: 'voice_channels.mock.manage', title: 'Use mock call simulator', module: 'voice_channels' },
]

export default features
```

#### `packages/voice-channels/src/modules/voice_channels/events.ts`

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'voice_channels.call.started',
    label: 'Voice Call Started',
    entity: 'call',
    category: 'lifecycle' as const,
    clientBroadcast: true,
  },
  {
    id: 'voice_channels.call.ended',
    label: 'Voice Call Ended',
    entity: 'call',
    category: 'lifecycle' as const,
    clientBroadcast: true,
  },
  {
    id: 'voice_channels.call.transcript_segment',
    label: 'Transcript Segment Received',
    entity: 'call',
    category: 'lifecycle' as const,
    clientBroadcast: true,
  },
  {
    id: 'voice_channels.copilot.suggestion',
    label: 'Copilot Suggestion Generated',
    entity: 'call',
    category: 'custom' as const,
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'voice_channels',
  events,
})

export const emitVoiceEvent = eventsConfig.emit

export type VoiceChannelsEventId = typeof events[number]['id']

export default eventsConfig
```

#### `packages/voice-channels/src/modules/voice_channels/setup.ts`

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/registry'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'voice_channels.calls.view',
      'voice_channels.calls.manage',
      'voice_channels.copilot.view',
      'voice_channels.copilot.configure',
      'voice_channels.mock.manage',
    ],
    employee: [
      'voice_channels.calls.view',
      'voice_channels.copilot.view',
    ],
  },
}
```

#### `packages/voice-channels/src/modules/voice_channels/di.ts`

```typescript
import { asValue, asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CopilotOrchestrator } from './lib/copilot/orchestrator'
import { MockTranscriptSimulator } from './lib/mock/simulator'
import { IntentDetector } from './lib/copilot/intent-detector'

export function register(container: AppContainer) {
  container.register({
    copilotOrchestrator: asFunction(() => new CopilotOrchestrator(container)).singleton(),
    mockTranscriptSimulator: asFunction(() => new MockTranscriptSimulator(container)).singleton(),
    intentDetector: asFunction(() => new IntentDetector()).singleton(),
  })
}
```

### 2.A.2 Module Registration

Add `voice_channels` to the app's module list. Edit `apps/mercato/src/modules.ts` and add the following entry:

```typescript
{ id: 'voice_channels', from: '@open-mercato/voice-channels' }
```

This registers the voice_channels module from the standalone `@open-mercato/voice-channels` package (NOT from `@open-mercato/core`).

Run `npm run modules:prepare` after creating all module files.

### 2.A.3 Mock Transcript Simulator

**Purpose**: Reads a `MockCallScript` JSON, emits `TranscriptSegment` events on a timer through the event bus. Simulates a real-time call for the demo.

#### File: `packages/voice-channels/src/modules/voice_channels/lib/mock/simulator.ts`

```typescript
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type {
  MockCallScript,
  MockScriptSegment,
  TranscriptSegment,
  CallStartEventPayload,
  CallEndEventPayload,
  TranscriptSegmentEventPayload,
} from '@open-mercato/voice-channels/modules/voice_channels/types'

interface ActiveMockCall {
  script: MockCallScript
  currentSegmentIndex: number
  timer: ReturnType<typeof setTimeout> | null
  startedAt: number
  status: 'playing' | 'paused' | 'completed'
}

export class MockTranscriptSimulator {
  private container: AppContainer
  private activeCall: ActiveMockCall | null = null

  constructor(container: AppContainer) {
    this.container = container
  }

  async startCall(
    script: MockCallScript,
    tenantId: string,
    organizationId: string
  ): Promise<{ callId: string }> {
    if (this.activeCall) {
      this.stopCall()
    }

    this.activeCall = {
      script,
      currentSegmentIndex: 0,
      timer: null,
      startedAt: Date.now(),
      status: 'playing',
    }

    // Emit call.started event
    await this.emitEvent('voice_channels.call.started', {
      callId: script.callId,
      phoneNumber: script.phoneNumber,
      direction: script.direction,
      customerId: script.customerId,
      customerName: script.customerName,
      companyName: script.companyName,
      startedAt: Date.now(),
    } satisfies CallStartEventPayload, tenantId, organizationId)

    // Schedule the first segment
    this.scheduleNextSegment(tenantId, organizationId)

    return { callId: script.callId }
  }

  stopCall(): void {
    if (this.activeCall?.timer) {
      clearTimeout(this.activeCall.timer)
    }
    this.activeCall = null
  }

  getStatus(): { status: string; segmentIndex: number; totalSegments: number } | null {
    if (!this.activeCall) return null
    return {
      status: this.activeCall.status,
      segmentIndex: this.activeCall.currentSegmentIndex,
      totalSegments: this.activeCall.script.segments.length,
    }
  }

  private scheduleNextSegment(tenantId: string, organizationId: string): void {
    if (!this.activeCall || this.activeCall.status !== 'playing') return

    const { script, currentSegmentIndex } = this.activeCall
    if (currentSegmentIndex >= script.segments.length) {
      this.completeCall(tenantId, organizationId)
      return
    }

    const segment = script.segments[currentSegmentIndex]

    this.activeCall.timer = setTimeout(async () => {
      if (!this.activeCall) return

      const transcriptSegment: TranscriptSegment = {
        segmentId: segment.segmentId,
        speaker: segment.speaker,
        text: segment.text,
        confidence: 0.95,
        isFinal: true,
        startTime: (Date.now() - this.activeCall.startedAt) / 1000,
        endTime: (Date.now() - this.activeCall.startedAt) / 1000 + 2,
        language: script.language,
      }

      // Emit transcript segment event
      await this.emitEvent('voice_channels.call.transcript_segment', {
        callId: script.callId,
        segment: transcriptSegment,
      } satisfies TranscriptSegmentEventPayload, tenantId, organizationId)

      // Advance to next segment
      this.activeCall!.currentSegmentIndex++
      this.scheduleNextSegment(tenantId, organizationId)
    }, segment.delayMs)
  }

  private async completeCall(tenantId: string, organizationId: string): Promise<void> {
    if (!this.activeCall) return

    const { script, startedAt } = this.activeCall
    this.activeCall.status = 'completed'

    await this.emitEvent('voice_channels.call.ended', {
      callId: script.callId,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      segmentCount: script.segments.length,
      suggestionCount: 0, // Will be tracked by orchestrator in integration
    } satisfies CallEndEventPayload, tenantId, organizationId)
  }

  private async emitEvent(
    eventId: string,
    payload: Record<string, unknown>,
    tenantId: string,
    organizationId: string
  ): Promise<void> {
    // Use the module's typed event emitter (imported at top of file)
    const { emitVoiceEvent } = require('../../events')
    await emitVoiceEvent(eventId as any, {
      ...payload,
      tenantId,
      organizationId,
    }, { persistent: false })
  }
}
```

### 2.A.4 Intent Detector (Dual-Track)

**Fast-track**: Keyword matching (< 10ms). Runs first on every customer segment.
**Smart-track**: LLM-based (2–4s). Runs async, may upgrade the fast-track result.

#### File: `packages/voice-channels/src/modules/voice_channels/lib/copilot/intent-detector.ts`

```typescript
import type { TranscriptSegment, CopilotIntent, IntentDetectionResult } from '@open-mercato/voice-channels/modules/voice_channels/types'

/**
 * Keyword patterns for fast-track intent detection.
 * Supports Polish and English keywords.
 * Keys are intents, values are arrays of regex patterns (case-insensitive).
 */
const KEYWORD_PATTERNS: Record<CopilotIntent, RegExp[]> = {
  product_need: [
    /potrzebuj[eę]/i, /zamówi[ćę]/i, /szukam/i, /interesuj[eę]/i,
    /chciałbym/i, /chciałabym/i, /rur[yę]/i, /zaworów/i, /kształtek/i,
    /need/i, /looking for/i, /order/i, /want to buy/i, /interested in/i,
    /ile kosztuj[eą]/i, /cennik/i, /ofert[aęy]/i,
    /sztuk/i, /jednostek/i, /units/i, /pieces/i,
  ],
  price_objection: [
    /za drogo/i, /zbyt drogo/i, /cena.*wysok/i, /obniż/i, /rabat/i, /upust/i,
    /too expensive/i, /lower the price/i, /discount/i, /cheaper/i,
    /konkurencja.*taniej/i, /tańsz/i, /budżet/i, /nie stać/i,
  ],
  competitor_mention: [
    /konkurencj[aię]/i, /inna firma/i, /inny dostawca/i,
    /competitor/i, /other supplier/i, /alternative/i,
    /ofert[aęy] od/i, /porówna[ćł]/i,
  ],
  order_intent: [
    /zamawiam/i, /bierzemy/i, /biorę/i, /składam zamówienie/i,
    /wyślij.*zamówienie/i, /potwierdź/i, /akceptuj[ęe]/i,
    /let'?s go ahead/i, /place.*order/i, /confirm/i, /send.*quote/i,
    /umow[aęy]/i, /podpiszemy/i, /deal/i,
  ],
  feature_question: [
    /czy możecie/i, /czy oferujecie/i, /jak działaj?a/i, /jaki czas/i,
    /termin dostawy/i, /gwarancj/i, /certyfikat/i, /norma/i,
    /do you offer/i, /how does/i, /lead time/i, /warranty/i,
    /ile trwa/i, /możliwe/i,
  ],
  complaint: [
    /reklamacj[aię]/i, /opóźnien/i, /spóźnion/i, /uszkodzon/i,
    /problem/i, /niezadowolon/i, /zły.*jakości/i,
    /complaint/i, /late delivery/i, /damaged/i, /quality issue/i,
  ],
  small_talk: [
    /jak się masz/i, /co słychać/i, /pogoda/i, /weekend/i,
    /how are you/i, /weather/i, /holiday/i,
  ],
}

export class IntentDetector {
  /**
   * Fast-track: keyword-based intent detection.
   * Returns within microseconds. Use for demo reliability.
   */
  detectByKeywords(segment: TranscriptSegment): IntentDetectionResult | null {
    if (segment.speaker !== 'customer') return null

    const text = segment.text.toLowerCase()

    for (const [intent, patterns] of Object.entries(KEYWORD_PATTERNS) as Array<[CopilotIntent, RegExp[]]>) {
      const matchedKeywords: string[] = []
      for (const pattern of patterns) {
        const match = text.match(pattern)
        if (match) {
          matchedKeywords.push(match[0])
        }
      }
      if (matchedKeywords.length > 0) {
        return {
          intent,
          confidence: Math.min(0.6 + matchedKeywords.length * 0.1, 0.9),
          keywords: matchedKeywords,
          segmentId: segment.segmentId,
        }
      }
    }

    return null
  }

  /**
   * Smart-track: LLM-based intent detection.
   * Returns in 2–4 seconds. More accurate for nuanced speech.
   *
   * Uses structured output (JSON mode) with a fast model (Haiku-class).
   */
  async detectByLlm(
    segment: TranscriptSegment,
    contextSegments: TranscriptSegment[]
  ): Promise<IntentDetectionResult | null> {
    if (segment.speaker !== 'customer') return null

    // Build context from recent segments
    const conversationContext = contextSegments
      .slice(-10)
      .map(s => `[${s.speaker}] ${s.text}`)
      .join('\n')

    const systemPrompt = `You are an intent classifier for a B2B sales call copilot.
Analyze the LATEST customer message in the context of the conversation.
Classify into exactly ONE intent.

Intents:
- product_need: Customer expresses need for a product or asks about availability/specifications
- price_objection: Customer objects to pricing, asks for discount, mentions budget constraints
- competitor_mention: Customer mentions competitors, alternative suppliers, or comparison offers
- order_intent: Customer signals readiness to place an order, confirms a purchase, or asks for a quote
- feature_question: Customer asks about product features, delivery times, warranties, certifications
- complaint: Customer mentions past issues, quality problems, or delivery delays
- small_talk: Greetings, weather, personal topics — not business-related

Respond with JSON only: { "intent": "<intent>", "confidence": <0.0-1.0>, "keywords": ["<key phrases>"] }`

    const userPrompt = `Conversation context:
${conversationContext}

LATEST customer message to classify:
[customer] ${segment.text}`

    try {
      // Use the AI service from DI container if available
      // For hackathon: direct Anthropic API call as fallback
      const response = await this.callLlm(systemPrompt, userPrompt)
      if (!response) return null

      return {
        ...response,
        segmentId: segment.segmentId,
      }
    } catch (error) {
      console.error('[IntentDetector] LLM call failed:', error)
      return null
    }
  }

  private async callLlm(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ intent: CopilotIntent; confidence: number; keywords: string[] } | null> {
    // Implementation depends on available AI service in the container.
    // For hackathon, use direct fetch to Anthropic API:
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.warn('[IntentDetector] No ANTHROPIC_API_KEY — LLM intent detection disabled')
      return null
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      console.error('[IntentDetector] API error:', response.status)
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text
    if (!text) return null

    try {
      const parsed = JSON.parse(text)
      if (parsed.intent && typeof parsed.confidence === 'number') {
        return {
          intent: parsed.intent as CopilotIntent,
          confidence: parsed.confidence,
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        }
      }
    } catch {
      console.error('[IntentDetector] Failed to parse LLM response:', text)
    }
    return null
  }
}
```

### 2.A.5 Copilot Orchestrator

The central pipeline that ties everything together.

#### File: `packages/voice-channels/src/modules/voice_channels/lib/copilot/orchestrator.ts`

```typescript
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type {
  TranscriptSegment,
  SuggestionCard,
  CopilotSuggestionEventPayload,
  IntentDetectionResult,
  CopilotIntent,
  CopilotProductSearchResult,
  CopilotCustomerContextResult,
  CopilotPricingCheckResult,
  CopilotOpenDealsResult,
} from '@open-mercato/voice-channels/modules/voice_channels/types'
import { IntentDetector } from './intent-detector'

/**
 * Copilot Orchestrator
 *
 * Pipeline: TranscriptSegment → IntentDetection → MCP Tool Call → SuggestionCard → Event Emission
 *
 * This class receives transcript segments (from the mock simulator or a real provider),
 * detects intents, calls MCP tools to fetch relevant data, and emits suggestion cards
 * through the event bus for the frontend to display.
 */
/**
 * Per-call session state. Stored in a Map keyed by callId
 * so multiple calls can be active simultaneously without race conditions.
 */
interface CopilotSession {
  callId: string
  customerId: string | null
  tenantId: string
  organizationId: string
  contextWindow: TranscriptSegment[]
  recentSuggestionTypes: Map<string, number>
  suggestionCounter: number
}

export class CopilotOrchestrator {
  private container: AppContainer
  private intentDetector: IntentDetector
  private sessions: Map<string, CopilotSession> = new Map()

  /** Maximum segments to keep in context window */
  private readonly MAX_CONTEXT_SEGMENTS = 30
  /** Minimum seconds between same suggestion type */
  private readonly DEDUP_INTERVAL_MS = 60_000

  constructor(container: AppContainer) {
    this.container = container
    this.intentDetector = new IntentDetector()
  }

  /**
   * Initialize for a new call. Emits CustomerContextCard immediately.
   */
  async startSession(
    callId: string,
    customerId: string | undefined,
    tenantId: string,
    organizationId: string
  ): Promise<void> {
    const session: CopilotSession = {
      callId,
      customerId: customerId ?? null,
      tenantId,
      organizationId,
      contextWindow: [],
      recentSuggestionTypes: new Map(),
      suggestionCounter: 0,
    }
    this.sessions.set(callId, session)

    // Auto-emit CustomerContextCard at call start
    if (customerId) {
      await this.emitCustomerContext(session, customerId)
    }
  }

  /**
   * Process an incoming transcript segment.
   * This is the main entry point called by the subscriber.
   * The callId is used to look up the correct session.
   */
  async processSegment(callId: string, segment: TranscriptSegment): Promise<void> {
    const session = this.sessions.get(callId)
    if (!session) return // No active session for this call

    // Add to context window
    session.contextWindow.push(segment)
    if (session.contextWindow.length > this.MAX_CONTEXT_SEGMENTS) {
      session.contextWindow.shift()
    }

    // Only detect intents on customer speech
    if (segment.speaker !== 'customer') return

    // Fast-track: keyword detection (immediate, < 10ms)
    const keywordResult = this.intentDetector.detectByKeywords(segment)

    if (keywordResult) {
      // Fire suggestion immediately from keyword match
      await this.routeIntentToSuggestion(session, keywordResult)
    }

    // Smart-track: LLM detection (async 2–4s, always runs in parallel)
    // LLM may produce a better result that upgrades or supplements the keyword match
    this.intentDetector
      .detectByLlm(segment, session.contextWindow)
      .then(async (llmResult) => {
        if (llmResult) {
          // If keyword already fired same intent, emit only if LLM confidence is significantly higher
          // If different intent, always emit (LLM found something keywords missed)
          if (!keywordResult) {
            await this.routeIntentToSuggestion(session, llmResult)
          } else if (llmResult.intent !== keywordResult.intent) {
            await this.routeIntentToSuggestion(session, llmResult)
          } else if (llmResult.confidence > keywordResult.confidence + 0.15) {
            // Same intent but much higher confidence — upgrade with richer LLM data
            await this.routeIntentToSuggestion(session, llmResult)
          }
          // Otherwise skip: keyword already handled this intent at similar confidence
        }
      })
      .catch((err) => console.error('[Orchestrator] LLM detection error:', err))
  }

  /**
   * End a call session. Clears state for that callId.
   */
  endSession(callId: string): void {
    this.sessions.delete(callId)
  }

  /**
   * Route a detected intent to the appropriate MCP tool and emit a suggestion card.
   */
  private async routeIntentToSuggestion(session: CopilotSession, result: IntentDetectionResult): Promise<void> {
    // Deduplication: skip if same type emitted recently
    const dedupKey = `${result.intent}`
    const lastEmitted = session.recentSuggestionTypes.get(dedupKey)
    if (lastEmitted && Date.now() - lastEmitted < this.DEDUP_INTERVAL_MS) return

    const triggerSegment = session.contextWindow.find(s => s.segmentId === result.segmentId)
    const triggerText = triggerSegment?.text ?? ''

    // Map intent to human-readable label for the intent toast
    const intentLabels: Record<string, string> = {
      product_need: 'Wykryto: zapotrzebowanie na produkt',
      price_objection: 'Wykryto: obiekcja cenowa',
      competitor_mention: 'Wykryto: wzmianka o konkurencji',
      order_intent: 'Wykryto: intencja zamówienia',
      feature_question: 'Wykryto: pytanie o szczegóły',
      complaint: 'Wykryto: reklamacja / problem',
    }

    let card: SuggestionCard | null = null

    try {
      switch (result.intent) {
        case 'product_need':
          card = await this.buildProductSuggestion(session, result.keywords, triggerText, result.segmentId, result.confidence)
          break
        case 'price_objection':
          card = await this.buildPricingAlert(session, triggerText, result.segmentId, result.confidence)
          break
        case 'order_intent':
          card = await this.buildQuickAction(session, triggerText, result.segmentId, result.confidence)
          break
        case 'competitor_mention':
          card = await this.buildPricingAlert(session, triggerText, result.segmentId, result.confidence)
          break
        case 'feature_question':
        case 'complaint':
          card = await this.buildDealStatus(session, triggerText, result.segmentId, result.confidence)
          break
        case 'small_talk':
          return // No suggestion for small talk
      }
    } catch (err) {
      console.error('[Orchestrator] Failed to build suggestion for intent:', result.intent, err)
      return
    }

    if (card) {
      // Attach detected intent label for the UI toast
      card.detectedIntent = intentLabels[result.intent] ?? result.intent
      session.recentSuggestionTypes.set(dedupKey, Date.now())
      await this.emitSuggestion(session, card)
    }
  }

  private async buildProductSuggestion(session: CopilotSession, keywords: string[], triggerText: string, triggerSegmentId: number, confidence: number): Promise<SuggestionCard | null> {
    const toolResult = await this.callMcpTool<CopilotProductSearchResult>('copilot_search_products', {
      keywords,
      customerId: session.customerId,
      limit: 3,
    }, session)

    if (!toolResult || toolResult.products.length === 0) return null

    return {
      id: this.nextSuggestionId(session),
      type: 'product_suggestion',
      priority: 'high',
      triggerText,
      triggerSegmentId,
      matchConfidence: Math.round(confidence * 100),
      createdAt: Date.now(),
      products: toolResult.products.map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: p.price,
        available: p.available,
        stockQuantity: p.stockQuantity,
        matchReason: `Matched keywords: ${keywords.join(', ')}`,
      })),
    }
  }

  private async buildPricingAlert(session: CopilotSession, triggerText: string, triggerSegmentId: number, confidence: number): Promise<SuggestionCard | null> {
    const recentProductSegments = session.contextWindow
      .filter(s => s.speaker === 'customer')
      .slice(-5)

    const toolResult = await this.callMcpTool<CopilotPricingCheckResult>('copilot_check_pricing', {
      customerId: session.customerId,
      context: recentProductSegments.map(s => s.text).join(' '),
    }, session)

    if (!toolResult) return null

    return {
      id: this.nextSuggestionId(session),
      type: 'pricing_alert',
      priority: 'high',
      triggerText,
      triggerSegmentId,
      matchConfidence: Math.round(confidence * 100),
      createdAt: Date.now(),
      currentPrice: toolResult.customerPrice,
      floorPrice: toolResult.floorPrice,
      maxDiscountPercent: toolResult.maxDiscountPercent,
      currency: toolResult.currency,
      activePromotions: toolResult.activePromotions,
    }
  }

  private async buildQuickAction(session: CopilotSession, triggerText: string, triggerSegmentId: number, confidence: number): Promise<SuggestionCard> {
    return {
      id: this.nextSuggestionId(session),
      type: 'quick_action',
      priority: 'high',
      triggerText,
      triggerSegmentId,
      matchConfidence: Math.round(confidence * 100),
      createdAt: Date.now(),
      actions: [
        { label: 'Utwórz ofertę', actionType: 'create_quote', prefill: { customerId: session.customerId } },
        { label: 'Zaplanuj follow-up', actionType: 'schedule_followup', prefill: { customerId: session.customerId } },
        { label: 'Dodaj notatkę', actionType: 'add_note', prefill: {} },
      ],
    }
  }

  private async buildDealStatus(session: CopilotSession, triggerText: string, triggerSegmentId: number, confidence: number): Promise<SuggestionCard | null> {
    if (!session.customerId) return null

    const toolResult = await this.callMcpTool<CopilotOpenDealsResult>('copilot_open_deals', {
      customerId: session.customerId,
    }, session)

    if (!toolResult || toolResult.deals.length === 0) return null

    return {
      id: this.nextSuggestionId(session),
      type: 'deal_status',
      priority: 'medium',
      triggerText,
      triggerSegmentId,
      matchConfidence: Math.round(confidence * 100),
      createdAt: Date.now(),
      deals: toolResult.deals,
    }
  }

  private async emitCustomerContext(session: CopilotSession, customerId: string): Promise<void> {
    const toolResult = await this.callMcpTool<CopilotCustomerContextResult>('copilot_customer_context', {
      customerId,
    }, session)

    if (!toolResult) return

    const card: SuggestionCard = {
      id: this.nextSuggestionId(session),
      type: 'customer_context',
      priority: 'medium',
      triggerText: 'Połączenie rozpoczęte — załadowano kontekst klienta',
      triggerSegmentId: 0, // Auto-emitted at call start, no triggering segment
      matchConfidence: 100,
      detectedIntent: 'Automatyczny kontekst klienta',
      createdAt: Date.now(),
      customer: toolResult.customer,
    }

    await this.emitSuggestion(session, card)
  }

  /**
   * Call an MCP tool by name. Resolves the tool from the AI assistant registry.
   * For hackathon: falls back to direct DI resolution if MCP registry unavailable.
   */
  private async callMcpTool<T>(toolName: string, input: Record<string, unknown>, session: CopilotSession): Promise<T | null> {
    try {
      // Try resolving tool handler from DI container
      const handler = this.container.resolve<((input: any, ctx: any) => Promise<T>) | undefined>(
        `mcpTool:${toolName}`
      )
      if (handler) {
        return await handler(input, {
          tenantId: session.tenantId,
          organizationId: session.organizationId,
          userId: null,
          container: this.container,
          userFeatures: [],
          isSuperAdmin: true,
        })
      }

      // Fallback: try global tool registry
      const toolRegistry = this.container.resolve<any>('mcpToolRegistry')
      if (toolRegistry?.getTool) {
        const tool = toolRegistry.getTool(toolName)
        if (tool?.handler) {
          return await tool.handler(input, {
            tenantId: session.tenantId,
            organizationId: session.organizationId,
            userId: null,
            container: this.container,
            userFeatures: [],
            isSuperAdmin: true,
          })
        }
      }

      console.warn(`[Orchestrator] MCP tool "${toolName}" not found`)
      return null
    } catch (err) {
      console.error(`[Orchestrator] MCP tool "${toolName}" error:`, err)
      return null
    }
  }

  private async emitSuggestion(session: CopilotSession, card: SuggestionCard): Promise<void> {
    const { emitVoiceEvent } = require('../../events')
    await emitVoiceEvent('voice_channels.copilot.suggestion' as any, {
      callId: session.callId,
      suggestion: card,
      tenantId: session.tenantId,
      organizationId: session.organizationId,
    }, { persistent: false })
  }

  private nextSuggestionId(session: CopilotSession): string {
    return `sug_${session.callId}_${++session.suggestionCounter}`
  }
}
```

### 2.A.6 API Routes

#### File: `packages/voice-channels/src/modules/voice_channels/api/post/mock/start.ts`

```typescript
import { z } from 'zod'
import type { ApiRouteHandler } from '@open-mercato/shared/lib/api/types'
import type { MockCallScript } from '@open-mercato/voice-channels/modules/voice_channels/types'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

const startBodySchema = z.object({
  script: z.object({
    callId: z.string().min(1),
    customerId: z.string().min(1),
    segments: z.array(z.object({
      speaker: z.enum(['customer', 'agent']),
      text: z.string(),
      delayMs: z.number().int().nonnegative(),
    })).min(1),
  }),
})

export const metadata = {
  POST: { requireAuth: true, features: ['voice_channels.mock.manage'] },
}

export const openApi = {
  summary: 'Start a mock call simulation',
  tags: ['Voice Channels'],
}

const handler: ApiRouteHandler = async (req, res) => {
  const ctx = resolveRequestContext(req)
  const parsed = startBodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const simulator = ctx.container.resolve<any>('mockTranscriptSimulator')
  const orchestrator = ctx.container.resolve<any>('copilotOrchestrator')

  // Start orchestrator session (subscriber auto-wires segments → orchestrator via event bus)
  await orchestrator.startSession(
    body.script.callId,
    body.script.customerId,
    ctx.tenantId!,
    ctx.organizationId!
  )

  const result = await simulator.startCall(body.script, ctx.tenantId!, ctx.organizationId!)

  return Response.json(result)
}

export default handler
```

#### File: `packages/voice-channels/src/modules/voice_channels/api/post/mock/stop.ts`

```typescript
import { z } from 'zod'
import type { ApiRouteHandler } from '@open-mercato/shared/lib/api/types'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

const stopBodySchema = z.object({
  callId: z.string().min(1),
})

export const metadata = {
  POST: { requireAuth: true, features: ['voice_channels.mock.manage'] },
}

export const openApi = {
  summary: 'Stop the active mock call simulation',
  tags: ['Voice Channels'],
}

const handler: ApiRouteHandler = async (req) => {
  const ctx = resolveRequestContext(req)
  const parsed = stopBodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const simulator = ctx.container.resolve<any>('mockTranscriptSimulator')
  const orchestrator = ctx.container.resolve<any>('copilotOrchestrator')

  simulator.stopCall()
  orchestrator.endSession(body.callId)

  return Response.json({ stopped: true })
}

export default handler
```

#### File: `packages/voice-channels/src/modules/voice_channels/api/get/mock/status.ts`

```typescript
import type { ApiRouteHandler } from '@open-mercato/shared/lib/api/types'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

export const metadata = {
  GET: { requireAuth: true, features: ['voice_channels.mock.manage'] },
}

export const openApi = {
  summary: 'Get status of current mock call',
  tags: ['Voice Channels'],
}

const handler: ApiRouteHandler = async (req) => {
  const ctx = resolveRequestContext(req)
  const simulator = ctx.container.resolve<any>('mockTranscriptSimulator')

  return Response.json({
    isRunning: simulator.isRunning(),
    callId: simulator.currentCallId() ?? null,
    elapsedMs: simulator.elapsedMs() ?? 0,
  })
}

export default handler
```

#### File: `packages/voice-channels/src/modules/voice_channels/api/get/copilot/calls.ts`

```typescript
import type { ApiRouteHandler } from '@open-mercato/shared/lib/api/types'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

export const metadata = {
  GET: { requireAuth: true, features: ['voice_channels.copilot.view'] },
}

export const openApi = {
  summary: 'List active and recent Copilot call sessions',
  tags: ['Voice Channels'],
}

const handler: ApiRouteHandler = async (req) => {
  const ctx = resolveRequestContext(req)
  const orchestrator = ctx.container.resolve<any>('copilotOrchestrator')

  const activeSessions = orchestrator.getActiveSessions()
  return Response.json({
    calls: activeSessions.map((session: any) => ({
      callId: session.callId,
      customerId: session.customerId,
      startedAt: session.startedAt,
      segmentCount: session.segmentCount,
    })),
  })
}

export default handler
```

#### File: `packages/voice-channels/src/modules/voice_channels/api/post/mock/cache.ts`

```typescript
import { z } from 'zod'
import type { ApiRouteHandler } from '@open-mercato/shared/lib/api/types'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { setCacheEnabled, isCacheEnabled } from '../../../lib/response-cache'

const cacheBodySchema = z.object({
  enabled: z.boolean(),
})

export const metadata = {
  POST: { requireAuth: true, features: ['voice_channels.mock.manage'] },
}

export const openApi = {
  summary: 'Toggle the response cache on or off at runtime',
  tags: ['Voice Channels'],
}

const handler: ApiRouteHandler = async (req) => {
  const ctx = resolveRequestContext(req)
  const parsed = cacheBodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  setCacheEnabled(parsed.data.enabled)

  return Response.json({
    cacheEnabled: isCacheEnabled(),
  })
}

export default handler
```

### 2.A.7 Package Scaffolding: `packages/voice-channels/`

The voice_channels module lives in a **standalone workspace package** (like `gateway-stripe` or `sync-akeneo`), NOT inside `packages/core/`.

#### `packages/voice-channels/package.json`

```json
{
  "name": "@open-mercato/voice-channels",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "node build.mjs",
    "watch": "node watch.mjs",
    "test": "jest --config jest.config.cjs",
    "typecheck": "tsc --noEmit"
  },
  "exports": {
    ".": "./dist/index.js",
    "./*.ts": { "types": "./src/*.ts", "default": "./dist/*.js" },
    "./*.tsx": { "types": "./src/*.tsx", "default": "./dist/*.js" },
    "./*": { "types": ["./src/*.ts", "./src/*.tsx"], "default": "./dist/*.js" },
    "./*/*": { "types": ["./src/*/*.ts", "./src/*/*.tsx"], "default": "./dist/*/*.js" },
    "./*/*/*": { "types": ["./src/*/*/*.ts", "./src/*/*/*.tsx"], "default": "./dist/*/*/*.js" },
    "./*/*/*/*": { "types": ["./src/*/*/*/*.ts", "./src/*/*/*/*.tsx"], "default": "./dist/*/*/*/*.js" },
    "./*/*/*/*/*": { "types": ["./src/*/*/*/*/*.ts", "./src/*/*/*/*/*.tsx"], "default": "./dist/*/*/*/*/*.js" }
  },
  "dependencies": {
    "@open-mercato/core": "workspace:*",
    "@open-mercato/events": "workspace:*",
    "@open-mercato/ui": "workspace:*"
  },
  "peerDependencies": {
    "@mikro-orm/postgresql": "^6.5.9",
    "@open-mercato/shared": "workspace:*",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@open-mercato/shared": "workspace:*",
    "esbuild": "^0.25.2",
    "glob": "^11.0.3"
  }
}
```

#### `packages/voice-channels/src/index.ts`

```typescript
export { metadata } from './modules/voice_channels/index'
```

Types are exported via package exports pattern:
```typescript
// Other modules import types via:
import type { TranscriptSegment, SuggestionCard } from '@open-mercato/voice-channels/modules/voice_channels/types'
```

### 2.A.8 Subscriber: Wire Simulator → Orchestrator

The orchestrator needs to process every transcript segment. Use an event subscriber.

#### File: `packages/voice-channels/src/modules/voice_channels/subscribers/copilot-segment-handler.ts`

```typescript
import type { EventPayload } from '@open-mercato/shared/modules/events'
import type { TranscriptSegmentEventPayload } from '@open-mercato/voice-channels/modules/voice_channels/types'

export const metadata = {
  event: 'voice_channels.call.transcript_segment',
  id: 'voice_channels.copilot.segment-handler',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handler(
  payload: EventPayload & TranscriptSegmentEventPayload,
  ctx: ResolverContext
) {
  const orchestrator = ctx.resolve<any>('copilotOrchestrator')

  // processSegment uses callId to look up the correct session
  await orchestrator.processSegment(payload.callId, payload.segment)
}
```

### 2.A.9 File Tree Summary (Sub-Spec A)

```
packages/voice-channels/src/modules/voice_channels/
├── index.ts                    # Module metadata
├── acl.ts                      # RBAC features
├── events.ts                   # Event definitions (4 events, all clientBroadcast)
├── setup.ts                    # Default role features
├── di.ts                       # DI registration
├── api/
│   └── post/
│       └── mock/
│           ├── start.ts        # POST /api/voice_channels/mock/start
│           └── stop.ts         # POST /api/voice_channels/mock/stop
├── subscribers/
│   └── copilot-segment-handler.ts  # Wires transcript segments to orchestrator
└── lib/
    ├── mock/
    │   └── simulator.ts        # MockTranscriptSimulator class
    └── copilot/
        ├── orchestrator.ts     # CopilotOrchestrator (main pipeline)
        └── intent-detector.ts  # Dual-track intent detection

packages/voice-channels/src/modules/voice_channels/
├── index.ts                    # Barrel export
└── types.ts                    # All shared types (Section 1.1)
```

### 2.A.10 Verification Checklist

After implementation, verify:

- [ ] `npm run modules:prepare` completes without errors
- [ ] `yarn build:packages` succeeds
- [ ] Events with `clientBroadcast: true` appear in the browser when subscribing via `useAppEvent('voice_channels.*', console.log)`
- [ ] `POST /api/voice_channels/mock/start` with a test script JSON emits transcript segments on schedule
- [ ] Intent detector returns correct intent for Polish keywords: "potrzebuję rur" → `product_need`
- [ ] Orchestrator emits `copilot.suggestion` events with valid card payloads

---

## 3. SUB-SPEC-B: Frontend Copilot UI

**Agent assignment**: Rafał's AI agent
**Scope**: Frontend-only. All React components for the Copilot panel, transcript feed, and 5 suggestion card types.
**Consumes**: Events from DOM Event Bridge via `useAppEvent()`.
**Does NOT build**: Any backend code, any API routes, any MCP tools.
**Can start immediately**: Use mock data (hardcoded JSON) until backend events are available.

### 3.B.1 File Structure

```
packages/voice-channels/src/modules/voice_channels/
├── backend/
│   └── voice-calls/
│       └── copilot/
│           └── page.tsx            # Main Copilot page (full-screen demo view)
├── widgets/
│   ├── injection-table.ts          # Widget-to-spot mappings
│   └── injection/
│       └── copilot-panel/
│           ├── widget.ts           # InjectionWidgetModule metadata
│           ├── CopilotPanel.tsx    # Main container (SSE subscription)
│           ├── TranscriptFeed.tsx  # Live scrolling transcript
│           ├── SuggestionStack.tsx # Prioritized card stack
│           ├── CallHeader.tsx      # Phone number, timer, contact info
│           ├── CopilotToggle.tsx   # ON/OFF toggle
│           └── cards/
│               ├── ProductCard.tsx
│               ├── PricingCard.tsx
│               ├── ContextCard.tsx
│               ├── DealCard.tsx
│               └── ActionCard.tsx
```

### 3.B.2 Main Copilot Page

This is the full-screen demo page at `/backend/voice-calls/copilot`.

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/page.tsx`

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

// Import sub-components (defined below)
import { CallHeader } from './CallHeader'
import { TranscriptFeed } from './TranscriptFeed'
import { SuggestionStack } from './SuggestionStack'
import { CopilotToggle } from './CopilotToggle'

/**
 * Full-screen Copilot demo page.
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────┐
 * │  Call Header (phone, timer, contact name)            │
 * ├──────────────────────┬──────────────────────────────┤
 * │                      │                              │
 * │  Live Transcript     │  Copilot Suggestions         │
 * │  (left panel)        │  (right panel)               │
 * │                      │                              │
 * ├──────────────────────┴──────────────────────────────┤
 * │  Controls: [Start Demo] [Stop] [Copilot: ON/OFF]   │
 * └─────────────────────────────────────────────────────┘
 */
// Inject CSS keyframes for animations (required for inline animation properties)
const COPILOT_KEYFRAMES = `
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes highlightPulse { 0%, 100% { box-shadow: 0 0 0 rgba(234, 179, 8, 0); } 50% { box-shadow: 0 0 16px rgba(234, 179, 8, 0.4); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
`

export default function CopilotPage() {
  // Inject keyframes stylesheet once on mount
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
  /** ID of the segment currently highlighted (linked to latest suggestion) */
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<number | null>(null)
  /** Transient intent toast text (shown briefly before card appears) */
  const [intentToast, setIntentToast] = useState<string | null>(null)

  // ─── Event Subscriptions ───────────────────────────

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
    const payload = event.payload as any
    setSegments(prev => [...prev, payload.segment as TranscriptSegment])
  })

  useAppEvent('voice_channels.copilot.suggestion', (event) => {
    if (!copilotEnabled) return
    const payload = event.payload as any
    const card = payload.suggestion as SuggestionCard

    // ─── WOW: Intent Toast (shows "Detected: ..." for 1.2s before card) ───
    if (card.detectedIntent) {
      setIntentToast(card.detectedIntent)
      setTimeout(() => setIntentToast(null), 1200)
    }

    // ─── WOW: Highlight the transcript segment that triggered this card ───
    // Uses triggerSegmentId for reliable matching (no string search ambiguity)
    if (card.triggerSegmentId > 0) {
      setHighlightedSegmentId(card.triggerSegmentId)
      setTimeout(() => setHighlightedSegmentId(null), 4000) // Glow for 4s
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

  // ─── Actions ───────────────────────────────────────

  const handleStartDemo = useCallback(async () => {
    // Use statically imported demo script (no API fetch needed)
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
  }, [])

  const handleDismiss = useCallback((suggestionId: string) => {
    setSuggestions(prev => prev.filter(s => s.id !== suggestionId))
  }, [])

  // ─── Render ────────────────────────────────────────

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      fontFamily: 'Inter, system-ui, sans-serif',
      backgroundColor: '#f8fafc',
    }}>
      {/* Call Header */}
      <CallHeader
        callActive={callActive}
        callInfo={callInfo}
        callDuration={callDuration}
      />

      {/* Main Content: Transcript + Suggestions */}
      <div style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
        gap: '1px',
        backgroundColor: '#e2e8f0',
      }}>
        {/* Left Panel: Transcript */}
        <div style={{
          flex: '1 1 50%',
          backgroundColor: '#ffffff',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            fontWeight: 600,
            fontSize: '14px',
            color: '#475569',
          }}>
            Transkrypcja na żywo
          </div>
          <TranscriptFeed segments={segments} highlightedSegmentId={highlightedSegmentId} />
        </div>

        {/* Right Panel: Copilot Suggestions */}
        <div style={{
          flex: '1 1 50%',
          backgroundColor: '#f8fafc',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            fontWeight: 600,
            fontSize: '14px',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>🤖 Call Copilot</span>
            <CopilotToggle enabled={copilotEnabled} onChange={setCopilotEnabled} />
          </div>
          {/* WOW: Intent detection toast — brief flash before card appears */}
          {intentToast && (
            <div style={{
              padding: '8px 16px',
              backgroundColor: '#fef3c7',
              borderBottom: '1px solid #fde68a',
              fontSize: '13px',
              fontWeight: 600,
              color: '#92400e',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              animation: 'fadeIn 0.2s ease-in',
            }}>
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                backgroundColor: '#f59e0b', animation: 'pulse 1s infinite',
              }} />
              {intentToast}
            </div>
          )}
          <SuggestionStack suggestions={suggestions} onDismiss={handleDismiss} />
        </div>
      </div>

      {/* Bottom Controls */}
      <div style={{
        padding: '12px 20px',
        backgroundColor: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
      }}>
        {!callActive ? (
          <button
            onClick={handleStartDemo}
            style={{
              padding: '8px 24px',
              backgroundColor: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ▶ Start Demo Call
          </button>
        ) : (
          <button
            onClick={handleStopDemo}
            style={{
              padding: '8px 24px',
              backgroundColor: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
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

### 3.B.3 Component: CallHeader

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/CallHeader.tsx`

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
    if (!callActive || !callInfo) {
      setElapsed(0)
      return
    }
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
      color: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {callActive && (
          <span style={{
            width: '10px',
            height: '10px',
            backgroundColor: '#22c55e',
            borderRadius: '50%',
            animation: 'pulse 2s infinite',
          }} />
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
      <div style={{
        fontSize: '28px',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '2px',
      }}>
        {timeStr}
      </div>
    </div>
  )
}
```

### 3.B.4 Component: TranscriptFeed

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/TranscriptFeed.tsx`

```tsx
'use client'

import { useRef, useEffect } from 'react'
import type { TranscriptSegment } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface TranscriptFeedProps {
  segments: TranscriptSegment[]
  /** Segment ID to highlight (linked to the latest suggestion trigger) */
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
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#94a3b8',
        fontSize: '15px',
      }}>
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
              marginBottom: '12px',
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor: isHighlighted ? '#fefce8' : style.bg,
              borderLeft: `3px solid ${isHighlighted ? '#eab308' : style.color}`,
              animation: isHighlighted ? 'highlightPulse 1.5s ease-in-out 2' : 'fadeIn 0.3s ease-in',
              boxShadow: isHighlighted ? '0 0 12px rgba(234, 179, 8, 0.3)' : 'none',
              transition: 'all 0.3s ease',
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '4px',
            }}>
              <span style={{
                fontSize: '12px',
                fontWeight: 600,
                color: style.color,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                {style.label}
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

### 3.B.5 Component: SuggestionStack

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/SuggestionStack.tsx`

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
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#94a3b8',
        fontSize: '15px',
        padding: '20px',
        textAlign: 'center',
      }}>
        AI Copilot nasłuchuje rozmowy i zasugeruje odpowiednie produkty, ceny i działania...
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          style={{
            marginBottom: '12px',
            animation: 'slideIn 0.4s ease-out',
          }}
        >
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

### 3.B.6 Card Components

Each card follows this visual pattern: colored left border, header with icon + title, body content, optional dismiss button.

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/cards/ProductCard.tsx`

```tsx
'use client'

import { useState } from 'react'
import type { ProductSuggestionCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: ProductSuggestionCard; onDismiss: () => void }

export function ProductCard({ card, onDismiss }: Props) {
  const [addedProductIds, setAddedProductIds] = useState<Set<string>>(new Set())
  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: '10px',
      border: '1px solid #e2e8f0',
      borderLeft: '4px solid #2563eb',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#eff6ff',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e40af' }}>
            📦 Sugestia produktu
          </span>
          {/* WOW: Confidence badge */}
          <span style={{
            fontSize: '11px', fontWeight: 600,
            padding: '2px 6px', borderRadius: '8px',
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
        <div key={product.id} style={{
          padding: '12px 16px',
          borderTop: '1px solid #f1f5f9',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>
                {product.name}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                SKU: {product.sku}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: '16px', color: '#059669' }}>
                {product.price.amount.toFixed(2)} {product.price.currency}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                {product.price.priceType}
              </div>
            </div>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '8px',
          }}>
            <span style={{
              fontSize: '12px',
              color: product.available ? '#059669' : '#dc2626',
              fontWeight: 500,
            }}>
              {product.available
                ? `✓ W magazynie${product.stockQuantity ? ` (${product.stockQuantity} szt.)` : ''}`
                : '✗ Brak w magazynie'}
            </span>
            {/* WOW: Add to Quote with visual feedback */}
            <button
              onClick={() => {
                setAddedProductIds(prev => new Set(prev).add(product.id))
              }}
              disabled={addedProductIds.has(product.id)}
              style={{
                padding: '4px 12px',
                backgroundColor: addedProductIds.has(product.id) ? '#dcfce7' : '#2563eb',
                color: addedProductIds.has(product.id) ? '#166534' : '#fff',
                border: addedProductIds.has(product.id) ? '1px solid #86efac' : 'none',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: addedProductIds.has(product.id) ? 'default' : 'pointer',
                transition: 'all 0.3s ease',
              }}
            >
              {addedProductIds.has(product.id) ? '✓ Dodano do oferty' : '+ Dodaj do oferty'}
            </button>
          </div>
          {product.matchReason && (
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
              {product.matchReason}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const dismissBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '14px',
  color: '#94a3b8',
  padding: '2px 6px',
  borderRadius: '4px',
}
```

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/cards/PricingCard.tsx`

```tsx
'use client'

import type { PricingAlertCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: PricingAlertCard; onDismiss: () => void }

export function PricingCard({ card, onDismiss }: Props) {
  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: '10px',
      border: '1px solid #e2e8f0',
      borderLeft: '4px solid #f59e0b',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#fffbeb',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#92400e' }}>
            💰 Alert cenowy
          </span>
          <span style={{
            fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '8px',
            backgroundColor: '#fef9c3', color: '#854d0e',
          }}>{card.matchConfidence}% match</span>
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
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#059669' }}>
              {card.maxDiscountPercent}%
            </div>
          </div>
        </div>
        {card.activePromotions.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
              Aktywne promocje:
            </div>
            {card.activePromotions.map((promo, i) => (
              <div key={i} style={{
                fontSize: '12px',
                color: '#059669',
                padding: '4px 0',
              }}>
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

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/cards/ContextCard.tsx`

```tsx
'use client'

import type { CustomerContextCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: CustomerContextCard; onDismiss: () => void }

export function ContextCard({ card, onDismiss }: Props) {
  const c = card.customer
  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: '10px',
      border: '1px solid #e2e8f0',
      borderLeft: '4px solid #8b5cf6',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#f5f3ff',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#5b21b6' }}>
          👤 Kontekst klienta
        </span>
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
                <span key={i} style={{
                  padding: '2px 8px',
                  backgroundColor: '#f1f5f9',
                  borderRadius: '12px',
                  fontSize: '11px',
                  color: '#475569',
                }}>
                  {cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {c.notes && (
          <div style={{
            marginTop: '8px',
            padding: '8px',
            backgroundColor: '#fffbeb',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#92400e',
          }}>
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

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/cards/DealCard.tsx`

```tsx
'use client'

import type { DealStatusCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: DealStatusCard; onDismiss: () => void }

export function DealCard({ card, onDismiss }: Props) {
  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: '10px',
      border: '1px solid #e2e8f0',
      borderLeft: '4px solid #06b6d4',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#ecfeff',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#155e75' }}>
          📊 Otwarte deale
        </span>
        <button onClick={onDismiss} style={dismissBtnStyle}>✕</button>
      </div>
      <div style={{ padding: '0 16px 12px' }}>
        {card.deals.map((deal) => (
          <div key={deal.id} style={{
            padding: '10px 0',
            borderBottom: '1px solid #f1f5f9',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>{deal.title}</span>
              <span style={{ fontWeight: 700, fontSize: '14px', color: '#059669' }}>
                {deal.value.toLocaleString()} {deal.currency}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '12px' }}>
              <span style={{
                padding: '2px 8px',
                backgroundColor: '#f0f9ff',
                borderRadius: '4px',
                color: '#0369a1',
              }}>
                {deal.stage}
              </span>
              <span style={{ color: '#64748b' }}>{deal.daysInStage} dni w etapie</span>
              {deal.isStalled && (
                <span style={{
                  color: '#dc2626',
                  fontWeight: 600,
                  animation: 'pulse 2s infinite',
                }}>⚠ Wstrzymany</span>
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

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/cards/ActionCard.tsx`

```tsx
'use client'

import type { QuickActionCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: QuickActionCard; onDismiss: () => void }

export function ActionCard({ card, onDismiss }: Props) {
  const handleAction = (actionType: string) => {
    // For demo: show a visual confirmation
    alert(`Akcja: ${actionType} — w produkcji otworzy formularz.`)
  }

  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: '10px',
      border: '1px solid #e2e8f0',
      borderLeft: '4px solid #22c55e',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#f0fdf4',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#166534' }}>
          ⚡ Szybkie akcje
        </span>
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
              padding: '8px 16px',
              backgroundColor: '#f0fdf4',
              color: '#166534',
              border: '1px solid #bbf7d0',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
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

### 3.B.7 Component: CopilotToggle

#### File: `packages/voice-channels/src/modules/voice_channels/backend/voice-calls/copilot/CopilotToggle.tsx`

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
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        backgroundColor: enabled ? '#dcfce7' : '#f1f5f9',
        border: `1px solid ${enabled ? '#86efac' : '#cbd5e1'}`,
        borderRadius: '16px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: 600,
        color: enabled ? '#166534' : '#64748b',
        transition: 'all 0.2s',
      }}
    >
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: enabled ? '#22c55e' : '#94a3b8',
      }} />
      {enabled ? 'ON' : 'OFF'}
    </button>
  )
}
```

### 3.B.8 Verification Checklist (Sub-Spec B)

- [ ] Page renders at `/backend/voice-calls/copilot` without errors
- [ ] TranscriptFeed auto-scrolls on new segments
- [ ] All 5 card types render with correct styling and data
- [ ] Cards animate in (slide/fade)
- [ ] Dismiss button removes card from stack
- [ ] CopilotToggle disables new suggestions when OFF
- [ ] CallHeader shows elapsed timer during active call
- [ ] Empty states show Polish placeholder text
- [ ] Layout works at 1920x1080 (projector resolution)

---

## 4. SUB-SPEC-C: Data Layer, MCP Tools, Seed Data, Mock Scripts

**Agent assignment**: Serhii's AI agent
**Scope**: MCP tool handlers (read-only queries against existing OM modules), seed data fixtures, and demo conversation script JSON.
**Produces**: MCP tools that the orchestrator calls, seed data that makes the demo realistic.
**Does NOT build**: Any UI components, any orchestrator logic, any event infrastructure.

### 4.C.1 MCP Tools — AI Tools Registration

#### File: `packages/voice-channels/src/modules/voice_channels/ai-tools.ts`

Follow the exact pattern from `packages/search/src/modules/search/ai-tools.ts`.

```typescript
import { z } from 'zod'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/lib/types'
import type { EntityManager } from '@mikro-orm/core'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { CatalogOffer } from '@open-mercato/core/modules/catalog/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { CustomerDeal } from '@open-mercato/core/modules/customers/data/entities'
import { CustomerActivity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'

/**
 * Copilot MCP Tools
 *
 * These tools provide read-only access to OM modules for the Copilot orchestrator.
 * They query existing CRUD APIs — no new database entities are needed.
 */

// ─── Tool 1: Search Products ─────────────────────────

const copilotSearchProducts: AiToolDefinition = {
  name: 'copilot_search_products',
  description: `Search the product catalog for items matching keywords from a sales conversation.
Returns products with customer-specific pricing, stock availability, and category.
Used by the Call Copilot to suggest relevant products during live calls.`,
  inputSchema: z.object({
    keywords: z.array(z.string()).min(1).describe('Product-related keywords from the conversation'),
    customerId: z.string().optional().describe('Customer ID for tier pricing resolution'),
    limit: z.number().int().min(1).max(10).optional().default(3).describe('Max products to return'),
  }),
  requiredFeatures: ['voice_channels.copilot.view'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) throw new Error('Tenant context required')

    // Query catalog products using existing search/list API
    // The implementation should use the catalog module's internal query capabilities
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Search products by name/SKU matching keywords
    const keywordPattern = input.keywords.join('|')
    const products = await em.find(CatalogProduct, {
      organizationId: ctx.organizationId,
      $or: [
        { name: { $re: keywordPattern } },
        { sku: { $re: keywordPattern } },
        { description: { $re: keywordPattern } },
      ],
      isActive: true,
    }, {
      limit: input.limit,
      orderBy: { name: 'ASC' },
      populate: ['prices', 'stockItems'],
    })

    // Resolve best price for each product if customer ID is provided
    const result = products.map((product: any) => {
      const prices = product.prices?.getItems() ?? []
      // Find the best applicable price (simplified — use selectBestPrice in production)
      const bestPrice = prices[0] ?? { amount: 0, currency: 'PLN', priceType: 'standard' }
      const stock = product.stockItems?.getItems()?.[0]

      return {
        id: product.id,
        name: product.name,
        sku: product.sku ?? '',
        price: {
          amount: bestPrice.amount ?? 0,
          currency: bestPrice.currency ?? 'PLN',
          priceType: bestPrice.priceType ?? 'standard',
        },
        available: (stock?.quantity ?? 0) > 0,
        stockQuantity: stock?.quantity ?? 0,
        category: product.categoryName ?? '',
      }
    })

    return { products: result }
  },
}

// ─── Tool 2: Customer Context ────────────────────────

const copilotCustomerContext: AiToolDefinition = {
  name: 'copilot_customer_context',
  description: `Get comprehensive customer context for a Call Copilot session.
Returns: name, company, lifetime value, order history summary, top categories,
open tickets, assigned rep, and relationship notes.`,
  inputSchema: z.object({
    customerId: z.string().describe('Customer (person) ID'),
  }),
  requiredFeatures: ['voice_channels.copilot.view'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) throw new Error('Tenant context required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Fetch customer using polymorphic base entity (kind: 'person')
    const customer = await em.findOne(CustomerEntity, {
      id: input.customerId,
      kind: 'person',
      organizationId: ctx.organizationId,
    }, { populate: ['personProfile', 'personProfile.company'] })

    if (!customer) return { customer: null }

    const person = customer.personProfile

    // Fetch order history for LTV calculation
    const orders = await em.find(SalesOrder, {
      customerId: customer.id,
      organizationId: ctx.organizationId,
      status: { $in: ['completed', 'delivered', 'paid'] },
    }, {
      orderBy: { createdAt: 'DESC' },
      limit: 100,
    })

    const lifetimeValue = orders.reduce((sum: number, o: any) => sum + (o.totalAmount ?? 0), 0)
    const orderCount = orders.length
    const avgOrderValue = orderCount > 0 ? lifetimeValue / orderCount : 0
    const lastOrderDate = orders[0]?.createdAt
      ? new Date(orders[0].createdAt).toISOString().split('T')[0]
      : 'Brak'

    // Get top product categories from order lines
    // Simplified: extract from recent orders
    const topCategories = extractTopCategories(orders)

    // Fetch recent activities for notes
    const activities = await em.find(CustomerActivity, {
      contactId: input.customerId,
      organizationId: ctx.organizationId,
    }, {
      orderBy: { createdAt: 'DESC' },
      limit: 5,
    })

    const latestNote = activities.find((a: any) => a.notes)?.notes ?? ''

    return {
      customer: {
        id: customer.id,
        name: person?.displayName ?? `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim(),
        company: person?.company?.name ?? '',
        lifetimeValue: Math.round(lifetimeValue * 100) / 100,
        currency: 'PLN',
        lastOrderDate,
        orderCount,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        topCategories,
        openTickets: 0, // Simplified for hackathon
        assignedRep: person?.ownerUserName ?? '',
        notes: latestNote,
      },
    }
  },
}

// ─── Tool 3: Pricing Check ──────────────────────────

const copilotCheckPricing: AiToolDefinition = {
  name: 'copilot_check_pricing',
  description: `Check pricing details for a product-customer combination.
Returns: base price, customer-specific price, floor price, max discount, active promotions.`,
  inputSchema: z.object({
    productId: z.string().optional().describe('Product ID (if known)'),
    customerId: z.string().optional().describe('Customer ID for tier pricing'),
    context: z.string().optional().describe('Conversation context to find relevant product'),
  }),
  requiredFeatures: ['voice_channels.copilot.view'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) throw new Error('Tenant context required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Find the product (by ID or by context keyword match)
    let product: any = null
    if (input.productId) {
      product = await em.findOne(CatalogProduct, { id: input.productId, organizationId: ctx.organizationId })
    } else if (input.context) {
      // Keyword search in context — extract first recognizable product term
      const contextWords = input.context.toLowerCase().split(/\s+/)
      const products = await em.find(CatalogProduct, {
        organizationId: ctx.organizationId,
        isActive: true,
        $or: [
          { name: { $re: contextWords.slice(0, 5).join('|') } },
          { sku: { $re: contextWords.slice(0, 5).join('|') } },
        ],
      }, { limit: 1 })
      product = products[0]
    }

    if (!product) return null

    // Get price information
    const prices = await em.find(CatalogProductPrice, {
      product: product.id,
      organizationId: ctx.organizationId,
    })

    const basePrice = prices.find((p: any) => p.kind === 'standard')?.unitPriceNet ?? 0
    const customerPrice = prices.find((p: any) => p.kind === 'tier' || p.customerId)?.unitPriceNet ?? basePrice
    const currency = prices[0]?.currencyCode ?? 'PLN'

    // Calculate floor price (base price minus max allowed discount)
    const maxDiscountPercent = 15 // Configurable, hardcoded for hackathon
    const floorPrice = basePrice * (1 - maxDiscountPercent / 100)

    // Find active promotions
    const now = new Date()
    const promotions = await em.find(CatalogOffer, {
      organizationId: ctx.organizationId,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }, { limit: 5 })

    return {
      productId: product.id,
      productName: product.name,
      basePrice,
      customerPrice,
      currency,
      floorPrice: Math.round(floorPrice * 100) / 100,
      maxDiscountPercent,
      activePromotions: promotions.map((p: any) => ({
        name: p.name,
        discount: p.discountPercent ? `${p.discountPercent}%` : `${p.discountAmount} ${currency}`,
        validUntil: p.endDate ? new Date(p.endDate).toISOString().split('T')[0] : 'Bezterminowa',
      })),
    }
  },
}

// ─── Tool 4: Open Deals ─────────────────────────────

const copilotOpenDeals: AiToolDefinition = {
  name: 'copilot_open_deals',
  description: `Get open deals and pipeline status for a customer.
Returns active deals with stage, value, days in stage, and stalled flag.`,
  inputSchema: z.object({
    customerId: z.string().describe('Customer (person or company) ID'),
  }),
  requiredFeatures: ['voice_channels.copilot.view'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) throw new Error('Tenant context required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const deals = await em.find(CustomerDeal, {
      contactId: input.customerId,
      organizationId: ctx.organizationId,
      status: { $in: ['open', 'active', 'negotiation'] },
    }, {
      orderBy: { updatedAt: 'DESC' },
      limit: 5,
      populate: ['stage'],
    })

    const now = Date.now()

    return {
      deals: deals.map((deal: any) => {
        const stageEnteredAt = deal.stageChangedAt ?? deal.updatedAt ?? deal.createdAt
        const daysInStage = Math.floor((now - new Date(stageEnteredAt).getTime()) / (86400 * 1000))

        return {
          id: deal.id,
          title: deal.title ?? deal.displayName ?? 'Bez nazwy',
          stage: deal.stage?.name ?? deal.stageName ?? 'Unknown',
          value: deal.value ?? 0,
          currency: deal.currency ?? 'PLN',
          daysInStage,
          isStalled: daysInStage > 14,
          probability: deal.probability ?? 50,
        }
      }),
    }
  },
}

// ─── Helper ──────────────────────────────────────────

function extractTopCategories(orders: any[]): string[] {
  const categoryCount: Record<string, number> = {}
  for (const order of orders) {
    const lines = order.lines?.getItems?.() ?? []
    for (const line of lines) {
      const cat = line.categoryName ?? line.productCategory ?? 'Inne'
      categoryCount[cat] = (categoryCount[cat] ?? 0) + 1
    }
  }
  return Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat)
}

// ─── Export ──────────────────────────────────────────

export const aiTools = [
  copilotSearchProducts,
  copilotCustomerContext,
  copilotCheckPricing,
  copilotOpenDeals,
]

export default aiTools
```

### 4.C.2 Demo Conversation Script

Create the JSON script that the MockTranscriptSimulator will play. This is the demo conversation.

#### File: `packages/voice-channels/src/modules/voice_channels/data/demo-scripts/demo-1-acme-steel.json`

Each segment has an optional `_narrativeBeat` field (ignored by simulator) that tells the demo narrator (Ewa) what to say or do at that moment.

```json
{
  "callId": "demo-call-001",
  "phoneNumber": "+48 512 345 678",
  "direction": "outbound",
  "customerId": "ACME_CUSTOMER_ID",
  "customerName": "Jan Kowalski",
  "companyName": "Acme Manufacturing Sp. z o.o.",
  "language": "pl-PL",
  "segments": [
    {
      "segmentId": 1,
      "speaker": "rep",
      "text": "Dzień dobry, Panie Janie. Tu Marek z Open Mercato. Dzwonię w sprawie Państwa zamówień na ten kwartał.",
      "delayMs": 2000,
      "_narrativeBeat": "SETUP. Ewa: 'Marek jest w firmie 3 miesiące. To jego pierwsza duża rozmowa z kluczowym klientem. Wcześniej musiałby przygotowywać się godzinę — dziś ma Copilota.' → CustomerContextCard auto-appears with Acme's LTV, order history, top categories."
    },
    {
      "segmentId": 2,
      "speaker": "customer",
      "text": "Dzień dobry, Panie Marku. Dobrze że Pan dzwoni, bo właśnie planowaliśmy kolejne zamówienie.",
      "delayMs": 3500,
      "_narrativeBeat": "Ewa points at CustomerContextCard: '142 tysiące złotych lifetime value. 20 zamówień w ciągu roku. Top kategorie: rury, zawory, kształtki. Marek wie z kim rozmawia — bez otwierania CRM-a.'"
    },
    {
      "segmentId": 3,
      "speaker": "rep",
      "text": "Świetnie się składa. Jak mogę pomóc? Czego Państwo potrzebują?",
      "delayMs": 2500,
      "_narrativeBeat": "Transition — rep is confident, he already sees the context."
    },
    {
      "segmentId": 4,
      "speaker": "customer",
      "text": "Potrzebujemy rur stalowych DN50, około pięćset sztuk. I jeszcze chyba z dwieście zaworów kulowych DN25.",
      "delayMs": 4000,
      "expectedIntent": "product_need",
      "_narrativeBeat": "★ FIRST WOW MOMENT. Watch the left panel — the phrase 'rur stalowych DN50' glows yellow. Intent toast flashes: 'Wykryto: zapotrzebowanie na produkt'. Then → ProductCard slides in with DN50 at 22.40 PLN (tier B pricing!), 1200 in stock, 92% confidence. Ewa: 'AI zrozumiało konkretny produkt, ilość, i od razu wyciągnęło cenę dla tego klienta — nie cennikową, tylko jego cenę.'"
    },
    {
      "segmentId": 5,
      "speaker": "rep",
      "text": "Rozumiem. Sprawdzam teraz dostępność i najlepszą cenę dla Państwa...",
      "delayMs": 3000,
      "_narrativeBeat": "Ewa: 'Marek mówi że sprawdza — ale tak naprawdę wszystko już widzi na ekranie. Copilot był szybszy.'"
    },
    {
      "segmentId": 6,
      "speaker": "customer",
      "text": "Proszę sprawdzić, bo ostatnio ceny trochę poszły w górę i zastanawiamy się czy to nadal się opłaca.",
      "delayMs": 4000,
      "expectedIntent": "price_objection",
      "_narrativeBeat": "★ TENSION. Toast: 'Wykryto: obiekcja cenowa'. → PricingAlertCard appears: customer price 22.40, floor price 20.60, max discount 12%, active promo Q1 -5%. Ewa: 'Klient sygnalizuje obawy cenowe. Copilot natychmiast pokazuje handlowcowi: ile możesz zejść, jaka jest cena minimalna, i że jest aktywna promocja którą może wykorzystać.'"
    },
    {
      "segmentId": 7,
      "speaker": "rep",
      "text": "Rozumiem obawy. Mamy dla Państwa specjalną cenę jako stałego klienta, a na ten kwartał jest jeszcze dodatkowa promocja na rury.",
      "delayMs": 4000,
      "_narrativeBeat": "Ewa: 'Zauważcie — Marek nie mówi \"muszę sprawdzić z kierownikiem\". Ma pełny obraz na ekranie. Odpowiada pewnie.'"
    },
    {
      "segmentId": 8,
      "speaker": "customer",
      "text": "Jaka promocja? Bo muszę powiedzieć że dostaliśmy też ofertę od konkurencji — Stalmet daje nam dziesięć procent taniej na rury.",
      "delayMs": 5000,
      "expectedIntent": "competitor_mention",
      "_narrativeBeat": "★ CONFLICT PEAK. Toast: 'Wykryto: wzmianka o konkurencji'. PricingCard updates or new card. Ewa: 'Klient zagrał kartą konkurencji. W starym świecie — panika, prośba o odroczenie. Z Copilotem Marek widzi: może dać 12% rabatu, a z promocją Q1 schodzi do 20.21 PLN. Stalmet daje 10% taniej od cennika, czyli ~22.41 — Marek jest poniżej.'"
    },
    {
      "segmentId": 9,
      "speaker": "rep",
      "text": "Stalmet? Rozumiem. Proszę pamiętać że u nas mają Państwo gwarantowany czas dostawy 48 godzin i pełną certyfikację PN-EN. Sprawdzam co mogę zaproponować cenowo...",
      "delayMs": 5000,
      "_narrativeBeat": "Rep counters with value arguments he can see in the system. Ewa pauses — let the audience absorb."
    },
    {
      "segmentId": 10,
      "speaker": "customer",
      "text": "To prawda, czas dostawy jest dla nas ważny. Ale cena też musi być konkurencyjna. Ile możecie zejść?",
      "delayMs": 4000,
      "expectedIntent": "price_objection",
      "_narrativeBeat": "Ewa: 'Klient się nie poddaje — ale Marek już zna odpowiedź. Patrzy na PricingCard: floor 20.60, max rabat 12%.'"
    },
    {
      "segmentId": 11,
      "speaker": "rep",
      "text": "Dla Państwa, przy tej ilości, mogę zaproponować dwanaście procent rabatu na rury i osiem procent na zawory. Co Pan na to?",
      "delayMs": 4000,
      "_narrativeBeat": "Ewa: 'Marek podaje dokładnie tyle, ile może — bez dzwonienia do szefa, bez przerywania rozmowy. Pewność siebie buduje zaufanie klienta.'"
    },
    {
      "segmentId": 12,
      "speaker": "customer",
      "text": "To brzmi dobrze. A jaki jest czas realizacji? Potrzebujemy to na budowę w Gdańsku, która startuje za dwa tygodnie.",
      "delayMs": 4500,
      "expectedIntent": "feature_question",
      "_narrativeBeat": "DealStatusCard appears showing 'Dostawa rur do projektu Gdańsk' — 45,000 PLN deal in Negotiation stage, 8 days. Ewa: 'Copilot wie o otwartym dealu na ten projekt. Handlowiec nie musi szukać w pipeline — deal context jest na ekranie.'"
    },
    {
      "segmentId": 13,
      "speaker": "rep",
      "text": "Rury mamy na stanie, wysyłka w 48 godzin. Zawory DN25 — sprawdzę, ale powinno być podobnie.",
      "delayMs": 3500,
      "_narrativeBeat": "Rep uses the stock data from ProductCard (1200 in stock). Confident."
    },
    {
      "segmentId": 14,
      "speaker": "customer",
      "text": "Dobra, w takim razie zamawiam. Pięćset rur DN50 i dwieście zaworów kulowych DN25. Proszę przygotować ofertę i wyślij do akceptacji.",
      "delayMs": 5000,
      "expectedIntent": "order_intent",
      "_narrativeBeat": "★ CLIMAX. Toast: 'Wykryto: intencja zamówienia'. → QuickActionCard slides in: [Utwórz ofertę] [Zaplanuj follow-up] [Dodaj notatkę]. Ewa: 'Jedno kliknięcie. Oferta pre-filled z ilością, ceną klienta i adresem dostawy. W starym procesie — 20 minut w Excelu. Tutaj — 2 sekundy.' Radek clicks 'Utwórz ofertę' → button changes to '✓ Dodano do oferty'."
    },
    {
      "segmentId": 15,
      "speaker": "rep",
      "text": "Doskonale! Przygotowuję ofertę teraz i wyślę ją do Pana na maila w ciągu godziny. Dziękuję za zamówienie, Panie Janie!",
      "delayMs": 4000,
      "_narrativeBeat": "RESOLUTION. Ewa: 'Rozmowa trwała 4 minuty i 30 sekund. Deal na 20 tysięcy złotych zamknięty. Nowy handlowiec, stary wynik.'"
    },
    {
      "segmentId": 16,
      "speaker": "customer",
      "text": "Dziękuję, Panie Marku. Do usłyszenia!",
      "delayMs": 2500,
      "_narrativeBeat": "CLOSING. Ewa: 'To jest Call Copilot. AI nie zastępuje handlowca — daje mu supermoc. Każda informacja z CRM-a, katalogu i systemu zamówień — na jednym ekranie, w czasie rzeczywistym. Dziękujemy.' [APPLAUSE]"
    }
  ]
}
```

**IMPORTANT**: Replace `"ACME_CUSTOMER_ID"` with the actual UUID of the seeded customer after creating seed data. The `_narrativeBeat` fields are for Ewa's script only — the simulator ignores them.

### 4.C.3 Seed Data

Create seed data that makes the demo realistic. The script references specific products and a specific customer.

#### File: `packages/voice-channels/src/modules/voice_channels/data/seed/demo-seed.ts`

This file should be runnable as a setup script or integrated into the module's `setup.ts` `seedExamples` hook.

```typescript
/**
 * Hackathon Demo Seed Data
 *
 * Creates:
 * - 1 company: Acme Manufacturing Sp. z o.o.
 * - 1 contact: Jan Kowalski (buyer)
 * - 50+ catalog products (steel pipes, valves, fittings) with Polish names
 * - 20+ historical orders for LTV calculation
 * - 3 open deals in pipeline
 * - 5+ activities (call logs, notes)
 * - Customer-tier pricing
 * - 1 active promotion (Q1 2026 bulk discount)
 *
 * After seeding, update demo-1-acme-steel.json with the actual customer UUID.
 */

export interface SeedResult {
  companyId: string
  customerId: string
  productIds: string[]
  dealIds: string[]
}

export async function seedDemoData(em: any, organizationId: string, tenantId: string): Promise<SeedResult> {
  // Implementation depends on exact ORM entity names.
  // The agent should:
  //
  // 1. Create company: Acme Manufacturing Sp. z o.o.
  //    - industry: Manufacturing
  //    - phone: +48 512 345 678
  //    - address: ul. Stalowa 15, 80-001 Gdańsk
  //
  // 2. Create person: Jan Kowalski
  //    - role: Kierownik Zakupów (Purchasing Manager)
  //    - email: j.kowalski@acme-mfg.pl
  //    - phone: +48 512 345 678
  //    - linked to Acme company
  //
  // 3. Create 50+ products in catalog, organized by category:
  //    Category: Rury stalowe (Steel Pipes)
  //    - Rura stalowa DN25 PN16, SKU: RS-DN25-PN16, base price: 15.80 PLN
  //    - Rura stalowa DN32 PN16, SKU: RS-DN32-PN16, base price: 18.50 PLN
  //    - Rura stalowa DN40 PN16, SKU: RS-DN40-PN16, base price: 21.20 PLN
  //    - Rura stalowa DN50 PN16, SKU: RS-DN50-PN16, base price: 24.90 PLN  ← DEMO KEY PRODUCT
  //    - Rura stalowa DN65 PN16, SKU: RS-DN65-PN16, base price: 32.50 PLN
  //    - Rura stalowa DN80 PN16, SKU: RS-DN80-PN16, base price: 38.20 PLN
  //    - Rura stalowa DN100 PN16, SKU: RS-DN100-PN16, base price: 48.60 PLN
  //    - Rura stalowa DN50 PN25, SKU: RS-DN50-PN25, base price: 29.40 PLN
  //    - Rura stalowa DN80 PN25, SKU: RS-DN80-PN25, base price: 45.80 PLN
  //    - Rura nierdzewna DN50, SKU: RN-DN50, base price: 52.30 PLN
  //
  //    Category: Zawory (Valves)
  //    - Zawór kulowy DN15, SKU: ZK-DN15, base price: 28.50 PLN
  //    - Zawór kulowy DN20, SKU: ZK-DN20, base price: 32.00 PLN
  //    - Zawór kulowy DN25, SKU: ZK-DN25, base price: 38.90 PLN  ← DEMO KEY PRODUCT
  //    - Zawór kulowy DN32, SKU: ZK-DN32, base price: 45.60 PLN
  //    - Zawór kulowy DN50, SKU: ZK-DN50, base price: 62.80 PLN
  //    - Zawór zwrotny DN25, SKU: ZZ-DN25, base price: 42.30 PLN
  //    - Zawór zwrotny DN50, SKU: ZZ-DN50, base price: 68.50 PLN
  //    - Zawór regulacyjny DN25, SKU: ZR-DN25, base price: 85.00 PLN
  //    - Zawór bezpieczeństwa DN25, SKU: ZB-DN25, base price: 95.00 PLN
  //    - Zawór motylkowy DN50, SKU: ZM-DN50, base price: 78.00 PLN
  //
  //    Category: Kształtki (Fittings)
  //    - Kolano 90° DN50, SKU: KOL-90-DN50, base price: 12.40 PLN
  //    - Kolano 45° DN50, SKU: KOL-45-DN50, base price: 11.80 PLN
  //    - Trójnik DN50, SKU: TRJ-DN50, base price: 18.90 PLN
  //    - Redukcja DN50/DN25, SKU: RED-50-25, base price: 14.20 PLN
  //    - Mufa DN50, SKU: MUF-DN50, base price: 8.50 PLN
  //    - Złączka DN50, SKU: ZLC-DN50, base price: 9.80 PLN
  //    - Kołnierz DN50 PN16, SKU: KON-DN50, base price: 22.60 PLN
  //    ... (add 20+ more fittings, flanges, gaskets, supports)
  //
  //    Category: Armatura (Hardware)
  //    - Śruba kołnierzowa M16x70, SKU: SRB-M16, base price: 2.40 PLN
  //    - Nakrętka M16, SKU: NAK-M16, base price: 0.80 PLN
  //    - Uszczelka DN50 PN16, SKU: USZ-DN50, base price: 4.20 PLN
  //    ... (add 10+ hardware items)
  //
  // 4. Set stock quantities:
  //    - RS-DN50-PN16: 1200 szt. (critical for demo)
  //    - ZK-DN25: 850 szt. (critical for demo)
  //    - All others: random 100–2000
  //
  // 5. Create customer-tier pricing for Acme:
  //    - RS-DN50-PN16: 22.40 PLN (tier B, -10% from base)
  //    - ZK-DN25: 35.60 PLN (tier B, -8.5% from base)
  //
  // 6. Create active promotion:
  //    - "Q1 2026 Promocja na rury" — 5% extra on all steel pipes
  //    - Valid: 2026-01-01 to 2026-03-31
  //
  // 7. Create 20+ historical orders for Acme (last 12 months):
  //    - Mix of product categories, amounts 2,000–25,000 PLN
  //    - Total LTV should be ~142,500 PLN
  //    - Average order ~7,125 PLN
  //    - Top categories: Rury stalowe, Zawory, Kształtki
  //
  // 8. Create 3 open deals:
  //    - "Dostawa rur do projektu Gdańsk" — 45,000 PLN, stage: Negotiation, 8 days
  //    - "Armatura dla nowej hali" — 28,000 PLN, stage: Proposal, 3 days
  //    - "Zamówienie roczne 2026" — 180,000 PLN, stage: Discovery, 22 days (stalled!)
  //
  // 9. Create 5 activities:
  //    - 3 call logs (previous calls with Jan Kowalski)
  //    - 1 email log
  //    - 1 note: "Klient zainteresowany długoterminową umową. Preferuje dostawy co 2 tygodnie."
  //
  // Return IDs for use in demo script JSON

  throw new Error('Implement seed data using actual ORM entities')
}
```

**CRITICAL for the agent**: The exact entity class names (e.g., `CatalogProduct`, `CustomerPersonProfile`, `SalesOrder`, `CustomerDeal`) must be discovered from the existing codebase. Check:
- `packages/core/src/modules/catalog/data/entities.ts`
- `packages/core/src/modules/customers/data/entities.ts`
- `packages/core/src/modules/sales/data/entities.ts`

Use `em.create()` and `em.persistAndFlush()` patterns from existing seed data in the codebase.

### 4.C.4 File Tree Summary (Sub-Spec C)

```
packages/voice-channels/src/modules/voice_channels/
├── ai-tools.ts                                 # 4 MCP tool definitions
└── data/
    ├── demo-scripts/
    │   └── demo-1-acme-steel.json              # Demo conversation script (Polish)
    └── seed/
        └── demo-seed.ts                        # Seed data generator
```

### 4.C.5 Verification Checklist (Sub-Spec C)

- [ ] All 4 MCP tools are exported in `ai-tools.ts` and discovered by `yarn generate`
- [ ] `copilot_search_products` returns matching products for keywords "rury", "zawory"
- [ ] `copilot_customer_context` returns complete customer object with LTV, order count, top categories
- [ ] `copilot_check_pricing` returns base price, customer price, floor price, and active promotion
- [ ] `copilot_open_deals` returns 3 deals including 1 stalled deal
- [ ] Seed data creates all fixtures without errors
- [ ] Demo script JSON has correct customerId matching the seeded customer
- [ ] All prices are in PLN, all text is in Polish

---

## 5. Response Cache — Demo Safety Net

**Purpose**: Pre-record all LLM responses and MCP tool outputs for the demo script so the demo works even if hotel WiFi or API is down.

**Built by**: Artur, Saturday evening after full pipeline is working.

### 5.1 How It Works

```typescript
// File: packages/voice-channels/src/modules/voice_channels/lib/copilot/response-cache.ts

import type { SuggestionCard, TranscriptSegment } from '@open-mercato/voice-channels/modules/voice_channels/types'

/**
 * Response cache for demo safety.
 * Maps segment IDs to pre-recorded suggestion cards.
 * When enabled, the orchestrator skips LLM + MCP tool calls
 * and returns cached results instantly.
 */

interface CachedResponse {
  segmentId: number
  suggestions: SuggestionCard[]
}

let cachedResponses: CachedResponse[] = []
let cacheEnabled = false

/** Load cached responses from JSON file */
export function loadResponseCache(responses: CachedResponse[]): void {
  cachedResponses = responses
  cacheEnabled = true
  console.log(`[ResponseCache] Loaded ${responses.length} cached responses`)
}

/** Check if cache has a response for this segment */
export function getCachedResponse(segmentId: number): SuggestionCard[] | null {
  if (!cacheEnabled) return null
  const cached = cachedResponses.find(r => r.segmentId === segmentId)
  return cached?.suggestions ?? null
}

/** Enable/disable cache (toggled via API or env var) */
export function setCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled
}

export function isCacheEnabled(): boolean {
  return cacheEnabled
}
```

### 5.2 Recording Cache

After one successful end-to-end run of the demo script, Artur saves all suggestion cards keyed by segmentId to a JSON file:

```
packages/voice-channels/src/modules/voice_channels/data/demo-scripts/demo-1-cache.json
```

The orchestrator checks `getCachedResponse(segment.segmentId)` before running the full intent → MCP pipeline. If cached, it emits the pre-recorded card immediately (< 50ms). If not cached (or cache disabled), it runs normally.

### 5.3 Activation

```bash
# Enable cache mode via env var (set at venue before demo)
COPILOT_DEMO_CACHE=true

# Or toggle at runtime via API:
# POST /api/voice_channels/mock/cache { "enabled": true }
```

---

## 6. CSS Animations

All animation keyframes used by the UI components. Add to a `<style>` block in the CopilotPage or a shared CSS file.

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes highlightPulse {
  0%, 100% { box-shadow: 0 0 0 rgba(234, 179, 8, 0); }
  50% { box-shadow: 0 0 16px rgba(234, 179, 8, 0.4); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

## 7. Integration Sequence

After all three sub-specs are implemented independently, integration follows this sequence:

1. **Serhii runs seed data** → creates Acme Manufacturing + products + orders + deals
2. **Serhii updates demo script JSON** with actual customer UUID from seed
3. **Artur verifies** transcript simulator emits events → appear in browser console via `useAppEvent`
4. **Artur verifies** orchestrator receives segments from subscriber and calls MCP tools
5. **Rafał verifies** CopilotPage at `/backend/voice-calls/copilot` subscribes to all 4 event types
6. **Full integration test**: Start demo call → segments appear in transcript → intent detected → MCP tool returns data → suggestion card appears in UI
7. **Artur records response cache** from one successful run
8. **Test cache mode**: Enable `COPILOT_DEMO_CACHE=true`, restart, run demo again — cards should appear instantly without API calls

**Fallback ladder** (if things break at integration):

| Problem | Fallback |
|---|---|
| MCP tool DI resolution fails | Create `copilot-tools-fallback.ts` with hardcoded data matching seed fixtures |
| LLM API unreachable | Keywords alone produce correct intents for the demo script |
| Both LLM and MCP fail | Enable response cache — pre-recorded cards fire on schedule |
| SSE events don't reach browser | Check `clientBroadcast: true` on events, verify `useEventBridge()` mounted in app layout |

---

## 8. Module Registration Checklist

After all three agents complete their work:

- [ ] `voice_channels` added to `apps/mercato/src/modules.ts`
- [ ] `npm run modules:prepare` runs clean
- [ ] `yarn build:packages` succeeds
- [ ] `yarn generate` discovers ai-tools.ts and events.ts
- [ ] Backend page accessible at `/backend/voice-calls/copilot`
- [ ] Full demo run: 16 segments, 5+ suggestion cards, < 5s latency per suggestion
- [ ] Response cache recorded and tested in offline mode
- [ ] Trigger text highlighting visible in transcript when cards appear
- [ ] Intent toast flashes before each card
- [ ] "Add to Quote" button shows ✓ feedback on click
