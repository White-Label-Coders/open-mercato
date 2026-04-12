import { POST } from '../route'

const resolveRequestContextMock = jest.fn()

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: (...args: unknown[]) => resolveRequestContextMock(...args),
}))

describe('voice channel copilot summarize route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveRequestContextMock.mockResolvedValue({
      ctx: {
        auth: {
          tenantId: 'tenant-1',
        },
      },
    })
  })

  it('returns 400 for malformed json bodies', async () => {
    const request = {
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected end of JSON input')),
    } as unknown as Request

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request body' })
  })
})
