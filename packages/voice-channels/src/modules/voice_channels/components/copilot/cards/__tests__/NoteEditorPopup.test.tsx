/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { NoteEditorPopup } from '../NoteEditorPopup'

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

describe('NoteEditorPopup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useGuardedMutationMock.mockReturnValue({
      runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
      retryLastMutation: async () => true,
    })
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 201,
      result: { id: 'comment-1' },
      response: { ok: true, status: 201 } as Response,
      cacheStatus: null,
    } as Awaited<ReturnType<typeof apiCall>>)
  })

  it('creates notes for both the person and linked company when both targets are present', async () => {
    const onOpenChange = jest.fn()
    const onSuccess = jest.fn()

    renderWithProviders(
      <NoteEditorPopup
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        segments={[]}
        prefill={{
          customerId: 'person-1',
          targetEntityIds: ['person-1', 'company-1'],
          callId: 'call-1',
          summary: 'Call summary',
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledTimes(2)
    })

    expect(apiCallMock).toHaveBeenNthCalledWith(
      1,
      '/api/customers/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          entityId: 'person-1',
          body: 'Call summary',
          appearanceIcon: 'lucide:message-square-text',
        }),
      }),
    )

    expect(apiCallMock).toHaveBeenNthCalledWith(
      2,
      '/api/customers/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          entityId: 'company-1',
          body: 'Call summary',
          appearanceIcon: 'lucide:message-square-text',
        }),
      }),
    )
  })
})
