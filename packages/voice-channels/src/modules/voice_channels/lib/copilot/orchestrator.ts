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
import { emitVoiceEvent } from '../../events'
import aiTools from '../../ai-tools'
import {
  resolveCompanyForCustomer,
  readCompanyContext,
  writeCompanyContext,
  COPILOT_CONTEXT_MAX_LENGTH,
} from './company-context'
import type { EntityManager } from '@mikro-orm/core'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE } from '@open-mercato/core/modules/customers/lib/interactionCompatibility'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import {
  extractQuantityNearAliases,
  extractSearchKeywordsFromText,
  inferQuantityFromSegments,
  inferQuantityFromText,
  summarizeTranscriptSegments,
} from './quickActionDrafts'

const toolHandlers: Record<string, (input: any, ctx: any) => Promise<unknown>> =
  Object.fromEntries(aiTools.map((tool) => [tool.name, tool.handler as any]))

// Polish filler tokens that must not seed the catalog search fallback. If these
// leak into the OR-pattern the query matches every product with a random vowel.
const PL_STOPWORDS = new Set([
  'dzień', 'dobry', 'dzien', 'panie', 'pani', 'proszę', 'prosze',
  'dziękuję', 'dziekuje', 'dzwonię', 'dzwonie', 'dobrze', 'tak', 'nie',
  'bardzo', 'sprawie', 'państwa', 'panstwa', 'państwo', 'panstwo',
  'kwartał', 'kwartal', 'teraz', 'jak', 'co', 'czy', 'się', 'sie',
  'jest', 'są', 'są', 'być', 'byc', 'mamy', 'mam', 'masz', 'ma',
  'potrzebujemy', 'potrzebuję', 'potrzebuje', 'ale', 'bo', 'bardzo',
  'doskonale', 'rozumiem', 'sprawdzam', 'sprawdzę', 'sprawdze',
  'obawy', 'przygotowuję', 'przygotowuje', 'świetnie', 'swietnie',
  'obawy', 'chwilę', 'chwile', 'później', 'pozniej', 'teraz',
  'ofertę', 'oferty', 'oferta', 'ofertą', 'akceptacji', 'akceptacja',
  'zamawiam', 'zamówienie', 'zamowienie', 'zamówienia', 'zamowienia',
  'ewa', 'jan', 'kowalski', 'janie', 'ewo', 'panie', 'janem',
  'open', 'mercato', 'dzwonię', 'dzwonie', 'pln', 'euro',
  'około', 'okolo', 'chyba', 'jeszcze', 'razie', 'takim', 'dobra',
  'procent', 'rabatu', 'promocja', 'promocje', 'cena', 'ceny',
  'godzin', 'godziny', 'certyfikację', 'certyfikacja',
])

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
      const finalQuickAction = await this.buildQuickAction(
        session,
        'Podsumowanie rozmowy',
        0,
        1,
      )
      finalQuickAction.detectedIntent = 'Szybkie akcje po rozmowie'
      await this.emitSuggestion(session, finalQuickAction)
    } catch (err) {
      console.error('[Orchestrator] Failed to emit final quick-action card:', err)
    }

    try {
      await this.registerCallActivity(session)
    } catch (err) {
      console.error('[Orchestrator] Failed to register call activity:', err)
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
    const lines = await this.resolveQuickActionLines(session, keywords, confidence, triggerText)
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
            note: triggerText || null,
          },
        },
        { label: 'Zaplanuj follow-up', actionType: 'schedule_followup', prefill: { customerId: session.customerId } },
        { label: 'Dodaj notatkę', actionType: 'add_note', prefill: {} },
      ],
    }
  }

  private getRecentConversationSegments(session: CopilotSession, limit = 16): TranscriptSegment[] {
    return session.contextWindow
      .slice(-limit)
  }

  private buildProductSearchKeywords(segments: TranscriptSegment[], keywords: string[], limit = 8): string[] {
    // Prefer tokens from CUSTOMER segments (the buyer names the products) over
    // rep greetings/small-talk. Reverse so the most recent customer turns seed
    // the keyword set first — quote extraction happens on the final order turn,
    // so its product words matter more than the opener "Dzień dobry".
    const customerTokens = [...segments]
      .reverse()
      .filter((segment) => segment.speaker === 'customer')
      .flatMap((segment) => extractSearchKeywordsFromText(segment.text, 20))

    const repTokens = [...segments]
      .reverse()
      .filter((segment) => segment.speaker === 'rep')
      .flatMap((segment) => extractSearchKeywordsFromText(segment.text, 12))

    return Array.from(
      new Set(
        [
          ...keywords,
          ...customerTokens,
          ...repTokens,
        ]
          .map((keyword) => keyword.trim())
          .filter((keyword) => keyword.length > 0),
      ),
    ).slice(0, limit)
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

  // Scans a raw LLM response for the first balanced `{...}` JSON object and
  // returns it. Tolerates leading prose, trailing commentary, code fences,
  // and the "Actually, re-evaluating:" follow-ups that Claude sometimes emits
  // after completing the requested JSON. Strings and escapes are respected
  // so braces inside quoted rationale text don't throw off the brace counter.
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

    // Score each candidate by how many distinctive customer tokens appear in
    // its title/sku (stem-stripped and lowercased). Sort descending so the
    // most relevant rows come first, then slice. This keeps the LLM's catalog
    // view focused — alphabetical fittings are pushed to the tail.
    const customerTokens = new Set(
      segments
        .filter((segment) => segment.speaker === 'customer')
        .flatMap((segment) => extractSearchKeywordsFromText(segment.text, 30))
        .map((token) => token.trim().toLocaleLowerCase('pl-PL'))
        .filter((token) => token.length >= 3 && !PL_STOPWORDS.has(token)),
    )
    const STEM_SUFFIXES = ['owych', 'owego', 'owej', 'ami', 'ach', 'ego', 'ów', 'ow', 'om', 'y', 'i', 'a', 'e']
    const expandedCustomerTokens = new Set<string>()
    for (const token of customerTokens) {
      expandedCustomerTokens.add(token)
      for (const suffix of STEM_SUFFIXES) {
        if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
          expandedCustomerTokens.add(token.slice(0, -suffix.length))
          break
        }
      }
    }

    const scoreCandidate = (product: CopilotProductSearchResult['products'][number]): number => {
      const haystack = `${product.name} ${product.sku ?? ''}`.toLocaleLowerCase('pl-PL')
      let score = 0
      for (const token of expandedCustomerTokens) {
        if (haystack.includes(token)) score += 1
      }
      return score
    }

    const rankedCandidates = [...candidateProducts]
      .map((product) => ({ product, score: scoreCandidate(product) }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return left.product.name.localeCompare(right.product.name, 'pl')
      })
      .map((entry) => entry.product)

    const topCandidates = rankedCandidates.slice(0, 40)
    const catalogPayload = topCandidates.map((product) => ({
      id: product.id,
      title: product.name,
      sku: product.sku ?? null,
      price: product.price ?? null,
      stock: product.stockQuantity ?? null,
    }))

    console.log('[Orchestrator] extractQuoteLinesViaLlm: ranked catalog', {
      callId: session.callId,
      totalCandidates: candidateProducts.length,
      sentToLlm: topCandidates.length,
      topScores: rankedCandidates.slice(0, 10).map((product) => ({
        title: product.name,
        score: scoreCandidate(product),
      })),
    })

    const transcriptText = segments
      .map((segment, index) => `#${index + 1} [${segment.speaker}] ${segment.text.trim()}`)
      .join('\n')
      .slice(0, 6000)

    const systemPrompt = `You are a B2B sales-call transcript analyzer. Your single job is to extract the ORDER LINE ITEMS the customer actually committed to buy during the call, and map each one to a catalog product id from the CATALOG list supplied in the user message.

OUTPUT CONTRACT (strict)
- Return ONLY a JSON object. No markdown, no prose, no code fences, no trailing commentary.
- Shape: {"lines":[{"productId":"<catalog id>","quantity":<positive integer>,"confidence":<0..1>,"rationale":"<short sentence>"}]}
- Every productId MUST appear verbatim in the CATALOG. NEVER invent ids. NEVER output an id that is not in CATALOG.
- If the customer did not commit to any purchase, return {"lines":[]}.

STEP-BY-STEP EXTRACTION PROCEDURE (follow in this exact order)
1. Find the FINAL authoritative order turn — typically the customer's last utterance that contains verbs like "zamawiam" / "biorę" / "I order" / "we'll take" / "send us". This overrides any earlier hedged statements.
2. Inside that final turn, split the utterance on coordinating conjunctions: "i", "oraz", "plus", "a także", "and", commas that separate products. Each segment names ONE product.
3. For EACH segment: extract the quantity, the product type (e.g. "rura", "zawór", "kształtka"), AND every modifier that narrows the product (material like "stalowa"/"nierdzewna", shape like "kulowy"/"zwrotny", size like "DN25"/"DN50", pressure like "PN16").
4. For EACH segment: pick the ONE catalog product whose title contains ALL the modifiers the customer mentioned. Never drop a modifier. Never substitute a different material or spec.
5. Output one line per segment. If step 4 returns zero catalog matches, skip that segment (do not guess).

MULTI-ITEM RULE (critical — never collapse)
- A single sentence with "X i Y" ALWAYS produces TWO lines, one per product.
- Never skip the second product just because the first was already mapped.
- Never merge two products into a single line by combining their quantities.

QUANTITY EXTRACTION
- Convert word-form numbers (Polish or English) to digits BEFORE outputting:
  zero=0, jeden/jedna/jedno=1, dwa/dwie=2, trzy=3, cztery=4, pięć=5, sześć=6, siedem=7, osiem=8, dziewięć=9,
  dziesięć=10, jedenaście=11, dwanaście=12, ..., dziewiętnaście=19,
  dwadzieścia=20, trzydzieści=30, ..., dziewięćdziesiąt=90,
  sto=100, dwieście=200, trzysta=300, czterysta=400, pięćset=500, sześćset=600, siedemset=700, osiemset=800, dziewięćset=900,
  tysiąc=1000, "dwa tysiące"=2000, "pięć tysięcy"=5000.
  English: "five hundred"=500, "two hundred"=200, "one thousand"=1000.
  Combine compound phrases: "sto dwadzieścia"=120, "dwa tysiące pięćset"=2500.
- Strip hedging words around the number: "około", "mniej więcej", "chyba", "z", "jakieś", "ponad", "prawie", "about", "approximately", "roughly", "around". The stated number stands.
- If the customer hedges first ("około pięćset") and then confirms a final count ("zamawiam pięćset"), use the CONFIRMED count.

NOT-A-QUANTITY (hard exclusions — NEVER use these as line quantities)
- Numbers inside product codes: "DN50", "DN25", "DN80", "PN16", "PN25", "PN-EN".
- Time windows and delivery SLAs: "48 godzin", "dwa tygodnie", "za 2 dni", "w ciągu godziny", "on 2026-04-15", "Q1".
- Percentages and discounts: "12 procent", "12%", "dziesięć procent", "10%", "rabat 8%", "osiem procent".
- Money amounts and lifetime value: "20 tysięcy złotych", "142 tys. PLN", "20k zł", "€1500", "1675 zł".
- Certifications and standards: "PN-EN", "ISO 9001".
- Counts of past events: "20 zamówień w ciągu roku", "3 miesiące".
These are metadata. They must never appear as the "quantity" field on any line.

PRODUCT MATCHING (spec preservation)
- Every modifier the customer says ("stalowa", "nierdzewna", "kulowy", "zwrotny", "DN50", "DN25", "PN16") is a HARD filter.
- "rura stalowa DN50" MUST be matched to a title containing BOTH "stalowa" AND "DN50". It MUST NOT be matched to "Rura nierdzewna DN50" or "Rura stalowa DN25".
- "zawór kulowy DN25" MUST be matched to a title containing "kulowy" AND "DN25". It MUST NOT be matched to "Zawór zwrotny DN25" or "Zawór kulowy DN50".
- When the catalog has multiple pressure variants (PN16 vs PN25) and the customer does not state a pressure, prefer PN16 (the more common default).
- If no catalog row matches all required modifiers, SKIP the item. Do not fall back to a "similar" product.

SOURCE EXCLUSIONS (who said it)
- Only the CUSTOMER's own commitments count. Ignore products the REP proposes, suggests, or merely confirms availability for.
- Ignore products mentioned in competitor comparisons (e.g. "Stalmet daje nam 10%").
- Ignore products the customer explicitly rejects or defers.

WORKED EXAMPLE (this is close to a real demo; use it as a reference)
Transcript (excerpt):
  #4 [customer] Potrzebujemy rur stalowych DN50, około pięćset sztuk. I jeszcze chyba z dwieście zaworów kulowych DN25.
  #13 [rep] Rury mamy na stanie, wysyłka w 48 godzin. Zawory DN25 — sprawdzę.
  #14 [customer] Dobra, w takim razie zamawiam. Pięćset rur DN50 i dwieście zaworów kulowych DN25. Proszę przygotować ofertę.
CATALOG (excerpt):
  {"id":"<id-a>","title":"Rura stalowa DN50 PN16"}
  {"id":"<id-b>","title":"Rura stalowa DN25 PN16"}
  {"id":"<id-c>","title":"Rura nierdzewna DN50"}
  {"id":"<id-d>","title":"Rura nierdzewna DN25"}
  {"id":"<id-e>","title":"Zawór kulowy DN25"}
  {"id":"<id-f>","title":"Zawór kulowy DN50"}
  {"id":"<id-g>","title":"Zawór zwrotny DN25"}
Correct output:
  {"lines":[
    {"productId":"<id-a>","quantity":500,"confidence":0.98,"rationale":"Segment #14: 'Pięćset rur DN50' → rura stalowa DN50 PN16"},
    {"productId":"<id-e>","quantity":200,"confidence":0.98,"rationale":"Segment #14: 'dwieście zaworów kulowych DN25' → zawór kulowy DN25"}
  ]}
Why NOT {"id":"<id-d>","quantity":48}: "48" is inside "wysyłka w 48 godzin" (delivery SLA, not a quantity), "<id-d>" is nierdzewna (wrong material), and the customer's committed order is in segment #14 not segment #13.

CONFIDENCE SCALE
- 0.95-1.00: explicit quantity + explicit spec + exact single catalog match.
- 0.75-0.94: order is confirmed but one field was mildly inferred (e.g. pressure variant defaulted to PN16).
- 0.40-0.74: partial evidence, keep only if you are sure the item was actually ordered.
- below 0.40: skip the item entirely — do NOT output the line.

FINAL OUTPUT DISCIPLINE
- After emitting the JSON object, STOP. Do not add "Actually", "Note:", "Re-evaluating:", or any other commentary. The JSON is the entire response.
- If you believe the catalog is insufficient, still emit {"lines":[]} — no prose explanation.
- Never prepend or append anything to the JSON. No markdown. No backticks. No trailing newlines with text.

Output only the JSON object. No preamble. No postamble.`

    const catalogJson = JSON.stringify(catalogPayload)
    const userPrompt = `CATALOG (only these product ids are valid):
${catalogJson}

TRANSCRIPT (ordered, #N is segment index, [speaker] = rep or customer):
${transcriptText}

Return the JSON object now.`

    console.log('[Orchestrator] extractQuoteLinesViaLlm: calling LLM', {
      callId: session.callId,
      candidateProducts: catalogPayload.length,
      transcriptSegments: segments.length,
      transcriptChars: transcriptText.length,
    })

    try {
      const llm = this.container.resolve<LlmClient>('llmClient')
      const text = await llm.complete(systemPrompt, userPrompt, { temperature: 0, maxTokens: 800 })
      if (!text) return null

      console.log('[Orchestrator] extractQuoteLinesViaLlm: raw response', text.slice(0, 600))

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

      console.log('[Orchestrator] extractQuoteLinesViaLlm: parsed lines', {
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

  // Seeds the catalog slice that the LLM extractor reasons over. The MCP
  // copilot_search_products tool is schema-capped at limit 10 AND orders by
  // title ASC, so alphabetical fittings ("Dennica", "Kolano", "Mufa"...)
  // consume the slot budget before any pipe/valve row is returned. This helper
  // bypasses the tool entirely: it builds a Polish-stem-aware OR pattern from
  // the customer's distinctive tokens and hits `catalog_products` directly.
  private async fetchCandidateCatalogForLlm(
    session: CopilotSession,
    segments: TranscriptSegment[],
  ): Promise<CopilotProductSearchResult['products']> {
    const customerTokens = segments
      .filter((segment) => segment.speaker === 'customer')
      .flatMap((segment) => extractSearchKeywordsFromText(segment.text, 20))
      .map((token) => token.trim())
      .filter((token) => {
        if (token.length < 3) return false
        const lowered = token.toLocaleLowerCase('pl-PL')
        return !PL_STOPWORDS.has(lowered)
      })

    // Stem trailing Polish inflections so "zaworów"/"kulowych"/"stalowych"
    // become "zawor"/"kulow"/"stalow", which match catalog titles
    // "Zawór kulowy" / "Rura stalowa". Keep the original token too.
    const SUFFIX_STRIPS = ['owych', 'owego', 'owej', 'ami', 'ach', 'ego', 'ów', 'ow', 'om', 'y', 'i', 'a', 'e']
    const expandedTokens = new Set<string>()
    for (const token of customerTokens) {
      expandedTokens.add(token)
      const lowered = token.toLocaleLowerCase('pl-PL')
      for (const suffix of SUFFIX_STRIPS) {
        if (lowered.length > suffix.length + 2 && lowered.endsWith(suffix)) {
          expandedTokens.add(lowered.slice(0, -suffix.length))
          break
        }
      }
    }

    const distinctTokens = Array.from(expandedTokens).slice(0, 60)
    if (distinctTokens.length === 0) return []

    try {
      const em = this.container.resolve<EntityManager>('em').fork()
      const escaped = distinctTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      const pattern = `(?i)(${escaped.join('|')})`

      const products = await em.find(
        CatalogProduct,
        {
          organizationId: session.organizationId,
          tenantId: session.tenantId,
          isActive: true,
          deletedAt: null,
          $or: [
            { title: { $re: pattern } },
            { sku: { $re: pattern } },
          ],
        } as any,
        {
          orderBy: { title: 'ASC' },
          limit: 50,
        },
      )

      return products.map((product) => ({
        id: product.id,
        name: product.title,
        sku: typeof (product as any).sku === 'string' ? (product as any).sku : '',
        price: { amount: 0, currency: 'PLN', priceType: 'standard' },
        available: true,
        stockQuantity: 0,
        category: '',
      }))
    } catch (err) {
      console.error('[Orchestrator] fetchCandidateCatalogForLlm failed', err)
      return []
    }
  }

  private async resolveQuickActionLines(
    session: CopilotSession,
    keywords: string[],
    confidence: number,
    triggerText: string,
  ): Promise<VoiceCreateQuotePrefill['lines']> {
    const conversationSegments = this.getRecentConversationSegments(session)
    const aggregateKeywords = this.buildProductSearchKeywords(conversationSegments, keywords, 60)
    const aggregateProducts = aggregateKeywords.length > 0
      ? await this.callMcpTool<CopilotProductSearchResult>(
          'copilot_search_products',
          {
            keywords: aggregateKeywords,
            customerId: session.customerId,
            limit: 10,
          },
          session,
        )
      : null

    console.log('[Orchestrator] resolveQuickActionLines: aggregate search', {
      callId: session.callId,
      keywordCount: aggregateKeywords.length,
      topKeywords: aggregateKeywords.slice(0, 20),
      aggregateProductCount: aggregateProducts?.products?.length ?? 0,
    })

    // Always seed LLM candidates from the direct catalog fallback. The MCP
    // copilot_search_products tool is capped at `limit: 10` and uses
    // `orderBy: { title: 'ASC' }`, which means alphabetical fittings
    // ("Dennica", "Kolano", "Mufa"...) fill the 10-slot budget and the
    // pipes ("Rura stalowa DN50 PN16") never make it into the LLM's catalog.
    // Direct em.find supports a much larger limit and returns every row whose
    // title/sku matches any distinctive customer token.
    const directCandidates = await this.fetchCandidateCatalogForLlm(session, conversationSegments)
    const aggregateCandidateMap = new Map<string, CopilotProductSearchResult['products'][number]>()
    for (const product of aggregateProducts?.products ?? []) {
      aggregateCandidateMap.set(product.id, product)
    }
    for (const product of directCandidates) {
      if (!aggregateCandidateMap.has(product.id)) {
        aggregateCandidateMap.set(product.id, product)
      }
    }
    const llmCandidates = Array.from(aggregateCandidateMap.values())

    console.log('[Orchestrator] resolveQuickActionLines: llm candidate pool', {
      callId: session.callId,
      aggregateCount: aggregateProducts?.products?.length ?? 0,
      directCount: directCandidates.length,
      totalCandidateCount: llmCandidates.length,
      sampleTitles: llmCandidates.slice(0, 12).map((product) => product.name),
    })

    const llmLines = await this.extractQuoteLinesViaLlm(
      session,
      llmCandidates,
      conversationSegments,
      confidence,
      triggerText,
    )
    if (llmLines && llmLines.length > 0) {
      session.lastProductId = llmLines[0]?.productId ?? session.lastProductId
      return llmLines
    }

    const linesByProductId = new Map<string, VoiceCreateQuotePrefill['lines'][number]>()
    const candidateProductsBySegment = new Map<number, CopilotProductSearchResult['products']>()

    for (const segment of conversationSegments) {
      const segmentKeywords = extractSearchKeywordsFromText(segment.text, 8)
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

      const candidateProducts = Array.from(
        new Map(
          [...(segmentProducts?.products ?? []), ...(aggregateProducts?.products ?? [])]
            .map((product) => [product.id, product]),
        ).values(),
      )
      candidateProductsBySegment.set(segment.segmentId, candidateProducts)

      for (const product of candidateProducts) {
        const score = this.scoreProductAgainstSegment(segment, product)
        if (score < 2) continue

        const quantity = extractQuantityNearAliases(segment.text, this.collectProductAliases(product))
        if (quantity == null) continue

        linesByProductId.set(product.id, {
          productId: product.id,
          quantity,
          note: segment.text.trim() || triggerText || null,
          confidence: Math.round(confidence * 100) / 100,
        })
      }
    }

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

    if (linesByProductId.size === 0) {
      const productId = await this.resolveQuickActionProductId(session, keywords)
      const quantity = inferQuantityFromSegments(conversationSegments.slice(-6)) ?? 1
      if (productId) {
        session.lastProductId = productId
        return [
          {
            productId,
            quantity,
            note: triggerText || null,
            confidence: Math.round(confidence * 100) / 100,
          },
        ]
      }
      return []
    }

    const lines = Array.from(linesByProductId.values())
    session.lastProductId = lines[0]?.productId ?? session.lastProductId
    return lines
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

        console.log('[Orchestrator] registerCallActivity: call activity created', {
          callId: session.callId,
          entityId: targetId,
          interactionId: result?.interactionId ?? null,
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
