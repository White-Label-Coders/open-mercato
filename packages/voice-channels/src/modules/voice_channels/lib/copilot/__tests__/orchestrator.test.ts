import { CopilotOrchestrator } from '../orchestrator'
import type { TranscriptSegment } from '@open-mercato/voice-channels/modules/voice_channels/types'
import { generateQuickActionPrefill } from '../generate-quick-action-prefill'
import { resolveCompanyForCustomer } from '../company-context'
import { emitVoiceEvent } from '../../../events'

jest.mock('../generate-quick-action-prefill', () => ({
  generateQuickActionPrefill: jest.fn(async () => null),
}))

jest.mock('../../../ai-tools', () => ({
  __esModule: true,
  default: [],
}))

jest.mock('../company-context', () => ({
  resolveCompanyForCustomer: jest.fn(async () => null),
  readCompanyContext: jest.fn(async () => null),
  writeCompanyContext: jest.fn(async () => undefined),
  COPILOT_CONTEXT_MAX_LENGTH: 1500,
}))

jest.mock('../../../events', () => ({
  emitVoiceEvent: jest.fn(async () => undefined),
}))

const generateQuickActionPrefillMock = jest.mocked(generateQuickActionPrefill)
const resolveCompanyForCustomerMock = jest.mocked(resolveCompanyForCustomer)
const emitVoiceEventMock = jest.mocked(emitVoiceEvent)

function createContainer() {
  return {
    resolve: jest.fn((name: string) => {
      if (name === 'em') {
        return { fork: () => ({}) }
      }
      return undefined
    }),
    register: jest.fn(),
  } as any
}

describe('CopilotOrchestrator', () => {
  let orchestrator: CopilotOrchestrator
  let mockContainer: ReturnType<typeof createContainer>

  beforeEach(() => {
    mockContainer = createContainer()
    orchestrator = new CopilotOrchestrator(mockContainer)
    jest.clearAllMocks()
    generateQuickActionPrefillMock.mockResolvedValue(null)
    resolveCompanyForCustomerMock.mockResolvedValue(null)
  })

  it('startSession creates entry in sessions map', async () => {
    await orchestrator.startSession('call-1', undefined, 'tenant-1', 'org-1')
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
    await orchestrator.endSession('call-2')
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
    await expect(orchestrator.processSegment('call-3', segment)).resolves.not.toThrow()
  })

  it('prefills follow-up for the linked company when the call customer is a person', async () => {
    resolveCompanyForCustomerMock.mockResolvedValue({
      companyEntityId: 'company-1',
      companyProfileId: 'company-profile-1',
      companyName: 'Acme',
    })

    await orchestrator.startSession('call-4', 'person-1', 'tenant-1', 'org-1', 'rep-1')
    await orchestrator.endSession('call-4')

    expect(generateQuickActionPrefillMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-4',
        customerId: 'person-1',
        targetEntityId: 'company-1',
        ownerUserId: 'rep-1',
      }),
    )
  })

  it('builds note prefill targets for both person and linked company', async () => {
    resolveCompanyForCustomerMock.mockResolvedValue({
      companyEntityId: 'company-2',
      companyProfileId: 'company-profile-2',
      companyName: 'Globex',
    })
    generateQuickActionPrefillMock.mockResolvedValue({
      followUp: {
        customerId: 'person-2',
        targetEntityId: 'company-2',
        targetEntityIds: ['person-2', 'company-2'],
        callId: 'call-5',
        ownerUserId: 'rep-2',
        title: '',
        description: '',
        suggestedDate: '2026-04-15T09:00:00.000Z',
      },
      note: {
        customerId: 'person-2',
        targetEntityIds: ['person-2', 'company-2'],
        callId: 'call-5',
        summary: 'Summary',
      },
    })

    await orchestrator.startSession('call-5', 'person-2', 'tenant-1', 'org-1', 'rep-2')
    await orchestrator.endSession('call-5')

    expect(generateQuickActionPrefillMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'person-2',
        targetEntityId: 'company-2',
      }),
    )
  })

  it('emits quick actions only after the call ends', async () => {
    await orchestrator.startSession('call-6', 'person-3', 'tenant-1', 'org-1', 'rep-3')
    emitVoiceEventMock.mockClear()

    const segment: TranscriptSegment = {
      segmentId: 1,
      speaker: 'customer',
      text: 'Chcę złożyć zamówienie jeszcze dzisiaj.',
      confidence: 0.95,
      isFinal: true,
      startTime: 0,
      endTime: 2,
    }

    await orchestrator.processSegment('call-6', segment)

    expect(emitVoiceEventMock).not.toHaveBeenCalledWith(
      'voice_channels.copilot.suggestion',
      expect.objectContaining({
        suggestion: expect.objectContaining({
          type: 'quick_action',
        }),
      }),
    )

    await orchestrator.endSession('call-6')

    expect(emitVoiceEventMock).toHaveBeenCalledWith(
      'voice_channels.copilot.suggestion',
      expect.objectContaining({
        suggestion: expect.objectContaining({
          type: 'quick_action',
        }),
      }),
      expect.objectContaining({
        persistent: false,
      }),
    )
  })
})
