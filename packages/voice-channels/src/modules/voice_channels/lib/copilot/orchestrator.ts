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
  VoiceCreateQuotePrefill,
} from '@open-mercato/voice-channels/modules/voice_channels/types'
import { IntentDetector } from './intent-detector'
import type { LlmClient } from './llmClient'
import { quoteLlmResponseSchema } from '../../data/validators'
import { QUOTE_EXTRACTION_SYSTEM_PROMPT } from './prompts/quoteExtraction'
import { buildCompanyContextMergePrompt } from './prompts/companyContextMerge'
import { emitVoiceEvent } from '../../events'
import aiTools from '../../ai-tools'
import {
  resolveCompanyForCustomer,
  readCompanyContext,
  writeCompanyContext,
  COPILOT_CONTEXT_MAX_LENGTH,
} from './company-context'
import { generateQuickActionPrefill, type QuickActionPrefillResult } from './generate-quick-action-prefill'
import type { EntityManager } from '@mikro-orm/core'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE } from '@open-mercato/core/modules/customers/lib/interactionCompatibility'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import {
  extractQuantityNearAliases,
  extractSearchKeywordsFromText,
  inferQuantityFromSegments,
  inferQuantityFromText,
  summarizeTranscriptSegments,
} from './quickActionDrafts'
import { expandStemVariants, PL_STOPWORDS, stripDiacritics } from '../text/polishText'

const toolHandlers: Record<string, (input: any, ctx: any) => Promise<unknown>> =
  Object.fromEntries(aiTools.map((tool) => [tool.name, tool.handler as any]))

const PROFILE_ENABLED = (process.env.OM_PROFILE ?? '').split(',').some(
  (filter) => filter === '*' || filter === 'all' || filter === 'voice_channels.*' || filter === 'voice_channels.copilot',
)

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
  repUserId: string | null
  tenantId: string
  organizationId: string
  contextWindow: TranscriptSegment[]
  recentSuggestionTypes: Map<string, number>
  suggestionCounter: number
  lastProductId: string | null
  // Company memory: resolved + loaded once at startSession, refreshed at endSession.
  companyProfileId: string | null
  companyEntityId: string | null
  companyContext: string | null
}

function resolveFollowUpTargetEntityId(session: CopilotSession): string | null {
  if (session.companyEntityId) {
    return session.companyEntityId
  }
  return session.customerId
}

function resolveFollowUpTargetEntityIds(session: CopilotSession): string[] {
  return Array.from(
    new Set(
      [session.customerId, session.companyEntityId].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    ),
  )
}

function resolveNoteTargetEntityIds(session: CopilotSession): string[] {
  return Array.from(
    new Set(
      [session.customerId, session.companyEntityId].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    ),
  )
}

// Sessions live on globalThis so all per-request orchestrator instances share call state.
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
    this.intentDetector = new IntentDetector(container)
  }

  /**
   * Initialize for a new call. Emits CustomerContextCard immediately.
   */
  async startSession(
    callId: string,
    customerId: string | undefined,
    tenantId: string,
    organizationId: string,
    repUserId?: string | null,
  ): Promise<void> {
    const session: CopilotSession = {
      callId,
      customerId: customerId ?? null,
      repUserId: repUserId ?? null,
      tenantId,
      organizationId,
      contextWindow: [],
      recentSuggestionTypes: new Map(),
      suggestionCounter: 0,
      companyProfileId: null,
      companyEntityId: null,
      companyContext: null,
      lastProductId: null,
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
          session.companyEntityId = company.companyEntityId
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
      await this.registerCallActivity(session)
    } catch (err) {
      console.error('[Orchestrator] Failed to register call activity:', err)
    }

    let prefill: QuickActionPrefillResult | null = null
    try {
      prefill = await generateQuickActionPrefill({
        callId: session.callId,
        customerId: session.customerId,
        targetEntityId: resolveFollowUpTargetEntityId(session),
        ownerUserId: session.repUserId,
        contextWindow: session.contextWindow,
        detectedIntents: Array.from(session.recentSuggestionTypes.keys()),
      })
    } catch (err) {
      console.error('[Orchestrator] Failed to generate quick-action prefill:', err)
    }

    try {
      const finalQuickAction = await this.buildQuickAction(
        session,
        'Podsumowanie rozmowy',
        0,
        1,
        prefill,
      )
      finalQuickAction.detectedIntent = 'Szybkie akcje po rozmowie'
      await this.emitSuggestion(session, finalQuickAction)
    } catch (err) {
      console.error('[Orchestrator] Failed to emit final quick-action card:', err)
    }

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
    const llm = this.container.resolve<LlmClient>('llmClient')

    const prior = session.companyContext?.trim() || '(empty)'
    const intentSummary = Array.from(session.recentSuggestionTypes.keys()).join(', ') || '(none detected)'
    const transcriptText = session.contextWindow
      .map((s) => `[${s.speaker}] ${s.text}`)
      .join('\n')
      .slice(0, 6000)

    const systemPrompt = buildCompanyContextMergePrompt(COPILOT_CONTEXT_MAX_LENGTH)

    const userPrompt = `PRIOR MEMORY:
${prior}

INTENTS DETECTED THIS CALL:
${intentSummary}

TRANSCRIPT:
${transcriptText}

Return only the updated memory document.`

    try {
      const text = await llm.complete(systemPrompt, userPrompt, { temperature: 0.2, maxTokens: 800 })
      if (!text) return null

      const stripped = text.trim()
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
          card = await this.buildQuickAction(
            session,
            triggerText,
            result.segmentId,
            result.confidence,
            result.keywords,
          )
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

    session.lastProductId = toolResult.products[0]?.id ?? session.lastProductId

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
      productId: session.lastProductId ?? undefined,
      context: session.lastProductId ? undefined : recentProductSegments.map(s => s.text).join(' '),
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

  private async buildQuickAction(
    session: CopilotSession,
    triggerText: string,
    triggerSegmentId: number,
    confidence: number,
    keywords: string[] = [],
  ): Promise<SuggestionCard> {
    const suggestionId = this.nextSuggestionId(session)
    const { lines, extractionMethod } = await this.resolveQuickActionLines(session, keywords, confidence, triggerText)
    const channelId = await this.resolvePreferredChannelId(session)

    return {
      id: suggestionId,
      type: 'quick_action',
      priority: 'high',
      triggerText,
      triggerSegmentId,
      matchConfidence: Math.round(confidence * 100),
      createdAt: Date.now(),
      actions: [
        {
          label: 'Utwórz ofertę',
          actionType: 'create_quote',
          prefill: {
            source: {
              callId: session.callId,
              suggestionId,
              triggerSegmentId,
            },
            customerId: session.customerId,
            companyId: session.companyEntityId,
            channelId,
            transcriptSummary: summarizeTranscriptSegments(session.contextWindow),
            detectedIntents: Array.from(session.recentSuggestionTypes.keys()),
            lines,
            extractionMethod,
            note: triggerText || null,
          },
        },
        {
          label: 'Zaplanuj follow-up',
          actionType: 'schedule_followup',
          prefill: {
            customerId: session.customerId,
            targetEntityId: resolveFollowUpTargetEntityId(session),
            targetEntityIds: resolveFollowUpTargetEntityIds(session),
            callId: session.callId,
            ownerUserId: session.repUserId,
          },
        },
        {
          label: 'Dodaj notatkę',
          actionType: 'add_note',
          prefill: {
            customerId: session.customerId,
            targetEntityIds: resolveNoteTargetEntityIds(session),
            callId: session.callId,
          },
        },
      ],
    }
  }

  private getRecentConversationSegments(session: CopilotSession, limit = 16): TranscriptSegment[] {
    return session.contextWindow
      .slice(-limit)
  }

  private buildProductSearchKeywords(segments: TranscriptSegment[], keywords: string[], limit = 8): string[] {
    // Customer segments first (most recent first), then rep segments.
    const customerTokens = [...segments]
      .reverse()
      .filter((segment) => segment.speaker === 'customer')
      .flatMap((segment) => extractSearchKeywordsFromText(segment.text, 20))

    const repTokens = [...segments]
      .reverse()
      .filter((segment) => segment.speaker === 'rep')
      .flatMap((segment) => extractSearchKeywordsFromText(segment.text, 12))

    const rawTokens = [
      ...keywords,
      ...customerTokens,
      ...repTokens,
    ]
      .map((keyword) => keyword.trim())
      .filter((keyword) => {
        if (keyword.length < 3) return false
        const lowered = keyword.toLocaleLowerCase('pl-PL')
        return !PL_STOPWORDS.has(lowered)
      })

    const withStems = rawTokens.flatMap((token) => {
      const variants = expandStemVariants(token)
      const stripped = variants.map((v) => stripDiacritics(v))
      return [...variants, ...stripped]
    })

    return Array.from(new Set(withStems)).slice(0, limit)
  }

  private collectProductAliases(product: CopilotProductSearchResult['products'][number]): string[] {
    return [product.name, product.sku].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  }

  private segmentExplicitProductMentions(
    segment: TranscriptSegment,
    product: CopilotProductSearchResult['products'][number],
  ): boolean {
    const segmentText = segment.text.toLocaleLowerCase()
    return this.collectProductAliases(product)
      .map((alias) => alias.toLocaleLowerCase())
      .some((alias) => segmentText.includes(alias))
  }

  private scoreProductAgainstSegment(
    segment: TranscriptSegment,
    product: CopilotProductSearchResult['products'][number],
  ): number {
    const segmentText = segment.text.toLocaleLowerCase()
    const aliases = this.collectProductAliases(product).map((alias) => alias.toLocaleLowerCase())

    if (aliases.some((alias) => segmentText.includes(alias))) {
      return 100
    }

    const segmentKeywords = extractSearchKeywordsFromText(segment.text, 12).map((keyword) => keyword.toLocaleLowerCase())
    const productKeywords = extractSearchKeywordsFromText(
      [product.name, product.sku].filter(Boolean).join(' '),
      12,
    ).map((keyword) => keyword.toLocaleLowerCase())

    return productKeywords.reduce((score, keyword) => (
      segmentKeywords.includes(keyword) ? score + 1 : score
    ), 0)
  }

  // Extracts the first balanced {...} JSON object from a raw LLM response.
  private extractFirstJsonObject(text: string): string | null {
    if (typeof text !== 'string' || text.length === 0) return null
    const cleaned = text.replace(/```(?:json)?/gi, '')
    const start = cleaned.indexOf('{')
    if (start < 0) return null

    let depth = 0
    let inString = false
    let escape = false

    for (let index = start; index < cleaned.length; index += 1) {
      const char = cleaned[index]
      if (inString) {
        if (escape) {
          escape = false
        } else if (char === '\\') {
          escape = true
        } else if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }

      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          return cleaned.slice(start, index + 1)
        }
      }
    }

    return null
  }

  private async extractQuoteLinesViaLlm(
    session: CopilotSession,
    candidateProducts: CopilotProductSearchResult['products'],
    segments: TranscriptSegment[],
    confidence: number,
    triggerText: string,
  ): Promise<VoiceCreateQuotePrefill['lines'] | null> {
    if (!candidateProducts?.length || !segments.length) {
      console.warn('[Orchestrator] extractQuoteLinesViaLlm: no candidate products or segments', {
        callId: session.callId,
        candidateProducts: candidateProducts?.length ?? 0,
        segments: segments.length,
      })
      return null
    }

    const topCandidates = candidateProducts.slice(0, 40)
    const catalogPayload = topCandidates.map((product) => ({
      id: product.id,
      title: product.name,
      sku: product.sku ?? null,
    }))

    const transcriptText = segments
      .map((segment, index) => `#${index + 1} [${segment.speaker}] ${segment.text.trim()}`)
      .join('\n')
      .slice(0, 6000)

    const systemPrompt = QUOTE_EXTRACTION_SYSTEM_PROMPT

    const catalogJson = JSON.stringify(catalogPayload)
    const userPrompt = `CATALOG (only these product ids are valid):
${catalogJson}

TRANSCRIPT (ordered, #N is segment index, [speaker] = rep or customer):
${transcriptText}

Return the JSON object now.`

    if (PROFILE_ENABLED) console.log('[copilot:profile] extractQuoteLinesViaLlm: calling LLM', {
      callId: session.callId,
      candidateProducts: catalogPayload.length,
      transcriptSegments: segments.length,
      transcriptChars: transcriptText.length,
    })

    try {
      const llm = this.container.resolve<LlmClient>('llmClient')
      const text = await llm.complete(systemPrompt, userPrompt, { temperature: 0, maxTokens: 800 })
      if (!text) return null

      if (PROFILE_ENABLED) console.log('[copilot:profile] extractQuoteLinesViaLlm: raw response', text.slice(0, 600))

      const jsonBlock = this.extractFirstJsonObject(text)
      if (!jsonBlock) {
        console.error('[Orchestrator] Quote extraction: no JSON object in response', text.slice(0, 500))
        return null
      }

      let rawJson: unknown
      try {
        rawJson = JSON.parse(jsonBlock)
      } catch {
        console.error('[copilot] Quote extraction: JSON parse failed')
        return null
      }

      const parseResult = quoteLlmResponseSchema.safeParse(rawJson)
      if (!parseResult.success) {
        console.error('[copilot] LLM response validation failed', parseResult.error.issues)
        return null
      }

      const rankedProductIds = new Set(topCandidates.map((p) => p.id))
      const lines: VoiceCreateQuotePrefill['lines'] = parseResult.data.lines
        .filter((line) => rankedProductIds.has(line.productId))
        .map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          note: line.rationale?.slice(0, 500) ?? triggerText?.trim() ?? null,
          confidence: Math.round(line.confidence * 100) / 100,
        }))

      if (PROFILE_ENABLED) console.log('[copilot:profile] extractQuoteLinesViaLlm: parsed lines', {
        callId: session.callId,
        rawLineCount: parseResult.data.lines.length,
        acceptedLineCount: lines.length,
        lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      })

      return lines.length > 0 ? lines : null
    } catch (err) {
      console.error('[Orchestrator] Quote extraction failed:', err)
      return null
    }
  }

  private async resolveQuickActionLines(
    session: CopilotSession,
    keywords: string[],
    confidence: number,
    triggerText: string,
  ): Promise<{ lines: VoiceCreateQuotePrefill['lines']; extractionMethod: 'llm' | 'heuristic' | 'heuristic_fallback' }> {
    const conversationSegments = this.getRecentConversationSegments(session)
    const customerText = conversationSegments
      .filter((s) => s.speaker === 'customer')
      .map((s) => s.text)
      .join(' ')
    const aggregateKeywords = this.buildProductSearchKeywords(conversationSegments, keywords, 60)

    console.log('[DEBUG:quote] aggregateKeywords', aggregateKeywords.slice(0, 30))

    const candidates = aggregateKeywords.length > 0
      ? await this.callMcpTool<CopilotProductSearchResult>(
          'copilot_search_products',
          {
            keywords: aggregateKeywords,
            customerId: session.customerId,
            limit: 40,
            context: customerText,
          },
          session,
        )
      : null

    const llmCandidates = candidates?.products ?? []

    console.log('[DEBUG:quote] search returned', llmCandidates.length, 'products:', llmCandidates.map((p) => p.name))

    const llmLines = await this.extractQuoteLinesViaLlm(
      session,
      llmCandidates,
      conversationSegments,
      confidence,
      triggerText,
    )

    console.log('[DEBUG:quote] llmLines result:', llmLines?.length ?? 'null', llmLines?.map((l) => ({ pid: l.productId, qty: l.quantity })))

    if (llmLines && llmLines.length > 0) {
      session.lastProductId = llmLines[0]?.productId ?? session.lastProductId
      return { lines: llmLines, extractionMethod: 'llm' as const }
    }

    const linesByProductId = new Map<string, VoiceCreateQuotePrefill['lines'][number]>()
    const candidateProductsBySegment = new Map<number, CopilotProductSearchResult['products']>()

    console.log('[DEBUG:quote] entering heuristic path, segments:', conversationSegments.length)

    for (const segment of conversationSegments) {
      const segmentKeywords = extractSearchKeywordsFromText(segment.text, 8)
      console.log('[DEBUG:quote] segment', segment.segmentId, segment.speaker, ':', segment.text.slice(0, 100), '→ keywords:', segmentKeywords)
      const segmentProducts = segmentKeywords.length > 0
        ? await this.callMcpTool<CopilotProductSearchResult>(
            'copilot_search_products',
            {
              keywords: segmentKeywords,
              customerId: session.customerId,
              limit: 5,
            },
            session,
          )
        : null

      console.log('[DEBUG:quote] segment', segment.segmentId, 'search returned:', segmentProducts?.products?.map((p) => p.name) ?? 'null')

      const candidateProducts = Array.from(
        new Map(
          [...(segmentProducts?.products ?? []), ...(candidates?.products ?? [])]
            .map((product) => [product.id, product]),
        ).values(),
      )
      candidateProductsBySegment.set(segment.segmentId, candidateProducts)

      for (const product of candidateProducts) {
        const score = this.scoreProductAgainstSegment(segment, product)
        const aliases = this.collectProductAliases(product)
        const quantity = score >= 2 ? extractQuantityNearAliases(segment.text, aliases) : null
        console.log('[DEBUG:quote] product', product.name, 'score:', score, 'aliases:', aliases, 'quantity:', quantity)
        if (score < 2) continue
        if (quantity == null) continue

        linesByProductId.set(product.id, {
          productId: product.id,
          quantity,
          note: segment.text.trim() || triggerText || null,
          confidence: Math.round(confidence * 100) / 100,
        })
      }
    }

    console.log('[DEBUG:quote] heuristic linesByProductId:', Array.from(linesByProductId.entries()).map(([id, l]) => ({ id, qty: l.quantity })))

    for (let index = 0; index < conversationSegments.length; index += 1) {
      const segment = conversationSegments[index]
      const candidateProducts = candidateProductsBySegment.get(segment.segmentId) ?? []
      const explicitProducts = candidateProducts.filter((product) => this.segmentExplicitProductMentions(segment, product))

      if (explicitProducts.length !== 1) continue
      const explicitProduct = explicitProducts[0]
      if (linesByProductId.has(explicitProduct.id)) continue

      const nearbySegments = [
        conversationSegments[index - 1],
        conversationSegments[index + 1],
        conversationSegments[index + 2],
      ].filter((value): value is TranscriptSegment => Boolean(value))

      for (const nearbySegment of nearbySegments) {
        const nearbyCandidates = candidateProductsBySegment.get(nearbySegment.segmentId) ?? []
        const nearbyExplicitProducts = nearbyCandidates.filter((product) => this.segmentExplicitProductMentions(nearbySegment, product))
        if (nearbyExplicitProducts.length > 0) continue

        const quantity = inferQuantityFromText(nearbySegment.text)
        if (quantity == null) continue

        linesByProductId.set(explicitProduct.id, {
          productId: explicitProduct.id,
          quantity,
          note: `${segment.text.trim()} ${nearbySegment.text.trim()}`.trim() || triggerText || null,
          confidence: Math.round(confidence * 100) / 100,
        })
        break
      }
    }

    const heuristicMethod = this.hasLlmClient() ? 'heuristic_fallback' as const : 'heuristic' as const

    if (linesByProductId.size === 0) {
      const productId = await this.resolveQuickActionProductId(session, keywords)
      const quantity = inferQuantityFromSegments(conversationSegments.slice(-6)) ?? 1
      if (productId) {
        session.lastProductId = productId
        return {
          lines: [
            {
              productId,
              quantity,
              note: triggerText || null,
              confidence: Math.round(confidence * 100) / 100,
            },
          ],
          extractionMethod: heuristicMethod,
        }
      }
      return { lines: [], extractionMethod: heuristicMethod }
    }

    const lines = Array.from(linesByProductId.values())
    session.lastProductId = lines[0]?.productId ?? session.lastProductId
    return { lines, extractionMethod: heuristicMethod }
  }

  private hasLlmClient(): boolean {
    try {
      return !!this.container.resolve<unknown>('llmClient')
    } catch {
      return false
    }
  }

  private async resolveQuickActionProductId(session: CopilotSession, keywords: string[]): Promise<string | null> {
    if (session.lastProductId) return session.lastProductId

    const searchKeywords = this.buildProductSearchKeywords(this.getRecentConversationSegments(session, 8), keywords, 8)

    if (searchKeywords.length === 0) return null

    const toolResult = await this.callMcpTool<CopilotProductSearchResult>(
      'copilot_search_products',
      {
        keywords: searchKeywords,
        customerId: session.customerId,
        limit: 1,
      },
      session,
    )

    const productId = toolResult?.products?.[0]?.id ?? null
    if (productId) session.lastProductId = productId
    return productId
  }

  private async resolvePreferredChannelId(session: CopilotSession): Promise<string | null> {
    try {
      const em = this.container.resolve<EntityManager>('em').fork()
      const channels = await em.find(
        SalesChannel,
        {
          organizationId: session.organizationId,
          tenantId: session.tenantId,
          isActive: true,
          deletedAt: null,
        },
        {
          orderBy: { createdAt: 'ASC' },
        },
      )

      if (channels.length === 1) return channels[0]?.id ?? null

      const demoChannel = channels.find((channel) => channel.code === 'voice_channels_demo')
      return demoChannel?.id ?? null
    } catch (err) {
      console.error('[Orchestrator] Failed to resolve preferred channel:', err)
      return null
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

  /**
   * Persist the completed call as a `call` activity on the linked customer.
   * Uses the canonical customers.interactions.create command so the record
   * shows up in the Activities tab for the customer detail page.
   */
  private async registerCallActivity(session: CopilotSession): Promise<void> {
    const targetIds = Array.from(
      new Set(
        [session.customerId, session.companyEntityId].filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        ),
      ),
    )

    if (targetIds.length === 0) {
      console.warn('[Orchestrator] registerCallActivity: no customer/company on session', session.callId)
      return
    }

    let commandBus: CommandBus
    try {
      commandBus = this.container.resolve('commandBus') as CommandBus
    } catch (err) {
      console.error('[Orchestrator] registerCallActivity: commandBus not resolvable', err)
      return
    }
    if (!commandBus) return

    const detectedIntents = Array.from(session.recentSuggestionTypes.keys())
    const transcript = session.contextWindow
      .map((segment) => `[${segment.speaker}] ${segment.text}`)
      .join('\n')
      .slice(0, 9000)

    const bodyParts: string[] = [`Call ID: ${session.callId}`]
    if (detectedIntents.length > 0) {
      bodyParts.push(`Wykryte intencje: ${detectedIntents.join(', ')}`)
    }
    if (transcript.length > 0) {
      bodyParts.push('', 'Transkrypcja:', transcript)
    }
    const body = bodyParts.join('\n')
    const occurredAt = new Date()
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
    const repUserId = session.repUserId && UUID_REGEX.test(session.repUserId) ? session.repUserId : null

    const commandContext: CommandRuntimeContext = {
      container: this.container as any,
      auth: {
        sub: repUserId,
        userId: repUserId,
        tenantId: session.tenantId,
        orgId: session.organizationId,
      } as any,
      organizationScope: null,
      selectedOrganizationId: session.organizationId,
      organizationIds: [session.organizationId],
      syncOrigin: 'voice_channels.copilot',
    }

    for (const targetId of targetIds) {
      try {
        const { result } = await commandBus.execute<
          Record<string, unknown>,
          { interactionId: string; entityId: string }
        >('customers.interactions.create', {
          input: {
            entityId: targetId,
            interactionType: 'call',
            title: 'Rozmowa telefoniczna (Copilot)',
            body,
            status: 'done',
            occurredAt,
            authorUserId: repUserId,
            ownerUserId: repUserId,
            source: CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE,
            appearanceIcon: 'lucide:phone-call',
          },
          ctx: commandContext,
        })

      } catch (err) {
        console.error('[Orchestrator] registerCallActivity: failed for target', {
          callId: session.callId,
          targetId,
          error: err,
        })
      }
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
