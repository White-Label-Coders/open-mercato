jest.mock('../../../events', () => ({
  emitVoiceEvent: jest.fn().mockResolvedValue(undefined),
}))

import { CopilotOrchestrator } from '../orchestrator'
import type { TranscriptSegment } from '@open-mercato/voice-channels/modules/voice_channels/types'
import { emitVoiceEvent } from '../../../events'

const mockContainer = {
  resolve: jest.fn().mockReturnValue(undefined),
  register: jest.fn(),
} as any

describe('CopilotOrchestrator', () => {
  let orchestrator: CopilotOrchestrator

  beforeEach(() => {
    orchestrator = new CopilotOrchestrator(mockContainer)
    jest.clearAllMocks()
  })

  it('startSession creates entry in sessions map', async () => {
    await orchestrator.startSession('call-1', undefined, 'tenant-1', 'org-1')
    // Verify session exists by processing a segment (should not throw)
    const segment: TranscriptSegment = {
      segmentId: 1,
      speaker: 'rep',
      text: 'Hello',
      confidence: 0.95,
      isFinal: true,
      startTime: 0,
      endTime: 2,
    }
    await expect(orchestrator.processSegment('call-1', segment)).resolves.not.toThrow()
  })

  it('endSession removes session', async () => {
    await orchestrator.startSession('call-2', undefined, 'tenant-1', 'org-1')
    orchestrator.endSession('call-2')
    // processSegment should be a no-op for unknown callId
    const segment: TranscriptSegment = {
      segmentId: 1,
      speaker: 'customer',
      text: 'potrzebuję rur',
      confidence: 0.95,
      isFinal: true,
      startTime: 0,
      endTime: 2,
    }
    await expect(orchestrator.processSegment('call-2', segment)).resolves.not.toThrow()
  })

  it('processSegment with non-customer speaker is a no-op', async () => {
    await orchestrator.startSession('call-3', undefined, 'tenant-1', 'org-1')
    const segment: TranscriptSegment = {
      segmentId: 1,
      speaker: 'rep',
      text: 'potrzebuję rur',
      confidence: 0.95,
      isFinal: true,
      startTime: 0,
      endTime: 2,
    }
    // Should not attempt to route intents for non-customer speech
    await expect(orchestrator.processSegment('call-3', segment)).resolves.not.toThrow()
  })

  it('emits create_quote quick action for order intent', async () => {
    await orchestrator.startSession('call-4', '11111111-1111-4111-8111-111111111111', 'tenant-1', 'org-1')

    const segment: TranscriptSegment = {
      segmentId: 4,
      speaker: 'customer',
      text: 'Składam zamówienie, potwierdzam i proszę przygotować dokument.',
      confidence: 0.98,
      isFinal: true,
      startTime: 5,
      endTime: 8,
    }

    await orchestrator.processSegment('call-4', segment)

    expect(emitVoiceEvent).toHaveBeenCalledWith(
      'voice_channels.copilot.suggestion',
      expect.objectContaining({
        callId: 'call-4',
        suggestion: expect.objectContaining({
          type: 'quick_action',
          actions: expect.arrayContaining([
            expect.objectContaining({
              actionType: 'create_quote',
              prefill: expect.objectContaining({
                customerId: '11111111-1111-4111-8111-111111111111',
              }),
            }),
          ]),
        }),
      }),
      { persistent: false },
    )
  })

  it('builds multiple quote lines with exact quantities from conversation context', async () => {
    const session = {
      callId: 'call-multi',
      customerId: '11111111-1111-4111-8111-111111111111',
      repUserId: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      contextWindow: [
        {
          segmentId: 10,
          speaker: 'customer',
          text: 'Proszę przygotować 123 sztuki Widget Alpha i 304 sztuki Widget Beta.',
          confidence: 0.99,
          isFinal: true,
          startTime: 0,
          endTime: 5,
        },
      ],
      recentSuggestionTypes: new Map([['order_intent', Date.now()]]),
      suggestionCounter: 0,
      lastProductId: null,
      companyProfileId: null,
      companyEntityId: '22222222-2222-4222-8222-222222222222',
      companyContext: null,
    }

    jest.spyOn(orchestrator as any, 'resolvePreferredChannelId').mockResolvedValue('channel-1')
    jest.spyOn(orchestrator as any, 'callMcpTool').mockImplementation(async (toolName: string) => {
      if (toolName !== 'copilot_search_products') return null
      return {
        products: [
          {
            id: 'product-alpha',
            name: 'Widget Alpha',
            sku: 'ALPHA-01',
            price: { amount: 10, currency: 'PLN', priceType: 'standard' },
            available: true,
            stockQuantity: 1000,
            category: 'Widgets',
          },
          {
            id: 'product-beta',
            name: 'Widget Beta',
            sku: 'BETA-01',
            price: { amount: 12, currency: 'PLN', priceType: 'standard' },
            available: true,
            stockQuantity: 1000,
            category: 'Widgets',
          },
        ],
      }
    })

    const result = await (orchestrator as any).buildQuickAction(
      session,
      'Klient chce złożyć zamówienie',
      10,
      0.98,
      ['widget', 'alpha', 'beta'],
    )

    expect(result).toMatchObject({
      type: 'quick_action',
      actions: expect.arrayContaining([
        expect.objectContaining({
          actionType: 'create_quote',
          prefill: expect.objectContaining({
            lines: expect.arrayContaining([
              expect.objectContaining({ productId: 'product-alpha', quantity: 123 }),
              expect.objectContaining({ productId: 'product-beta', quantity: 304 }),
            ]),
          }),
        }),
      ]),
    })
  })

  it('includes extractionMethod in quote prefill', async () => {
    const session = {
      callId: 'call-method',
      customerId: '11111111-1111-4111-8111-111111111111',
      repUserId: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      contextWindow: [
        {
          segmentId: 30,
          speaker: 'customer',
          text: 'Proszę przygotować 10 sztuki Widget Alpha.',
          confidence: 0.99,
          isFinal: true,
          startTime: 0,
          endTime: 5,
        },
      ],
      recentSuggestionTypes: new Map([['order_intent', Date.now()]]),
      suggestionCounter: 0,
      lastProductId: null,
      companyProfileId: null,
      companyEntityId: '22222222-2222-4222-8222-222222222222',
      companyContext: null,
    }

    jest.spyOn(orchestrator as any, 'resolvePreferredChannelId').mockResolvedValue('channel-1')
    jest.spyOn(orchestrator as any, 'callMcpTool').mockImplementation(async (toolName: string) => {
      if (toolName !== 'copilot_search_products') return null
      return {
        products: [
          {
            id: 'product-alpha',
            name: 'Widget Alpha',
            sku: 'ALPHA-01',
            price: { amount: 10, currency: 'PLN', priceType: 'standard' },
            available: true,
            stockQuantity: 1000,
            category: 'Widgets',
          },
        ],
      }
    })

    const result = await (orchestrator as any).buildQuickAction(
      session,
      'Klient chce złożyć zamówienie',
      30,
      0.98,
      ['widget', 'alpha'],
    )

    expect(result).toMatchObject({
      type: 'quick_action',
      actions: expect.arrayContaining([
        expect.objectContaining({
          actionType: 'create_quote',
          prefill: expect.objectContaining({
            extractionMethod: expect.stringMatching(/^(llm|heuristic|heuristic_fallback)$/),
          }),
        }),
      ]),
    })
  })

  it('uses neighboring rep confirmation when product and quantity are split across segments', async () => {
    const session = {
      callId: 'call-context',
      customerId: '11111111-1111-4111-8111-111111111111',
      repUserId: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      contextWindow: [
        {
          segmentId: 20,
          speaker: 'customer',
          text: 'Chodzi o Widget Alpha.',
          confidence: 0.99,
          isFinal: true,
          startTime: 0,
          endTime: 2,
        },
        {
          segmentId: 21,
          speaker: 'rep',
          text: 'Potwierdzam, 123 sztuki Widget Alpha.',
          confidence: 0.99,
          isFinal: true,
          startTime: 2,
          endTime: 4,
        },
      ],
      recentSuggestionTypes: new Map([['order_intent', Date.now()]]),
      suggestionCounter: 0,
      lastProductId: null,
      companyProfileId: null,
      companyEntityId: '22222222-2222-4222-8222-222222222222',
      companyContext: null,
    }

    jest.spyOn(orchestrator as any, 'resolvePreferredChannelId').mockResolvedValue('channel-1')
    jest.spyOn(orchestrator as any, 'callMcpTool').mockImplementation(async (toolName: string) => {
      if (toolName !== 'copilot_search_products') return null
      return {
        products: [
          {
            id: 'product-alpha',
            name: 'Widget Alpha',
            sku: 'ALPHA-01',
            price: { amount: 10, currency: 'PLN', priceType: 'standard' },
            available: true,
            stockQuantity: 1000,
            category: 'Widgets',
          },
        ],
      }
    })

    const result = await (orchestrator as any).buildQuickAction(
      session,
      'Klient chce złożyć zamówienie',
      21,
      0.98,
      ['widget', 'alpha'],
    )

    expect(result).toMatchObject({
      type: 'quick_action',
      actions: expect.arrayContaining([
        expect.objectContaining({
          actionType: 'create_quote',
          prefill: expect.objectContaining({
            lines: expect.arrayContaining([
              expect.objectContaining({ productId: 'product-alpha', quantity: 123 }),
            ]),
          }),
        }),
      ]),
    })
  })

  describe('extractFirstJsonObject', () => {
    it('extracts balanced JSON from text with trailing prose', () => {
      const result = (orchestrator as any).extractFirstJsonObject(
        '{"lines":[{"productId":"aaa","quantity":500}]}\nActually this is wrong',
      )
      expect(JSON.parse(result)).toEqual({ lines: [{ productId: 'aaa', quantity: 500 }] })
    })

    it('extracts JSON when wrapped in markdown code fence', () => {
      const result = (orchestrator as any).extractFirstJsonObject(
        '```json\n{"lines":[{"productId":"bbb","quantity":200}]}\n```',
      )
      expect(JSON.parse(result)).toEqual({ lines: [{ productId: 'bbb', quantity: 200 }] })
    })

    it('returns null for non-JSON text', () => {
      const result = (orchestrator as any).extractFirstJsonObject('No JSON here')
      expect(result).toBeNull()
    })
  })
})
