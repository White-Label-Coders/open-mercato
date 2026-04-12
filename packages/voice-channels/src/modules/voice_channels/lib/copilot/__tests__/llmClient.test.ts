import { createLlmClient } from '../llmClient'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(response: { status: number; body: unknown }): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: () => Promise.resolve(response.body),
    text: () => Promise.resolve(JSON.stringify(response.body)),
  })
  globalThis.fetch = mock
  return mock
}

describe('createLlmClient', () => {
  it('returns null when API key is empty', async () => {
    const client = createLlmClient({ provider: 'anthropic', apiKey: '' })
    const result = await client.complete('system', 'user')
    expect(result).toBeNull()
  })

  it('builds Anthropic request shape', async () => {
    const mock = mockFetch({
      status: 200,
      body: { content: [{ text: '{"result": true}' }] },
    })
    const client = createLlmClient({ provider: 'anthropic', apiKey: 'test-key', model: 'test-model' })
    await client.complete('sys prompt', 'user prompt', { temperature: 0 })

    expect(mock).toHaveBeenCalledTimes(1)
    const [url, options] = mock.mock.calls[0]
    expect(url).toContain('anthropic')
    const body = JSON.parse(options.body)
    expect(body.system).toBe('sys prompt')
    expect(body.messages[0].content).toBe('user prompt')
    expect(body.model).toBe('test-model')
    expect(options.headers['x-api-key']).toBe('test-key')
  })

  it('builds OpenAI request shape', async () => {
    const mock = mockFetch({
      status: 200,
      body: { choices: [{ message: { content: 'hello' } }] },
    })
    const client = createLlmClient({ provider: 'openai', apiKey: 'oai-key' })
    await client.complete('sys', 'user')

    const [url, options] = mock.mock.calls[0]
    expect(url).toContain('openai')
    const body = JSON.parse(options.body)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
    expect(options.headers['Authorization']).toBe('Bearer oai-key')
  })

  it('builds Google request shape', async () => {
    const mock = mockFetch({
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: 'hi' }] } }] },
    })
    const client = createLlmClient({ provider: 'google', apiKey: 'g-key' })
    await client.complete('sys', 'user')

    const [url] = mock.mock.calls[0]
    expect(url).toContain('generativelanguage.googleapis.com')
    expect(url).toContain('key=g-key')
  })

  it('strips code fences from response', async () => {
    mockFetch({
      status: 200,
      body: { content: [{ text: '```json\n{"ok": true}\n```' }] },
    })
    const client = createLlmClient({ provider: 'anthropic', apiKey: 'k' })
    const result = await client.complete('s', 'u')
    expect(result).toBe('{"ok": true}')
  })

  it('returns null on HTTP error', async () => {
    mockFetch({ status: 500, body: { error: 'server error' } })
    const client = createLlmClient({ provider: 'anthropic', apiKey: 'k', maxRetries: 0 })
    const result = await client.complete('s', 'u')
    expect(result).toBeNull()
  })
})
