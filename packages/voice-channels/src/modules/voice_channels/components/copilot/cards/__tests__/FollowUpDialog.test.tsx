/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { FollowUpDialog } from '../FollowUpDialog'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const apiCallMock = jest.mocked(apiCall)
const useGuardedMutationMock = jest.mocked(useGuardedMutation)

describe('FollowUpDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useGuardedMutationMock.mockReturnValue({
      runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
      retryLastMutation: async () => true,
    })
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 201,
      result: { interactionId: 'interaction-1', id: 'interaction-1' },
      response: { ok: true, status: 201 } as Response,
      cacheStatus: null,
    } as Awaited<ReturnType<typeof apiCall>>)
  })

  it('creates the follow-up task on all resolved target entities', async () => {
    const onOpenChange = jest.fn()
    const onSuccess = jest.fn()
    const expectedScheduledAt = new Date('2026-04-14T09:00').toISOString()

    renderWithProviders(
      <FollowUpDialog
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        prefill={{
          customerId: 'person-1',
          targetEntityId: 'company-1',
          targetEntityIds: ['person-1', 'company-1'],
          callId: 'call-1',
          ownerUserId: 'rep-1',
          title: 'Follow-up',
          description: 'Call back tomorrow',
          suggestedDate: '2026-04-14T09:00:00.000Z',
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }))

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledTimes(2)
      expect(apiCallMock).toHaveBeenNthCalledWith(
        1,
        '/api/customers/interactions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            entityId: 'person-1',
            interactionType: 'task',
            title: 'Follow-up',
            body: 'Call back tomorrow',
            status: 'planned',
            scheduledAt: expectedScheduledAt,
            ownerUserId: 'rep-1',
            appearanceIcon: 'lucide:calendar-check',
            source: 'voice_channels.copilot:call-1',
          }),
        }),
      )
      expect(apiCallMock).toHaveBeenNthCalledWith(
        2,
        '/api/customers/interactions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            entityId: 'company-1',
            interactionType: 'task',
            title: 'Follow-up',
            body: 'Call back tomorrow',
            status: 'planned',
            scheduledAt: expectedScheduledAt,
            ownerUserId: 'rep-1',
            appearanceIcon: 'lucide:calendar-check',
            source: 'voice_channels.copilot:call-1',
          }),
        }),
      )
    })
  })
})
