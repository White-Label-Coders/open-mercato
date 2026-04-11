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
import { emitVoiceEvent } from '../../events'
import aiTools from '../../ai-tools'
import {
  resolveCompanyForCustomer,
  readCompanyContext,
  writeCompanyContext,
  COPILOT_CONTEXT_MAX_LENGTH,
} from './company-context'
import type { EntityManager } from '@mikro-orm/core'

const toolHandlers: Record<string, (input: any, ctx: any) => Promise<unknown>> =
  Object.fromEntries(aiTools.map((tool) => [tool.name, tool.handler as any]))

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
  // Company memory: resolved + loaded once at startSession, refreshed at endSession.
  companyProfileId: string | null
  companyContext: string | null
}

// Sessions live on globalThis so that every per-request orchestrator instance
// shares the same in-flight call state. Awilix .singleton() is only container-
// scoped; each HTTP request creates a fresh container and a fresh orchestrator
// whose local `sessions` Map would otherwise be empty. The result would be:
// POST /mock/start populates session A in container A's orchestrator, then the
// simulator's delayed setTimeout emissions land in a subscriber resolving
// container B's orchestrator, whose sessions map is empty, so processSegment
// early-returns and no keyword suggestions ever fire.
const GLOBAL_SESSIONS_KEY = '__voiceChannelsCopilotSessions__'

function getSharedSessions(): Map<string, CopilotSession> {
  const store = globalThis as Record<string, unknown>
  const existing = store[GLOBAL_SESSIONS_KEY]
  if (existing instanceof Map) return existing as Map<string, CopilotSession>
  const created = new Map<string, CopilotSession>()
  store[GLOBAL_SESSIONS_KEY] = created
  return created
}

export class CopilotOrchestrator {
  private container: AppContainer
  private intentDetector: IntentDetector
  private get sessions(): Map<string, CopilotSession> {
    return getSharedSessions()
  }

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
      companyProfileId: null,
      companyContext: null,
    }
    this.sessions.set(callId, session)

    // Resolve linked company and load any prior Copilot context document.
    // Best-effort: failures here must not block the call from starting.
    if (customerId) {
      try {
        const em = this.container.resolve<EntityManager>('em').fork()
        const company = await resolveCompanyForCustomer(em, customerId, {
          tenantId,
          organizationId,
        })
        if (company) {
          session.companyProfileId = company.companyProfileId
          session.companyContext = await readCompanyContext(em, company.companyProfileId, {
            tenantId,
            organizationId,
          })
        }
      } catch (err) {
        console.error('[Orchestrator] Failed to load company context:', err)
      }
    }

    // Auto-emit CustomerContextCard at call start (now includes priorContext if loaded)
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
      .detectByLlm(segment, session.contextWindow, session.companyContext)
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
   * Return all active sessions for the Copilot calls API.
   */
  getActiveSessions(): Array<{ callId: string; customerId: string | null; startedAt: number; segmentCount: number }> {
    return Array.from(this.sessions.values()).map(session => ({
      callId: session.callId,
      customerId: session.customerId,
      startedAt: Date.now(), // session start approximation
      segmentCount: session.contextWindow.length,
    }))
  }

  /**
   * End a call session.
   *
   * Best-effort flow:
   * 1. Look up the session.
   * 2. Ask the LLM to merge prior company context with the new transcript +
   *    detected intents into an updated memory document.
   * 3. Persist the merged document back to the company custom field.
   * 4. Clear the in-process session.
   *
   * All failures are logged but never thrown — context refresh is a side effect
   * and must not block the call.ended event from completing.
   */
  async endSession(callId: string): Promise<void> {
    const session = this.sessions.get(callId)
    if (!session) return

    try {
      if (session.companyProfileId && session.contextWindow.length > 0) {
        const merged = await this.mergeCompanyContext(session)
        if (merged && merged !== session.companyContext) {
          const em = this.container.resolve<EntityManager>('em').fork()
          await writeCompanyContext(em, session.companyProfileId, merged, {
            tenantId: session.tenantId,
            organizationId: session.organizationId,
          })
        }
      }
    } catch (err) {
      console.error('[Orchestrator] Failed to refresh company context:', err)
    } finally {
      this.sessions.delete(callId)
    }
  }

  /**
   * Ask the LLM to merge the prior company context with the just-completed call.
   * Returns the merged plain-text document, or null when the LLM is unavailable
   * or returns nothing useful.
   */
  private async mergeCompanyContext(session: CopilotSession): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.warn('[Orchestrator] No ANTHROPIC_API_KEY — skipping company context merge')
      return null
    }

    const prior = session.companyContext?.trim() || '(empty)'
    const intentSummary = Array.from(session.recentSuggestionTypes.keys()).join(', ') || '(none detected)'
    const transcriptText = session.contextWindow
      .map((s) => `[${s.speaker}] ${s.text}`)
      .join('\n')
      .slice(0, 6000)

    const systemPrompt = `You maintain a long-term memory document for a B2B customer relationship. You will be given:
1. The PRIOR memory text (or "(empty)").
2. A new call transcript (rep + customer turns).
3. A list of intents detected during the call.

Your job: produce a single updated memory document. Rules:
- Plain text only. No markdown fences, no headers, no commentary.
- Stay under ${COPILOT_CONTEXT_MAX_LENGTH} characters total.
- Preserve durable facts from the PRIOR memory (people, decisions, ongoing deals, pain points) unless the new call clearly invalidates them.
- Add NEW durable facts learned in this call: pain points, commitments, products discussed, competitor mentions, follow-ups owed, names introduced.
- Do NOT include greetings, weather, small talk, or per-call conversational filler.
- Write in the language of the transcript (Polish if Polish, English if English).
- When the new call adds nothing durable, return the PRIOR memory unchanged.`

    const userPrompt = `PRIOR MEMORY:
${prior}

INTENTS DETECTED THIS CALL:
${intentSummary}

TRANSCRIPT:
${transcriptText}

Return only the updated memory document.`

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          temperature: 0.2,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })

      if (!response.ok) {
        console.error('[Orchestrator] Context merge API error:', response.status)
        return null
      }

      const data = await response.json()
      const text = data.content?.[0]?.text
      if (typeof text !== 'string') return null

      // Strip optional markdown fences the model may emit despite instructions.
      const stripped = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()
      if (stripped.length === 0) return null
      return stripped
    } catch (err) {
      console.error('[Orchestrator] Context merge failed:', err)
      return null
    }
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
      context: triggerText,
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
      priorContext: session.companyContext,
    }

    await this.emitSuggestion(session, card)
  }

  /**
   * Call a voice-channels AI tool by name. Tools are imported directly from
   * `ai-tools.ts` so the orchestrator does not depend on the MCP runtime
   * registry (which is only loaded inside the MCP server process).
   */
  private async callMcpTool<T>(
    toolName: string,
    input: Record<string, unknown>,
    session: CopilotSession,
  ): Promise<T | null> {
    const handler = toolHandlers[toolName]
    if (!handler) {
      console.warn(`[Orchestrator] Voice-channels AI tool "${toolName}" not found`)
      return null
    }
    try {
      const result = await handler(input, {
        tenantId: session.tenantId,
        organizationId: session.organizationId,
        userId: null,
        container: this.container,
        userFeatures: ['voice_channels.copilot.view'],
        isSuperAdmin: true,
      })
      return result as T
    } catch (err) {
      console.error(`[Orchestrator] AI tool "${toolName}" error:`, err)
      return null
    }
  }

  private async emitSuggestion(session: CopilotSession, card: SuggestionCard): Promise<void> {
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
